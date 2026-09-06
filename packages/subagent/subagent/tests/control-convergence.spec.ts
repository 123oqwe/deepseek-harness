/**
 * P5-10 Contract — the five control kinds, and the barrier cancellation waits on.
 *
 * acceptance[0] and acceptance[2] are races: a `steer` arriving beside a
 * `cancel`, and the same message delivered twice. Both are decided here rather
 * than by arrival order, because arrival order belongs to the transport and
 * would make the outcome depend on scheduling.
 *
 * must[3]'s barrier is built over the one participant that has a subject today.
 * The case that matters most is the empty-set one: a barrier over nothing is
 * trivially satisfied, which is how this clause would stop meaning anything
 * without any test noticing.
 */
import { describe, expect, it } from 'vitest'

import {
  decideControl,
  decideConvergence,
  orderByPriority,
  type ControlMessage,
} from '../src/control-convergence.ts'

const NONE: ReadonlySet<number> = new Set()

/** One message of each kind, with distinct epochs. */
function message(kind: ControlMessage['kind'], controlEpoch = 1, waitingPointId?: string): ControlMessage {
  return { kind, controlEpoch, ...waitingPointId === undefined ? {} : { waitingPointId } }
}

describe('P5-10 Contract — must[0]/must[1]: each kind acts only in the phases that admit it', () => {
  it('steer and continue are admitted while running', () => {
    expect(decideControl(message('steer'), 'running', NONE).applied).toBe(true)
    expect(decideControl(message('continue'), 'running', NONE).applied).toBe(true)
  })

  it('acceptance[0]: a steer arriving while the child is CANCELLING is refused, not queued', () => {
    // The race the clause names. A steer admitted here would wake a child that
    // is already stopping, which is the failure this epic exists to fix.
    const decision = decideControl(message('steer'), 'cancelling', NONE)
    expect(decision).toStrictEqual({
      applied: false,
      denial: { reason: 'phase-forbids', kind: 'steer', phase: 'cancelling' },
    })
  })

  it('acceptance[0]: a continue arriving while cancelling is refused for the same reason', () => {
    expect(decideControl(message('continue'), 'cancelling', NONE).applied).toBe(false)
  })

  it('nothing at all is admitted in terminal — a message after the end has nothing to act on', () => {
    for (const kind of ['continue', 'steer', 'inject', 'cancel', 'human-answer'] as const) {
      expect(decideControl(message(kind), 'terminal', NONE).applied).toBe(false)
    }
  })

  it('a SECOND cancel while cancelling is admitted: a caller who did not see the first land', () => {
    // Refusing it would make the caller retry something that already happened.
    expect(decideControl(message('cancel', 2), 'cancelling', NONE).applied).toBe(true)
  })

  it('inject is admitted while awaiting a human, since it adds context without driving a turn', () => {
    expect(decideControl(message('inject'), 'awaiting-human', NONE).applied).toBe(true)
  })
})

describe('P5-10 Contract — acceptance[1]: a human answer reaches one waiting point', () => {
  it('an answer for the waiting point the child is at is admitted', () => {
    expect(decideControl(message('human-answer', 1, 'ask-42'), 'awaiting-human', NONE, 'ask-42').applied).toBe(true)
  })

  it('an answer naming a DIFFERENT waiting point is refused, and the denial names both', () => {
    expect(decideControl(message('human-answer', 1, 'ask-7'), 'awaiting-human', NONE, 'ask-42')).toStrictEqual({
      applied: false,
      denial: { reason: 'wrong-waiting-point', expected: 'ask-42', received: 'ask-7' },
    })
  })

  it('an answer arriving while the child waits for nobody is refused by phase', () => {
    expect(decideControl(message('human-answer', 1, 'ask-42'), 'running', NONE, undefined).applied).toBe(false)
  })
})

describe('P5-10 Contract — must[2]: a redelivered control message changes nothing', () => {
  it('acceptance[2]: the same controlEpoch twice is refused as a redelivery', () => {
    expect(decideControl(message('continue', 9), 'running', new Set([9]))).toStrictEqual({
      applied: false,
      denial: { reason: 'already-applied', controlEpoch: 9 },
    })
  })

  it('a redelivery is reported as a redelivery even when the phase ALSO forbids it now', () => {
    // Checked before the phase, deliberately: a continue applied while running
    // and redelivered after cancellation began is a redelivery, not a race, and
    // reporting the phase conflict would send a caller looking for a race that
    // never happened.
    const decision = decideControl(message('continue', 9), 'cancelling', new Set([9]))
    expect(decision.applied).toBe(false)
    expect(decision.applied === false ? decision.denial.reason : undefined).toBe('already-applied')
  })

  it('a different epoch of the same kind is a new message', () => {
    expect(decideControl(message('continue', 10), 'running', new Set([9])).applied).toBe(true)
  })
})

describe('P5-10 Contract — must[1]: cancel outranks whatever arrived beside it', () => {
  it('acceptance[0]: cancel is ordered ahead of steer and continue that arrived together', () => {
    const ordered = orderByPriority([message('inject', 1), message('continue', 2), message('steer', 3), message('cancel', 4)])
    expect(ordered[0]?.kind).toBe('cancel')
  })

  it('order within one kind is arrival order, so equal-urgency messages are not reshuffled', () => {
    const ordered = orderByPriority([message('inject', 1), message('inject', 2), message('inject', 3)])
    expect(ordered.map(entry => entry.controlEpoch)).toStrictEqual([1, 2, 3])
  })
})

describe('P5-10 Contract — must[3]: cancellation converges before terminal', () => {
  it('a participant that has not stopped keeps the barrier closed, and is named', () => {
    expect(decideConvergence([{ name: 'child', stopped: false }])).toStrictEqual({
      converged: false,
      pending: ['child'],
    })
  })

  it('every participant stopped converges, and the report says which took part', () => {
    expect(decideConvergence([{ name: 'child', stopped: true }])).toStrictEqual({
      converged: true,
      participants: ['child'],
    })
  })

  it('an EMPTY participant set does NOT converge', () => {
    // The case that guards the clause itself: a barrier over nothing is
    // trivially satisfied, so a participant silently dropped from the set would
    // make cancellation terminal immediately with every other case still green.
    expect(decideConvergence([])).toStrictEqual({
      converged: false,
      pending: ['(no participants registered)'],
    })
  })

  it('one stopped participant beside one running one does not converge', () => {
    // Written with two members although only `child` exists today: the barrier
    // takes a set precisely so a supplier can add itself (BLOCKED-116), and
    // this pins that a second member is actually waited on rather than ignored.
    expect(decideConvergence([{ name: 'child', stopped: true }, { name: 'a-later-supplier', stopped: false }]))
      .toStrictEqual({ converged: false, pending: ['a-later-supplier'] })
  })
})
