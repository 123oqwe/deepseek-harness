/**
 * P4-09 lock points [2]/[3] (BLOCKED-312) on the real worker-thread engine via
 * `ctx.workflowEngine`: a nested run's failure strategy must be declarable, and
 * a tree's total agent and token budgets must be enforced.
 *
 * Red first for B-698 (the P4-09 fix; §21.4: its diff is not read). Today the
 * shipped engine returns a hard-coded `'fail-parent'` for every nesting, reads
 * no `onFailure` from the request, and debits neither the tree's agent count
 * nor its token usage (each sibling gets the same derived remainder, and no
 * token usage is read). So clauses ②③④ are red; clause ① (default fail-parent)
 * is the green control.
 *
 * The reason strings are the plan's (`b4f24-p4-09-lock-plan.md`):
 * `agent-budget-exhausted`, `token-budget-exhausted`.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionName, SignerIdentity } from '@deepseek-ai/dsh-workflow-registry'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

const META = { name: 'parent', description: 'nests another definition or spawns agents', phases: [] }

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Mount the engine stack, with the engine budgets a case constrains and enough
 * mock responses for the agents it starts.
 * @param options - the engine config a case sets (`maxTotalAgents`/`maxNestedTokens`).
 * @param responses - how many single-line mock model responses to queue.
 * @returns the mounted context and its parent agent.
 */
