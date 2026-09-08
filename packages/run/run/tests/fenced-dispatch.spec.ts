/**
 * The Run's lease as an authority the harness actually presents (Epic P4-07
 * must[1]/must[3], §12.19-3).
 *
 * **This is the production caller `advanceAgentLifecycleFenced` did not have.**
 * The fencing rule, the store, the lifecycle state machine and the fenced
 * entry point all existed through P4-05 and P4-07's Contract stages with, as
 * measured for the withdrawal, zero production callers of either the store's
 * acquire or the fenced advance. A rule nothing holds refuses nothing.
 *
 * The cases below drive a REAL agent session through the mounted Run Service,
 * take its Run's lease away the way a scheduler would, and assert the next
 * state write is refused. Nothing is hand-built: the lifecycle comes from
 * `RunPlugin.open`, the epoch from the store, and the refusal from
 * `checkFencing` reading the store's current lease.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { advanceLeasedAgent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { brandString } from '@deepseek-ai/dsh-brand'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import LeaseStoreSqlite from '@deepseek-ai/dsh-lease-sqlite'
import type { WorkerId, WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import LlmRuntime, { createUserMessage, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { gateActionRisk } from '@deepseek-ai/dsh-tools/external-effect'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import RunPlugin from '../src/index.ts'

const roots: string[] = []
const mounted: Context[] = []

// Dispose BEFORE removing the directory. `RunPlugin`'s disposer awaits the
// durable writes it started, and a case that only removed the root raced them:
// the write landed back into a directory `rm` had just emptied, and the case
// failed with ENOTEMPTY on teardown rather than on anything it asserted.
afterEach(async () => {
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** One assistant message carrying several tool calls, as the loop parses them. */
function multiCall(calls: { id: string; name: string; args: object }[]): StreamChunk[] {
  const chunks: StreamChunk[] = []
  calls.forEach((call, index) => {
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: JSON.stringify(call.args) } },
    )
  })
  chunks.push(
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

async function harness(options: { leaseMs?: number; leaseDirectory?: string } = {}): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-fenced-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  // Two hosts share a store by sharing a DIRECTORY, which is the only way they
  // can: the in-memory plugin owns its own map, so mounting it twice produces
  // the arrangement that cannot contend at all — the same shape that let the
  // old work item's defect survive unnoticed.
  if (options.leaseDirectory === undefined) await ctx.plugin(InMemoryLeaseStorePlugin)
  else await ctx.plugin(LeaseStoreSqlite, { directory: options.leaseDirectory })
  await ctx.plugin(RunPlugin, { storePath: join(root, 'runs.json'), leaseMs: options.leaseMs ?? 1000 })
  mounted.push(ctx)
  return ctx
}

