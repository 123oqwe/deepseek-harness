/**
 * Epic P4-11 must[1]: every in-scope layer accounts against ONE run budget.
 *
 * These run the real agent loop through the real retry executor, because the
 * clause is about callers: `admitRetry` deciding correctly was the Contract
 * stage, and a budget nothing consults satisfies the noun and not the clause.
 *
 * What the cases observe is the ADAPTER's request count. A refused retry is
 * refused by not being made, so counting requests is the only observation that
 * cannot pass while the budget is consulted and ignored.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ResolvedRetryPolicy, RetryPolicyConfig, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import RunPlugin from '@deepseek-ai/dsh-run'
import { RunRetryUsagePlugin } from '@deepseek-ai/dsh-retry'
import * as retry from '../src/index.ts'

const POLICY: RetryPolicyConfig = {
  mode: 'normal',
  maxRetries: 5,
  retryableCodes: ['SERVER'],
  backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
}

/** Fails every request, so each attempt is a retry the budget must decide on. */
class AlwaysFailingAdapter extends LlmAdapter {
  requests = 0

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests += 1
    await Promise.resolve()
    throw new LlmError('endpoint is down', 'SERVER', { status: 503 })
    yield undefined as unknown as StreamChunk
  }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return resolveRetryPolicy(POLICY, 'run-budget test retryPolicy')
  }
}

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function harness(budget: { maxRetries: number }): Promise<{ ctx: Context; adapter: AlwaysFailingAdapter }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  // The REAL Run producer: RunPlugin opens one Run per agent/session-start,
  // which is where `Agent.runId` comes from. Without it a session has no run,
  // the charge is skipped as capability absence, and the case would be
  // asserting nothing.
  await ctx.plugin(InMemoryLeaseStorePlugin)
  const root = mkdtempSync(join(tmpdir(), 'run-budget-'))
  roots.push(root)
  await ctx.plugin(RunPlugin, { storePath: join(root, 'runs.json') })
  await ctx.plugin(RunRetryUsagePlugin, budget)
  await ctx.plugin(Object.assign((inner: Context) => { retry.apply(inner, {}) }, { inject: retry.inject }))
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new AlwaysFailingAdapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

describe('P4-11 must[1]: the LLM layer charges the run, not the session', () => {
  it('stops retrying when the RUN budget is spent, below the policy’s own cap', async () => {
    // The policy allows 5 retries and the run allows 2. Without the budget
    // consulted, the adapter is called 6 times; with it, 3 — the first attempt
    // plus the two the run could pay for.
    const { ctx, adapter } = await harness({ maxRetries: 2 })
    const agent = ctx.agentLoop.create(SessionId('budgeted-run'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'go' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    expect(adapter.requests).toBe(3)
  })

  it('charges a CHILD session’s retries to the PARENT’s run, so allowances do not stack', async () => {
    // must[1] itself, and the case is built so the two readings give DIFFERENT
    // numbers. A Run is 1:1 with a session, so the parent and the child each
    // have one: the parent turn spends the run's whole allowance first, and
    // the child then finds nothing left. Charged to the child's OWN run it
    // would find a full allowance, which is the stacking the registry names.
    const { ctx, adapter } = await harness({ maxRetries: 3 })
    const parent = ctx.agentLoop.create(SessionId('delegating-parent'), { provider: 'mock', model: 'mock' })
    parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'parent work' }],
      source: { kind: 'user' },
    }))
    await parent.whenIdle()
    // 1 attempt + the run's 3 retries.
    expect(adapter.requests).toBe(4)

    const child = await ctx.agents.create({
      sessionId: SessionId('delegated-child'),
      agentOptions: { provider: 'mock', model: 'mock' },
      meta: { parentSession: parent.session.id },
    })
    child.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'delegated work' }],
      source: { kind: 'user' },
    }))
    await child.agent.whenIdle()

    // One attempt and no retry: the parent's run is spent. Charged to the
    // child's own run it would take 4 more requests, for 8.
    expect(adapter.requests).toBe(5)
    await child.dispose()
  })

  it('lets the policy decide when the run budget is the looser of the two', async () => {
    // The positive control. Without it, a budget that refused everything would
    // satisfy the case above: the observation there is "fewer requests", and
    // fewer includes one.
    const { ctx, adapter } = await harness({ maxRetries: 50 })
    const agent = ctx.agentLoop.create(SessionId('policy-bound-run'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'go' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    // 1 attempt + the policy's 5 retries: the run budget is not the binding
    // limit here, and the layer's own policy still holds.
    expect(adapter.requests).toBe(6)
  })
})
