/**
 * B-709 (P4-09 acceptance[1]): a nested `workflow()` start never outlives its
 * cancelled parent, whether the worker asks after the parent was cancelled or
 * the parent is cancelled while the nested run is starting.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionName, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { WorkerRun } from '../src/host.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import { HostToWorkerType, WorkerToHostType } from '../src/protocol.ts'
import type { WorkerToHostMessage } from '../src/protocol.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/** A definition whose run never ends unless it is cancelled. */
const INNER_BODY = 'await new Promise(() => {})'

/**
 * Mount the engine on a spawn provider, register the `inner` definition, and
 * start a parent run that waits until it is disposed.
 * @returns the engine, the waiting parent run, its message handler and the inner definition's digest.
 */
async function startWaitingParent() {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(WorkerThreadWorkflowEngine, { disposeGraceMs: 100 })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
  const agent = await ctx.agentLoop.create(SessionId('nested-cancel-parent'), { provider: 'mock', model: 'mock' })
  const engine = ctx.workflowEngine as WorkerThreadWorkflowEngine
  const digest = computeDefinitionDigest(INNER_BODY)
  engine.registerDefinition({
    digest,
    name: brandString<DefinitionName>('inner'),
    version: 1,
    body: INNER_BODY,
    signer: brandString<SignerIdentity>('test-signer'),
  })
  const run = engine.start({
    script: 'await new Promise(() => {})',
    meta: { name: 'parent', description: 'waits until disposed', phases: [] },
    parent: agent,
  }) as WorkerRun
  const internals = run as unknown as {
    onMessage(message: WorkerToHostMessage): void
    worker: { postMessage(message: unknown): void }
  }
  return { engine, run, internals, digest }
}

describe('B-709: a nested start does not outlive its cancelled parent', () => {
  it('refuses a nested start that arrives after the parent was cancelled, and starts nothing', async () => {
    const { engine, run, internals, digest } = await startWaitingParent()
    run.cancel('stopped by the host')
    const posted = vi.spyOn(internals.worker, 'postMessage')
    const startNested = vi.spyOn(engine, 'startNested')

    internals.onMessage({ type: WorkerToHostType.NestedStart, callId: 3, name: 'inner', digest })

    expect(posted).toHaveBeenCalledWith({
      type: HostToWorkerType.NestedRefused,
      callId: 3,
      rendered: 'nested workflow "inner" was not started: workflow run cancelled: stopped by the host',
    })
    expect(startNested).not.toHaveBeenCalled()
    await run.dispose()
  })

  it('disposes a nested run whose parent was cancelled while it was starting, and refuses the call', async () => {
    const { engine, run, internals, digest } = await startWaitingParent()
    const startNested = engine.startNested.bind(engine)
    const child = Promise.withResolvers<WorkflowRun>()
    vi.spyOn(engine, 'startNested').mockImplementation(async (request, parent) => {
      const started = await startNested(request, parent)
      if (started.started) child.resolve(started.run)
      run.cancel('cancelled while the nested run was starting')
      return started
    })
    // The parent's worker may already be gone when the refusal is sent, so the
    // host's own post is observed rather than the worker's port.
    const post = vi.spyOn(run as unknown as { post(type: HostToWorkerType, payload: unknown): void }, 'post')

    internals.onMessage({ type: WorkerToHostType.NestedStart, callId: 4, name: 'inner', digest })
    const nested = await child.promise
    const outcome = await Promise.race([
      nested.result.then(result => result.stopReason),
      new Promise<string>(resolve => setTimeout(() => { resolve('still running') }, 2_000)),
    ])

    expect(outcome).toBe('cancelled')
    await vi.waitFor(() => {
      const call = post.mock.calls.find(([type]) => type === HostToWorkerType.NestedRefused)
      const refused = call?.[1] as { callId?: number; rendered?: string } | undefined
      expect(refused?.callId).toBe(4)
      expect(refused?.rendered).toContain('nested workflow "inner" was not started: workflow run cancelled: cancelled while the nested run was starting')
    })
    await run.dispose()
  }, 15_000)
})
