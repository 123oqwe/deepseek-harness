/**
 * Driver for P4-06 lock (a)'s claim-before-record measurement (BLOCKED-088,
 * blind review F2): an inbox message claimed by a turn but not yet written to
 * the conversation record, when that turn is refused in pre-step, must not be
 * lost — it must take effect exactly once.
 *
 * One process on the SHIPPED headless profile with `./base.patch.yml`:
 * - creates the root agent after boot;
 * - delivers a MARKED user message through `followup`, which the loop claims out
 *   of the inbox (agent.ts:272) and passes to the `agent/pre-step` waterfall.
 *   `./pre-step-reject.ts` rejects the first pre-step carrying the marker, so the
 *   turn ends `blocked` before the message is written to the record (agent.ts:433)
 *   and the refused turn's end consumes the claim — the message is neither pending
 *   nor recorded, lost;
 * - delivers a CONTROL message, which is not rejected and is recorded once (and is
 *   a later turn in which a fix that re-queued the claimed message would record it);
 * - flushes and reads the parent's durable log, reporting how many times each
 *   message reached the conversation record.
 *
 * Prints one `P4-06-CLAIM-LOST <json>` line. P4-06 lock (a) requires the marked
 * message to reach the record exactly once.
 * @module tests/first100/fixtures/loader/p4-06-inbox-claim-lost/driver
 */

import { writeSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { REJECT_MARKER } from './pre-step-reject.ts'

/** The route the scripted model registers. */
const PROVIDER = 'p4-06-inbox-claim-lost-mock'
/** A message that is never rejected, recorded once — the control that proves the loop records normally. */
const CONTROL_TEXT = 'P4-06-CONTROL: this message is recorded normally.'
/** The line the driver reports under. */
const REPORT_TAG = 'P4-06-CLAIM-LOST'

/**
 * How many user messages in one session's durable log carry `needle` in their text.
 * @param ctx - the booted root context.
 * @param id - the session to read.
 * @param needle - the marker text to count.
 * @returns the count, or `null` when no session query is mounted.
 */
async function recordedCount(ctx: Context, id: SessionId, needle: string): Promise<number | null> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) return null
  using observation = await query.observeSession(id)
  return observation.events.filter((event) => {
    if (event.type !== 'user/message') return false
    const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    return text.includes(needle)
  }).length
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p4-06 inbox-claim-lost driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'p4-06-inbox-claim-lost',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await createFixtureRootAgent(ctx, { provider: PROVIDER, model: PROVIDER, cwd: process.cwd() })
  const [parent] = ctx.agents.roots()
  if (parent === undefined) throw new Error('p4-06 inbox-claim-lost driver: no root agent after creation')
  await parent.whenIdle()

  // Delivered, claimed, then refused in pre-step before the record: lost today.
  parent.followup(createUserMessage({
    content: [{ type: 'text', text: `${REJECT_MARKER}: this message is claimed then refused between the claim and the record.` }],
    source: { kind: 'user' },
  }))
  await parent.whenIdle()
  await ctx.sessions.flush(parent.session)
  const markedAfterReject = await recordedCount(ctx, parent.id, REJECT_MARKER)

  // A control message the pre-step does not reject, and a later turn in which a
  // fix that re-queued the claimed message would record it.
  parent.followup(createUserMessage({ content: [{ type: 'text', text: CONTROL_TEXT }], source: { kind: 'user' } }))
  await parent.whenIdle()
  await ctx.sessions.flush(parent.session)

  writeSync(1, `${REPORT_TAG} ${JSON.stringify({
    parent: parent.id,
    // The business effect P4-06 lock (a) requires to be exactly one: the marked
    // message in the parent's durable record. Zero today (claimed then lost).
    markedRecorded: await recordedCount(ctx, parent.id, REJECT_MARKER),
    markedRecordedBeforeControl: markedAfterReject,
    // The control proves the loop records a message it does not refuse.
    controlRecorded: await recordedCount(ctx, parent.id, CONTROL_TEXT),
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
