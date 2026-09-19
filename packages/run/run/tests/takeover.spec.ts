/**
 * P4-05 acceptance[2] on the path a deployment runs: a restart that adopts a
 * Run whose holder stopped renewing walks it through `orphaned`.
 *
 * **The restart is the reclaim.** `RunService.reclaim` describes this
 * transition and has no production caller; what a second host actually does is
 * `open`, and until now `open` set every adopted Run to `queued` — the state
 * of a run nobody had ever taken. `orphaned` had no producer on any path a
 * deployment runs, which is what left acceptance[2] without a subject.
 *
 * Every case here uses ONE durable lease store across two mounts, which is
 * what a restart is: the second context is a different process's worth of
 * state over the same rows. The predecessor's residue is WRITTEN, by
 * `crashResidue` below, rather than produced by disposing the first host: a
 * clean unload hands the lease back, so it leaves no predecessor to adopt.
 * No case here waits on a clock.
 *
 * What is observed is `agent.lifecycle`, the same exit
 * `tests/fenced-dispatch.spec.ts` asserts against: the state, and the epoch
 * the store issued for it. No logger spy decides anything here.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { TrackedContexts } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import LeaseStorePlugin from '@deepseek-ai/dsh-lease-sqlite'
import type { WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease-contract'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import RunPlugin from '../src/index.ts'

const roots: string[] = []
const contexts = new TrackedContexts()

afterEach(async () => {
  expect(await contexts.disposeAll()).toEqual([])
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/**
 * A directory owned through teardown.
 * @param prefix - what it holds, so a leftover names itself.
 * @returns the directory path.
 */
async function directory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/**
 * One host over a given lease directory and Run store.
 * @param leases - the durable lease directory both hosts share.
 * @param runs - the Run store path both hosts share, so the second adopts what the first registered.
 * @param leaseMs - how long this host's leases run for.
 * @returns the mounted context.
 */
async function host(leases: string, runs: string, leaseMs: number): Promise<Context> {
  const ctx = contexts.track(new Context())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LeaseStorePlugin, { directory: leases })
  await ctx.plugin(RunPlugin, { storePath: join(runs, 'runs.json'), leaseMs })
  return ctx
}

/**
 * Leave on the shared store what a CRASHED host leaves, and nothing else.
 *
 * **A clean unload is not a crash, and this file's cases are about a crash.**
 * `fiber.dispose()` runs `pauseRun`, whose FIRST act is
 * `leaseStore.release(lease.token)` -- deliberately, and whatever state the
 * Run is in (`run/src/index.ts:1249-1266`), so the next boot does not wait out
 * the expiry of an item nobody is doing. Disposing the first host therefore
 * leaves NO lease row at all, and the lapsed predecessor these cases are about
 * never existed: measured in run 35440317116, where case one's own diagnostic
 * reported `no lease row`. The case had been passing on a free item.
 *
 * Nor can the residue be produced by leaving the first host mounted: `open`
 * starts a renewal timer for every Run it opens (`run/src/index.ts:918`), at
 * `leaseMs / LEASE_RENEWAL_DIVISOR`, so whether the row is live or lapsed when
 * the second host reads it would be a race with `setInterval`.
 *
 * So the residue is written here, explicitly: a row held by a worker that is
 * gone, whose term ended before this host's clock reading. That is what a
 * killed process leaves behind -- a lease it never handed back and never
 * renewed again.
 * @param ctx - the second host, mounted over the same durable lease directory.
 * @param session - the session whose work item the dead host held.
 */
function crashResidue(ctx: Context, session: SessionId): void {
  const result = ctx.leaseStore.acquire(
    brandString<WorkItemId>(String(session)),
    brandString<WorkerId>('crashed-host'),
    Date.now() - 10_000,
    1,
  )
  expect(result.acquired, `the crash residue must actually be written: ${JSON.stringify(result)}`).toBe(true)
}

