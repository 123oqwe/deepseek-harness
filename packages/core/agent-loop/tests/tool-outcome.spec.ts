/**
 * Epic P3-03 U1 at the loop's one `tool/result` writer: a result whose
 * execution did not succeed records its outcome from the result's structured
 * facts, and a clean success records none.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

/**
 * A loop over `adapter` with two tools: `fails` throws `ENOENT`, `ok` answers.
 * @param adapter - the scripted model.
 * @returns the context.
 */
async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.tools.register(defineContentToolFixture({
    name: 'fails', description: 'throws', parameters: {},
    async execute() { throw new HarnessError('no such file', 'ENOENT') },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'ok', description: 'answers', parameters: {},
    async execute() { return [{ type: 'text', text: 'fine' }] },
  }))
  return ctx
}

/**
 * Resolve when `agent` next goes idle.
 * @param ctx - the context.
 * @param agent - the agent.
 */
function idle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

describe('P3-03 U1: the loop records each tool result\'s outcome', () => {
  it('records a failed call\'s outcome beside its error, and nothing for a clean success', async () => {
    const ctx = await harness(new MockAdapter([toolCallResponse('c1', 'fails', {}), toolCallResponse('c2', 'ok', {}), textResponse('done')]))
    const agent = await ctx.agentLoop.create(SessionId('outcome-loop'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await idle(ctx, agent)

    const results = agent.session.snapshotEvents().flatMap(event => event.type === 'tool/result' ? [event.data] : [])
    expect(results.map(data => [data.message.source.callId, data.error, data.outcome])).toEqual([
      ['c1', { name: 'HarnessError', code: 'ENOENT' }, { kind: 'tool_failed', code: 'ENOENT' }],
      ['c2', undefined, undefined],
    ])
    expect(Object.hasOwn(results[1] ?? {}, 'outcome')).toBe(false)
  })
})
