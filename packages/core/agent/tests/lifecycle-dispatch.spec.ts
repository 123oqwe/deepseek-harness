/**
 * Epic P4-05's Usage stage: the lifecycle state machine wired into dispatch.
 *
 * The Contract stage proved the decision function in isolation. This asserts
 * the properties that only exist once a caller uses it — that the dispatch
 * layer cannot route around the decision, that a refusal is a returned
 * outcome rather than a thrown exception, and that slot occupancy is derived
 * from the lifecycle rather than tracked separately alongside it.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { advanceAgentLifecycle, holdsDispatchSlot } from '../src/dispatch.ts'
import type { AgentLifecycle, AgentLifecycleState, AgentRunId, AgentTransition } from '../src/state-machine.ts'

const RUN = brandString<AgentRunId>('run-dispatch-1')

/**
 * A lifecycle at a state and epoch.
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
  return { from, to, reason: 'dispatch test', runId: RUN, epoch: 1, ...overrides }
}

describe('P4-05 Usage: dispatch advances a lifecycle only through the state machine', () => {
  it('contract: an admitted transition returns the next lifecycle carrying the proposal epoch', () => {
    const result = advanceAgentLifecycle(at('running'), move('running', 'waiting_tool'))
    expect(result).toEqual({ ok: true, next: { runId: RUN, state: 'waiting_tool', epoch: 1 } })
  })

  it('contract: a refusal is RETURNED, not thrown, so a supervisor can record a turned-away worker as an ordinary outcome', () => {
    // A stale worker being refused is the system working. Throwing would make
    // the normal case indistinguishable from a fault at the call site.
    expect(() => advanceAgentLifecycle(at('running', 7), move('running', 'paused', { epoch: 2 }))).not.toThrow()
    expect(advanceAgentLifecycle(at('running', 7), move('running', 'paused', { epoch: 2 })))
      .toEqual({ ok: false, reason: 'stale-epoch' })
  })

  it('contract: the refusal reason reaches the caller unchanged, so dispatch adds no interpretation of its own', () => {
    expect(advanceAgentLifecycle(at('queued'), move('queued', 'running')))
      .toEqual({ ok: false, reason: 'illegal-transition' })
    expect(advanceAgentLifecycle(at('running'), move('running', 'paused', { reason: '' })))
      .toEqual({ ok: false, reason: 'missing-reason' })
  })

  it('contract: a refused transition leaves the lifecycle untouched, so a rejected proposal cannot half-apply', () => {
    const before = at('running', 7)
    const result = advanceAgentLifecycle(before, move('running', 'paused', { epoch: 2 }))
    expect(result.ok).toBe(false)
    expect(before).toEqual({ runId: RUN, state: 'running', epoch: 7 })
  })

  it('control: the same proposal at the current epoch IS admitted, so the refusal above measures the epoch', () => {
    expect(advanceAgentLifecycle(at('running', 7), move('running', 'paused', { epoch: 7 })))
      .toEqual({ ok: true, next: { runId: RUN, state: 'paused', epoch: 7 } })
  })
})

describe('P4-05 Usage: acceptance[1] — slot occupancy is derived from the lifecycle', () => {
  it('contract: a run that is running or starting holds a dispatch slot', () => {
    expect(holdsDispatchSlot(at('running'))).toBe(true)
    expect(holdsDispatchSlot(at('starting'))).toBe(true)
  })

  it('contract: every waiting state, plus queued and paused, holds no slot', () => {
    for (const state of ['queued', 'paused', 'waiting_tool', 'waiting_human'] as const) {
      expect(holdsDispatchSlot(at(state)), state).toBe(false)
    }
  })

  it('contract: a cancelling run still holds its slot, because a draining run has not released it', () => {
    expect(holdsDispatchSlot(at('cancelling'))).toBe(true)
  })

  it('contract: moving into a waiting state releases the slot in the SAME step that changes the state', () => {
    // Occupancy is computed from the lifecycle rather than tracked beside it,
    // so the two cannot disagree: there is no window in which the state says
    // waiting and a separate counter still says occupied.
    const before = at('running')
    expect(holdsDispatchSlot(before)).toBe(true)
    const result = advanceAgentLifecycle(before, move('running', 'waiting_human'))
    if (!result.ok) throw new Error('expected the transition to be admitted')
    expect(holdsDispatchSlot(result.next)).toBe(false)
  })
})
