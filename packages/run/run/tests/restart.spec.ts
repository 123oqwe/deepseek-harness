/**
 * The restart path as a production behaviour (Epic P4-01 acceptance[0],
 * acceptance[1], acceptance[2]'s first and negative halves) — the U2
 * remediation slice for a sign-off that was withdrawn because these clauses
 * were implemented and reached by nothing.
 *
 * **acceptance[0] is two verbs at two seams, and they are tested separately.**
 * `Service.init` ENUMERATES what the store restored, because it is the only
 * place that knows and it needs no agent; `open()` ADOPTS, because that is
 * where a session appears and where `resume()`'s decision can be acted on. A
 * case that tested `resume()` itself would observe the Provider stage again —
 * that function's own behaviour is frozen there.
 *
 * **Two mounts over one store path is this file's model of a restart.** A
 * second `Context` over the same document is what a second process sees, and
 * the restored registry is the only thing they share. Measured before this
 * slice: a restart minted a SECOND Run for the same session and left the first
 * non-terminal forever, which is `BLOCKED-196`'s opening measurement and the
 * accident the adoption case replaces with a decision.
 *
 * `attachSession` is NOT wired and one case freezes that absence
 * (`BLOCKED-196`): a Run spanning sessions is writable under two independent
 * authorities, because the lease's work item is the session and a Run's own
 * writes present no lease at all.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { advanceLeasedAgent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import LeaseStoreSqlite from '@deepseek-ai/dsh-lease-sqlite'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import RunPlugin, { createFileRunStore, RunService } from '../src/index.ts'

const roots: string[] = []
const mounted: Context[] = []

afterEach(async () => {
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** One isolated store path owned through teardown, so forked workers never share one. */
async function storePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-restart-'))
  roots.push(root)
  return join(root, 'runs.json')
}

/**
 * A real Context with the agent loop, a lease store, and the Run plugin over
 * `path`.
 *
 * `leaseDirectory` swaps the in-memory lease store for the SQLite one. Two
 * mounts can only SHARE a lease store by sharing a directory: the in-memory
 * plugin owns its own map, so mounting it twice produces two stores that cannot
 * contend at all — which is invisible until a case asserts something about an
 * epoch, and then it reads as the code failing rather than the arrangement.
 */
async function mount(path: string, leaseDirectory?: string, leaseMs?: number): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (leaseDirectory === undefined) await ctx.plugin(InMemoryLeaseStorePlugin)
  else await ctx.plugin(LeaseStoreSqlite, { directory: leaseDirectory })
  await ctx.plugin(RunPlugin, { storePath: path, ...leaseMs === undefined ? {} : { leaseMs } })
  mounted.push(ctx)
  return ctx
}

describe('P4-01 acceptance[0]: a fresh process enumerates what it restored', () => {
  it('reports the non-terminal Runs the store held, at mount, before any agent exists', async () => {
    const path = await storePath()
    const first = await mount(path)
    first.agentLoop.create(SessionId('session-alpha'))
    first.agentLoop.create(SessionId('session-beta'))
    await first.fiber.dispose()
    mounted.length = 0

    const second = await mount(path)
    // The enumeration is the plugin's own answer about its restored state, and
    // it is taken at mount — so reading it needs no agent, which is the whole
    // reason it cannot live where adoption lives.
    expect(second.runs.restoredNonTerminal().map(run => run.sessionIds[0]).sort())
      .toStrictEqual(['session-alpha', 'session-beta'])
  })

  it('reports nothing for a store that holds only terminal Runs, so the enumeration is not just "everything"', async () => {
    // The control. `listNonTerminal` returning every Run would pass the case
    // above and this one is what tells them apart.
    const path = await storePath()
    const first = await mount(path)
    const agent = first.agentLoop.create(SessionId('session-ends'))
    await first.runs.service.advance(agent.runId!, 'cancelled', [], Date.now())
    await first.fiber.dispose()
    mounted.length = 0

    const second = await mount(path)
    expect(second.runs.restoredNonTerminal()).toStrictEqual([])
  })
})

