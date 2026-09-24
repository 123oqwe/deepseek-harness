/**
 * BLOCKED-330 on the native dispatch path: a call its capability token will
 * refuse is refused before the risk gate asks a person about it.
 *
 * The composition asks for real: the approval service, the preset gate that
 * asks about `shell-execute` at `read` and above, and a real session. Every
 * scope requires a capability token and no token provider is mounted, so the
 * call presents none and the token check refuses it.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/** One assistant message carrying a tool call, as the loop parses it. */
function call(id: string, name: string, args: object): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/**
 * Run one turn in which the model calls `write` once, with a token required everywhere and none presented.
 * @returns what the tool observed, the tool results as text, and the tools the session asked an operator about.
 */
async function refusedForItsToken(): Promise<{ runs: string[]; results: string[]; asked: string[] }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([call('c1', 'write', { contents: 'one' }), textResponse('done')]))
  // `permission-presets` injects `shell`: without one the preset service never
  // applies, and the risk gate would ask nobody whatever the order.
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('this case does not execute bash') },
    run() { throw new Error('this case does not execute bash') },
    start() { throw new Error('this case does not execute bash') },
  })
  await ctx.plugin(ApprovalService, {})
  ctx.on('approval/request', () => Promise.resolve<'allowed-once'>('allowed-once'))
  await ctx.plugin(PermissionPresetService, {
    riskRules: [{ domainTag: 'shell-execute', riskClass: 'internal-write' }],
    presets: { 'workspace-write': { sandbox: 'workspace-write', approval: 'ask', approvalThreshold: 'read' } },
    defaultPreset: 'workspace-write',
  })
  const runs: string[] = []
  ctx.tools.register(defineTool({
    name: 'write',
    description: 'an action the risk gate asks about',
    parameters: { contents: { type: 'string', required: true } },
    riskDomainTags: ['shell-execute'],
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute(args: { contents: string }) {
      runs.push(args.contents)
      return Promise.resolve(`wrote ${args.contents}`)
    },
  }))
  ctx.tools.requireCapabilityToken()
  const id = SessionId('token-before-ask')
  const agent = await ctx.agentLoop.create(id, { provider: 'mock', model: 'mock' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const events = ctx.sessions.get(id)!.snapshotEvents()
  const asked = events.flatMap(event => event.type === 'approval/asked' ? [event.data.toolName] : [])
  const results = events.flatMap(event => event.type !== 'tool/result' ? [] : [
    event.data.message.content.flatMap(block =>
      block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
  ])
  return { runs, results, asked }
}

describe('BLOCKED-330 on the native dispatch path: a call its capability token will refuse', () => {
  it('is not put to the operator', async () => {
    const { asked } = await refusedForItsToken()

    expect(asked).toEqual([])
  })

  it('is refused as a call that presented no token, and the tool body does not run', async () => {
    const { runs, results } = await refusedForItsToken()

    expect(results.some(text => text.includes('this scope requires a capability token and none was presented')), JSON.stringify(results)).toBe(true)
    expect(runs).toEqual([])
  })
})
