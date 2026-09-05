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
