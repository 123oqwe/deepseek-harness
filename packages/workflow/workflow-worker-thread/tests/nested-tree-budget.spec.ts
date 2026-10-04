/**
 * One count per tree of workflow runs (Epic P4-09 acceptance[3]): the host
 * charges each `agent()` child to its run's tree and refuses one when the tree
 * is spent, the engine charges a nested run to its parent's tree and bounds its
 * admission by what the tree has left, and an in-process child's tokens come
 * off the tree as its session records them, stopping the run's running children
 * once the tree has none left (B-714).
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
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionName, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { WorkerRun } from '../src/host.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import { HostToWorkerType, WorkerToHostType } from '../src/protocol.ts'
import type { WorkerToHostMessage } from '../src/protocol.ts'

const META = { name: 'parent', description: 'spends a tree budget', phases: [] }

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/**
 * Mount the engine on a spawn provider whose children answer with a fixed text.
 * @param options - whether token-meter is mounted, how many child answers the model has, and the engine's maxNestedTokens.
 * @returns the context, the engine and a parent agent.
 */
async function setup(options: { tokenMeter: boolean; answers: number; maxNestedTokens?: number }) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  if (options.tokenMeter) await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(WorkerThreadWorkflowEngine, {
    disposeGraceMs: 100,
    ...options.maxNestedTokens === undefined ? {} : { maxNestedTokens: options.maxNestedTokens },
  })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(Array.from({ length: options.answers }, () => textResponse('child said so'))))
  const parent = await ctx.agentLoop.create(SessionId('tree-budget-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, engine: ctx.workflowEngine as WorkerThreadWorkflowEngine, parent }
}

/**
 * Start a run whose script waits until it is disposed, and expose the host's
 * message handler and the worker's port.
 * @param engine - the mounted engine.
 * @param parent - the agent the run acts for.
 * @returns the run and its host internals.
 */
function startWaitingRun(engine: WorkerThreadWorkflowEngine, parent: Awaited<ReturnType<typeof setup>>['parent']) {
  const run = engine.start({ script: 'await new Promise(() => {})', meta: META, parent }) as WorkerRun
  const internals = run as unknown as {
    onMessage(message: WorkerToHostMessage): void
    worker: { postMessage(message: unknown): void }
  }
  return { run, internals, posted: vi.spyOn(internals.worker, 'postMessage') }
}

/**
 * Register one definition with the engine.
 * @param engine - the mounted engine.
 * @param body - the definition's source.
 * @returns the `{ name, digest }` a script nests it by.
 */
function register(engine: WorkerThreadWorkflowEngine, body: string): { name: string; digest: string } {
  const digest = computeDefinitionDigest(body)
  engine.registerDefinition({
    digest,
    name: brandString<DefinitionName>('inner'),
    version: 1,
    body,
    signer: brandString<SignerIdentity>('test-signer'),
  })
  return { name: 'inner', digest }
}

describe('P4-09 acceptance[3]: the host charges each agent() child to its tree', () => {
  it('charges a started child to the tree', async () => {
    const { engine, parent } = await setup({ tokenMeter: false, answers: 1 })
    const run = engine.start({ script: "await agent('first'); return 'done'", meta: META, parent }) as WorkerRun
    const agentsBefore = run.tree.agentsRemaining

    expect((await run.result).value).toBe('done')
    expect(run.tree.agentsRemaining).toBe(agentsBefore - 1)
    await run.dispose()
  })

  it('refuses a child once the tree has started every agent it may', async () => {
    const { engine, parent } = await setup({ tokenMeter: false, answers: 0 })
    const { run, internals, posted } = startWaitingRun(engine, parent)
    run.tree.agentsRemaining = 0

    internals.onMessage({ type: WorkerToHostType.ChildStart, callId: 3, request: { prompt: 'one more' } })

    expect(posted).toHaveBeenCalledWith({
      type: HostToWorkerType.ChildStartError,
      callId: 3,
      rendered: 'agent() was refused: agent-budget-exhausted',
    })
    expect(run.tree.agentsRemaining).toBe(0)
    await run.dispose()
  })

  it('refuses a child once the tree has spent its tokens', async () => {
    const { engine, parent } = await setup({ tokenMeter: false, answers: 0 })
    const { run, internals, posted } = startWaitingRun(engine, parent)
    run.tree.tokensRemaining = 0
    const agentsBefore = run.tree.agentsRemaining

    internals.onMessage({ type: WorkerToHostType.ChildStart, callId: 4, request: { prompt: 'one more' } })

    expect(posted).toHaveBeenCalledWith({
      type: HostToWorkerType.ChildStartError,
      callId: 4,
      rendered: 'agent() was refused: token-budget-exhausted',
    })
    expect(run.tree.agentsRemaining).toBe(agentsBefore)
    await run.dispose()
  })
})

describe('P4-09 acceptance[3]: a nested run belongs to its parent\'s tree', () => {
  it('joins the parent\'s tree and is charged to it', async () => {
    const { engine, parent } = await setup({ tokenMeter: false, answers: 0 })
    const { run } = startWaitingRun(engine, parent)
    const ref = register(engine, "return 'inner'")
    const agentsBefore = run.tree.agentsRemaining

    const started = await engine.startNested(ref, run)

    expect(started.started && (started.run as WorkerRun).tree).toBe(run.tree)
    expect(run.tree.agentsRemaining).toBe(agentsBefore - 1)
    if (started.started) await started.run.dispose()
    await run.dispose()
  })

  it('is refused when the tree has no agents left, whatever the parent\'s own budget says', async () => {
    const { engine, parent } = await setup({ tokenMeter: false, answers: 0 })
    const { run } = startWaitingRun(engine, parent)
    const ref = register(engine, "return 'inner'")
    run.tree.agentsRemaining = 0

    const started = await engine.startNested(ref, run)

    expect(started).toEqual({ started: false, rendered: 'nested workflow "inner" was refused: agent-budget-exhausted' })
    await run.dispose()
  })
})

describe('P4-09 acceptance[3]: an in-process child\'s tokens come off its tree', () => {
  it('debits the four token buckets token-meter recorded for the child', async () => {
    const { engine, parent } = await setup({ tokenMeter: true, answers: 1 })
    const run = engine.start({ script: "await agent('first'); return 'done'", meta: META, parent }) as WorkerRun
    expect(run.tree.tokensRemaining).toBe(1_000_000)

    expect((await run.result).value).toBe('done')
    // textResponse reports 10 input tokens and one output token per character.
    expect(run.tree.tokensRemaining).toBe(1_000_000 - (10 + 'child said so'.length))
    expect(run.tree.tokenLimitWarned).toBe(false)
    await run.dispose()
  })

  it('stops a running child once the tree has spent its tokens, before the child settles (B-714)', async () => {
    const { ctx, engine, parent } = await setup({ tokenMeter: true, answers: 0, maxNestedTokens: 20 })
    // Two tool-call responses spend 15 tokens each; the third response is the step a child metered only at
    // settlement would still take.
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'no_such_tool', {}),
      toolCallResponse('c2', 'no_such_tool', {}),
      textResponse('one step too many'),
    ])
    ctx.llm.registerAdapter(['metered'], adapter)
    const run = engine.start({
      script: "try { await agent('spend', { provider: 'metered', model: 'metered' }); return 'ran' } catch { return 'stopped' }",
      meta: META,
      parent,
    }) as WorkerRun

    await run.result
    expect(adapter.requests).toHaveLength(2)
    expect(run.tree.tokensRemaining).toBe(20 - 30)
    await run.dispose()
  })

  it('debits only its running children\'s sessions, not another session\'s events (B-714)', async () => {
    const { ctx, engine, parent } = await setup({ tokenMeter: true, answers: 0, maxNestedTokens: 20 })
    const adapter = new MockAdapter(['hang'])
    ctx.llm.registerAdapter(['metered'], adapter)
    const run = engine.start({ script: "await agent('wait', { provider: 'metered', model: 'metered' })", meta: META, parent }) as WorkerRun
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    parent.session.append('turn/start', { turn: 1 })

    expect(run.tree.tokensRemaining).toBe(20)
    await run.dispose()
  })

  it('leaves the tokens untouched without token-meter, and the tree records that it warned', async () => {
    const { engine, parent } = await setup({ tokenMeter: false, answers: 2 })
    const run = engine.start({ script: "await agent('first'); await agent('second'); return 'done'", meta: META, parent }) as WorkerRun
    const tokensBefore = run.tree.tokensRemaining

    expect((await run.result).value).toBe('done')
    expect(run.tree.tokensRemaining).toBe(tokensBefore)
    expect(run.tree.tokenLimitWarned).toBe(true)
    await run.dispose()
  })
})

