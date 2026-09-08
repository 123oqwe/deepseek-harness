/**
 * Delegation as the taskboard's producer (Epic P5-11 must[0], acceptance[0],
 * acceptance[1]).
 *
 * Every case here drives a REAL delegation through `SubagentRuntime` and a real
 * spawn provider, and then reads the durable board. Nothing constructs a `Task`
 * by hand: the point of this suite is that production creates them, which was
 * exactly what P5-11 lacked (BLOCKED-154).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { TaskId, WorkerId } from '@deepseek-ai/dsh-taskboard'
import TaskStorePlugin, { openTaskStore } from '@deepseek-ai/dsh-taskboard-sqlite'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { TestSessionQuery } from '../../subagent/tests/test-session-query.ts'
import * as SubagentTaskboard from '../src/index.ts'

const CLAIM_LEASE_MS = 60_000

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Boot the loop, a spawn provider, the durable board, and the producer under test. */
async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-taskboard-'))
  roots.push(root)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(TaskStorePlugin, { directory: root })
  await ctx.plugin(SubagentTaskboard, { claimLeaseMs: CLAIM_LEASE_MS })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, root }
}

/**
 * Observe the board at the moment a child STARTS, which is the only window in
 * which its claim is live: the producer gives the claim back when the child
 * settles, so a case that reads afterwards sees a released task.
 */
function observeAtStart<T>(ctx: Context, read: (childId: SessionId) => T): { value: T | undefined } {
  const seen: { value: T | undefined } = { value: undefined }
  ctx.on('subagent/start', (info) => { seen.value = read(info.id) })
  return seen
}

/** Run one child to completion through the public delegation entry. */
async function delegate(ctx: Context, parent: Agent): Promise<SessionId> {
  const run = await ctx.subagents.start('spawn', {
    prompt: [{ type: 'text', text: 'do the work' }],
    parent,
    signal: new AbortController().signal,
  })
  await run.result
  await run.dispose()
  return run.id
}

