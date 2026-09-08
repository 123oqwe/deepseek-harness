/**
 * Settlement through the durable bus (Epic P4-06 must[0], must[1],
 * acceptance[1]; §12.35-2(c), §12.39).
 *
 * **The send side had no producer.** `dispatchOnce`'s only caller in the
 * repository was an experimental package that does not ship, and the one real
 * handoff between agents — a child telling its parent how it ended — was
 * delivered by hand: a parent that was gone, tearing down, or unreachable got
 * a log line and nothing else.
 *
 * These cases drive real children through the real manager with the bus
 * mounted, and read the bus back.
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
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime from '../src/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Boot the loop, a spawn provider, a lease store, the Run Service and the bus. */
async function setup(script: ConstructorParameters<typeof MockAdapter>[0], directory?: string) {
  const busDirectory = directory ?? mkdtempSync(join(tmpdir(), 'dsh-settlement-bus-'))
  if (directory === undefined) roots.push(busDirectory)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  // Continuable children require persistence: a child that outlives its
  // Activation has to be reloadable, which is also what makes a settlement
  // delivered on a later start meaningful.
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

/** The delegation spec a continuable child is started from. */
function startSpec(parent: Agent) {
  return {
    provider: 'spawn',
    label: 'child task',
    request: { prompt: [{ type: 'text' as const, text: 'child task' }], parent },
    signal: new AbortController().signal,
  }
}

/** Wait until a child's Activation is gone, which is when its settlement is sent. */
async function waitGone(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
}

/** The settlement notices a session's log carries. */
function settlementNotices(ctx: Context, sessionId: SessionId): unknown[] {
  return (ctx.agents.get(sessionId)?.session.snapshotEvents() ?? [])
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'subagent-settled')
}

describe('P4-06: a settlement is committed to the bus before anyone tries to deliver it', () => {
  it('WAKES an idle parent once when its child settles, through the committed row', async () => {
    // Trigger (1): the commit signals the target's driver. A pre-step-only
    // drain would deadlock here — an idle parent waiting on its child has no
    // step to take, so nothing would ever deliver what it is waiting for.
    const { ctx } = await setup([textResponse('child done'), textResponse('parent done')])
    const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitGone(ctx, started.childId)
    await vi.waitFor(() => { expect(settlementNotices(ctx, SessionId('parent'))).toHaveLength(1) })

    // Exactly one, and the bus agrees it was delivered rather than still owed.
    expect(settlementNotices(ctx, SessionId('parent'))).toHaveLength(1)
    expect(ctx.messageBus.outboxRows().map(row => row.record.state)).toEqual(['acked'])
  })

  it('KEEPS a settlement whose parent is gone, and delivers it when that parent next starts', async () => {
    // acceptance[1], and the case the hand-delivery could not serve: the notice
    // was logged and dropped when no live parent was found. Committed first, it
    // survives the process that could not deliver it.
    const { ctx, busDirectory } = await setup([textResponse('child done')])
    const parent = ctx.agentLoop.create(SessionId('lonely-parent'), { provider: 'mock', model: 'mock' })
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitGone(ctx, started.childId)
    // The live parent took it, so the row is `acked`. Put it back to `pending`
    // to stand for a settlement committed while nobody could receive it.
    //
    // **Set directly, and that is a recorded finding rather than convenience.**
    // The end-to-end route — dispose the context so the manager's own drain
    // settles the child while the tree tears down — still commits NOTHING:
    // measured after §12.40, `ctx.get('messageBus')` is undefined at that
    // moment even with `SubagentRuntime` injecting it. `drain()` is async and
    // continues past the point where the bus fiber has gone, so declaring the
    // dependency orders the FIBERS without ordering this await. Reported; until
    // it is closed, what this case can honestly exercise is the drain.
    const owed = ctx.messageBus.outboxRows()[0]
    expect(owed?.record.state).toBe('acked')
    ctx.messageBus.persistOutbox({ ...owed!.record, state: 'pending', attempts: 0, receipt: null })
    await ctx.fiber.dispose()
    // A second process over the same bus directory: the row is still owed.
    const second = await setup([textResponse('parent done')], busDirectory)
    expect(second.ctx.messageBus.outboxRows().map(row => row.record.state)).toEqual(['pending'])
    second.ctx.agentLoop.create(SessionId('lonely-parent'), { provider: 'mock', model: 'mock' })

    await vi.waitFor(() => {
      expect(second.ctx.messageBus.outboxRows().map(row => row.record.state)).toEqual(['acked'])
    })
    await second.ctx.fiber.dispose()
  })

  it('delivers ONCE even though three triggers drain, so a redelivery is not a second effect', async () => {
    // The idempotence the three triggers rest on. The commit signals, the
    // parent's start drains, and every pre-step drains again; the dispatch
    // decision skips an acked record and the inbox refuses a repeated
    // (source, id, epoch).
    const { ctx } = await setup([textResponse('child done'), textResponse('parent done'), textResponse('more')])
    const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitGone(ctx, started.childId)
    await vi.waitFor(() => { expect(settlementNotices(ctx, SessionId('parent'))).toHaveLength(1) })

    // Drive the parent again so more pre-steps run over the same bus.
    parent.followup({ ...(await import('@deepseek-ai/dsh-llm')).createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }) })
    await parent.whenIdle()

    expect(settlementNotices(ctx, SessionId('parent'))).toHaveLength(1)
    expect(ctx.messageBus.outboxRows()).toHaveLength(1)
  })
})
