/**
 * A nested run resumed from the journal the host compacted when it settled
 * (BLOCKED-328, a precondition of Epic P4-08's sign-off).
 *
 * A nested run's journal records `nesting`, what the run inherited when it
 * started, and a resume reads it back to restore the run's budget, ancestor
 * chain and tool bound (P4-09 must[3]). The host compacts every journal at
 * settlement, so the resume reads the compacted one: whatever compaction drops
 * the resumed run no longer has.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies, TrackedContexts } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionName, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { WorkerRun } from '../src/host.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'

const contexts = new TrackedContexts()
afterEach(async () => { await contexts.disposeAll() })

/**
 * Register a definition under the digest computed from its body.
 * @param engine - the mounted engine.
 * @param name - the definition's name.
 * @param body - the definition's script.
 * @returns the reference a script passes to `workflow()`.
 */
function register(engine: WorkerThreadWorkflowEngine, name: string, body: string): { name: string; digest: string } {
  const digest = computeDefinitionDigest(body)
  engine.registerDefinition({
    digest,
    name: brandString<DefinitionName>(name),
    version: 1,
    body,
    signer: brandString<SignerIdentity>('test-signer'),
  })
  return { name, digest }
}

describe('BLOCKED-328: a nested run resumed from its compacted journal is the same nested run', () => {
  it('resumes with the nesting it started with, so the depth limit that refused it still refuses it', async () => {
    const ctx = contexts.track(new Context())
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(MessageBusPlugin)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(InMemoryLeaseStorePlugin)
    // Depth 1: a root run may nest a run, and that nested run may not nest another.
    await ctx.plugin(WorkerThreadWorkflowEngine, { maxNestingDepth: 1 })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('unused')]))
    const parent = await ctx.agentLoop.create(SessionId('nested-journal-resume-parent'), { provider: 'mock', model: 'mock' })
    const engine = ctx.workflowEngine as WorkerThreadWorkflowEngine

    const leaf = register(engine, 'leaf', "return 'leaf ran'")
    const innerBody = `try { return await workflow(${JSON.stringify(leaf)}) } catch (error) { return 'REFUSED: ' + error.message }`
    const inner = register(engine, 'inner', innerBody)
    const innerIds: WorkflowRunId[] = []
    ctx.on('workflow/start', (info) => { if (info.meta.name === 'inner') innerIds.push(info.id) })

    const root = ctx.workflowEngine.start({
      script: `return await workflow(${JSON.stringify(inner)})`,
      meta: { name: 'root', description: 'nests the inner definition', phases: [] },
      parent,
    })
    // The nested run, at depth 1, is refused a nesting of its own. It settled
    // before the root did, so the host has written its compacted journal.
    expect((await root.result).value).toContain('max-depth-exceeded')
    await root.dispose()
    expect(innerIds).toHaveLength(1)

    const resumed = await ctx.workflowEngine.resume(innerIds[0] as WorkflowRunId, {
      script: innerBody,
      meta: { name: 'inner', description: 'the nested run, resumed', phases: [] },
      parent,
    }) as WorkerRun
    const settled = await resumed.result
    const { nesting } = resumed.journalSnapshot()
    await resumed.dispose()

    // Resumed as a root run, it would have depth 0 and the leaf would run.
    expect(settled.value).toContain('max-depth-exceeded')
    expect(nesting?.ancestors).toEqual([inner.digest])
    expect(nesting?.budget.depth).toBe(1)
  })
})