describe('P5-11: a delegated child IS a task on the board', () => {
  it('CLAIMS the child for the delegating parent while it runs, at the attempt the claim granted', async () => {
    const { ctx, parent, root } = await setup([textResponse('done')])
    // Read through a SEPARATE handle on the same directory: what the assertion
    // is about is what landed durably, not what one in-process object holds.
    const board = openTaskStore(root)
    const live = observeAtStart(ctx, childId => board.get(brandString<TaskId>(childId)))

    await delegate(ctx, parent)

    // must[0]'s facts, each carrying a real value rather than a default: the
    // owner is the delegating parent's session, and the attempt is 1 because
    // this claim was the first.
    expect(live.value?.owner).toBe('parent')
    expect(live.value?.attempt).toBe(1)
    expect(live.value?.claimExpiresAtMs).toBeGreaterThan(0)
  })

  it('REFUSES a second worker while the child is running, and ADMITS one after it settles (acceptance[0], §12.29-1)', async () => {
    // Both halves on the row a real delegation wrote. The refusal is the clause;
    // the admission afterwards is what says the refusal was the live claim
    // rather than something that refuses everything.
    const { ctx, parent, root } = await setup([textResponse('done')])
    const board = openTaskStore(root)
    const other = brandString<WorkerId>('other-host')
    const contended = observeAtStart(ctx, childId => board.claim(brandString<TaskId>(childId), other, Date.now(), 1_000))

    const childId = await delegate(ctx, parent)

    expect(contended.value).toEqual({ claimed: false, reason: 'already-claimed' })
    expect(board.claim(brandString<TaskId>(childId), other, Date.now(), 1_000).claimed).toBe(true)
  })

  it('GIVES THE CLAIM BACK when the child settles, so the same host is not refused by its own finished attempt', async () => {
    // The gap §12.29-1 closed. Before `release` existed the claim stood until
    // `claimLeaseMs` elapsed, and a host delegating the same child again was
    // refused by a claim it had finished with.
    const { ctx, parent, root } = await setup([textResponse('done')])

    const childId = await delegate(ctx, parent)

    const task = openTaskStore(root).get(brandString<TaskId>(childId))
    expect(task?.owner).toBeNull()
    expect(task?.claimExpiresAtMs).toBeNull()
  })

  it('ADVANCES the task from the child settling, with nothing model-facing touching it (acceptance[1])', async () => {
    const { ctx, parent, root } = await setup([textResponse('done')])

    const childId = await delegate(ctx, parent)

    const board = openTaskStore(root)
    // `submitted`, not `verified`: the child produced work and nobody checked
    // it. A runtime that advanced straight to verified would be asserting a
    // check that never ran. The release clears the owner and leaves this
    // status alone — a holder letting go does not un-submit its work.
    expect(board.get(brandString<TaskId>(childId))?.status).toBe('submitted')
    expect(board.get(brandString<TaskId>(childId))?.verification).toBe('unverified')
  })

  it('advances a FAILED child to failed, so a task nobody finished is not left looking claimed', async () => {
    // An exhausted script makes the adapter throw, which is the transport
    // failure the seam reports as `stopReason: 'error'` — a real failing child
    // rather than a stop reason handed to the producer directly.
    const { ctx, parent, root } = await setup([])

    const childId = await delegate(ctx, parent)

    const task = openTaskStore(root).get(brandString<TaskId>(childId))
    expect(task?.status).toBe('failed')
    expect(task?.verification).toBe('failed')
  })

  it('REFUSES a release presenting a stale attempt, so a lapsed holder cannot strip its successor (§12.29-1)', async () => {
    // The fencing half. A worker whose claim lapsed and was reclaimed can still
    // finish and try to give the claim back; accepting that would take the
    // claim away from the holder that now has it.
    const { ctx, parent, root } = await setup([textResponse('done')])
    const childId = await delegate(ctx, parent)
    const board = openTaskStore(root)
    const taskId = brandString<TaskId>(childId)
    const successor = brandString<WorkerId>('successor')
    const claimed = board.claim(taskId, successor, Date.now(), 60_000)
    expect(claimed.claimed).toBe(true)

    const stale = board.release(taskId, successor, 1)

    expect(stale).toEqual({ released: false, reason: 'stale-attempt' })
    expect(board.get(taskId)?.owner).toBe('successor')
  })

  it('reports the task status through listChildren, which projections alone cannot answer', async () => {
    // The read side the registry names. A listing built from session
    // projections says whether a child is resident; only the board says what
    // the runtime recorded about its work, and this asserts the row carries it.
    const { ctx, parent } = await setup([textResponse('done')])
    const run = await ctx.subagents.start('spawn', {
      prompt: [{ type: 'text', text: 'do the work' }],
      parent,
      signal: new AbortController().signal,
    })

    const listed = await ctx.subagents.listChildren(parent.session.id)

    const row = listed.find(entry => entry.id === run.id)
    // The two disagree, and that is the point: the session record still has
    // the child resident, while the board already carries the runtime's own
    // record that its work was submitted. A listing without the board cannot
    // produce the second fact at all.
    expect(row).toMatchObject({ kind: 'child', activity: 'running', taskStatus: 'submitted' })
    await run.result
    await run.dispose()
  })

  it('records NOTHING when no board is mounted, because the producer never activates', async () => {
    // The inject is the whole guard: a profile without a taskboard runs
    // delegation exactly as before rather than half-recording it.
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    const applied = vi.spyOn(SubagentTaskboard, 'apply')
    await ctx.plugin(SubagentTaskboard, { claimLeaseMs: CLAIM_LEASE_MS })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
    const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })

    await expect(delegate(ctx, parent)).resolves.toBeDefined()
    expect(applied).not.toHaveBeenCalled()
  })
})
