/**
 * Driver for P5-10's shipped-composition cases (acceptance[0], the
 * simultaneous half): boot the SHIPPED headless profile with
 * `./base.patch.yml`, let the configured root agent take one turn, start one
 * continuable child from it through `ctx.subagents.startContinuable` (the call
 * the shipped `subagent` tool makes in continuable mode), wait for the child's
 * first turn to end, and send the child one plain-text prompt through
 * `ctx.subagents.prompt`.
 *
 * In `race` mode the driver calls `interruptByParent` synchronously right after
 * `prompt` returns its pending promise and before awaiting it. By then the
 * prompt has been admitted and not yet enqueued: the child lock runs its
 * critical section on a later microtask even when it is free. In `control`
 * mode it sends the same prompt and does not interrupt.
 *
 * It prints one `P5-10-K1B <json>` line: what was mounted, whether the child's
 * first turn ended, the interrupt's receipt or error, the prompt's outcome,
 * the child's statuses from the moment the prompt was sent, and the request
 * ids of the child's logged user messages.
 * @module tests/first100/fixtures/loader/p5-10-control/driver
 */

import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type { SubagentInterruptReceipt, SubagentPromptRequest, SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The request id of the one prompt the driver sends. */
const REQUEST_ID = 'p5-10-k1b'
/** Longest wait for the child's first turn to end. */
const FIRST_TURN_MS = 30_000
/** How long the driver waits, once the prompt has settled, for a child turn to end. */
const SETTLE_MS = 3_000
/** Polling interval for the two waits above. */
const POLL_MS = 25

/** What the driver prints. */
interface Report {
  readonly mounted: { readonly subagents: boolean; readonly spawn: boolean }
  readonly firstTurn?: boolean
  readonly interrupt?: SubagentInterruptReceipt | { readonly error: string }
  readonly outcome?: { readonly delivered: string } | { readonly refused: string }
  readonly statusesAfterPrompt?: readonly string[]
  readonly childRpcIds?: readonly string[]
}

/**
 * The code a rejection carries, or its text when it carries none.
 * @param error - the thrown value.
 * @returns the `RemoteError` code, or the error's string form.
 */
function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : String(error)
}

/**
 * Poll until `done` holds or `timeoutMs` passes.
 * @param done - the condition.
 * @param timeoutMs - the longest wait.
 * @returns whether the condition held.
 */
async function until(done: () => boolean, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    if (done()) return true
    await delay(POLL_MS)
  }
  return done()
}

/**
 * Start a continuable child, send it one prompt, and report what happened.
 * @param ctx - the booted root context.
 * @param race - whether to interrupt the child right after the prompt is admitted.
 * @returns the observation.
 */
async function observe(ctx: Context, race: boolean): Promise<Report> {
  const subagents = ctx.get('subagents')
  const mounted = { subagents: subagents !== undefined, spawn: subagents?.getProvider('spawn') !== undefined }
  if (subagents === undefined) return { mounted }

  await runFixtureTurn(ctx, { task: 'P5-10: the parent takes one turn before it starts a child.' })
  const [parent] = ctx.agents.roots()
  if (parent === undefined) throw new Error('no root agent after the parent turn')

  const turnEnds = new Map<string, number>()
  const rpcIds = new Map<string, string[]>()
  const statuses: string[] = []
  const watched: { child?: string } = {}
  ctx.on('session/event', (session, event) => {
    const id = String(session.id)
    if (event.type === 'turn/end') turnEnds.set(id, (turnEnds.get(id) ?? 0) + 1)
    if (event.type === 'user/message') {
      const { rpcId } = event.data.source as { readonly rpcId?: unknown }
      if (typeof rpcId === 'string') rpcIds.set(id, [...rpcIds.get(id) ?? [], rpcId])
    }
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (watched.child !== undefined && String(agent.id) === watched.child) statuses.push(status)
  })

  const started = await subagents.startContinuable({
    provider: 'spawn',
    label: 'p5-10 child',
    request: { prompt: [{ type: 'text', text: 'P5-10: the child takes its first turn.' }], parent },
    signal: new AbortController().signal,
  })
  const child = String(started.childId)
  const firstTurn = await until(() => (turnEnds.get(child) ?? 0) >= 1, FIRST_TURN_MS)
  await ctx.agents.get(started.childId)?.whenIdle()

  const request: SubagentPromptRequest = {
    requestId: brandString<SubagentPromptRequestId>(REQUEST_ID),
    parentSessionId: parent.id,
    childSessionId: started.childId,
    mode: 'continuable',
    delivery: 'queue',
    content: [{ type: 'text', text: 'P5-10: take another turn.' }],
  }
  const endsBefore = turnEnds.get(child) ?? 0
  watched.child = child
  const pending = subagents.prompt(request, new AbortController().signal)
  // Synchronous, before `pending` is awaited: the prompt is admitted and its
  // enqueue waits for the child lock's next microtask.
  let interrupt: Report['interrupt']
  if (race) {
    try {
      interrupt = subagents.interruptByParent(started.childId, parent.id, 'continuable')
    } catch (error: unknown) {
      interrupt = { error: errorCode(error) }
    }
  }
  const outcome = await pending.then(
    (receipt): Report['outcome'] => ({ delivered: String(receipt.messageId) }),
    (error: unknown): Report['outcome'] => ({ refused: errorCode(error) }),
  )
  await until(() => (turnEnds.get(child) ?? 0) > endsBefore, SETTLE_MS)
  await ctx.agents.get(started.childId)?.whenIdle()
  return { mounted, firstTurn, interrupt, outcome, statusesAfterPrompt: statuses, childRpcIds: rpcIds.get(child) ?? [] }
}

const [configPath, mode] = process.argv.slice(2)
if (configPath === undefined || (mode !== 'race' && mode !== 'control')) {
  throw new Error('p5-10 driver requires a config path and `race` or `control`')
}

const ctx = await bootProductionProfile({
  binName: 'p5-10-control',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  process.stdout.write(`P5-10-K1B ${JSON.stringify(await observe(ctx, mode === 'race'))}\n`)
} finally {
  await ctx.fiber.dispose()
}
