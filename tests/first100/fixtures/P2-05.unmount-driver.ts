/**
 * P2-05 acceptance[2] as C18 narrowed it ("the policy service fails closed
 * once unmounted") on the shipped `sdk-minimal` composition.
 *
 * It boots that profile through `bootProductionProfile` with the Trust Kernel
 * pinned the way `apps/cli/src/profile-boot.ts` pins it, over the same test
 * overlay the BLOCKED-266 observations use, and drives one tool call. It then
 * disables the `policy-engine` row the way a running process unmounts a
 * composed row: a new patch list on the root include entry, which recomposes
 * its subtree (what `watchUserPatches` does on the live `web` profile), and
 * drives the same tool call again. It records what each call met and writes the record to
 * `observation.json` in its working directory; the spec beside it judges.
 *
 * The model is a scripted adapter registered here rather than the overlay's
 * one-shot mock: this observation needs a tool call in each of two turns, and
 * a request made for another purpose (a session title, a compaction) is
 * answered with text so it cannot consume a turn's tool call.
 */

import { writeFile } from 'node:fs/promises'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlay = fileURLToPath(new URL('../../../packages/bundle/sdk-app/tests/fixtures/sdk-minimal-pep.patch.yml', import.meta.url))

const PROVIDER = 'p2-05-unmount-mock'
const PROBE_TOOL = 'p2_05_probe'
const POLICY_ENGINE_PLUGIN = '@deepseek-ai/dsh-policy-engine-cedar'

/** Every audit payload the kernel was handed, in order: the policy decisions are read here. */
const auditEntries: unknown[] = []

/** How many times the probe tool's own body ran. */
let probeRuns = 0

let callCount = 0
/**
 * One scripted model answer: a probe call for a turn's opening request, text
 * for the request after the tool result and for any side request.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions) {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(`p2-05-${String(++callCount)}`, PROBE_TOOL, {}) : textResponse('done')
}

/**
 * The text of every tool result the session log holds, in order.
 * @param ctx - the booted context.
 * @returns one string per tool result.
 */
function toolResultTexts(ctx: Awaited<ReturnType<typeof bootProductionProfile>>): string[] {
  return ctx.sessions.list().flatMap(session => session.snapshotEvents()).flatMap(event => event.type !== 'tool/result' ? [] : [
    event.data.message.content.flatMap(block =>
      block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
  ])
}

/**
 * The effect and reason of every decision the kernel audited, in order.
 * @returns one entry per audited decision.
 */
function auditedDecisions(): { effect: unknown, reason: unknown }[] {
  return auditEntries.map((payload) => {
    const decision = (payload as { decision?: { effect?: unknown, reason?: unknown } }).decision
    return { effect: decision?.effect, reason: decision?.reason }
  })
}

const ctx = await bootProductionProfile({
  binName: 'p2-05-unmount-observation',
  profile: 'sdk-minimal',
  overlayPaths: [resolveConfigPath(overlay, undefined)],
  // The real launcher's own two lines, with this deployment's audit sink:
  // the policy decisions are recorded there and nowhere else.
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: (entry) => { auditEntries.push(entry.payload) },
    }))
  },
})
try {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a harmless probe that records that it ran',
    parameters: {},
    execute: () => {
      probeRuns += 1
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })

  const policyMountedBefore = ctx.get('policy') !== undefined
  await runFixtureTurn(ctx, { task: 'run the probe' })
  const before = { probeRuns, results: toolResultTexts(ctx), decisions: auditedDecisions() }

  // The composed rows live under the root include entry, so the row is
  // disabled by a patch targeting its own id, not by resolving it at the root.
  const row = [...ctx.loader.entries()].find(entry => entry.options.name === POLICY_ENGINE_PLUGIN)
  if (row === undefined) throw new Error(`no Loader row mounts ${POLICY_ENGINE_PLUGIN}`)
  const include = ctx.loader.resolve('include')
  const { patches = [], ...includeConfig } = include.options.config as { patches?: PatchOptions[] }
  await include.update({ config: { ...includeConfig, patches: [...patches, { id: row.options.id, disabled: true }] } })
  await ctx.loader.await()
  const unmount = { rowId: row.options.id, policyMountedAfter: ctx.get('policy') !== undefined }

  await runFixtureTurn(ctx, { task: 'run the probe again' })
  const after = {
    probeRuns: probeRuns - before.probeRuns,
    results: toolResultTexts(ctx).slice(before.results.length),
    decisions: auditedDecisions().slice(before.decisions.length),
  }

  await writeFile('observation.json', `${JSON.stringify({
    profile: 'sdk-minimal',
    trustKernel: ctx.get('trustKernel') !== undefined,
    policyMountedBefore,
    before,
    unmount,
    after,
  }, null, 2)}\n`, 'utf8')
} finally {
  await ctx.fiber.dispose()
}
