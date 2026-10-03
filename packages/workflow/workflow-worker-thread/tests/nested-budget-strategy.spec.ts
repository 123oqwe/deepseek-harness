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
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'

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
    const run = ctx.workflowEngine.start({
      script: `const outcome = await workflow(${JSON.stringify({ ...ref, onFailure: 'continue-parent' })}).then(() => 'child-ok', (error) => 'child-failed: ' + String(error))
        return 'parent completed; ' + outcome`,
      meta: META,
      parent,
    })
    const result = await run.result
    const detail = `${result.stopReason}: ${result.error ?? ''} value=${String(result.value)}`
    expect(result.stopReason, detail).toBe('completed')
    expect(String(result.value), detail).toContain('parent completed')
    await run.dispose()
  })
})

describe('P4-09 [3]: a tree\'s total agent and token budgets are enforced (red first for B-698)', () => {
  it('③ maxTotalAgents N: the N+1th agent in the tree is refused agent-budget-exhausted, the first N run', async () => {
    const { ctx, parent } = await setup({ maxTotalAgents: 2 })
    // Three agent() starts under a two-agent tree budget: the third must be
    // refused. The script catches it and returns the reason, so the assertion
    // reads one value whether the refusal throws or settles the run.
    const run = ctx.workflowEngine.start({
      script: `const ran = []
        for (const label of ['a', 'b', 'c']) {
          try { await agent(label); ran.push(label) }
          catch (error) { return 'refused at ' + label + ': ' + String(error) }
        }
        return 'all ran: ' + ran.join(',')`,
      meta: META,
      parent,
    })
    const result = await run.result
    const detail = `${result.stopReason}: ${result.error ?? ''} value=${String(result.value)}`
    // RED today: no tree debit, so all three run and the value is "all ran".
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
