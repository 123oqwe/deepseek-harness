/**
 * The idempotency ledger consulted on the REAL dispatch path (Epic P4-12
 * must[4], acceptance[1], acceptance[2]).
 *
 * **The ledger had no caller.** The store, the CAS reservation and the five
 * states shipped through the Contract and Provider stages with, measured, zero
 * production callers, so "an external effect is reserved before it is sent"
 * held over a ledger nothing ever reserved against. These cases drive the
 * agent loop's own tool dispatch and assert what the tool observed.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ActionLedgerPlugin from '@deepseek-ai/dsh-action-ledger'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** One assistant message carrying a tool call, as the loop parses it. */
function call(id: string, name: string, args: object): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

async function harness(adapter: MockAdapter, options: { ledger?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.ledger !== false) {
    const root = mkdtempSync(join(tmpdir(), 'dsh-ledger-'))
    roots.push(root)
    await ctx.plugin(ActionLedgerPlugin, { directory: root })
  }
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** A tool that records every execution, so "did it run" is observed and not inferred. */
function countingTool(runs: string[]) {
  return defineContentToolFixture({
    name: 'charge',
    description: 'an external effect',
    parameters: { amount: { type: 'string', required: true } },
    execute(args: { amount: string }) {
      runs.push(args.amount)
      return Promise.resolve([{ type: 'text' as const, text: `charged ${args.amount}` }])
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

describe('P4-12 must[4]: the dispatch path reserves before it runs a tool', () => {
  it('RUNS the tool once and confirms the reservation, so an ordinary call is unaffected', async () => {
    // The positive control every refusal below needs. Without it a ledger that
    // refused everything would satisfy the refusal cases perfectly.
    const runs: string[] = []
    const ctx = await harness(new MockAdapter([call('c1', 'charge', { amount: '10' }), textResponse('done')]))
    ctx.tools.register(countingTool(runs))
    const agent = ctx.agentLoop.create(SessionId('ledger-ok'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual(['10'])
    expect(resultTexts(ctx, SessionId('ledger-ok'))).toEqual(['charged 10'])
    // The title says "and confirms the reservation", so the ledger is READ.
    // Without this the case asserted only that the tool ran: a dispatch path
    // that reserved and never confirmed passed it, leaving every key stuck at
    // `sent` — the state a crash cannot be told apart from, and the one this
    // epic exists to settle. Measured: deleting `confirmExternalEffect`
    // reddened nothing here before this assertion existed.
    // Scope and key come from the manifest the dispatch appended, which is the
    // same pair production reserved under — computing them here a second way
    // would test this test's arithmetic rather than the path's.
    const appended = ctx.sessions.get(SessionId('ledger-ok'))
      ?.snapshotEvents().find(event => event.type === 'action/manifest-appended')
    expect(appended).toBeDefined()
    const { actor, idempotencyKey } = appended?.data as { actor: string; idempotencyKey: string }
    expect(ctx.actionLedger.entry(actor as never, idempotencyKey)?.state).toBe('confirmed')
  })

  it('REFUSES a second call whose key was already reserved, and the tool does NOT run', async () => {
    // acceptance[0]'s consumer half at this seam. The key is derived from
    // (session, actionId, argumentsHash), so a replayed call id with the same
    // arguments presents the same key — which is exactly what a crash-and-retry
    // produces, and exactly what must not charge twice.
    const runs: string[] = []
    const ctx = await harness(new MockAdapter([
      call('c1', 'charge', { amount: '10' }),
      call('c1', 'charge', { amount: '10' }),
      textResponse('done'),
    ]))
    ctx.tools.register(countingTool(runs))
    const agent = ctx.agentLoop.create(SessionId('ledger-dup'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual(['10'])
    const texts = resultTexts(ctx, SessionId('ledger-dup'))
    expect(texts[0]).toBe('charged 10')
    expect(texts[1]).toContain('already')
    expect(texts[1]).toContain('not performed again')
  })

  it('runs BOTH calls when the arguments differ, so the key identifies the action and not the tool', async () => {
    // The arguments hash is in the key, so two genuinely different charges are
    // two reservations. Without this the refusal case above would also pass
    // against a ledger keyed on the tool name.
    const runs: string[] = []
    const ctx = await harness(new MockAdapter([
      call('c1', 'charge', { amount: '10' }),
      call('c2', 'charge', { amount: '20' }),
      textResponse('done'),
    ]))
    ctx.tools.register(countingTool(runs))
    const agent = ctx.agentLoop.create(SessionId('ledger-distinct'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual(['10', '20'])
  })

  it('runs the tool when NO ledger is mounted, because absence is not an approval to record', async () => {
    // The documented fall-through. A composition without a ledger has no
    // durable record of what it sent and behaves as the harness did before the
    // ledger existed; what must never happen is a MOUNTED ledger's refusal
    // being ignored, which the cases above pin.
    const runs: string[] = []
    const ctx = await harness(new MockAdapter([call('c1', 'charge', { amount: '10' }), textResponse('done')]), { ledger: false })
    ctx.tools.register(countingTool(runs))
    const agent = ctx.agentLoop.create(SessionId('ledger-absent'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(runs).toEqual(['10'])
  })
})