describe('P4-05 acceptance[2]: adopting a Run whose holder lapsed', () => {
  it('walks the adopted Run through orphaned under a new epoch, rather than opening it as queued', async () => {
    const leases = await directory('dsh-takeover-leases-')
    const runs = await directory('dsh-takeover-runs-')
    const session = SessionId('adopted-session')

    // `leaseMs: 1` is kept for what it still does -- it makes the first host's
    // own lease lapse immediately -- but it is NOT what leaves the predecessor
    // row behind: the dispose below hands that row back. See `crashResidue`.
    const first = await host(leases, runs, 1)
    const held = await first.agentLoop.create(session)
    expect(held.lifecycle?.state).toBe('queued')
    const firstEpoch = held.lifecycle?.epoch
    expect(firstEpoch).toBeDefined()
    await first.fiber.dispose()

    const second = await host(leases, runs, 30_000)
    crashResidue(second, session)
    // Read BEFORE the takeover overwrites the row, and carried into the
    // messages below: when this case fails, "what did the second host see"
    // must be in the failure rather than in a rerun.
    const lapsed = second.leaseStore.get(brandString<WorkItemId>(String(session)))
    const openingAt = Date.now()
    const adopted = await second.agentLoop.create(session)

    // Two preconditions, because the assertion they guard cannot tell a failed
    // adoption from an adoption that never had a predecessor to adopt.
    const known = second.runs.service.runsForSession(session)
    expect(known.length, `the second host restored no Run for ${String(session)} from the shared store, so there was nothing to adopt`)
      .toBeGreaterThan(0)
    // The decisive one: an adopted Run keeps the id the first host registered.
    // A second host that restored nothing MINTS one, and then every later
    // assertion is about a fresh Run wearing the same session.
    expect(adopted.runId, `expected the first host's Run ${String(held.runId)}; the store holds ${JSON.stringify(known.map(run => run.id))}`)
      .toBe(held.runId)
    expect(
      lapsed === undefined ? 'no lease row' : lapsed.expiresAtMs < openingAt,
      `the predecessor's lease must have expired before this host opened: expiresAtMs=${String(lapsed?.expiresAtMs)}, openedAt≈${String(openingAt)}`,
    ).toBe(true)

    // The state P4-05 declared and nothing produced. It is reached through the
    // real transition table, so a run that could not legally be orphaned would
    // have stayed where it was instead.
    expect(adopted.lifecycle?.state).toBe('starting')
    expect(adopted.leaseRefused).toBeUndefined()
    // A NEW epoch: the second host writes under authority this store issued
    // it, never under the one the dead host still believes it has.
    expect(adopted.lifecycle?.epoch).toBeGreaterThan(firstEpoch as number)
  })

  it('fences the previous holder\'s token once the item has been taken over', async () => {
    const leases = await directory('dsh-takeover-leases-')
    const runs = await directory('dsh-takeover-runs-')
    const session = SessionId('fenced-after-takeover')

    const first = await host(leases, runs, 1)
    const held = await first.agentLoop.create(session)
    const staleEpoch = held.lifecycle?.epoch
    await first.fiber.dispose()

    const second = await host(leases, runs, 30_000)
    crashResidue(second, session)
    await second.agentLoop.create(session)
    // Read from the store rather than from either agent: the item's current
    // authority is what the fencing rule compares against, and it has moved.
    const current = second.leaseStore.get(brandString<WorkItemId>(String(session)))
    expect(current?.epoch).toBeGreaterThan(staleEpoch as number)
    expect(current?.holder).not.toBe(brandString<WorkerId>('dead-host'))
  })

  it('takes a real step after the takeover: a tool runs and the profile is compiled, which the old first-step test skipped', async () => {
    // The defect this case exists for is invisible to the two above. An
    // adopted Run enters its first model step at `starting`, and the plugin's
    // "is this the first step" test used to be `lifecycle.state === 'queued'`
    // — false for exactly this Run — so P4-02's compile was skipped and the
    // run took every step at `starting`, never reaching `running`.
    const leases = await directory('dsh-takeover-leases-')
    const runs = await directory('dsh-takeover-runs-')
    const session = SessionId('adopted-and-stepping')

    const first = await host(leases, runs, 1)
    const held = await first.agentLoop.create(session)
    const staleEpoch = held.lifecycle?.epoch
    await first.fiber.dispose()

    let executed = 0
    const second = await host(leases, runs, 30_000)
    crashResidue(second, session)
    second.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'records that it ran',
      parameters: {},
      execute() {
        executed += 1
        return Promise.resolve([{ type: 'text' as const, text: 'ran' }])
      },
    }))
    second.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('c1', 'noop', {}),
      textResponse('done'),
    ]))
    const adopted = await second.agentLoop.create(session, { provider: 'mock', model: 'mock' })
    adopted.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await adopted.whenIdle()

    // First: that this Run WAS adopted. Without it the case passes on a
    // freshly minted Run — which reaches `running` and compiles its profile
    // through the ordinary `queued` path — and proves nothing about takeover,
    // so it would not count toward P4-05's lock either.
    expect(adopted.runId, 'this case only says anything if the Run is the one the first host registered')
      .toBe(held.runId)
    // The step ran: the tool executed under this host's authority.
    expect(executed, 'an adopted run must take its step like any other').toBe(1)
    // P4-02's once-per-agent compile happened for the adopted run too.
    expect(adopted.taskProfile, 'the first-step work must run for an adopted Run').toBeDefined()
    // And the lifecycle left `starting`, which the missing edge would have
    // prevented.
    expect(adopted.lifecycle?.state).not.toBe('starting')
    expect(adopted.lifecycle?.epoch).toBeGreaterThan(staleEpoch as number)
  })

  it('leaves a live predecessor alone: the second host is refused and no Run is orphaned', async () => {
    // The control, and the boundary of the change: a lease that has NOT
    // lapsed is still a live owner, and taking it over would be the two-master
    // failure P4-07 exists to prevent. `tests/fenced-dispatch.spec.ts` pins the
    // refusal itself; what this adds is that nothing was orphaned on the way.
    const leases = await directory('dsh-takeover-leases-')
    const runs = await directory('dsh-takeover-runs-')
    const session = SessionId('live-predecessor')

    const first = await host(leases, runs, 30_000)
    const held = await first.agentLoop.create(session)
    expect(held.lifecycle?.state).toBe('queued')

    const second = await host(leases, runs, 30_000)
    const refused = await second.agentLoop.create(session)
    expect(refused.leaseRefused).toBe(true)
    expect(refused.lifecycle).toBeUndefined()
    expect(held.lifecycle?.state).toBe('queued')
  })
})