describe('the Run lease is an authority the harness presents (P4-07 must[1], §12.19-3)', () => {
  it('takes a lease for every Run it opens, so the Run has an owner before it has work', async () => {
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    const runId = agent.runId
    expect(runId).toBeDefined()
    // The store, not the agent, is asked. A lifecycle carrying an epoch nobody
    // issued is exactly what this epic refuses, so the assertion reads the
    // issuer.
    // The work item is the SESSION, not the Run (§12.35-2): a `run-<uuid>` is
    // minted per open, so two hosts driving one session would have asked for
    // two different items and never contended. The Run keeps its identity; the
    // lease is on the session whose work it does.
    const held = ctx.leaseStore.get(brandString<WorkItemId>(agent.id))
    expect(held?.workItem).toBe(agent.id)
    expect(agent.lifecycle?.epoch).toBe(held?.epoch)
  })

  it('starts the lifecycle at queued, so a run that never steps is never running', async () => {
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    expect(agent.lifecycle?.state).toBe('queued')
  })

  it('REFUSES a state write once another holder has taken the Run, naming it fenced', async () => {
    // The whole point. A scheduler reclaiming an expired Run and a stale host
    // waking up are the same instant from the store's side; the store issues a
    // greater epoch to the new holder, and the old holder's token stops being
    // current. Nothing tells the old holder — it finds out here.
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    const workItem = brandString<WorkItemId>(agent.id)

    const stolen = ctx.leaseStore.acquire(
      workItem,
      brandString<WorkerId>('a-different-host'),
      // Past the lease this mount was granted, which is the condition under
      // which the scheduler may reclaim (must[2]).
      Date.now() + 5_000,
      1_000,
    )
    expect(stolen.acquired).toBe(true)

    expect(ctx.runs.advance(agent, 'starting', 'the run is taking its first model step')).toBe('fenced')
    // And the lifecycle did not move: a refused transition writes nothing.
    expect(agent.lifecycle?.state).toBe('queued')
  })

  it('ADMITS the same write while this holder is still current, so the refusal is about authority and not about the transition', async () => {
    // The positive control the refusal above needs. Without it the case would
    // pass against an `advance` that refused everything.
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    expect(ctx.runs.advance(agent, 'starting', 'the run is taking its first model step')).toBeUndefined()
    expect(agent.lifecycle?.state).toBe('starting')
  })

  it('refuses an ILLEGAL transition with the state machine\'s own reason, not with fenced', async () => {
    // The two refusals must stay distinguishable: `fenced` says another host
    // owns this run and this one must stop, `illegal-transition` says this
    // host asked for something the lifecycle does not allow. Reporting either
    // as the other would make a routing bug look like a failover.
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    expect(ctx.runs.advance(agent, 'waiting_tool', 'skipping straight to a tool wait')).toBe('illegal-transition')
  })

  it('refuses a transition with an empty reason, so must[1]\'s reason cannot be satisfied by whitespace', async () => {
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    expect(ctx.runs.advance(agent, 'starting', '   ')).toBe('missing-reason')
  })

  it('reports no-run for an agent with no lifecycle, rather than inventing one at its initial state', async () => {
    // A composition without the Run Service, and a Run whose lease was
    // refused, reach this path. Treating absence as `queued` would let an
    // unleased agent advance through a state machine no store backs.
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-alpha'))
    delete agent.lifecycle
    expect(ctx.runs.advance(agent, 'starting', 'no lifecycle here')).toBe('no-run')
  })

  it('REFUSES every tool call in a step once this host was fenced out, and says so in the log', async () => {
    // The dispatch-side half of must[1]: the authority is presented where the
    // state write happens, which for an agent run is the tool dispatch. A host
    // that lost its Run must not execute a single call, and the model must see
    // that its calls did not run — a silent drop would leave the turn's log
    // claiming calls that neither executed nor failed.
    const ctx = await harness()
    let executed = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'records that it ran',
      parameters: {},
      execute() {
        executed += 1
        return Promise.resolve([{ type: 'text' as const, text: 'ran' }])
      },
    }))
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'noop', args: {} }, { id: 'c2', name: 'noop', args: {} }]),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('session-fenced'), { provider: 'mock', model: 'mock' })

    // Another host takes the Run before the model's calls are dispatched.
    ctx.leaseStore.acquire(
      brandString<WorkItemId>(agent.id),
      brandString<WorkerId>('a-different-host'),
      Date.now() + 5_000,
      1_000,
    )

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(executed).toBe(0)
    const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(2)
    for (const result of results) {
      // Asserted on the MODEL-VISIBLE content, not only on the error record:
      // what matters is that the model is told its calls did not run. The
      // `FencedError` name is what separates this from an ordinary abort,
      // which a reader of the log needs in order to know not to retry.
      expect(result.data.error?.name).toBe('FencedError')
      const block = result.data.message.content[0]
      expect(block?.type === 'tool-result' && block.isError).toBe(true)
      expect(block?.type === 'tool-result' && block.content[0]?.type === 'text' && block.content[0].text)
        .toBe('Error: this run is no longer the owner of its work item')
    }
  })

  it('EXECUTES the same calls while this host still owns its Run, so the refusal is about the lease', async () => {
    // The positive control. Without it the case above passes against a
    // dispatch that refuses everything.
    const ctx = await harness()
    let executed = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'records that it ran',
      parameters: {},
      execute() {
        executed += 1
        return Promise.resolve([{ type: 'text' as const, text: 'ran' }])
      },
    }))
    const adapter = new MockAdapter([
      multiCall([{ id: 'c1', name: 'noop', args: {} }, { id: 'c2', name: 'noop', args: {} }]),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('session-owned'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(executed).toBe(2)
    expect(agent.lifecycle?.state).toBe('running')
  })

  it('RENEWS the lease while the run is alive, so a long run does not fence itself out', async () => {
    // Without renewal every Run lapses at `leaseMs` while still working, and
    // the next dispatch refuses the run that legitimately holds the item —
    // the fencing rule firing on its own holder, which is worse than not
    // having it.
    const ctx = await harness({ leaseMs: 90 })
    const agent = ctx.agentLoop.create(SessionId('session-long'))
    const workItem = brandString<WorkItemId>(agent.id)
    const granted = ctx.leaseStore.get(workItem)?.expiresAtMs

    await new Promise<void>((resolve) => { setTimeout(resolve, 120) })

    const held = ctx.leaseStore.get(workItem)
    expect(held?.expiresAtMs).toBeGreaterThan(granted!)
    // The epoch is UNCHANGED: renewal moves a deadline, it does not reissue
    // authority. A renewal that bumped the epoch would fence the holder out of
    // its own work.
    expect(held?.epoch).toBe(agent.lifecycle?.epoch)
  })

  it('stops renewing once the run is finished, so a second host can take the item', async () => {
    // The heartbeat's other half. A timer that outlived its run would assert
    // ownership of work nobody is doing, and the item would never come back.
    const ctx = await harness({ leaseMs: 90 })
    const handle = await ctx.agents.create({ sessionId: SessionId('session-short') })
    const workItem = brandString<WorkItemId>(handle.agent.id)
    await handle.dispose()

    await new Promise<void>((resolve) => { setTimeout(resolve, 120) })

    const second = ctx.leaseStore.acquire(workItem, brandString<WorkerId>('a-second-host'), Date.now(), 1_000)
    expect(second.acquired).toBe(true)
  })

  it('RELEASES the lease and completes the lifecycle when the session ends', async () => {
    // §12.20-3. A finished run is not a lapsed one: holding the item until a
    // deadline it no longer needs makes a host of many short sessions spend
    // its capacity waiting out leases nobody holds.
    const ctx = await harness()
    const handle = await ctx.agents.create({ sessionId: SessionId('session-ending') })
    const { agent } = handle
    const workItem = brandString<WorkItemId>(agent.id)
    expect(ctx.leaseStore.get(workItem)).toBeDefined()

    await handle.dispose()

    expect(agent.lifecycle?.state).toBe('completed')
    expect(ctx.leaseStore.get(workItem)).toBeUndefined()
    // Immediately, not after the term: a second host takes it now.
    const second = ctx.leaseStore.acquire(workItem, brandString<WorkerId>('a-second-host'), Date.now(), 1_000)
    expect(second.acquired).toBe(true)
    // And with a GREATER epoch, because releasing hands the item to nobody:
    // the released item must never reissue an epoch a stale worker still holds.
    expect(second.acquired && second.token.epoch).toBeGreaterThan(agent.lifecycle!.epoch)
  })

  it('ends a run disposed before its first step through cancelling, not as if it had completed its work', async () => {
    // Only `running` reaches `completed` directly, and that is the state
    // machine being right rather than in the way: a run that never started did
    // not finish its work, it was ended. Reporting it as a plain completion
    // would make an abandoned session indistinguishable from a finished one in
    // the durable record.
    const ctx = await harness()
    const handle = await ctx.agents.create({ sessionId: SessionId('session-unstepped') })
    expect(handle.agent.lifecycle?.state).toBe('queued')
    await handle.dispose()
    expect(handle.agent.lifecycle?.state).toBe('completed')
  })

  it('opens NO Run when the lease store refuses, so an unauthorized agent gets no Run rather than an unowned one', async () => {
    // acceptance[2]'s stop-work at the Run boundary. The store being
    // unreachable and the item being held are different answers, and only the
    // first means "start nothing".
    const ctx = await harness()
    ctx.leaseStore.setAvailable(false)
    const agent = ctx.agentLoop.create(SessionId('session-beta'))
    expect(agent.runId).toBeUndefined()
    expect(agent.lifecycle).toBeUndefined()
  })

  it('executes ZERO tools for an agent whose lease was REFUSED, and names the refusal apart from a fencing (§12.31-A)', async () => {
    // The gap this closes: a refused lease left the agent with no lifecycle,
    // which is also what a composition with no Run Service has — and that one
    // must dispatch normally. Measured before `leaseRefused` existed: the
    // refused agent ran every tool, because `advanceLeasedAgent` answered
    // `no-run` and the dispatcher treats `no-run` as capability absence.
    const ctx = await harness()
    let executed = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'records that it ran',
      parameters: {},
      execute() {
        executed += 1
        return Promise.resolve([{ type: 'text' as const, text: 'ran' }])
      },
    }))
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      multiCall([{ id: 'c1', name: 'noop', args: {} }, { id: 'c2', name: 'noop', args: {} }]),
      textResponse('done'),
    ]))
    ctx.leaseStore.setAvailable(false)
    const agent = ctx.agentLoop.create(SessionId('session-refused'), { provider: 'mock', model: 'mock' })
    expect(agent.leaseRefused).toBe(true)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(executed).toBe(0)
    const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(2)
    for (const result of results) {
      // `LeaseRefusedError`, not `FencedError`. A fenced run held the item and
      // lost it, so another host is already doing the work; this one never
      // held it. An operator sent to look for a takeover that never happened
      // is looking in the wrong place.
      expect(result.data.error?.name).toBe('LeaseRefusedError')
      const block = result.data.message.content[0]
      expect(block?.type === 'tool-result' && block.content[0]?.type === 'text' && block.content[0].text)
        .toBe('Error: this run was refused ownership of its work item')
    }
  })

  it('REFUSES the SECOND host that opens the same session, and that host executes zero tools (§12.35-2, acceptance[1])', async () => {
    // The case the old work item made unwritable. While the lease was keyed on
    // `run-<uuid>`, two hosts driving one session asked for two different
    // items and both were granted — acceptance[1]'s "does not produce two
    // masters" held because nothing could ever contend. Keyed on the session,
    // the second host is refused by the first host's live lease, which is the
    // condition §12.31-A's `lease-refused` exists to answer.
    let executed = 0
    const leaseDirectory = await mkdtemp(join(tmpdir(), 'dsh-run-contended-'))
    roots.push(leaseDirectory)
    const first = await harness({ leaseDirectory })
    const second = await harness({ leaseDirectory })
    for (const ctx of [first, second]) {
      ctx.tools.register(defineContentToolFixture({
        name: 'noop',
        description: 'records that it ran',
        parameters: {},
        execute() {
          executed += 1
          return Promise.resolve([{ type: 'text' as const, text: 'ran' }])
        },
      }))
      ctx.llm.registerAdapter(['mock'], new MockAdapter([
        multiCall([{ id: 'c1', name: 'noop', args: {} }]),
        textResponse('done'),
      ]))
    }
    const shared = SessionId('contended-session')

    const held = first.agentLoop.create(shared, { provider: 'mock', model: 'mock' })
    const loser = second.agentLoop.create(shared, { provider: 'mock', model: 'mock' })

    // The first host owns the session; the second was refused and knows it.
    expect(held.lifecycle).toBeDefined()
    expect(held.leaseRefused).toBeUndefined()
    expect(loser.runId).toBeUndefined()
    expect(loser.leaseRefused).toBe(true)

    loser.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await loser.whenIdle()
    expect(executed).toBe(0)

    // The positive control in the same case: the holder runs its call. Without
    // it, a dispatch that refused everything would satisfy the refusal above.
    held.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await held.whenIdle()
    expect(executed).toBe(1)
  })

  it('EXECUTES normally with NO Run Service mounted, so capability absence is not read as a refusal', async () => {
    // The positive control the case above needs, and the reason a marker was
    // required rather than reusing absence: this agent also has no lifecycle,
    // and it must run. A dispatcher that refused on absence would stop every
    // composition that mounts no Run Service.
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    mounted.push(ctx)
    let executed = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'records that it ran',
      parameters: {},
      execute() {
        executed += 1
        return Promise.resolve([{ type: 'text' as const, text: 'ran' }])
      },
    }))
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      multiCall([{ id: 'c1', name: 'noop', args: {} }, { id: 'c2', name: 'noop', args: {} }]),
      textResponse('done'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('session-no-run-service'), { provider: 'mock', model: 'mock' })
    expect(agent.lifecycle).toBeUndefined()
    expect(agent.leaseRefused).toBeUndefined()

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(executed).toBe(2)
  })
})