async function setup(
  options: { maxTotalAgents?: number; maxNestedTokens?: number } = {},
  responses = 8,
) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  // The shipped base mounts the token-meter (bundle/base/cordis.patch.yml), so
  // the nested token budget has real usage to debit against; without it the
  // engine only warns, which is not the factory composition this proves.
  await ctx.plugin(TokenMeter)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(WorkerThreadWorkflowEngine, options)
  ctx.llm.registerAdapter(['mock'], new MockAdapter(Array.from({ length: responses }, () => textResponse('ok'))))
  const parent = await ctx.agentLoop.create(SessionId('nesting-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

/**
 * Register one definition and return the `{ name, digest }` a script passes to `workflow()`.
 * @param ctx - the mounted context.
 * @param name - the definition name.
 * @param body - the definition's script body.
 * @returns the reference a `workflow()` call resolves by.
 */
function register(ctx: Context, name: string, body: string): { name: string; digest: string } {
  const digest = computeDefinitionDigest(body)
  const engine = ctx.workflowEngine as WorkerThreadWorkflowEngine
  engine.registerDefinition({
    digest,
    name: brandString<DefinitionName>(name),
    version: 1,
    body,
    signer: brandString<SignerIdentity>('test-signer'),
  })
  return { name, digest }
}

describe('P4-09 [2]: a nested run\'s failure strategy is declarable (red first for B-698)', () => {
  it('① control: a failing nested run with NO declared strategy fails the parent, naming the child', async () => {
    const { ctx, parent } = await setup()
    const ref = register(ctx, 'boom', "throw new Error('child boom')")
    const run = ctx.workflowEngine.start({ script: `return await workflow(${JSON.stringify(ref)})`, meta: META, parent })
    const result = await run.result
    const detail = `${result.stopReason}: ${result.error ?? ''}`
    // Green today AND after: the default strategy is fail-parent.
    expect(result.stopReason, detail).not.toBe('completed')
    expect(result.error ?? '', detail).toContain('boom')
    await run.dispose()
  })

  it('② continue-parent: a failing nested run the parent declared continue-parent for lets the parent complete', async () => {
    const { ctx, parent } = await setup()
    const ref = register(ctx, 'boom', "throw new Error('child boom')")
    // The declaration is on the parent's own call. Today the request carries no
    // onFailure field, so this is dropped and the default fail-parent fails the
    // parent — RED. B-698 honors it: the parent completes and the child's
    // failure is recorded rather than fatal.
    // Direct await, NOT `.then(…, onRejected)`: a catch here would complete the
    // parent whether or not the engine honors the strategy, so the case could
    // never red. Letting the rejection propagate means only the strategy can
    // keep the parent alive.
    const run = ctx.workflowEngine.start({
      script: `await workflow(${JSON.stringify({ ...ref, onFailure: 'continue-parent' })})
        return 'parent completed'`,
      meta: META,
      parent,
    })
    const result = await run.result
    const detail = `${result.stopReason}: ${result.error ?? ''} value=${String(result.value)}`
    // RED today: `onFailure` is dropped, so the default fail-parent rejects the
    // await and the parent fails. B-698 honors continue-parent: `workflow()`
    // resolves (the child failure is recorded, not thrown), so the parent runs on.
    expect(result.stopReason, detail).toBe('completed')
    expect(String(result.value), detail).toContain('parent completed')
    await run.dispose()
  })
})

describe('P4-09 [3]: a tree\'s total agent and token budgets are enforced (red first for B-698)', () => {
  it('③ maxTotalAgents N: the N+1th agent across the tree is refused agent-budget-exhausted, though no single run passes its own cap', async () => {
    // The budget is the TREE's, not one run's: the parent starts N agents (at
    // its own per-run cap) and the nested run starts one more, so the tree holds
    // N+1 while no single run exceeds N. Three agents in ONE run would instead
    // trip today's per-run cap and red for the wrong reason.
    const { ctx, parent } = await setup({ maxTotalAgents: 2 })
    const nested = register(ctx, 'nested-agent', "try { return await agent('n1') } catch (error) { return 'nested refused: ' + String(error) }")
    const run = ctx.workflowEngine.start({
      script: `await agent('p1'); await agent('p2'); return await workflow(${JSON.stringify(nested)})`,
      meta: META,
      parent,
    })
    const result = await run.result
    const detail = `${result.stopReason}: ${result.error ?? ''} value=${String(result.value)}`
    // RED today: no tree total, so the parent's two agents and the nested run's
    // one agent all run (each run is within its own cap of 2) and the value is
    // the nested agent's result. B-698's shared tree budget refuses the third.
    expect(`${String(result.value)}${result.error ?? ''}`, detail).toContain('agent-budget-exhausted')
    await run.dispose()
  })

  it('④ maxNestedTokens T: a start after the tree\'s token usage passes T is refused token-budget-exhausted', async () => {
    // Each mock response reports outputTokens = 'ok'.length = 2 plus inputTokens
    // 10, so one agent spends 12 tokens; a 20-token tree budget is passed after
    // the first agent, so the second start is refused.
    const { ctx, parent } = await setup({ maxNestedTokens: 20 })
    const run = ctx.workflowEngine.start({
      script: `const ran = []
        for (const label of ['first', 'second']) {
          try { await agent(label); ran.push(label) }
          catch (error) { return 'refused at ' + label + ': ' + String(error) }
        }
        return 'all ran: ' + ran.join(',')`,
      meta: META,
      parent,
    })
    const result = await run.result
    const detail = `${result.stopReason}: ${result.error ?? ''} value=${String(result.value)}`
    // RED today: token usage is never read, so both run and the value is "all ran".
    expect(`${String(result.value)}${result.error ?? ''}`, detail).toContain('token-budget-exhausted')
    await run.dispose()
  })
})

describe('P4-09 [1]: cancelling the parent cancels its nested run and tears down the agent the nested run started ([235] successor)', () => {
  /** A bounded fallback that resolves after `ms`, never holding the process open. */
  const fallback = (ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms).unref?.() })

  it('⑤ a cancelled parent cancels its never-ending nested run — the nested run settles cancelled and the agent it started is ended, not stranded', async () => {
    // The claim nested-run.spec.ts:410 names ("a nested sibling IS [cancelled]")
    // but never exercises (its body starts no nested run). Here the parent nests
    // a run that starts an agent and then never resolves, so at cancel the
    // nested run is live and observable. Its meta name is the definition's own
    // (`slow`), which distinguishes it from the parent run in the events.
    //
    // The nested run's settlement is read from the RUN itself, attached by id
    // the moment it starts (the engine records it in `liveRuns` before the
    // `workflow/start` event fires), rather than from an end event that a
    // never-settling nested run would never emit — so the mutation is observed
    // as a non-settlement, not as a missing event.
    const { ctx, parent } = await setup({}, 1)
    const engine = ctx.workflowEngine as WorkerThreadWorkflowEngine
    const ref = register(ctx, 'slow', "await agent('child-of-nested'); await new Promise(() => {}); return 1")
    let nestedRun: WorkflowRun | undefined
    let onNestedStarted: () => void = () => {}
    const nestedStarted = new Promise<void>((resolve) => { onNestedStarted = resolve })
    let onNestedAgentStarted: () => void = () => {}
    const nestedAgentStarted = new Promise<void>((resolve) => { onNestedAgentStarted = resolve })
    const agentStarts: string[] = []
    const agentEnds: string[] = []
    ctx.on('workflow/start', (info) => {
      if (info.meta.name === 'slow' && nestedRun === undefined) { nestedRun = engine.attach(info.id); onNestedStarted() }
    })
    ctx.on('workflow/agent-start', (info) => {
      if (info.meta.name === 'slow') { agentStarts.push(info.meta.name); onNestedAgentStarted() }
    })
    ctx.on('workflow/agent-end', (info) => { if (info.meta.name === 'slow') agentEnds.push(info.meta.name) })
    const run = ctx.workflowEngine.start({ script: `return await workflow(${JSON.stringify(ref)})`, meta: META, parent })
    // Cancel only once the nested run and its agent are both live (a fixed delay
    // cancelled before they were, leaving the observation empty); bounded fallback.
    await Promise.race([Promise.all([nestedStarted, nestedAgentStarted]).then(() => undefined), fallback(10_000)])
    run.cancel('the parent was cancelled')
    const result = await run.result
    // Read the nested run's own settlement, bounded so the mutation (which
    // leaves the nested run uncancelled and hanging on its never-resolving
    // promise) reds here within the case rather than hanging to the timeout.
    const SENTINEL = { stopReason: 'did-not-settle' as const }
    const nestedSettled = nestedRun === undefined
      ? SENTINEL
      : await Promise.race([nestedRun.result, fallback(12_000).then(() => SENTINEL)])
    const detail = JSON.stringify({
      parent: result.stopReason, nested: nestedSettled.stopReason, agentStarts, agentEnds, hadNestedHandle: nestedRun !== undefined,
    })

    expect(result.stopReason, detail).toBe('cancelled')
    // Green today (host.ts:331-332 cancels each nested run on parent cancel);
    // M-a581-1 inverts that guard, so the nested run is never cancelled, never
    // settles, and this reads 'did-not-settle' — red.
    expect(nestedSettled.stopReason, detail).toBe('cancelled')
    // The nested run started an agent, and none it started is left stranded.
    expect(agentStarts.length, detail).toBeGreaterThan(0)
    expect(agentEnds.length, detail).toBeGreaterThanOrEqual(agentStarts.length)
    await run.dispose()
  }, 30_000)

  it('⑤ control: a nested run that ends on its own is observed completed through the same attached handle', async () => {
    // Proves the attach-by-id settlement observation distinguishes a real
    // outcome: the same mechanism that reads 'cancelled' above reads 'completed'
    // here, so ⑤'s 'cancelled' is a real distinction rather than a constant.
    const { ctx, parent } = await setup({}, 1)
    const engine = ctx.workflowEngine as WorkerThreadWorkflowEngine
    const ref = register(ctx, 'quick', "await agent('child-of-nested'); return 'nested done'")
    let nestedRun: WorkflowRun | undefined
    let onNestedStarted: () => void = () => {}
    const nestedStarted = new Promise<void>((resolve) => { onNestedStarted = resolve })
    ctx.on('workflow/start', (info) => {
      if (info.meta.name === 'quick' && nestedRun === undefined) { nestedRun = engine.attach(info.id); onNestedStarted() }
    })
    const run = ctx.workflowEngine.start({ script: `return await workflow(${JSON.stringify(ref)})`, meta: META, parent })
    const result = await run.result
    await nestedStarted
    const nestedSettled = nestedRun === undefined ? undefined : await nestedRun.result
    const detail = JSON.stringify({
      parent: result.stopReason, nested: nestedSettled?.stopReason, hadNestedHandle: nestedRun !== undefined,
    })
    // Green today and after: the nested run completes on its own, and the same
    // attached handle reads 'completed'.
    expect(result.stopReason, detail).toBe('completed')
    expect(nestedSettled?.stopReason, detail).toBe('completed')
    await run.dispose()
  }, 30_000)
})
