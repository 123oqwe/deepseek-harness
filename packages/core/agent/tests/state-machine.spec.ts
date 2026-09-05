/**
 * Epic P4-05's Contract stage: the Agent lifecycle state machine.
 *
 * Case prefixes carry this program's usual meaning — `contract:` asserts a
 * promise the exported surface makes, `control:` proves the assertion beside
 * it measures a decision rather than a constant.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  LEGAL_TRANSITIONS,
  NON_CONSUMING_STATES,
  TERMINAL_STATES,
  consumesNoResources,
  decideTransition,
  isTerminal,
  type AgentLifecycle,
  type AgentLifecycleState,
  type AgentRunId,
  type AgentTransition,
} from '../src/state-machine.ts'

const RUN = brandString<AgentRunId>('run-1')
const OTHER_RUN = brandString<AgentRunId>('run-2')

/**
 * A lifecycle at a given state and epoch.
 * @param state - the current state.
 * @param epoch - the current lease epoch.
 * @returns the lifecycle.
 */
function at(state: AgentLifecycleState, epoch = 1): AgentLifecycle {
  return { runId: RUN, state, epoch }
}

/**
 * A well-formed transition proposal.
 * @param from - source state.
 * @param to - target state.
 * @param overrides - fields to replace.
 * @returns the proposal.
 */
function move(from: AgentLifecycleState, to: AgentLifecycleState, overrides: Partial<AgentTransition> = {}): AgentTransition {
  return { from, to, reason: 'test', runId: RUN, epoch: 1, ...overrides }
}

describe('P4-05 Contract: must[0] — the ten states, exactly', () => {
  it('contract: the state map declares exactly the ten states must[0] names, with no extras', () => {
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual(
      ['cancelling', 'completed', 'failed', 'orphaned', 'paused', 'queued', 'running', 'starting', 'waiting_human', 'waiting_tool'],
    )
  })

  it('contract: every declared target is itself a declared state, so the map cannot name a state that does not exist', () => {
    const declared = new Set(Object.keys(LEGAL_TRANSITIONS))
    for (const [from, targets] of Object.entries(LEGAL_TRANSITIONS)) {
      for (const target of targets) expect(declared.has(target), `${from} -> ${target}`).toBe(true)
    }
  })

  it('contract: waiting_tool and waiting_human are distinct states rather than one waiting state', () => {
    // They differ in whether the run can ever proceed unattended, which is the
    // distinction a supervisor needs before deciding to reclaim a lease.
    expect(LEGAL_TRANSITIONS.waiting_tool).not.toBe(LEGAL_TRANSITIONS.waiting_human)
    expect(consumesNoResources('waiting_tool')).toBe(true)
    expect(consumesNoResources('waiting_human')).toBe(true)
  })
})

describe('P4-05 Contract: must[1] — every transition carries reason, runId and epoch', () => {
  it('contract: a transition with an empty reason is refused, so a recorded transition always says why', () => {
    expect(decideTransition(at('running'), move('running', 'paused', { reason: '' })))
      .toEqual({ admitted: false, reason: 'missing-reason' })
  })

  it('contract: a whitespace-only reason is refused too, since it records nothing a reader can use', () => {
    expect(decideTransition(at('running'), move('running', 'paused', { reason: '   ' })))
      .toEqual({ admitted: false, reason: 'missing-reason' })
  })

  it('control: the same transition with a real reason is admitted, so the refusals above measure the reason and not the edge', () => {
    expect(decideTransition(at('running'), move('running', 'paused')))
      .toEqual({ admitted: true, state: 'paused', epoch: 1 })
  })

  it('contract: a proposal naming a different run is refused, so one run can never advance another', () => {
    expect(decideTransition(at('running'), move('running', 'paused', { runId: OTHER_RUN })))
      .toEqual({ admitted: false, reason: 'run-mismatch' })
  })
})