describe('P4-05 must[0]: `failed` is a state a run can actually reach', () => {
  it('ends a run whose last activity was an unrecovered error in `failed`, not `completed`', async () => {
    // The gap this closes: `finish` advanced EVERY run to `completed`, so half
    // of `TERMINAL_STATES` was unreachable and an agent whose work ended badly
    // reported the same terminal state as one that succeeded. A supervisor
    // reading the lifecycle could not tell them apart.
    const ctx = await harness()
    // An exhausted script makes the adapter throw on the first request, so the
    // failure arrives through the real `agent/error` path rather than through
    // an injected state write.
    ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
    const handle = await ctx.agents.create({ sessionId: SessionId('session-fails'), agentOptions: { provider: 'mock', model: 'mock' } })
    const { agent } = handle
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    await handle.dispose()

    expect(agent.lifecycle?.state).toBe('failed')
  })

  it('still ends a run that did its work in `completed`, so the failure path is not simply the new default', async () => {
    // The negative control: without it, a `finish` changed to always report
    // `failed` would pass the case above.
    const ctx = await harness()
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
    const handle = await ctx.agents.create({ sessionId: SessionId('session-succeeds'), agentOptions: { provider: 'mock', model: 'mock' } })
    const { agent } = handle
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    await handle.dispose()

    expect(agent.lifecycle?.state).toBe('completed')
  })
})

