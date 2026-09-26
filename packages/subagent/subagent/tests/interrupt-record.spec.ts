/**
 * A human parent's interrupt survives a host restart (Epic P5-10 must[2],
 * acceptance[0]; BLOCKED-343).
 *
 * `interruptByParent` commits the interrupt to the durable bus, keyed by the
 * child's lease epoch, before it returns, and a router built after a restart
 * replays it. These cases drive real children through the real manager with
 * a durable bus and the Run Service mounted. A restart is one Context
 * disposed and another booted over the same session, run and bus stores. The
 * bus file is read through a second SQLite connection, so a row it returns is
 * on disk and not only in the committing process.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import RunPlugin from '@deepseek-ai/dsh-run'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime, { type SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent'
import { deliverSubagentPrompt, type HostPromptDeliverer } from '@deepseek-ai/dsh-subagent/internal'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { commitInterrupt, interruptRecorded } from '../src/interrupt-record.ts'
import { TestSessionQuery } from './test-session-query.ts'

const PARENT = SessionId('parent')
const CHILD = SessionId('child')
const OTHER = SessionId('other')

const roots: string[] = []
/** Every Context a case boots, disposed before the directories go (BLOCKED-229, BLOCKED-230). */
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/**
 * Boot the loop, a spawn provider, a lease store, the Run Service, a durable
 * bus over `directory`, and the session query a cold resume reads the child through.
 * @param script - the scripted model's responses, in request order.
 * @param directory - the stores' directory; a new one when absent.
 * @returns the booted Context, its scripted model, and the stores' directory.
 */
async function setup(script: ConstructorParameters<typeof MockAdapter>[0], directory?: string) {
  const storeDirectory = directory ?? mkdtempSync(join(tmpdir(), 'dsh-interrupt-record-'))
  if (directory === undefined) roots.push(storeDirectory)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(storeDirectory, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(InMemoryLeaseStorePlugin)
  await ctx.plugin(RunPlugin, { storePath: join(storeDirectory, 'runs.json'), leaseMs: 60_000 })
  await ctx.plugin(MessageBusPlugin, { directory: storeDirectory })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter, storeDirectory }
}

/**
 * The delegation spec a continuable child is started from.
 * @param parent - the live parent.
 * @returns the spec.
 */
function startSpec(parent: Agent) {
  return {
    provider: 'spawn',
    label: 'child task',
    request: { prompt: [{ type: 'text' as const, text: 'child task' }], parent },
    signal: new AbortController().signal,
  }
}

/**
 * A browser prompt from the parent to one child.
 * @param childSessionId - the child.
 * @param requestId - the prompt's request id.
 * @returns the request.
 */
function promptRequest(childSessionId: SessionId, requestId: string) {
  return {
    requestId: requestId as SubagentPromptRequestId,
    parentSessionId: PARENT,
    childSessionId,
    mode: 'continuable' as const,
    delivery: 'queue' as const,
    content: [{ type: 'text' as const, text: 'take a turn after the restart' }],
  }
}

/** One interrupt record as the bus file holds it. */
interface InterruptRow {
  readonly child: string
  readonly epoch: number
  readonly parent: string
  readonly type: string
}

/**
 * The interrupt records in the bus file, read through a second, read-only connection.
 * @param storeDirectory - the directory holding `bus.sqlite`.
 * @returns each record's child, epoch, parent and type, in commit order.
 */
function interruptRows(storeDirectory: string): InterruptRow[] {
  const db = new DatabaseSync(join(storeDirectory, 'bus.sqlite'), { readOnly: true })
  try {
    return (db.prepare('SELECT message_id, epoch, subject, type FROM domain_events WHERE source = \'subagent-interrupted\' ORDER BY seq').all() as Record<string, string | number | null>[])
      .map(row => ({ child: String(row.message_id), epoch: Number(row.epoch), parent: String(row.subject), type: String(row.type) }))
  } finally {
    db.close()
  }
}

/**
 * Wait until a child's Activation is gone.
 * @param ctx - the booted Context.
 * @param childId - the child.
 */
async function waitGone(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
}

/**
 * Start one continuable child whose first model request is held open, and wait until that request is in flight.
 * @param ctx - the booted Context.
 * @param adapter - the scripted model, whose first entry holds.
 * @returns the parent, the child's id, and the lease epoch of the child's residency.
 */
async function startHeldChild(ctx: Context, adapter: MockAdapter) {
  const parent = await ctx.agentLoop.create(PARENT, { provider: 'mock', model: 'mock' })
  const { childId } = await ctx.subagents.startContinuable(startSpec(parent))
  const epoch = await vi.waitFor(() => {
    expect(adapter.requests).toHaveLength(1)
    const live = ctx.agents.get(childId)?.lifecycle?.epoch
    expect(live).toBeDefined()
    return live as number
  }, { timeout: 5_000 })
  return { parent, childId, epoch }
}

