/**
 * BLOCKED-352 (P4-12, product defect, open): on the native dispatch path a
 * refused reservation keeps its record (tool-calls.ts publishes records[index]
 * before reserveExternalEffect and keeps it on refusal), so commitReady settles
 * it, confirmExternalEffect calls markAmbiguous on an entry that is already
 * confirmed, and the ledger throws — the turn ends in an error. The code-mode
 * path (ptc.ts) clears the reservation before it settles and does not have this.
 *
 * Red first (BLOCKED-352 closing condition 1). The fix is lane B's — clear the
 * record on refusal, as the code-mode path does — and §21.4: it is not read.
 * Two replays of an already-confirmed external effect — same-epoch (a duplicate
 * call in one run) and cross-epoch (a resume in a new process replays the call
 * under its original id) — each report "already confirmed … not performed
 * again" AND must not end their turn in an error. Today the kept record's
 * settlement throws, emitting `agent/error`, so both cases red. The effect runs
 * exactly once either way (P4-12 acceptance[0] is not what fails here).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ActionLedgerPlugin from '@deepseek-ai/dsh-action-ledger'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import RunPlugin from '@deepseek-ai/dsh-run'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** One assistant message carrying a tool call, as the loop parses it. */
function call(id: string, name: string, args: object): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) } },
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** An external-effect tool that records each execution, so "did it run" is observed. */
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

/** A durable native stack: persistence (so a session can be resumed), tools, and the idempotency ledger. */
async function durableHarness(adapter: MockAdapter, sessionRoot: string, ledgerRoot: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  // SessionStore is the live session service the loop reads through; the JSONL
  // backend adds the durable persistence `resume` needs. Both are mounted, the
  // same way the agent-loop testkit's dependency bundle does.
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: sessionRoot })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  // The Run Service assigns the lease epoch (external-effect.ts): a fresh agent
  // gets one epoch, and a resume after the lease lapses gets a higher one — which
  // is what makes the cross-epoch replay's "held by epoch 0, not 1" distinct from
  // the same-epoch "is confirmed". It injects the lease store mounted here.
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: join(ledgerRoot, 'runs.json'), leaseMs: 60_000 })
  await ctx.plugin(ActionLedgerPlugin, { directory: ledgerRoot })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** Every tool result a session recorded, as flat text. */
function resultTexts(ctx: Context, id: SessionId): string[] {
  return (ctx.agents.get(id)?.session.snapshotEvents() ?? []).flatMap(event => event.type !== 'tool/result' ? [] : [
    event.data.message.content.flatMap(block =>
      block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
  ])
}

/** A fresh temp directory, cleaned in afterEach. */
function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

const goMessage = (text: string) => createUserMessage({ content: [{ type: 'text' as const, text }], source: { kind: 'user' as const } })

describe('BLOCKED-352: a replayed already-confirmed call reports "already confirmed" and does not end its turn in an error (red first)', () => {
  it('① same-epoch: a duplicate call in one run is refused, runs once, and its turn does not error', async () => {
    const runs: string[] = []
    const errors: string[] = []
    const ctx = await durableHarness(new MockAdapter([
      call('c1', 'charge', { amount: '10' }),
      call('c1', 'charge', { amount: '10' }),
      textResponse('done'),
    ]), tempRoot('b352-same-s-'), tempRoot('b352-same-l-'))
    ctx.tools.register(countingTool(runs))
    ctx.on('agent/error', ({ error }) => { errors.push(String(error)) })
    const agent = await ctx.agentLoop.create(SessionId('b352-same'), { provider: 'mock', model: 'mock' })
    agent.followup(goMessage('go'))
    await agent.whenIdle()

    const texts = resultTexts(ctx, SessionId('b352-same'))
    const detail = JSON.stringify({ runs, texts, errors })
    // The effect ran once; the replay is refused with the "already confirmed" result.
    expect(runs, detail).toEqual(['10'])
    expect(texts[1] ?? '', detail).toContain('already')
    expect(texts[1] ?? '', detail).toContain('not performed again')
    // RED today: settling the refused reservation's kept record calls
    // markAmbiguous on the confirmed entry, which throws, so the turn emits
    // agent/error. B-704's fix clears the record (as the code-mode path does).
    expect(errors, detail).toEqual([])
  })

  it('② cross-epoch: a resume in a new process replays the confirmed call under its id, refused, turn does not error', async () => {
    const runs: string[] = []
    const errors: string[] = []
    const sessionRoot = tempRoot('b352-x-s-')
    const ledgerRoot = tempRoot('b352-x-l-')
    // Epoch 0: the call takes effect and its ledger entry is confirmed, then the
    // process ends with the session persisted.
    const firstAdapter = new MockAdapter([call('c1', 'charge', { amount: '10' }), textResponse('done')])
    const first = await durableHarness(firstAdapter, sessionRoot, ledgerRoot)
    first.tools.register(countingTool(runs))
    const firstAgent = await first.agentLoop.create(SessionId('b352-epoch'), { provider: 'mock', model: 'mock' })
    firstAgent.followup(goMessage('go'))
    await firstAgent.whenIdle()
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    // A new process (new epoch) over the same session and ledger directories:
    // the resume replays the confirmed call under its original id.
    const secondAdapter = new MockAdapter([call('c1', 'charge', { amount: '10' }), textResponse('done')])
    const second = await durableHarness(secondAdapter, sessionRoot, ledgerRoot)
    second.tools.register(countingTool(runs))
    second.on('agent/error', ({ error }) => { errors.push(String(error)) })
    const resumed = await second.agents.resume({
      resumeSessionId: SessionId('b352-epoch'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    resumed.agent.followup(goMessage('go again'))
    await resumed.agent.whenIdle()

    const texts = resultTexts(second, SessionId('b352-epoch'))
    const detail = JSON.stringify({ runs, texts, errors })
    // The effect ran once (epoch 0); the replay in the new epoch is refused.
    expect(runs, detail).toEqual(['10'])
    expect(texts.at(-1) ?? '', detail).toContain('already')
    expect(texts.at(-1) ?? '', detail).toContain('not performed again')
    // RED today: the refused replay's kept record settles, markAmbiguous throws
    // "is held by epoch 0, not 1", and the resumed turn emits agent/error.
    expect(errors, detail).toEqual([])
  })
})