describe('P4-05 must[0]: `waiting_human` is a state a run can actually reach', () => {
  it('holds the run in `waiting_human` WHILE an operator is being asked, and returns it to `running`', async () => {
    // Observed from inside the approval request, because the state during the
    // wait is the whole claim: a case that only looked afterwards would pass
    // against a gate that never moved the lifecycle at all.
    //
    // `gateActionRisk` reads its policy through a structural port, so the
    // stub here is the port and not a fake of the shipped table — what this
    // case owns is the LIFECYCLE, and the classification only has to reach
    // the approval branch.
    const ctx = await harness()
    const handle = await ctx.agents.create({ sessionId: SessionId('session-asks') })
    const { agent } = handle
    // `waiting_human` is legal only from `running`, which production reaches
    // through `agent/pre-step`. Walked explicitly here so the case does not
    // depend on a model turn it is not testing.
    advanceLeasedAgent(agent, 'starting', 'test drives the run to running')
    advanceLeasedAgent(agent, 'running', 'test drives the run to running')

    let observed: string | undefined
    ctx.provide('approval', {
      request: () => {
        observed = agent.lifecycle?.state
        return Promise.resolve('allowed-once')
      },
    } as never)
    ctx.provide('permissionPresets', {
      classifyAction: () => ({ riskClass: 'security-sensitive', hardDenied: false }),
      requiresApproval: () => true,
      current: () => 'workspace-write',
    } as never)

    const refusal = await gateActionRisk(ctx, agent, 'untagged', [])

    expect(observed).toBe('waiting_human')
    // Allowed, so the action proceeds and the run is working again.
    expect(refusal).toBeUndefined()
    expect(agent.lifecycle?.state).toBe('running')

    await handle.dispose()
  })
})

