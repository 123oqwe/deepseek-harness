/**
 * B-709 red first (P4-09 acceptance[1], the `workflow()` nested path): a nested
 * WORKFLOW run whose start is still IN FLIGHT when the parent run is cancelled
 * must be cancelled before its body runs — it must NOT be published as a live
 * run. This is the workflow() twin of the agent() case A-591 covers: A-591
 * showed `startChild`'s post-await admission re-check (host.ts:577-580) closes
 * the window on the agent() path; this one shows the `workflow()` path (`nest`,
 * host.ts:869) leaves it OPEN today.
 *
 * `nest` awaits `this.nesting.startNested` (:870) and only then adds the run to
 * `nestedRuns` (:875) — with NO re-check of `cancelReason` after the await
 * (unlike :577-580) and the registration AFTER the await (the comment at
 * :872-874 claims "before"). So a `cancel()` that arrives while the start is in
 * flight finds `nestedRuns` empty (its loop at host.ts:358 has nothing), and the
 * run is then published and run uncancelled.
 *
 * The fixture gates `startNested` (via `vi.spyOn` on the engine, which IS the
 * host's `nesting` port — index.ts passes `this` at construction) so the start
 * parks deterministically, and returns a fixture `WorkflowRun` whose result-body
 * writes a marker unless the run was cancelled or disposed first — so the only
 * thing that can stop the marker is the host cancelling the in-flight nested run
 * (a nested workflow's own script runs in a vm sandbox and cannot write the
 * marker itself). RED today: the marker appears because the cancel missed the
 * in-flight start. After B-709 (the fix, not read, §21.4) the started nested run
 * is cancelled the same way the agent() path is, and the marker is absent.
 * @module tests/nested-workflow-cancel-inflight-start
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowMeta, WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'

const PARENT_META: WorkflowMeta = { name: 'b709-parent', description: 'nests one workflow whose start is gated', phases: [] }
const NESTED_META: WorkflowMeta = { name: 'b709-nested', description: 'the gated nested run', phases: [] }
/** The nested body's delay: short enough to run well before the dispose grace (5s), long enough that a cancel re-check precedes it. */
const BODY_DELAY_MS = 300

vi.setConfig({ testTimeout: 30_000 })

/** Wait up to 60s for cold worker-thread startup on contended CI (the nested-run.spec.ts allowance). */
function waitFor(assertion: () => void): Promise<void> {
  return vi.waitFor(assertion, { timeout: 60_000, interval: 50 })
}

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(): Promise<{ ctx: Context; parent: Agent; engine: WorkerThreadWorkflowEngine; markerPath: string }> {
  const root = mkdtempSync(join(tmpdir(), 'b709-'))
  roots.push(root)
  const markerPath = join(root, 'nested-body-marker')
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(WorkerThreadWorkflowEngine, {})
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('ok')]))
  const parent = await ctx.agentLoop.create(SessionId('b709-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, engine: ctx.workflowEngine as WorkerThreadWorkflowEngine, markerPath }
}

/** One gated nested start: `publish()` releases the parked `startNested`. */
interface GatedStart {
  publish(): void
}

/**
 * Spy `engine.startNested` (the host's `nesting` port) so it PARKS until
 * released, then returns a fixture `WorkflowRun` whose result-body writes the
 * marker unless the run was cancelled/disposed first. The fixture deliberately
 * ignores the parent's cancellation EXCEPT through its own `cancel`/`dispose`,
 * so the host cancelling the in-flight nested run is the only thing that can
 * stop the marker.
 * @param engine - the mounted engine whose `startNested` the host calls.
 * @param markerPath - where the nested body writes its marker.
 * @returns the started gates, one per `startNested` call.
 */
function gateStartNested(engine: WorkerThreadWorkflowEngine, markerPath: string): { starts: GatedStart[] } {
  const starts: GatedStart[] = []
  vi.spyOn(engine, 'startNested').mockImplementation(async () => {
    const gate = Promise.withResolvers<undefined>()
    let cancelled = false
    const run: WorkflowRun = {
      id: WorkflowRunId(`b709-nested-${starts.length}`),
      traceContext: undefined,
      meta: NESTED_META,
      result: (async (): Promise<WorkflowResult> => {
        await delay(BODY_DELAY_MS)
        if (!cancelled) writeFileSync(markerPath, 'nested body ran')
        return { value: null, stopReason: cancelled ? 'cancelled' : 'completed', agentsStarted: 0 }
      })(),
      cancel: () => { cancelled = true },
      dispose: () => { cancelled = true; return Promise.resolve() },
    }
    starts.push({ publish: () => { gate.resolve(undefined) } })
    await gate.promise
    return { started: true, run, failurePolicy: 'fail-parent' }
  })
  return { starts }
}

const SCRIPT = "return await workflow({ name: 'b709-nested', digest: 'b709-nested' }, {})"

describe('P4-09 acceptance[1] (B-709 red first): a nested workflow whose start is in flight at cancel is cancelled, not published', () => {
  it('the in-flight nested run is cancelled before its body runs — no marker (RED today: the workflow() path misses it)', async () => {
    const { parent, engine, markerPath } = await setup()
    const { starts } = gateStartNested(engine, markerPath)
    const handle = engine.start({ script: SCRIPT, meta: PARENT_META, parent })
    // The nested start is parked inside `await this.nesting.startNested` (host.ts:870).
    await waitFor(() => { expect(starts.length).toBe(1) })
    // The parent cancels while the start is in flight: `cancel()` iterates
    // `nestedRuns` (host.ts:358), which is still empty — the run is added only
    // after the await (:875).
    handle.cancel('b709 user stop')
    // Release the gate: `nest` adds the run and awaits its result.
    starts[0]!.publish()
    const result = await handle.result
    expect(result.stopReason).toBe('cancelled')
    await handle.dispose()
    await delay(BODY_DELAY_MS + 200)
    // RED today: the cancel missed the in-flight start and there is no post-await
    // re-check, so the nested run was published and ran its body.
    expect(existsSync(markerPath), 'the in-flight nested run must not run its body after the parent cancelled').toBe(false)
  })

  it('control: with no cancel, the same gated nested run is published and runs its body — the marker appears', async () => {
    const { parent, engine, markerPath } = await setup()
    const { starts } = gateStartNested(engine, markerPath)
    const handle = engine.start({ script: SCRIPT, meta: PARENT_META, parent })
    await waitFor(() => { expect(starts.length).toBe(1) })
    // No cancel: releasing the gate publishes the nested run, so its body runs
    // and writes the marker — proving the marker mechanism is live, so the main
    // case's absence is the cancellation, not a dead body.
    starts[0]!.publish()
    const result = await handle.result
    expect(result.stopReason).toBe('completed')
    await handle.dispose()
    expect(existsSync(markerPath), 'a published nested run runs its body and writes the marker').toBe(true)
  })
})
