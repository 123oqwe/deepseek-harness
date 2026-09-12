/**
 * P2-06 must[1]: the REAL dispatch path re-verifies a recorded approval before
 * it runs the tool (Epic P2-06, acceptance[0]).
 *
 * The verifier and the binding shipped through the Contract and Provider stages
 * with no caller, so "an approval is re-validated before execution" held over a
 * function nothing on a dispatch path called. These cases drive the agent loop's
 * own tool dispatch and assert **what the tool observed**: a verification whose
 * result is computed and then ignored passes every case that only asserts the
 * verifier was reached.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import LlmRuntime, { createUserMessage, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { approvalBindingDigest } from '@deepseek-ai/dsh-user-approval/canonical'
import type { ApprovalBindingInputs } from '@deepseek-ai/dsh-user-approval/types'
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

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** A tool that records every execution, so "did it run" is observed and not inferred. */
function countingTool(runs: string[]) {
  return defineContentToolFixture({
    name: 'write',
    description: 'an action a human approved',
    parameters: { contents: { type: 'string', required: true } },
    execute(args: { contents: string }) {
      runs.push(args.contents)
      return Promise.resolve([{ type: 'text' as const, text: `wrote ${args.contents}` }])
    },
  })
}

/** Every tool result the session recorded, as flat text. */
function resultTexts(ctx: Context, id: SessionId): string[] {
  return ctx.sessions.get(id)!.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : [
    event.data.message.content.flatMap(block =>
      block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
  ])
}

/**
 * The tuple a decider would have seen for this call, as the dispatch path builds it.
 *
 * `args` is the RAW argument string the model emitted, not a parsed object,
 * because that is what the dispatch path binds — the same value P2-03's
 * `computeArgumentsHash` already digests for the manifest. Binding the parsed
 * form instead would give one action two different digests depending on which
 * layer took it. The consequence is conservative and worth stating: two
 * semantically equal argument strings that differ in spelling digest
 * differently and are refused, which fails closed rather than open.
 * @param contents - the one argument this fixture's tool takes.
 * @returns the tuple.
 */
function decidedFor(contents: string): ApprovalBindingInputs {
  return {
    action: 'write',
    args: JSON.stringify({ contents }),
    principal: 'unattached',
    preconditions: [],
  }
}

/**
 * Seed a session with the record the approval service would have written.
 *
 * Written into the log directly because the DECISION is not what these cases
 * are about — the Provider stage's own suite proves the service writes it. What
 * is under test is whether the dispatch path reads it back and acts on it.
 * @param ctx - the composition holding the session.
 * @param id - the session to seed.
 * @param inputs - the tuple the recorded decision covered.
 * @param expiresAtMs - when that decision stops being usable.
 */
function seedApproval(ctx: Context, id: SessionId, inputs: ApprovalBindingInputs, expiresAtMs: number): void {
  ctx.sessions.get(id)!.append('approval/bound', {
    id: ApprovalRequestId('approval-1'),
    action: inputs.action,
    digest: approvalBindingDigest(inputs),
    principal: inputs.principal,
    preconditions: inputs.preconditions,
    expiresAtMs,
  })
}

describe('P2-06 must[1]: a recorded approval is re-verified on the real dispatch path', () => {
  it('RUNS the tool when the recorded decision still covers the call — the positive control', async () => {
    // Without this, a dispatch path that refused everything would satisfy both
    // refusal cases below perfectly.
    const runs: string[] = []
    const ctx = await harness(new MockAdapter([call('c1', 'write', { contents: 'one' }), textResponse('done')]))
    ctx.tools.register(countingTool(runs))
    const id = SessionId('approval-ok')
    const agent = ctx.agentLoop.create(id, { provider: 'mock', model: 'mock' })
    seedApproval(ctx, id, decidedFor('one'), Date.now() + 600_000)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual(['one'])
  })

  it('does NOT run the tool when the arguments changed after the decision, and says which field', async () => {
    // The clause's first sentence, observed at the tool: the approval covered
    // `one` and the model is dispatching `two`.
    const runs: string[] = []
    const ctx = await harness(new MockAdapter([call('c1', 'write', { contents: 'two' }), textResponse('done')]))
    ctx.tools.register(countingTool(runs))
    const id = SessionId('approval-substituted')
    const agent = ctx.agentLoop.create(id, { provider: 'mock', model: 'mock' })
    seedApproval(ctx, id, decidedFor('one'), Date.now() + 600_000)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual([])
    expect(resultTexts(ctx, id).join('\n')).toContain('arguments changed')
  })

  it('does NOT run the tool once the decision has expired, and says so distinctly', async () => {
    // A lapsed decision and a substituted one call for different operator
    // actions — ask again versus investigate — so the refusals must differ.
    const runs: string[] = []
    const ctx = await harness(new MockAdapter([call('c1', 'write', { contents: 'one' }), textResponse('done')]))
    ctx.tools.register(countingTool(runs))
    const id = SessionId('approval-expired')
    const agent = ctx.agentLoop.create(id, { provider: 'mock', model: 'mock' })
    seedApproval(ctx, id, decidedFor('one'), Date.now() - 1)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual([])
    expect(resultTexts(ctx, id).join('\n')).toContain('had expired')
  })

  it('RUNS the tool when the session recorded no approval at all, so unbound asks are unaffected', async () => {
    // The registry's own ask carries no tuple, and every composition that
    // predates this epic records nothing: those must dispatch exactly as before
    // rather than being refused for lacking a decision they never made.
    const runs: string[] = []
    const ctx = await harness(new MockAdapter([call('c1', 'write', { contents: 'one' }), textResponse('done')]))
    ctx.tools.register(countingTool(runs))
    const id = SessionId('approval-none')
    const agent = ctx.agentLoop.create(id, { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual(['one'])
  })
})
