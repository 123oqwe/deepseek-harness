/**
 * P2-12's Usage stage, first slice: the emergency stop on the REAL dispatch
 * path.
 *
 * `advanceLeasedAgent` is the one implementation of "this agent proposes a
 * state change", and both production callers reach it — `@deepseek-ai/dsh-run`
 * for the run's own progress and the agent loop at tool dispatch. Gating there
 * rather than at each caller is what makes must[2] hold for work nobody
 * remembered to check.
 *
 * The cases assert the THREE answers rather than two. A gate that only
 * distinguished stopped from not-stopped would leave "allowed because the run
 * is live" and "allowed because no channel is mounted" as one fact, which is
 * the collapse `Agent.leaseRefused` exists to undo one layer down.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import type { FencingToken, Lease, LeaseEpoch, RunLease, WorkerId, WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import type { ControlState, StopRecord } from '@deepseek-ai/dsh-human-channel/types'
import type { PrincipalId } from '@deepseek-ai/dsh-principal/types'
import { advanceLeasedAgent, stopGateFor } from '../src/dispatch.ts'
import type { AgentLifecycle, AgentRunId } from '../src/state-machine.ts'
import type { Agent } from '../src/types.ts'

const RUN = brandString<AgentRunId>('run-stop-gate')
const HOLDER = brandString<WorkerId>('worker-1')
const ITEM = brandString<WorkItemId>('item-1')
const EPOCH = 1 as LeaseEpoch
const record: StopRecord = {
  requestedBy: brandString<PrincipalId>('operator-1'),
  reason: 'human-requested',
  requestedAtMs: 1_700_000_000_000,
  release: 'explicit-resume',
}

const lifecycle: AgentLifecycle = { runId: RUN, state: 'running', epoch: 1 }
const lease: Lease = { workItem: ITEM, holder: HOLDER, epoch: EPOCH, expiresAtMs: 9_999_999_999_999 }
const token: FencingToken = { workItem: ITEM, holder: HOLDER, epoch: EPOCH }
// Only `token` and `currentLease` are reached on this path; the rest of the
// interface is supplied so the stand-in is a real `RunLease` rather than a cast,
// and each unreached member throws rather than returning a plausible answer.
const runLease: RunLease = {
  token,
  currentLease: () => lease,
  renew: () => { throw new Error('the stop gate must not renew a lease') },
  mayWrite: () => { throw new Error('the stop gate must not ask whether this holder may write') },
  release: () => { throw new Error('the stop gate must not release a lease') },
}

/**
 * The four fields `advanceLeasedAgent` reads, and nothing else.
 *
 * A cast rather than a real `AgentRegistry` handle: this slice is about which
 * of four fields the gate consults and in what order, and building a live agent
 * would make the case depend on the session, LLM and tool services it also
 * needs — a cross-package composition, which the run package's own
 * `fenced-dispatch.spec.ts` already owns for the fencing half.
 * @param controlState - the stop reading to present, or undefined for no channel.
 * @param overrides - further agent fields, for the lease-refusal case.
 * @returns an agent-shaped stand-in.
 */
function agentWith(controlState: ControlState | undefined, overrides: Partial<Agent> = {}): Agent {
  return { lifecycle: { ...lifecycle }, runLease, controlState, ...overrides } as unknown as Agent
}

describe('P2-12 must[2]: a stop refuses the next advance on the real dispatch path', () => {
  it('refuses the advance with `stopped` while a stop is in force', () => {
    expect(advanceLeasedAgent(agentWith({ stopped: true, record }), 'waiting_human', 'gate test')).toBe('stopped')
  })

  it('leaves the lifecycle untouched when it refuses, so a refused agent did not half-advance', () => {
    const agent = agentWith({ stopped: true, record })
    advanceLeasedAgent(agent, 'waiting_human', 'gate test')
    expect(agent.lifecycle).toEqual(lifecycle)
  })

  it('admits the advance once the stop is RELEASED, so the gate refuses only while stopped', () => {
    // The control. Without it a gate that refused everything would satisfy the
    // case above and stop the harness.
    const agent = agentWith({ stopped: false })
    expect(advanceLeasedAgent(agent, 'waiting_human', 'gate test')).toBeUndefined()
    expect(agent.lifecycle).toMatchObject({ state: 'waiting_human' })
  })

  it('admits the advance when NO channel is mounted, and says that is why', () => {
    // The reverse control the delegate named: absence must not be read as
    // stopped. A composition that mounts no channel is capability absence and
    // dispatches normally — the same rule P4-07 applies to an absent Run
    // Service — and `stopGateFor` is what makes the admitting reason visible.
    const agent = agentWith(undefined)
    expect(stopGateFor(agent)).toBe('no-channel')
    expect(advanceLeasedAgent(agent, 'waiting_human', 'gate test')).toBeUndefined()
  })

  it('distinguishes the two admitting reasons, because they are different facts', () => {
    // "Allowed because the run is live" and "allowed because nothing is
    // watching" look identical in behaviour and differ in what an operator must
    // do next. Collapsing them is the mistake `leaseRefused` records one layer
    // down, where absence of a lifecycle hid a refusal.
    expect(stopGateFor(agentWith({ stopped: false }))).toBe('running')
    expect(stopGateFor(agentWith(undefined))).toBe('no-channel')
  })

  it('reports the STOP even when the lease was also refused, so the operator is sent to the right cause', () => {
    // Check order, not preference. A stopped run whose lease was also refused
    // must report the stop: told `lease-refused`, an operator goes looking for
    // the host that took the work instead of for the stop they requested.
    const agent = agentWith({ stopped: true, record }, { leaseRefused: true })
    expect(advanceLeasedAgent(agent, 'waiting_human', 'gate test')).toBe('stopped')
  })

  it('still reports `lease-refused` when no stop is in force, so the stop check did not swallow it', () => {
    // The mirror of the case above: the new check must not shadow the refusal
    // it was placed in front of.
    const agent = agentWith({ stopped: false }, { leaseRefused: true })
    expect(advanceLeasedAgent(agent, 'waiting_human', 'gate test')).toBe('lease-refused')
  })
})
