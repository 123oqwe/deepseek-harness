/**
 * A-591 (P4-09 acceptance[1], green evidence): a nested `agent()` child whose
 * provider START is still IN FLIGHT when the parent run is cancelled is refused
 * before its body runs — it is NOT published as a live run.
 *
 * `cancel()` (host.ts:350) aborts the controller and disposes the children it
 * already tracks, but a start parked inside `await this.subagents.start` (:542)
 * is in neither `this.children` nor `this.nestedRuns` yet, so `abortChildren`
 * cannot reach it. The guard that does is the admission RE-CHECK after the await
 * resolves (:577-580): `childAdmissionFailure()` sees the `cancelReason` the
 * cancel set, so the started child is handed to `refuseStartedChild` (posts
 * `ChildStartError`, disposes the run) instead of being published.
 *
 * The provider here is a FIXTURE: its start parks on a test-controlled gate (so
 * the cancel lands deterministically while the start is in flight, not by
 * racing), and its run DELIBERATELY IGNORES the aborted signal. That isolation
 * matters — if the provider honoured the signal, the signal alone would stop the
 * child and the :577-580 re-check would no longer be the sole guard, so the
 * mutation below would not red. The child's "body" (a marker written to disk)
 * runs only after a short delay and only while the run has not been disposed, so
 * `refuseStartedChild`'s dispose is the ONE reason the marker is absent.
 *
 * Green today (the re-check refuses the in-flight child). The paired mutation —
 * removing the :577-580 await-then-re-check — publishes the child started during
 * cancel as a live run, its body runs, and the marker APPEARS, reddening the
 * main case. Only the provider is a fixture; `host.ts` is the real engine host,
 * and a gated provider cannot be injected through a shipped composition, so this
 * is a focused worker-thread test rather than a first100 e2e (delegate ruling
 * gate3 2026-10-04T04:58:02Z).
 * @module tests/nested-cancel-inflight-start
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentCapabilities, SubagentProvider, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { WorkflowMeta } from '@deepseek-ai/dsh-workflow'
import WorkerThreadWorkflowEngine from '../src/index.ts'

const META: WorkflowMeta = { name: 'a591-parent', description: 'nests one agent whose start is gated', phases: [] }
const PROVIDER = 'a591-gated'
/** The child body's delay: long enough that `refuseStartedChild`'s synchronous dispose always precedes it. */
const BODY_DELAY_MS = 400

vi.setConfig({ testTimeout: 30_000 })

/** Wait up to 60s for cold worker-thread startup on contended CI (the nested-run.spec.ts allowance). */
function waitFor(assertion: () => void): Promise<void> {
  return vi.waitFor(assertion, { timeout: 60_000, interval: 50 })
}

/** One gated child start: `publish()` releases the parked start; `disposed` records the host's refusal dispose. */
interface GatedRun {
  publish(): void
  disposed: boolean
}

/**
 * A fixture subagent provider whose start parks until {@link GatedRun.publish},
 * IGNORES the request signal, and returns a run whose body writes a marker after
 * {@link BODY_DELAY_MS} unless the run was disposed first. Ignoring the signal is
 * deliberate: it makes `refuseStartedChild`'s dispose the ONLY thing that can
 * stop the marker, so the :577-580 re-check is the sole guard under test.
 */
class GatedMarkerProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    outputSchema: true,
    depthLimit: true,
    toolFilter: true,
    persona: false,
  }

  readonly inheritsParentContext = false
  readonly runs: GatedRun[] = []

  constructor(readonly name: string, private readonly markerPath: string) {}

  async start(_request: SubagentStartRequest): Promise<SubagentRun> {
    const gate = Promise.withResolvers<undefined>()
    let disposed = false
    const controlled: GatedRun = { publish: () => { gate.resolve(undefined) }, disposed: false }
    this.runs.push(controlled)
    const index = this.runs.length - 1
    // No signal listener, by design (see the class doc): this start resolves on
    // the gate alone, so a published child reaches the host even on an aborted
    // signal and only the host's re-check can refuse it.
    await gate.promise
    return {
      id: SessionId(`a591-child-${index}`),
      localAgent: undefined,
      result: (async (): Promise<SubagentResult> => {
        await delay(BODY_DELAY_MS)
        if (!disposed) writeFileSync(this.markerPath, 'child body ran')
        return { output: [], stopReason: disposed ? 'aborted' : 'completed' }
      })(),
      dispose: () => { disposed = true; controlled.disposed = true; return Promise.resolve() },
    }
  }
}

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A minimal parent stand-in: the engine only threads it through to the fixture provider (which ignores it). */
function fakeParent(): Agent {
  return { id: SessionId('a591-parent'), options: {} } as unknown as Agent
}

async function setup(): Promise<{ ctx: Context; parent: Agent; provider: GatedMarkerProvider; markerPath: string }> {
  const root = mkdtempSync(join(tmpdir(), 'a591-'))
  roots.push(root)
  const markerPath = join(root, 'child-body-marker')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  const provider = new GatedMarkerProvider(PROVIDER, markerPath)
  ctx.subagents.registerProvider(provider)
  await ctx.plugin(InMemoryLeaseStorePlugin)
  // `maxNestedTokens: 0` (no tree token limit): this fixture's run reports no
  // local agent, which the engine treats as a remote child and refuses at
  // host.ts:587 whenever a token limit is set — a refusal that would mask the
  // admission re-check this case is about, and would refuse the control child
  // too. The cancel re-check (:577) runs BEFORE :587, so the main case is
  // unaffected; the control needs :587 skipped to publish the child.
  await ctx.plugin(WorkerThreadWorkflowEngine, { provider: PROVIDER, maxNestedTokens: 0, maxConcurrentAgents: 8 })
  return { ctx, parent: fakeParent(), provider, markerPath }
}

describe('P4-09 acceptance[1] (A-591, green evidence): a child whose start is in flight at cancel is refused, not published', () => {
  it('the in-flight child is refused before its body runs — no marker is written', async () => {
    const { ctx, parent, provider, markerPath } = await setup()
    const handle = ctx.workflowEngine.start({ script: "return await agent('child task')", meta: META, parent })
    // The start is parked inside `await this.subagents.start` (host.ts:542).
    await waitFor(() => { expect(provider.runs.length).toBe(1) })
    // The parent cancels while the start is in flight: abortChildren cannot see
    // this start (it is in neither children nor nestedRuns yet).
    handle.cancel('a591 user stop')
    // Release the gate: the start resolves and the host's :577-580 re-check runs.
    provider.runs[0]!.publish()
    const result = await handle.result
    expect(result.stopReason).toBe('cancelled')
    await handle.dispose()
    // Give the child body's delayed write its full window; the refused child's
    // dispose ran synchronously at :577, so `disposed` is set well before it.
    await delay(BODY_DELAY_MS + 200)
    expect(existsSync(markerPath), 'the refused in-flight child must not run its body').toBe(false)
    expect(provider.runs[0]!.disposed).toBe(true)
  })

  it('control: with no cancel, the same gated child is published and its body runs — the marker appears', async () => {
    const { ctx, parent, provider, markerPath } = await setup()
    const handle = ctx.workflowEngine.start({ script: "return await agent('child task')", meta: META, parent })
    await waitFor(() => { expect(provider.runs.length).toBe(1) })
    // No cancel: releasing the gate publishes the child as a live run, so its
    // body runs and writes the marker. This proves the marker mechanism itself
    // works, so the main case's absence is the refusal, not a dead body.
    provider.runs[0]!.publish()
    const result = await handle.result
    expect(result.stopReason).toBe('completed')
    await handle.dispose()
    expect(existsSync(markerPath), 'a published child runs its body and writes the marker').toBe(true)
  })
})