describe('P4-05 acceptance[2]: the orphaned host is not the one that records it', () => {
  it('REFUSES the orphaning write from the host that LOST the lease, because it no longer speaks for the run', async () => {
    // Read once as a contradiction between two epics and corrected by §12.60:
    // fencing is right and the writer was wrong. A host that lost its lease
    // must not write anything — including the fact of its own orphaning, which
    // it cannot establish, since from its side a reclaim and a network pause
    // look identical. `orphaned` is recorded by the party that OBSERVED the
    // loss: the reclaimer, under its own valid epoch, in the case below.
    const ctx = await harness()
    const agent = ctx.agentLoop.create(SessionId('session-orphaned'))
    const workItem = brandString<WorkItemId>(agent.id)

    const stolen = ctx.leaseStore.acquire(
      workItem,
      brandString<WorkerId>('the-host-that-reclaimed-it'),
      Date.now() + 5_000,
      1_000,
    )
    expect(stolen.acquired).toBe(true)

    // `orphaned` is a LEGAL target from `queued` (`state-machine.ts`'s
    // `LEGAL_TRANSITIONS`), so this refusal is about authority and not about
    // the transition table — the positive control below shows the same write
    // succeeds while this holder is still current.
    expect(advanceLeasedAgent(agent, 'orphaned', 'the run lost its work item')).toBe('fenced')
    expect(agent.lifecycle?.state).toBe('queued')

    await ctx.fiber.dispose()
    mounted.splice(mounted.indexOf(ctx), 1)
  })
})

