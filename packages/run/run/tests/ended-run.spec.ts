/**
 * BLOCKED-332 at the Run plugin (P4-05 acceptance[0]): a step refused because
 * the agent's Run has ended names the terminal state and the reason the
 * transition was given, so the turn records why it stopped.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type TurnEndReason } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import RunPlugin from '../src/index.ts'

/** The reason the test gives for ending the Run. */
const REASON = 'the run was ended from a test'

const roots: string[] = []
const mounted: Context[] = []

afterEach(async () => {
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/**
 * Mount the Run plugin over an in-memory lease store, with a model that must never be asked.
 * @returns the context, and the adapter whose requests show whether a model step ran.
 */
async function mount(): Promise<{ ctx: Context; adapter: MockAdapter }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-ended-'))
  roots.push(root)
  const ctx = new Context()
  mounted.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: join(root, 'runs.json') })
  const adapter = new MockAdapter([textResponse('should never be asked')])
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

/**
 * Prompt the agent and read the reasons its turns ended with.
 * @param agent - the agent to prompt.
 * @returns every turn-end reason in its log.
 */
async function promptedTurnEnds(agent: Agent): Promise<TurnEndReason[]> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go on' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  return agent.session.snapshotEvents().flatMap(event => event.type === 'turn/end' ? [event.data.reason] : [])
}

describe('BLOCKED-332: a step refused because the Run has ended names its state and the reason', () => {
  it('records the terminal state and the reason the transition was given on the blocked turn end', async () => {
    const { ctx, adapter } = await mount()
    const agent = await ctx.agentLoop.create(SessionId('ended-failed'), { provider: 'mock', model: 'mock' })
    expect(ctx.runs.advance(agent, 'failed', REASON)).toBeUndefined()
    // A later proposal is refused, and does not replace the reason the Run ended with.
    expect(ctx.runs.advance(agent, 'completed', 'a later proposal')).toBe('illegal-transition')

    expect(await promptedTurnEnds(agent)).toEqual([{ kind: 'blocked', runEnded: { state: 'failed', reason: REASON } }])
    expect(adapter.requests).toHaveLength(0)
  })

  it('names the state alone for a Run that ended without a reason given through runs.advance', async () => {
    const { ctx } = await mount()
    const agent = await ctx.agentLoop.create(SessionId('ended-completed'), { provider: 'mock', model: 'mock' })
    const lifecycle = agent.lifecycle
    if (lifecycle === undefined) throw new Error('the Run plugin opened no Run for the agent')
    agent.lifecycle = { ...lifecycle, state: 'completed' }

    expect(await promptedTurnEnds(agent)).toEqual([{ kind: 'blocked', runEnded: { state: 'completed' } }])
  })
})
