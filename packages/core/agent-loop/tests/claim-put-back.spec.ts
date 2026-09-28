/**
 * Epic P4-06 must[2] and the ACCEPTANCE LOCK's clause (a), BLOCKED-088, on the
 * agent loop (B-677): a message a step claimed and the conversation never
 * recorded is not lost. A pre-step refusal or a failure before the record puts
 * it back in the inbox, where a later turn records it once; a refusal that
 * drops it on purpose names it in `dropped`, and the turn's `blocked` end
 * records who dropped it and why; a cancel that clears the inbox cancels it
 * with a `canceled` splice.
 */
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/**
 * A context with the agent loop and its services, answering from `adapter`.
 * @param adapter - the scripted model.
 * @returns the context.
 */
async function loopContext(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/**
 * The text of every message the conversation recorded, in order.
 * @param agent - the agent whose log is read.
 * @returns the texts.
 */
function recordedTexts(agent: Agent): string[] {
  return agent.session.snapshotEvents()
    .flatMap((event: SessionEvent) => event.type === 'user/message' ? event.data.content : [])
    .flatMap(block => block.type === 'text' ? [block.text] : [])
}

/**
 * The reason of every `turn/end` in the agent's log, in order.
 * @param agent - the agent whose log is read.
 * @returns the reasons.
 */
function turnEnds(agent: Agent): TurnEndReason[] {
  return agent.session.snapshotEvents().flatMap((event: SessionEvent) => event.type === 'turn/end' ? [event.data.reason] : [])
}

/**
 * Send one user prompt and wait until the agent is idle again.
 * @param agent - the agent.
 * @param text - the prompt.
 */
async function prompt(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

describe('P4-06 must[2] (agent loop): a claimed message the turn never recorded goes back, unless the refusal drops it with a record (B-677)', () => {
  it('a pre-step refusal that names no drop puts the claimed prompt back, and the next turn records it once', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await loopContext(adapter)
    const agent = await ctx.agentLoop.create(SessionId('put-back'), { provider: 'mock', model: 'mock' })
    let proposals = 0
    ctx.on('agent/pre-step', async (_proposal, next): Promise<PreStepDecision> => ++proposals === 1 ? { kind: 'reject' } : next())

    await prompt(agent, 'first')
    expect(recordedTexts(agent)).toEqual([])
    expect(agent.inbox.nextStep.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))).toEqual(['first'])

    await prompt(agent, 'second')
    expect(recordedTexts(agent)).toEqual(['first', 'second'])
    expect(adapter.requests).toHaveLength(1)
    expect(turnEnds(agent).map(reason => reason.kind)).toEqual(['blocked', 'completed'])
  })

  it('a refusal that drops the claimed prompt on purpose records on the turn end which message, who dropped it and why, and puts nothing back', async () => {
    const adapter = new MockAdapter([])
    const ctx = await loopContext(adapter)
    const agent = await ctx.agentLoop.create(SessionId('dropped'), { provider: 'mock', model: 'mock' })
    const claimedIds: string[] = []
    ctx.on('agent/pre-step', async ({ messages }): Promise<PreStepDecision> => {
      claimedIds.push(...messages.map(message => String(message.id)))
      return { kind: 'reject', dropped: [{ messageIds: messages.map(message => message.id), by: 'test-refuser', reason: 'the test drops it' }] }
    })

    await prompt(agent, 'refused')
    expect(claimedIds).toHaveLength(1)
    expect(turnEnds(agent)).toEqual([{ kind: 'blocked', dropped: [{ messageIds: claimedIds, by: 'test-refuser', reason: 'the test drops it' }] }])
    expect([...agent.inbox.nextTurn, ...agent.inbox.nextStep]).toEqual([])
    expect(recordedTexts(agent)).toEqual([])
    expect(adapter.requests).toHaveLength(0)
  })

  it('a cancel that clears the inbox from inside the claim cancels the claimed prompt with a record and puts nothing back', async () => {
    const adapter = new MockAdapter([])
    const ctx = await loopContext(adapter)
    const agent = await ctx.agentLoop.create(SessionId('cancel-in-claim'), { provider: 'mock', model: 'mock' })
    // `agent/inbox/claimed` runs inside the claim, before the loop holds the batch.
    const stop = ctx.on('agent/inbox/claimed', ({ agent: subject }) => {
      if (subject !== agent) return
      stop()
      agent.cancel({ kind: 'user' })
    })

    await prompt(agent, 'cancelled')
    expect([...agent.inbox.nextTurn, ...agent.inbox.nextStep]).toEqual([])
    expect(recordedTexts(agent)).toEqual([])
    expect(turnEnds(agent).map(reason => reason.kind)).toEqual(['aborted'])
    expect(agent.session.snapshotEvents().filter((event: SessionEvent) =>
      event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled')).toHaveLength(1)
    expect(adapter.requests).toHaveLength(0)
  })

  it('a cancel that keeps the inbox but sets cancelClaim cancels the claimed prompt with a record instead of putting it back', async () => {
    const adapter = new MockAdapter([])
    const ctx = await loopContext(adapter)
    const agent = await ctx.agentLoop.create(SessionId('cancel-claim'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/pre-step', async (_proposal, next): Promise<PreStepDecision> => {
      agent.cancel({ kind: 'parent' }, { keepInbox: true, cancelClaim: true })
      return next()
    })

    await prompt(agent, 'interrupted')
    expect([...agent.inbox.nextTurn, ...agent.inbox.nextStep]).toEqual([])
    expect(recordedTexts(agent)).toEqual([])
    expect(turnEnds(agent)).toEqual([{ kind: 'aborted', reason: { kind: 'parent' } }])
    expect(agent.session.snapshotEvents().filter((event: SessionEvent) =>
      event.type === 'agent/inbox/spliced' && event.data.outcome === 'canceled')).toHaveLength(1)
    expect(adapter.requests).toHaveLength(0)
  })

  it('a pre-step that fails before the record puts the claimed prompt back, and the next turn records it once', async () => {
    const adapter = new MockAdapter([textResponse('ok')])
    const ctx = await loopContext(adapter)
    const agent = await ctx.agentLoop.create(SessionId('failed'), { provider: 'mock', model: 'mock' })
    let proposals = 0
    ctx.on('agent/pre-step', async (_proposal, next): Promise<PreStepDecision> => {
      if (++proposals === 1) throw new Error('the pre-step failed')
      return next()
    })

    await prompt(agent, 'first')
    expect(recordedTexts(agent)).toEqual([])
    expect(turnEnds(agent).map(reason => reason.kind)).toEqual(['error'])

    await prompt(agent, 'second')
    expect(recordedTexts(agent)).toEqual(['first', 'second'])
    expect(adapter.requests).toHaveLength(1)
  })
})
