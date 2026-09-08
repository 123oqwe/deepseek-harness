/**
 * P5-10 Provider — the decisions reach a real Agent, or nothing happens.
 *
 * The Contract stage pinned what each control kind may do in each phase. What
 * it could not pin is that a refused message reaches no Agent operation AT ALL:
 * a router that decided correctly and dispatched anyway would satisfy every
 * Contract case while still waking a cancelled child, which is acceptance[0]'s
 * failure exactly.
 *
 * So every case here asserts on what the Agent was asked to do, not on the
 * decision that was returned.
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ControlLedger } from '../src/control-ledger.ts'
import type { UserMessage } from '@deepseek-ai/dsh-session'

import { ChildControlRouter } from '../src/control-router.ts'
import type { ControlMessage } from '../src/control-convergence.ts'

/** What the child Agent was actually asked to do. */
interface Calls {
  readonly log: string[]
  readonly answers: { waitingPointId: string; answer: UserMessage }[]
}

/** An in-memory stand-in for the manager's durable ledger (§12.26). */
function ledger(): ControlLedger {
  const applied = new Set<number>()
  return { has: epoch => applied.has(epoch), add: epoch => void applied.add(epoch) }
}

/** A router over an Agent that records the operations it receives. */
function bench(options: { live?: boolean } = {}): { router: ChildControlRouter; calls: Calls } {
  const calls: Calls = { log: [], answers: [] }
  const agent = {
    cancel: () => { calls.log.push('cancel') },
    followup: () => { calls.log.push('followup') },
    steer: () => { calls.log.push('steer') },
    inject: () => { calls.log.push('inject') },
  } as unknown as Agent
  const router = new ChildControlRouter(
    ledger(),
    options.live === false ? undefined : agent,
    (waitingPointId: string, answer: UserMessage) => {
      calls.answers.push({ waitingPointId, answer })
      calls.log.push('answer')
    },
  )
  return { router, calls }
}

function message(kind: ControlMessage['kind'], controlEpoch: number, waitingPointId?: string): ControlMessage {
  return { kind, controlEpoch, ...waitingPointId === undefined ? {} : { waitingPointId } }
}

const body = (text: string): UserMessage =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })

describe('P5-10 Provider — an admitted message reaches its Agent operation', () => {
  it('must[0]: each kind maps onto the operation that kind names', () => {
    const { router, calls } = bench()
    expect(router.submit({ message: message('steer', 1), payload: body('a') }).dispatched).toBe('steer')
    expect(router.submit({ message: message('inject', 2), payload: body('b') }).dispatched).toBe('inject')
    expect(router.submit({ message: message('continue', 3), payload: body('c') }).dispatched).toBe('followup')
    expect(calls.log).toStrictEqual(['steer', 'inject', 'followup'])
  })

  it('acceptance[0]: a steer arriving while cancelling reaches the Agent NOT AT ALL', () => {
    const { router, calls } = bench()
    router.submit({ message: message('cancel', 1) })
    expect(router.currentPhase).toBe('cancelling')
    const outcome = router.submit({ message: message('steer', 2), payload: body('wake up') })
    expect(outcome.dispatched).toBeUndefined()
    // The whole point: `steer` never appears. A router that decided correctly
    // and dispatched anyway would pass every Contract case and still wake a
    // child that was stopping.
    expect(calls.log).toStrictEqual(['cancel'])
  })

  it('acceptance[0]: cancel arriving BESIDE a steer is applied first, whatever order they arrived in', () => {
    const { router, calls } = bench()
    router.submitBatch([
      { message: message('steer', 1), payload: body('steer me') },
      { message: message('cancel', 2) },
    ])
    // Cancel outranks, so it lands first and the steer is then refused by
    // phase. Delivery order decided nothing.
    expect(calls.log).toStrictEqual(['cancel'])
  })

  it('acceptance[2]: a redelivered message dispatches once, not twice', () => {
    const { router, calls } = bench()
    router.submit({ message: message('continue', 7), payload: body('go') })
    const second = router.submit({ message: message('continue', 7), payload: body('go') })
    expect(second.dispatched).toBeUndefined()
    expect(calls.log).toStrictEqual(['followup'])
  })
})

describe('P5-10 Provider — acceptance[1]: an answer reaches the waiting point that asked', () => {
  it('an answer for the open question is delivered to that waiting point', () => {
    const { router, calls } = bench()
    router.awaitHuman('ask-42')
    expect(router.currentPhase).toBe('awaiting-human')
    router.submit({ message: message('human-answer', 1, 'ask-42'), payload: body('yes') })
    expect(calls.answers).toHaveLength(1)
    expect(calls.answers[0]?.waitingPointId).toBe('ask-42')
    // Answering closes the wait, so the child is running again.
    expect(router.currentPhase).toBe('running')
  })

  it('an answer naming a different waiting point is delivered NOWHERE', () => {
    const { router, calls } = bench()
    router.awaitHuman('ask-42')
    router.submit({ message: message('human-answer', 1, 'ask-7'), payload: body('yes') })
    // Not "delivered to the wrong point" — not delivered. Another question may
    // be outstanding, and an answer routed by child identity alone would
    // satisfy whichever one happened to be waiting.
    expect(calls.answers).toHaveLength(0)
    expect(router.currentPhase).toBe('awaiting-human')
  })

  it('a child that is running answers nobody', () => {
    const { router, calls } = bench()
    router.submit({ message: message('human-answer', 1, 'ask-42'), payload: body('yes') })
    expect(calls.answers).toHaveLength(0)
  })
})

describe('P5-10 Provider — must[3]: cancellation is not terminal until participants stop', () => {
  it('a cancelled child stays in cancelling until the child itself reports stopped', () => {
    const { router } = bench()
    router.submit({ message: message('cancel', 1) })
    expect(router.currentPhase).toBe('cancelling')
    const state = router.participantStopped('child')
    expect(state).toStrictEqual({ converged: true, participants: ['child'] })
    expect(router.currentPhase).toBe('terminal')
  })

  it('a registered participant that has not stopped holds the barrier, and is named', () => {
    const { router } = bench()
    router.addParticipant('a-later-supplier')
    router.submit({ message: message('cancel', 1) })
    expect(router.participantStopped('child')).toStrictEqual({
      converged: false,
      pending: ['a-later-supplier'],
    })
    // Still cancelling: the child stopped, the supplier did not.
    expect(router.currentPhase).toBe('cancelling')
    router.participantStopped('a-later-supplier')
    expect(router.currentPhase).toBe('terminal')
  })

  it('a participant stopping during an ORDINARY run does not make the child terminal', () => {
    // A stop reported outside cancellation says nothing about the child being
    // finished, and treating it as convergence would end a live run.
    const { router } = bench()
    expect(router.currentPhase).toBe('running')
    router.participantStopped('child')
    expect(router.currentPhase).toBe('running')
  })

  it('nothing at all reaches the Agent once the child is terminal', () => {
    const { router, calls } = bench()
    router.submit({ message: message('cancel', 1) })
    router.participantStopped('child')
    expect(router.currentPhase).toBe('terminal')
    for (const kind of ['continue', 'steer', 'inject', 'cancel', 'human-answer'] as const) {
      router.submit({ message: message(kind, 100), payload: body('x') })
    }
    expect(calls.log).toStrictEqual(['cancel'])
  })
})