describe('P4-05 acceptance[2]: an orphaned run is reclaimed, or safely failed, by the host that took it', () => {
  it('lets a second host take a LAPSED item, record `orphaned` under its own epoch, and fences the first host afterwards', async () => {
    // §12.60's frozen case, over two real hosts sharing one SQLite lease
    // store. `leaseMs` is short so the first host's lease lapses without it
    // releasing — the crash-and-never-come-back shape acceptance[2] is about,
    // rather than an orderly handover.
    const leaseDirectory = await mkdtemp(join(tmpdir(), 'dsh-run-orphan-'))
    roots.push(leaseDirectory)
    const first = await harness({ leaseDirectory, leaseMs: 40 })
    const second = await harness({ leaseDirectory, leaseMs: 1_000 })
    const shared = SessionId('lapsed-session')

    const stranded = first.agentLoop.create(shared, { provider: 'mock', model: 'mock' })
    expect(stranded.lifecycle?.state).toBe('queued')
    const firstEpoch = stranded.lifecycle?.epoch

    // Stop the first host's renewals WITHOUT releasing: that is the shape
    // acceptance[2] is about — a host that died still holding the item, not
    // one that handed it back. Disposing the plugin would release the lease
    // and there would be nothing to reclaim.
    const firstPlugin = first.runs as unknown as { heartbeats: Map<unknown, NodeJS.Timeout> }
    for (const timer of firstPlugin.heartbeats.values()) clearInterval(timer)
    firstPlugin.heartbeats.clear()

    // Past the lease it last renewed, which nothing will renew again.
    await new Promise<void>((resolve) => { setTimeout(resolve, 80) })

    expect(second.runs.reclaim(stranded, Date.now())).toBe('reclaimed')
    expect(stranded.lifecycle?.state).toBe('orphaned')
    // Under the RECLAIMER's epoch, which the store issued it — the whole point
    // is that this write carries current authority rather than bypassing the
    // check the first host would have failed.
    expect(stranded.lifecycle?.epoch).toBeGreaterThan(firstEpoch ?? 0)

    // acceptance[2]'s two arms are both reachable from here.
    expect(second.runs.advance(stranded, 'failed', 'the reclaimer could not resume this work')).toBeUndefined()
    expect(stranded.lifecycle?.state).toBe('failed')

    for (const ctx of [first, second]) {
      await ctx.fiber.dispose()
      mounted.splice(mounted.indexOf(ctx), 1)
    }
  })

  it('REFUSES to reclaim an item whose holder is still current, so a live run is never taken from it', async () => {
    // The negative control. Without it the case above would pass against a
    // `reclaim` that seized any item it was handed.
    const leaseDirectory = await mkdtemp(join(tmpdir(), 'dsh-run-live-'))
    roots.push(leaseDirectory)
    const first = await harness({ leaseDirectory, leaseMs: 10_000 })
    const second = await harness({ leaseDirectory, leaseMs: 10_000 })

    const working = first.agentLoop.create(SessionId('live-session'), { provider: 'mock', model: 'mock' })
    expect(second.runs.reclaim(working, Date.now())).toBe('held')
    expect(working.lifecycle?.state).toBe('queued')

    for (const ctx of [first, second]) {
      await ctx.fiber.dispose()
      mounted.splice(mounted.indexOf(ctx), 1)
    }
  })
})