/**
 * A provider whose child the engine sees as running in another process: its
 * run has no local agent.
 * @param disposed - counts the child's disposals.
 * @returns the provider, registered as `remote`.
 */
function remoteProvider(disposed: { count: number }): SubagentProvider {
  return {
    name: 'remote',
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: () => Promise.resolve({
      id: SessionId('remote-child'),
      localAgent: undefined,
      result: Promise.resolve({ output: [{ type: 'text', text: 'remote reply' }], stopReason: 'completed' }),
      dispose: () => {
        disposed.count += 1
        return Promise.resolve()
      },
    }),
  }
}

describe('P4-09 acceptance[3]: a child in another process runs only in a tree with no token limit', () => {
  it('refuses the child in a tree with a token limit, and disposes it', async () => {
    const { ctx, engine, parent } = await setup({ tokenMeter: false, answers: 0 })
    const disposed = { count: 0 }
    ctx.subagents.registerProvider(remoteProvider(disposed))
    const run = engine.start({
      script: "try { await agent('x'); return 'ran' } catch (error) { return 'REFUSED: ' + error.message }",
      meta: META,
      parent,
      subagentProvider: 'remote',
    }) as WorkerRun

    // The worker wraps every start failure as "agent() could not start a child: …", so only the reason is asserted.
    expect((await run.result).value).toContain('agent() was refused: provider "remote" runs the child in another process')
    expect(disposed.count).toBe(1)
    await run.dispose()
  })

  it('runs the child when the deployment sets no token limit, and meters nothing', async () => {
    const { ctx, engine, parent } = await setup({ tokenMeter: false, answers: 0, maxNestedTokens: 0 })
    ctx.subagents.registerProvider(remoteProvider({ count: 0 }))
    const run = engine.start({ script: "return await agent('x')", meta: META, parent, subagentProvider: 'remote' }) as WorkerRun

    expect((await run.result).value).toBe('remote reply')
    expect(run.tree.tokensRemaining).toBeUndefined()
    expect(run.tree.tokenLimitWarned).toBe(false)
    await run.dispose()
  })

  it('meters nothing for an in-process child when the deployment sets no token limit', async () => {
    const { engine, parent } = await setup({ tokenMeter: true, answers: 1, maxNestedTokens: 0 })
    const run = engine.start({ script: "await agent('first'); return 'done'", meta: META, parent }) as WorkerRun

    expect((await run.result).value).toBe('done')
    expect(run.tree.tokensRemaining).toBeUndefined()
    await run.dispose()
  })
})