describe('P4-05 Contract: acceptance[0] — illegal transitions and stale workers are refused', () => {
  it('contract: an edge absent from the map is refused', () => {
    expect(decideTransition(at('queued'), move('queued', 'running')))
      .toEqual({ admitted: false, reason: 'illegal-transition' })
  })

  it('contract: a proposal whose source disagrees with the current state is refused, even when the edge itself is legal', () => {
    // running -> paused is a legal edge; the lifecycle is not in running.
    expect(decideTransition(at('waiting_tool'), move('running', 'paused')))
      .toEqual({ admitted: false, reason: 'illegal-transition' })
  })

  it('contract: a strictly older epoch is refused whatever it proposes — the stale-worker case', () => {
    expect(decideTransition(at('running', 5), move('running', 'paused', { epoch: 4 })))
      .toEqual({ admitted: false, reason: 'stale-epoch' })
  })

  it('control: the same proposal at the current epoch is admitted, so staleness is decided by the epoch and not by the edge', () => {
    expect(decideTransition(at('running', 5), move('running', 'paused', { epoch: 5 })))
      .toEqual({ admitted: true, state: 'paused', epoch: 5 })
  })

  it('contract: a stale worker is refused for staleness before legality, so it never learns whether its edge would have been legal', () => {
    // An illegal edge AND a stale epoch: the epoch must decide, or the refusal
    // reason leaks the shape of a lifecycle the worker no longer owns.
    expect(decideTransition(at('queued', 9), move('queued', 'running', { epoch: 2 })))
      .toEqual({ admitted: false, reason: 'stale-epoch' })
  })

  it('contract: no transition leaves a terminal state, so a finished run cannot be revived or re-orphaned', () => {
    for (const terminal of TERMINAL_STATES) {
      expect(LEGAL_TRANSITIONS[terminal]).toEqual([])
      expect(isTerminal(terminal)).toBe(true)
    }
  })
})

describe('P4-05 Contract: acceptance[1] — waiting states consume no LLM or worker resource', () => {
  it('contract: every waiting state, plus queued and paused, is non-consuming', () => {
    for (const state of ['queued', 'paused', 'waiting_tool', 'waiting_human'] as const) {
      expect(consumesNoResources(state), state).toBe(true)
    }
  })

  it('contract: running and starting DO consume, so the classification is a real partition rather than a list of everything', () => {
    expect(consumesNoResources('running')).toBe(false)
    expect(consumesNoResources('starting')).toBe(false)
  })

  it('contract: cancelling consumes, because a draining run still holds its slot', () => {
    // Excluded from NON_CONSUMING_STATES deliberately: treating a cancelling
    // run as idle would let a supervisor reclaim resources still in use.
    expect(NON_CONSUMING_STATES).not.toContain('cancelling')
    expect(consumesNoResources('cancelling')).toBe(false)
  })
})

describe('P4-05 Contract: acceptance[2] — an orphaned run is reclaimable or fails safely', () => {
  it('contract: an orphaned run may be reclaimed through starting, which is what issues a new epoch', () => {
    expect(decideTransition(at('orphaned'), move('orphaned', 'starting', { reason: 'reclaimed after restart' })))
      .toEqual({ admitted: true, state: 'starting', epoch: 1 })
  })

  it('contract: an orphaned run may fail safely', () => {
    expect(decideTransition(at('orphaned'), move('orphaned', 'failed', { reason: 'unreclaimable' })))
      .toEqual({ admitted: true, state: 'failed', epoch: 1 })
  })

  it('contract: an orphaned run may NOT resume directly as running, so a reclaim always issues a new lease', () => {
    // Resuming straight to running would keep the dead worker's epoch alive,
    // and acceptance[0]'s staleness test is exactly that epoch.
    expect(decideTransition(at('orphaned'), move('orphaned', 'running', { reason: 'resume' })))
      .toEqual({ admitted: false, reason: 'illegal-transition' })
  })

  it('contract: every non-terminal state can reach orphaned, so any interrupted run is representable after a restart', () => {
    for (const [state, targets] of Object.entries(LEGAL_TRANSITIONS)) {
      if (isTerminal(state as AgentLifecycleState) || state === 'orphaned') continue
      expect(targets, state).toContain('orphaned')
    }
  })
})