describe('P4-01 acceptance[0] and acceptance[2]: a restart adopts its Run instead of minting a second', () => {
  it('gives a session exactly ONE Run across a restart, adopting the non-terminal one it restored', async () => {
    // Measured before this slice: two. `open()` checked only whether the live
    // agent already had a runId and never asked what the store restored, so the
    // first Run stayed non-terminal forever and acceptance[2]'s "one Session,
    // many Runs" was satisfied by an accident of the restart path.
    const path = await storePath()
    const first = await mount(path)
    const before = first.agentLoop.create(SessionId('session-restart'))
    const firstRunId = before.runId
    await first.fiber.dispose()
    mounted.length = 0

    const second = await mount(path)
    const after = second.agentLoop.create(SessionId('session-restart'))

    expect(after.runId).toBe(firstRunId)
    expect(second.runs.service.runsForSession(after.id)).toHaveLength(1)
    expect(second.runs.service.listNonTerminal()).toHaveLength(1)
  })

  it('MINTS a fresh Run when the restored one is terminal, rather than resuming something already finished', async () => {
    // The other half of the branch, and the reason adoption is a decision
    // rather than a default: `resume()` refuses a terminal Run, and a plugin
    // that adopted anyway would reopen work that had ended.
    const path = await storePath()
    const first = await mount(path)
    const before = first.agentLoop.create(SessionId('session-finished'))
    const endedRunId = before.runId
    await first.runs.service.advance(endedRunId!, 'cancelled', [], Date.now())
    await first.fiber.dispose()
    mounted.length = 0

    const second = await mount(path)
    const after = second.agentLoop.create(SessionId('session-finished'))

    expect(after.runId).not.toBe(endedRunId)
    expect(second.runs.service.get(endedRunId!)?.state).toBe('cancelled')
    // Both exist: the finished one is history, not something to clean up.
    expect(second.runs.service.runsForSession(after.id)).toHaveLength(2)
  })

  it('adopts a Run that was mid-`running` when the process CRASHED, rather than dropping it', async () => {
    // validation[1]'s kill/restart, at the state a real crash leaves behind: a
    // Run that had started work and was never parked. The first mount is
    // deliberately NOT disposed — a crash runs no disposer, which is the whole
    // difference between this case and the clean-unload pair below.
    const path = await storePath()
    const first = await mount(path)
    const before = first.agentLoop.create(SessionId('session-crashed'))
    await first.runs.service.advance(before.runId!, 'planning', [], Date.now())
    await first.runs.service.advance(before.runId!, 'running', [], Date.now())
    const logLength = first.runs.service.get(before.runId!)?.events.length

    const second = await mount(path)
    const after = second.agentLoop.create(SessionId('session-crashed'))

    expect(after.runId).toBe(before.runId)
    expect(second.runs.service.get(after.runId!)?.state).toBe('running')
    // The adopted Run keeps the event log it had, so the restart continues a
    // history rather than starting one.
    expect(second.runs.service.get(after.runId!)?.events).toHaveLength(logLength!)
  })

  it('PARKS a running Run at `paused` when the mount unloads cleanly, rather than ending or abandoning it', async () => {
    // The third shape, and the one that was missing: an operator closing the
    // app is neither a crash nor a completion. Terminating the Run would claim
    // work that is merely unfinished — `succeeded` and `cancelled` are both
    // lies about a run half-way through — and leaving it `running` leaked a
    // non-terminal Run and a held lease once per boot. `paused` says "not
    // crashed, not finished, resumable", and until now it was the one legal Run
    // state nothing ever reached.
    const path = await storePath()
    const leases = await mkdtemp(join(tmpdir(), 'dsh-run-restart-park-'))
    roots.push(leases)
    const ctx = await mount(path, leases)
    const agent = ctx.agentLoop.create(SessionId('session-parked'))
    await ctx.runs.service.advance(agent.runId!, 'planning', [], Date.now())
    await ctx.runs.service.advance(agent.runId!, 'running', [], Date.now())
    await ctx.fiber.dispose()
    mounted.length = 0

    const restored = await RunService.restore(createFileRunStore(path))
    expect(restored.get(agent.runId!)?.state).toBe('paused')
    expect(restored.get(agent.runId!)?.events.map(event => event.toState))
      .toStrictEqual(['accepted', 'planning', 'running', 'paused'])
  })

  it('holds its work item past a clean unload too, so a restart waits out the lease either way', async () => {
    // **Not the behaviour this case was written to assert, and the change is
    // the finding.** It was `continues a parked Run IMMEDIATELY after a clean
    // unload, waiting out no lease` — until the release turned out to be
    // impossible from the plugin's disposer: the provider clears its handle
    // synchronously while this disposer awaits the transition before the
    // release, and a fiber unload runs every disposer concurrently, so there is
    // no order to rely on either. A clean shutdown therefore parks the Run but
    // keeps the work item, and the next boot is refused exactly as it is after
    // a crash.
    //
    // Frozen as it is rather than deleted, because the difference between
    // "cleanly unloaded" and "crashed" is invisible to the next host today, and
    // a case that says so is what reddens when BLOCKED-197 closes that gap.
    const path = await storePath()
    const leases = await mkdtemp(join(tmpdir(), 'dsh-run-restart-clean-'))
    roots.push(leases)
    const first = await mount(path, leases)
    const before = first.agentLoop.create(SessionId('session-clean-restart'))
    await first.runs.service.advance(before.runId!, 'planning', [], Date.now())
    await first.runs.service.advance(before.runId!, 'running', [], Date.now())
    await first.fiber.dispose()
    mounted.length = 0

    const second = await mount(path, leases)
    const after = second.agentLoop.create(SessionId('session-clean-restart'))

    expect(after.runId).toBeUndefined()
    expect(after.leaseRefused).toBe(true)
    // The Run was still parked, which is the half that DOES work: the state
    // says resumable, only the authority to resume it is not free yet.
    expect(second.runs.restoredNonTerminal().map(run => run.state)).toStrictEqual(['paused'])
  })

  it('takes a parked Run back to `running` at the next model step, so `paused` is a pause and not a stop', async () => {
    // The other end of parking, and it needs its own case: a mutation that
    // removed `paused` from the states a first step resumes from reddened
    // NOTHING until this existed — the Run would have been adopted, then sat in
    // `paused` forever while its agent worked.
    //
    // The in-memory lease store, deliberately: each mount owns its own, so the
    // second one is not refused the work item the first still holds. That is
    // the arrangement BLOCKED-197 describes from the other side.
    const path = await storePath()
    const first = await mount(path)
    const before = first.agentLoop.create(SessionId('session-resumes-work'))
    await first.runs.service.advance(before.runId!, 'planning', [], Date.now())
    await first.runs.service.advance(before.runId!, 'running', [], Date.now())
    await first.fiber.dispose()
    mounted.length = 0

    const second = await mount(path)
    second.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
    const handle = await second.agents.create({
      sessionId: SessionId('session-resumes-work'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(handle.agent.runId).toBe(before.runId)
    expect(second.runs.service.get(handle.agent.runId!)?.state).toBe('paused')

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'carry on' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    const run = second.runs.service.get(before.runId!)
    // `paused -> running` is in the log, so the parked run resumed rather than
    // being resumed only on the agent's side.
    expect(run?.events.map(event => event.toState))
      .toStrictEqual(['accepted', 'planning', 'running', 'paused', 'running'])
  })

  it('continues under a lease THIS mount was issued, once the dead process\'s lease has lapsed', async () => {
    // **Over a SHARED lease store, and the only place in this file where the
    // restart contends with itself.** The three cases above use the in-memory
    // store, where a second mount owns a second map and acquires freely — so
    // they observe adoption and deliberately do NOT observe the authority
    // handover. Asserting an epoch there produced `expected +0 not to be +0`,
    // because the number was a second store's first answer rather than
    // adoption's. That is §12.35-2's trap and BLOCKED-189's rule in one place:
    // an arrangement that cannot contend reports health it has not measured.
    //
    // `leaseMs: 1` is what makes the crash real rather than polite. An abrupt
    // process end releases nothing, so the work item stays held until it lapses
    // — see the case below, which is that half.
    const path = await storePath()
    const leases = await mkdtemp(join(tmpdir(), 'dsh-run-restart-leases-'))
    roots.push(leases)
    const first = await mount(path, leases, 1)
    const before = first.agentLoop.create(SessionId('session-epoch'))
    const deadEpoch = before.lifecycle?.epoch
    expect(deadEpoch).toBeDefined()
    await first.fiber.dispose()
    mounted.length = 0

    const second = await mount(path, leases, 1)
    const after = second.agentLoop.create(SessionId('session-epoch'))

    expect(after.runId).toBe(before.runId)
    expect(after.lifecycle?.epoch).toBeGreaterThan(deadEpoch!)
    // And the continued Run is writable by this host: the lifecycle it was
    // given carries the epoch the fencing check compares against.
    expect(advanceLeasedAgent(after, 'starting', 'the restarted host takes its first step')).toBeUndefined()
  })

  it('opens NO Run for a restart inside the lease window, because the work item is still held', async () => {
    // The protection working, and the other half of the case above. A crashed
    // process releases nothing, so a host coming back before the lapse is
    // refused its own session's work item — indistinguishable, from the store's
    // side, from a second host racing for it, which is exactly why it must be
    // refused. `leaseRefused` is what tells this apart from "no Run Service
    // mounted" at the dispatch gate.
    const path = await storePath()
    const leases = await mkdtemp(join(tmpdir(), 'dsh-run-restart-held-'))
    roots.push(leases)
    const first = await mount(path, leases, 30_000)
    const before = first.agentLoop.create(SessionId('session-held'))
    expect(before.runId).toBeDefined()
    // Dispose only the plugin's listeners' effect by dropping the Context
    // reference: the lease is NOT released, which is what a crash looks like.
    mounted.length = 0

    const second = await mount(path, leases, 30_000)
    const after = second.agentLoop.create(SessionId('session-held'))

    expect(after.runId).toBeUndefined()
    expect(after.leaseRefused).toBe(true)
    // The restored Run is still there and still non-terminal: nothing was lost,
    // it simply is not this host's to continue yet.
    expect(second.runs.restoredNonTerminal().map(run => run.id)).toStrictEqual([before.runId])
    await first.fiber.dispose()
  })
})

describe('P4-01 acceptance[1]: an illegal transition is refused on the production path', () => {
  it('refuses a transition the table does not allow, naming the pair it refused', async () => {
    // Reachable for the first time. Through P4-05 and P4-07 the refusal had no
    // production caller, so it refused nothing.
    const path = await storePath()
    const ctx = await mount(path)
    const agent = ctx.agentLoop.create(SessionId('session-illegal'))

    const decision = await ctx.runs.service.advance(agent.runId!, 'verifying', [], Date.now())

    expect(decision).toStrictEqual({ accepted: false, reason: 'illegal-transition', from: 'accepted', to: 'verifying' })
  })

  it('writes nothing when it refuses: the Run keeps the event log it had', async () => {
    // The half that tells a refusal from a silent failure. must[1]'s log is
    // append-only, so a refused transition must not extend it — and the subject
    // is the Run STORE, not the session log: the Run's event log does not live
    // there (P4-02 put a TaskProfile body there, which is a different record).
    const path = await storePath()
    const ctx = await mount(path)
    const agent = ctx.agentLoop.create(SessionId('session-unchanged'))
    const before = ctx.runs.service.get(agent.runId!)

    await ctx.runs.service.advance(agent.runId!, 'verifying', [], Date.now())

    expect(ctx.runs.service.get(agent.runId!)).toStrictEqual(before)
  })
})

describe('P4-01 acceptance[2] negative half: no Run spans sessions today (BLOCKED-196)', () => {
  it('opens an independent Run per session, so a second session never joins the first\'s Run', async () => {
    // Frozen as an ABSENCE, deliberately. `attachSession` is implemented,
    // durable and tested, and wiring it would make one Run's append-only log
    // writable under two independent authorities: the lease's work item is the
    // SESSION, and `advance`/`attachSession` present no lease at all. This case
    // reddens the day someone wires it without reading BLOCKED-196.
    const path = await storePath()
    const ctx = await mount(path)
    const alpha = ctx.agentLoop.create(SessionId('session-one'))
    const beta = ctx.agentLoop.create(SessionId('session-two'))

    expect(alpha.runId).not.toBe(beta.runId)
    expect(ctx.runs.service.get(alpha.runId!)?.sessionIds).toStrictEqual([alpha.id])
    expect(ctx.runs.service.get(beta.runId!)?.sessionIds).toStrictEqual([beta.id])
    // And no Run in the store carries two sessions, which is the claim rather
    // than a property of these two agents.
    for (const run of ctx.runs.service.listNonTerminal()) expect(run.sessionIds).toHaveLength(1)
  })
})

describe('P4-01 must[0] and must[1]: the Run occupies its states and logs each one', () => {
  /**
   * The Run `id` as the STORE holds it, read back through a fresh service.
   *
   * Every case here disposes the mount first. `agent/disposed` is emitted
   * synchronously and does not await its listeners, so the terminal transitions
   * are still in flight when the agent handle's own dispose resolves — the
   * plugin's disposer is what awaits them. Reading the durable document also
   * makes must[1]'s claim the stronger one: the entries were persisted, not
   * merely appended in memory.
   */
  async function storedRun(path: string, id: string): Promise<{ state: string; states: string[] }> {
    const restored = await RunService.restore(createFileRunStore(path))
    const run = restored.get(id as never)
    if (run === undefined) throw new Error(`no Run ${id} in ${path}`)
    return { state: run.state, states: run.events.map(event => event.toState) }
  }

  /** Run one real turn on a fresh session, then dispose the agent so its Run ends. */
  async function onTurn(ctx: Context, sessionId: string, text = 'do the thing'): Promise<string> {
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
    const handle = await ctx.agents.create({
      sessionId: SessionId(sessionId),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const runId = handle.agent.runId!
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    await handle.dispose()
    return runId
  }

  it('walks a successful session accepted → planning → running → verifying → succeeded, one log entry each', async () => {
    // must[0]'s states are occupied by a real turn, and must[1]'s log gains one
    // entry per transition — which before this slice it never did: every Run
    // carried only its genesis entry.
    //
    // `verifying` is passed through because the table admits no shortcut from
    // `running` to `succeeded`, and what it MEANS here is the end decision over
    // this plugin's failure ledger, NOT output verification (P7-05 owns that).
    const path = await storePath()
    const ctx = await mount(path)
    const runId = await onTurn(ctx, 'session-succeeds')
    await ctx.fiber.dispose()
    mounted.length = 0

    expect(await storedRun(path, runId)).toStrictEqual({
      state: 'succeeded',
      states: ['accepted', 'planning', 'running', 'verifying', 'succeeded'],
    })
  })

  it('ends a session whose last reported activity was an unrecovered error at verifying → failed', async () => {
    // The same three-step path with the other decision, so `verifying` is not
    // a step that only ever precedes success.
    const path = await storePath()
    const ctx = await mount(path)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
    const handle = await ctx.agents.create({
      sessionId: SessionId('session-errors'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const runId = handle.agent.runId!
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do the thing' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    // Reported the way production reports one: through the event this plugin
    // subscribes to, not by reaching into its ledger.
    ctx.emit('agent/error', { agent: handle.agent, turn: 1, step: 1, error: new Error('the tool host died') })
    await handle.dispose()
    await ctx.fiber.dispose()
    mounted.length = 0

    expect(await storedRun(path, runId)).toStrictEqual({
      state: 'failed',
      states: ['accepted', 'planning', 'running', 'verifying', 'failed'],
    })
  })

  it('leaves no non-terminal Run behind after a session that ran and ended', async () => {
    // acceptance[0]'s other consequence, and the growth the README recorded:
    // before this slice every Run a boot opened was still non-terminal at the
    // next boot, so `listNonTerminal` grew forever and adoption would have
    // continued a session that had already finished.
    const path = await storePath()
    const ctx = await mount(path)
    await onTurn(ctx, 'session-clean')
    await ctx.fiber.dispose()
    mounted.length = 0

    const restored = await RunService.restore(createFileRunStore(path))
    expect(restored.listNonTerminal()).toStrictEqual([])
  })

  it('cancels a Run whose session was disposed before any model step, rather than leaving it accepted', async () => {
    // The branch for a session that never ran: `succeeded` would claim work that
    // did not happen, and `failed` would claim an error nobody reported.
    const path = await storePath()
    const ctx = await mount(path)
    const handle = await ctx.agents.create({ sessionId: SessionId('session-never-ran') })
    const runId = handle.agent.runId!
    await handle.dispose()
    await ctx.fiber.dispose()
    mounted.length = 0

    expect(await storedRun(path, runId)).toStrictEqual({ state: 'cancelled', states: ['accepted', 'cancelled'] })
  })
})