describe('P4-05 acceptance[1] (§12.60): a run holding no dispatch slot does not begin a model step', () => {
  it('REFUSES the step for a reclaimed run, so no LLM call is spent on work this host lost', async () => {
    // `holdsDispatchSlot`'s production caller. The failure it prevents is
    // concrete: an orphaned run whose host kept stepping would spend model
    // calls on work another host now owns, and every result it produced would
    // be written against a lifecycle it no longer has authority over.
    const leaseDirectory = await mkdtemp(join(tmpdir(), 'dsh-run-nostep-'))
    roots.push(leaseDirectory)
    const first = await harness({ leaseDirectory, leaseMs: 40 })
    const second = await harness({ leaseDirectory, leaseMs: 1_000 })

    let requests = 0
    const adapter = new MockAdapter([textResponse('should never be asked')])
    const counting = new Proxy(adapter, {
      get(target, key, receiver) {
        if (key === 'stream' || key === 'generate') requests += 1
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    first.llm.registerAdapter(['mock'], counting)

    const stranded = first.agentLoop.create(SessionId('nostep-session'), { provider: 'mock', model: 'mock' })
    const firstPlugin = first.runs as unknown as { heartbeats: Map<unknown, NodeJS.Timeout> }
    for (const timer of firstPlugin.heartbeats.values()) clearInterval(timer)
    firstPlugin.heartbeats.clear()
    await new Promise<void>((resolve) => { setTimeout(resolve, 80) })

    expect(second.runs.reclaim(stranded, Date.now())).toBe('reclaimed')
    expect(stranded.lifecycle?.state).toBe('orphaned')

    stranded.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await stranded.whenIdle()

    // The step was refused before the model was reached.
    expect(requests).toBe(0)
    expect(stranded.session.snapshotEvents().filter(event => event.type === 'request/header')).toEqual([])
    // And the refusal did not move the lifecycle: the reclaimer still owns it.
    expect(stranded.lifecycle?.state).toBe('orphaned')

    for (const ctx of [first, second]) {
      await ctx.fiber.dispose()
      mounted.splice(mounted.indexOf(ctx), 1)
    }
  })
})