describe('P4-05 Fault: the decider under inputs a caller should never send', () => {
  it('enforcement: a transition into a state that does not exist is refused rather than admitted as novel', () => {
    // TypeScript forbids this at the boundary; a JSON-decoded proposal
    // crossing a process boundary is not typechecked, and this decider is
    // reachable from one.
    const bogus = move('running', 'zombie' as AgentLifecycleState)
    expect(decideTransition(at('running'), bogus)).toEqual({ admitted: false, reason: 'illegal-transition' })
  })

  it('DEFECT: a proposal FROM an unknown state throws instead of refusing, because the map lookup is unguarded', () => {
    // decideTransition reads LEGAL_TRANSITIONS[transition.from] after
    // confirming `from` equals the lifecycle's state, so an unknown state can
    // only arrive if the LIFECYCLE itself is corrupt -- from a persisted
    // record written by a newer build, say. Today that throws a TypeError
    // rather than returning a refusal, so a caller that handles decisions but
    // not exceptions would crash on a forward-compatible log.
    // Recorded, not fixed: the guard belongs in decideTransition, which is the
    // Contract stage's declared file and already frozen.
    const corrupt: AgentLifecycle = { runId: RUN, state: 'zombie' as AgentLifecycleState, epoch: 1 }
    expect(() => decideTransition(corrupt, move('zombie' as AgentLifecycleState, 'failed'))).toThrow()
  })

  it('enforcement: a far-future epoch is admitted, because a higher epoch is a newer lease and not an attack', () => {
    // The staleness test is strictly-older. A worker holding a NEWER lease is
    // the legitimate owner -- refusing it would strand a run whose lease was
    // reissued while a supervisor held an old view.
    expect(decideTransition(at('running', 1), move('running', 'paused', { epoch: 999 })))
      .toEqual({ admitted: true, state: 'paused', epoch: 999 })
  })

  it('enforcement: a self-transition is refused, since no state lists itself as a target', () => {
    for (const state of Object.keys(LEGAL_TRANSITIONS) as AgentLifecycleState[]) {
      expect(LEGAL_TRANSITIONS[state], state).not.toContain(state)
    }
    expect(decideTransition(at('running'), move('running', 'running')))
      .toEqual({ admitted: false, reason: 'illegal-transition' })
  })

  it('enforcement: every state is reachable from queued, so no state is declared and stranded', () => {
    // A state nothing can reach is a state whose rules are never exercised --
    // it would look covered while being dead.
    const seen = new Set<AgentLifecycleState>(['queued'])
    const queue: AgentLifecycleState[] = ['queued']
    while (queue.length > 0) {
      const current = queue.shift()
      if (current === undefined) break
      for (const next of LEGAL_TRANSITIONS[current]) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(LEGAL_TRANSITIONS).sort())
  })

  it('CHARACTERIZATION: the reason string is stored verbatim, with no length bound or normalization', () => {
    // Pins current behaviour so a later bound is a deliberate change rather
    // than a silent one. must[1] requires a reason to exist; it says nothing
    // about its size, and a durable log carrying one may want a limit.
    const long = 'x'.repeat(100_000)
    expect(decideTransition(at('running'), move('running', 'paused', { reason: long })))
      .toEqual({ admitted: true, state: 'paused', epoch: 1 })
  })
})

describe('P4-05 Fault: the property the orphaned-edge prohibition exists to protect', () => {
  it('enforcement: a run that goes orphaned -> starting -> running carries a strictly greater epoch than before it was orphaned', () => {
    // BLOCKED-079: the state machine FORBIDS orphaned -> running, and a
    // mutation adding that edge reddened only the prohibition itself while
    // every stale-epoch assertion kept passing. The prohibition was asserted;
    // the property it protects was not. This is that property, at the level
    // this stage owns -- the state machine's half. The other half, that a real
    // lease store issues the greater epoch, belongs to P4-07.
    //
    // `starting` is where a new lease is issued, so the reclaim path must be
    // able to carry a greater epoch through. If the decider refused a greater
    // epoch, or silently preserved the old one, a reclaimed run would keep the
    // dead worker's epoch and acceptance[0]'s comparison baseline would be
    // corrupt from that point on.
    const orphanedAt = at('orphaned', 4)
    const reclaimed = decideTransition(orphanedAt, move('orphaned', 'starting', { reason: 'reclaim', epoch: 5 }))
    if (!reclaimed.admitted) throw new Error('expected the reclaim to be admitted')
    const resumed = decideTransition(
      { runId: RUN, state: reclaimed.state, epoch: reclaimed.epoch },
      move('starting', 'running', { reason: 'resumed', epoch: reclaimed.epoch }),
    )
    if (!resumed.admitted) throw new Error('expected the resume to be admitted')
    expect(resumed.epoch).toBeGreaterThan(orphanedAt.epoch)
  })

  it('enforcement: the dead worker cannot act after the reclaim, because its epoch is now strictly older', () => {
    // The consequence that makes the property matter: once the reclaim has
    // raised the epoch, the previous lease holder's proposals are stale.
    const resumedAt = at('running', 5)
    expect(decideTransition(resumedAt, move('running', 'completed', { reason: 'stale worker finishing', epoch: 4 })))
      .toEqual({ admitted: false, reason: 'stale-epoch' })
  })
})