describe('P5-10 must[2]: the interrupt record on the bus', () => {
  it('commits one record per residency and finds it by child', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(MessageBusPlugin)

    expect(commitInterrupt(ctx.messageBus, { childId: CHILD, parentSessionId: PARENT, epoch: 3 })).toBe(true)
    // The same residency again: its record is already consumed, so nothing is added.
    expect(commitInterrupt(ctx.messageBus, { childId: CHILD, parentSessionId: PARENT, epoch: 3 })).toBe(false)
    expect(commitInterrupt(ctx.messageBus, { childId: CHILD, parentSessionId: PARENT, epoch: 4 })).toBe(true)

    expect(interruptRecorded(ctx.messageBus, CHILD)).toBe(true)
    expect(interruptRecorded(ctx.messageBus, OTHER)).toBe(false)
    expect(ctx.messageBus.domainEvents().map(event => ({ id: event.id, epoch: event.epoch, subject: event.subject, type: event.type })))
      .toEqual([
        { id: CHILD, epoch: 3, subject: PARENT, type: 'subagent/interrupt' },
        { id: CHILD, epoch: 4, subject: PARENT, type: 'subagent/interrupt' },
      ])
  })
})

describe('P5-10 must[2] and acceptance[0]: an interrupt survives a host restart', () => {
  it('is on disk, keyed by the child\'s lease epoch, when interruptByParent returns; a foreign address and a repeat add nothing', async () => {
    const { ctx, adapter, storeDirectory } = await setup(['hang', textResponse('parent saw the stop'), textResponse('spare'), textResponse('spare')])
    const { childId, epoch } = await startHeldChild(ctx, adapter)

    expect(() => ctx.subagents.interruptByParent(childId, SessionId('stranger'), 'continuable'))
      .toThrow(expect.objectContaining({ code: 'subagent/unauthorized' }))
    expect(interruptRows(storeDirectory)).toEqual([])

    expect(ctx.subagents.interruptByParent(childId, PARENT, 'continuable')).toEqual({ accepted: true })
    // Read before any await: nothing after the call's return is needed for the row to exist.
    expect(interruptRows(storeDirectory)).toEqual([{ child: childId, epoch, parent: PARENT, type: 'subagent/interrupt' }])

    ctx.subagents.interruptByParent(childId, PARENT, 'continuable')
    expect(interruptRows(storeDirectory)).toHaveLength(1)
    await waitGone(ctx, childId)
  })

  it('a browser prompt after the restart does not wake the interrupted child, and reading the record writes nothing', async () => {
    const first = await setup(['hang', textResponse('parent saw the stop'), textResponse('spare'), textResponse('spare')])
    const { parent, childId } = await startHeldChild(first.ctx, first.adapter)
    first.ctx.subagents.interruptByParent(childId, PARENT, 'continuable')
    await waitGone(first.ctx, childId)
    await parent.whenIdle()
    await first.ctx.fiber.dispose()

    const second = await setup([textResponse('spare'), textResponse('spare'), textResponse('spare'), textResponse('spare')], first.storeDirectory)
    await second.ctx.agents.resume({ resumeSessionId: PARENT, agentOptions: { provider: 'mock', model: 'mock' } })
    const delivery = vi.spyOn(second.ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt)

    await expect(second.ctx.subagents.prompt(promptRequest(childId, 'after-restart-1'), new AbortController().signal))
      .rejects.toMatchObject({ code: 'subagent/not-resumable', details: { reason: 'phase-forbids' } })
    await expect(second.ctx.subagents.prompt({ ...promptRequest(childId, 'after-restart-2'), delivery: 'steer' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'subagent/not-resumable' })
    expect(delivery).not.toHaveBeenCalled()
    expect(second.ctx.agents.get(childId)).toBeUndefined()
    expect(interruptRows(first.storeDirectory)).toHaveLength(1)
  })

  it('control: after the same restart, a child that was never interrupted takes the prompt', async () => {
    const first = await setup([textResponse('child done'), textResponse('parent ack'), textResponse('spare'), textResponse('spare')])
    const parent = await first.ctx.agentLoop.create(PARENT, { provider: 'mock', model: 'mock' })
    const { childId } = await first.ctx.subagents.startContinuable(startSpec(parent))
    await waitGone(first.ctx, childId)
    await parent.whenIdle()
    await first.ctx.fiber.dispose()

    const second = await setup([textResponse('child again'), textResponse('parent ack again'), textResponse('spare'), textResponse('spare')], first.storeDirectory)
    await second.ctx.agents.resume({ resumeSessionId: PARENT, agentOptions: { provider: 'mock', model: 'mock' } })
    const delivery = vi.spyOn(second.ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt)

    await expect(second.ctx.subagents.prompt(promptRequest(childId, 'after-restart-1'), new AbortController().signal))
      .resolves.toMatchObject({ messageId: expect.any(String) as unknown as string })
    expect(delivery).toHaveBeenCalledTimes(1)
    expect(interruptRows(first.storeDirectory)).toEqual([])
  })
})
