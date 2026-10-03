/**
 * The child-failure policy a parent declares on its `workflow()` call
 * (Epic P4-09 acceptance[2]): what the worker posts and what it refuses before
 * posting, the host's own check of the value it receives, and the policy the
 * engine starts a nested run under.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import type { MessagePort } from 'node:worker_threads'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionName, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { WorkerRun } from '../src/host.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import { HostToWorkerType, WorkerToHostType } from '../src/protocol.ts'
import type { WorkerToHostMessage } from '../src/protocol.ts'
import { runWorkerSession } from '../src/session.ts'

const ports: MessagePort[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const port of ports.splice(0)) port.close()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/**
 * Run a script in the worker session in-process, answering every nested start
 * with a settled value, and collect what the session posted.
 * @param body - the script body.
 * @returns the posted messages and the script's returned value.
 */
async function runInSession(body: string): Promise<{ posted: WorkerToHostMessage[]; value: unknown }> {
  const channel = new MessageChannel()
  ports.push(channel.port1, channel.port2)
  const posted: WorkerToHostMessage[] = []
  const settled = Promise.withResolvers<unknown>()
  channel.port1.on('message', (message: WorkerToHostMessage) => {
    posted.push(message)
    if (message.type === WorkerToHostType.Ready) channel.port1.postMessage({ type: HostToWorkerType.Go })
    if (message.type === WorkerToHostType.NestedStart) {
      channel.port1.postMessage({ type: HostToWorkerType.NestedSettled, callId: message.callId, value: 'nested value' })
    }
    if (message.type === WorkerToHostType.Result) settled.resolve(message.result.value)
  })
  void runWorkerSession(channel.port2, {
    meta: { name: 'parent', description: 'nests a definition' },
    body,
    limits: { maxConcurrentAgents: 1, maxTotalAgents: 10, maxItemsPerCall: 10, syncTimeoutMs: 5_000 },
  }).catch((error: unknown) => { settled.reject(error) })
  return { posted, value: await settled.promise }
}

/**
 * The nested-start messages a session posted.
 * @param posted - everything the session posted.
 * @returns the nested-start messages, in order.
 */
function nestedStarts(posted: readonly WorkerToHostMessage[]): WorkerToHostMessage<WorkerToHostType.NestedStart>[] {
  return posted.filter((message): message is WorkerToHostMessage<WorkerToHostType.NestedStart> =>
    message.type === WorkerToHostType.NestedStart)
}

describe('P4-09 acceptance[2]: the worker posts the policy a workflow() call declares', () => {
  it('posts a declared policy with the nested start', async () => {
    const { posted, value } = await runInSession("return await workflow({ name: 'inner', digest: 'd', onFailure: 'continue-parent' })")

    expect(value).toBe('nested value')
    expect(nestedStarts(posted)).toEqual([expect.objectContaining({ name: 'inner', digest: 'd', onFailure: 'continue-parent' })])
  })

  it('posts no policy when the call declares none', async () => {
    const { posted } = await runInSession("return await workflow({ name: 'inner', digest: 'd' })")

    const [start] = nestedStarts(posted)
    expect(start).toBeDefined()
    expect(start !== undefined && 'onFailure' in start).toBe(false)
  })

  it('refuses a policy outside the two it accepts, and asks the host nothing', async () => {
    const { posted, value } = await runInSession(
      "try { return await workflow({ name: 'inner', digest: 'd', onFailure: 'ignore' }) } catch (error) { return error.code + ': ' + error.message }",
    )

    expect(value).toBe("INVALID_ARGUMENT: workflow() onFailure must be one of 'fail-parent', 'continue-parent'")
    expect(nestedStarts(posted)).toEqual([])
  })
})

/**
 * Mount the engine on a spawn provider and start a run that waits until it is
 * disposed.
 * @returns the context, the engine and the waiting run.
 */
async function startWaitingRun(): Promise<{ ctx: Context; engine: WorkerThreadWorkflowEngine; run: WorkerRun }> {
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
  const parent = await ctx.agentLoop.create(SessionId('failure-policy-parent'), { provider: 'mock', model: 'mock' })
  const engine = ctx.workflowEngine as WorkerThreadWorkflowEngine
  const run = engine.start({
    script: 'await new Promise(() => {})',
    meta: { name: 'parent', description: 'waits until disposed', phases: [] },
    parent,
  }) as WorkerRun
  return { ctx, engine, run }
}

describe('P4-09 acceptance[2]: the host and the engine', () => {
  it('the host refuses a policy outside the list when one reaches it, and starts nothing', async () => {
    const { engine, run } = await startWaitingRun()
    const internals = run as unknown as {
      onMessage(message: WorkerToHostMessage): void
      worker: { postMessage(message: unknown): void }
    }
    const posted = vi.spyOn(internals.worker, 'postMessage')
    const startNested = vi.spyOn(engine, 'startNested')

    internals.onMessage({ type: WorkerToHostType.NestedStart, callId: 7, name: 'inner', digest: 'd', onFailure: 'ignore' })

    expect(posted).toHaveBeenCalledWith({
      type: HostToWorkerType.NestedRefused,
      callId: 7,
      rendered: 'nested workflow "inner" was not started: onFailure "ignore" is not one of fail-parent, continue-parent',
    })
    expect(startNested).not.toHaveBeenCalled()
    await run.dispose()
  })

  it('starts a nested run under the policy the call declared', async () => {
    const { engine, run } = await startWaitingRun()
    const body = "return 'inner'"
    const digest = computeDefinitionDigest(body)
    engine.registerDefinition({
      digest,
      name: brandString<DefinitionName>('inner'),
      version: 1,
      body,
      signer: brandString<SignerIdentity>('test-signer'),
    })

    const started = await engine.startNested({ name: 'inner', digest, onFailure: 'continue-parent' }, run)

    expect(started.started && started.failurePolicy).toBe('continue-parent')
    if (started.started) await started.run.dispose()
    await run.dispose()
  })
})
