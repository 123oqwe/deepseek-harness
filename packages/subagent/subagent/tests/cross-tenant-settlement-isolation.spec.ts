/**
 * P4-06 acceptance[2] on the real settlement path: a child's settlement is
 * consumed only by ITS OWN parent — one parent can never drain a settlement
 * addressed to another. The isolation lives in `settlementsInState`
 * (settlement-outbox.ts), which a draining parent reaches through
 * `pendingSettlementsFor`/`drainSettlements`: it returns only the outbox rows
 * whose `target` is that parent. The tenant a settlement is committed under is
 * the child's parent session (continuation-activation.ts commits every
 * settlement with `parentSessionId`/`tenant: activation.parentSession`).
 *
 * This is a real-composition evidence case, not a unit check of the filter: two
 * parent sessions each start a continuable child through the real manager with
 * the bus and durable persistence mounted, and each parent's own session log is
 * read back. The existing references to the mailbox/dedup decision functions
 * have no factory caller (A-584); this drives the settlement path that the
 * shipped composition actually runs.
 *
 * Green today. The paired mutation drops the `target` match from
 * `settlementsInState`, so a draining parent takes every pending settlement
 * regardless of whom it is addressed to — one parent then receives the other's
 * child's settlement, and these cases red.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import RunPlugin from '@deepseek-ai/dsh-run'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime from '../src/index.ts'
import { ackedSettlementsFor, pendingSettlementsFor } from '../src/settlement-outbox.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  // Dispose before the directories go, so an in-flight durable write never
  // races a removed path (settlement-outbox.spec.ts's BLOCKED-229 ordering).
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Boot the loop, a spawn provider, a lease store, the Run Service, durable persistence and the bus. */
async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  directory?: string,
): Promise<{ ctx: Context; busDirectory: string }> {
  const busDirectory = directory ?? mkdtempSync(join(tmpdir(), 'dsh-xtenant-settle-'))
  if (directory === undefined) roots.push(busDirectory)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(busDirectory, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: join(busDirectory, 'runs.json'), leaseMs: 60_000 })
  await ctx.plugin(MessageBusPlugin, { directory: busDirectory })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  return { ctx, busDirectory }
}

/** Enough generic responses for two children to run and two parents to drain. */
const responses = (): ReturnType<typeof textResponse>[] => Array.from({ length: 8 }, () => textResponse('done'))

/** The delegation spec a continuable child is started from. */
function startSpec(parent: Agent) {
  return {
    provider: 'spawn',
    label: 'child task',
    request: { prompt: [{ type: 'text' as const, text: 'child task' }], parent },
    signal: new AbortController().signal,
  }
}

/** The child session ids a parent's log records a settlement for, in log order. */
function settledSenders(ctx: Context, sessionId: SessionId): SessionId[] {
  const events = ctx.agents.get(sessionId)?.session.snapshotEvents() ?? []
  return events.flatMap((event) => {
    if (event.type !== 'user/message') return []
    const source = event.data.source
    return source.kind === 'subagent-settled' ? [source.senderSessionId] : []
  })
}

/** The number of outbox rows a drain has delivered (consumed). */
function ackedCount(ctx: Context): number {
  return ctx.messageBus.outboxRows().filter(row => row.record.state === 'acked').length
}

describe('P4-06 acceptance[2]: a settlement is consumed only by its own parent, never cross-tenant', () => {
  it('① two parents each start a child; each parent\'s log carries only its own child\'s settlement', async () => {
    const { ctx } = await setup(responses())
    const parent1 = await ctx.agentLoop.create(SessionId('tenant-a'), { provider: 'mock', model: 'mock' })
    const parent2 = await ctx.agentLoop.create(SessionId('tenant-b'), { provider: 'mock', model: 'mock' })
    const childA = await ctx.subagents.startContinuable(startSpec(parent1))
    const childB = await ctx.subagents.startContinuable(startSpec(parent2))
    // Both children settle, and the commit signals each target's driver so each
    // idle parent drains its own owed settlement.
    await vi.waitFor(() => { expect(ackedCount(ctx)).toBe(2) }, { timeout: 10_000 })
    const a = settledSenders(ctx, SessionId('tenant-a'))
    const b = settledSenders(ctx, SessionId('tenant-b'))
    const detail = JSON.stringify({ a, b, childA: childA.childId, childB: childB.childId })
    // Green today: each parent received exactly its own child, and neither
    // carries the other's. The mutation that drops the target match lets one
    // parent drain both, so one of these reds.
    expect(a, detail).toEqual([childA.childId])
    expect(b, detail).toEqual([childB.childId])
    expect(a, detail).not.toContain(childB.childId)
    expect(b, detail).not.toContain(childA.childId)
  })

  it('② the isolation survives a restart: settlements owed at shutdown reach only their own parent on resume', async () => {
    const first = await setup(responses())
    const parent1 = await first.ctx.agentLoop.create(SessionId('tenant-a'), { provider: 'mock', model: 'mock' })
    const parent2 = await first.ctx.agentLoop.create(SessionId('tenant-b'), { provider: 'mock', model: 'mock' })
    const childA = await first.ctx.subagents.startContinuable(startSpec(parent1))
    const childB = await first.ctx.subagents.startContinuable(startSpec(parent2))
    // Dispose with the children still resident: the manager commits every live
    // child's settlement in its drain prologue and delivers none (the tree is
    // tearing down), so both rows are committed and left owed.
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    // A second process over the same bus directory: both rows are still owed,
    // then each parent drains on resume.
    const second = await setup(responses(), first.busDirectory)
    expect(second.ctx.messageBus.outboxRows().map(row => row.record.state).sort()).toEqual(['pending', 'pending'])
    await second.ctx.agents.resume({ resumeSessionId: SessionId('tenant-a'), agentOptions: { provider: 'mock', model: 'mock' } })
    await second.ctx.agents.resume({ resumeSessionId: SessionId('tenant-b'), agentOptions: { provider: 'mock', model: 'mock' } })
    await vi.waitFor(() => { expect(ackedCount(second.ctx)).toBe(2) }, { timeout: 10_000 })

    const a = settledSenders(second.ctx, SessionId('tenant-a'))
    const b = settledSenders(second.ctx, SessionId('tenant-b'))
    // Diagnosis (dispatch-only): the narrow run read b as []. Capture whether
    // each tenant resumed, which settlements are still owed vs acked for tenant-b,
    // and the full outbox, so the cause (b not resumed / its drain not triggered /
    // acked before the splice reached its log) is read from the run, not guessed.
    const diagnosis = {
      aResumed: second.ctx.agents.get(SessionId('tenant-a')) !== undefined,
      bResumed: second.ctx.agents.get(SessionId('tenant-b')) !== undefined,
      bOwed: pendingSettlementsFor(second.ctx.messageBus, SessionId('tenant-b')).map(settlement => settlement.childId),
      bAcked: ackedSettlementsFor(second.ctx.messageBus, SessionId('tenant-b')).map(settlement => settlement.childId),
      outbox: second.ctx.messageBus.outboxRows().map(row => ({ target: row.target, state: row.record.state, id: row.record.id })),
    }
    const detail = JSON.stringify({ a, b, childA: childA.childId, childB: childB.childId, diagnosis })
    // Green today after the restart: each resumed parent still received only its
    // own child's settlement.
    expect(a, detail).toEqual([childA.childId])
    expect(b, detail).toEqual([childB.childId])
    expect(a, detail).not.toContain(childB.childId)
    expect(b, detail).not.toContain(childA.childId)
  })
})
