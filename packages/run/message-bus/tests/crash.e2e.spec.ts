/**
 * P4-06 acceptance: kill around commit, send and ack; the effect happens once.
 *
 * The harness below is a durable store plus a dispatcher that can be killed at
 * a named point, then restarted against the surviving state. A test that
 * asserted the decision functions in isolation would prove the transition
 * table and nothing about what survives a crash, so the crash points are the
 * subject here and the assertions are about the effect counter, not the API.
 *
 * `.e2e.spec.ts` rather than `.e2e.ts`: the latter routes into
 * vitest.e2e.config.ts, whose suites self-skip without an API key, and the
 * exact-SHA CI job runs the default config -- these cases would never be
 * observed there. Recorded as an adjudicated path patch before the file was
 * written (adjudication.json, P4-06-C-crash-e2e-not-yet-created).
 */

import { describe, expect, it } from 'vitest'
import { classifyIntake, dedupKey } from '../src/inbox.ts'
import {
  applyReceipt,
  decideDelivery,
  orderForDispatch,
  type BusMessageId,
  type DeliveryReceipt,
  type MessageEpoch,
  type OutboxRecord,
  type TenantId,
} from '../src/outbox.ts'

const TENANT = 'tenant-a' as TenantId
const OTHER_TENANT = 'tenant-b' as TenantId

/** Points at which the process can be killed, named for the epic's acceptance[0]. */
type CrashPoint = 'after-commit' | 'after-send' | 'after-effect' | 'after-ack' | 'none'

/** Raised by the harness to simulate a process death; never escapes a run. */
class SimulatedCrash extends Error {}

/**
 * State that outlives a crash: the outbox rows, the consumer's seen-set, and
 * the count of business effects actually applied.
 */
interface DurableState {
  outbox: Map<BusMessageId, OutboxRecord>
  seen: Set<string>
  effects: string[]
}

function newRecord(id: string, overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: id as BusMessageId,
    epoch: 1 as MessageEpoch,
    tenant: TENANT,
    state: 'pending',
    priority: 0,
    deadlineMs: 10_000,
    attempts: 0,
    receipt: null,
    ...overrides,
  }
}

/**
 * Run the dispatcher over every pending record, dying at `crashAt`.
 *
 * The write ordering here is the arrangement under test: the record moves to
 * `sent` and is persisted BEFORE the consumer is invoked, so a crash between
 * them leaves a record that replay can find. Reversing those two lines is the
 * mutation that should redden the after-send case.
 */
function runDispatcher(state: DurableState, crashAt: CrashPoint, nowMs = 0): void {
  try {
    for (const record of orderForDispatch([...state.outbox.values()])) {
      const decision = decideDelivery(record, nowMs, 5)
      if (decision.action !== 'deliver') continue

      state.outbox.set(record.id, { ...record, state: 'sent', attempts: decision.attempt })
      if (crashAt === 'after-send') throw new SimulatedCrash()

      const intake = classifyIntake({ id: record.id, epoch: record.epoch, tenant: record.tenant }, state.seen, TENANT)
      if (intake.action === 'accept') {
        state.effects.push(record.id)
        state.seen.add(intake.key)
      }
      if (intake.action === 'refuse') continue
      // The crash point the whole epic turns on: the effect is durable and the
      // ack is not. Replay MUST redeliver (the record still says `sent`) and
      // dedup is the only thing standing between that and a second effect.
      if (crashAt === 'after-effect') throw new SimulatedCrash()

      const receipt: DeliveryReceipt = { messageId: record.id, epoch: record.epoch, consumer: 'consumer-1' }
      const acked = applyReceipt(state.outbox.get(record.id) as OutboxRecord, receipt)
      state.outbox.set(record.id, acked)
      if (crashAt === 'after-ack') throw new SimulatedCrash()
    }
  } catch (error: unknown) {
    if (!(error instanceof SimulatedCrash)) throw error
  }
}

/** Commit a domain event and its outbox row together, dying at `crashAt`. */
function commitAndEnqueue(state: DurableState, id: string, crashAt: CrashPoint): void {
  try {
    state.outbox.set(id as BusMessageId, newRecord(id))
    if (crashAt === 'after-commit') throw new SimulatedCrash()
  } catch (error: unknown) {
    if (!(error instanceof SimulatedCrash)) throw error
  }
}

function freshState(): DurableState {
  return { outbox: new Map(), seen: new Set(), effects: [] }
}

describe('P4-06 acceptance[0]: killed at any point, the effect happens exactly once', () => {
  for (const crashAt of ['after-commit', 'after-send', 'after-effect', 'after-ack'] as const) {
    it(`kill ${crashAt}, then replay: the business effect is applied exactly once`, () => {
      const state = freshState()
      commitAndEnqueue(state, 'msg-1', crashAt)
      runDispatcher(state, crashAt)

      // Restart: the process is gone, the durable state is not. Replay until
      // quiescent, which is what a real recovery loop does.
      runDispatcher(state, 'none')
      runDispatcher(state, 'none')

      expect(state.effects).toEqual(['msg-1'])
      expect(state.outbox.get('msg-1' as BusMessageId)?.state).toBe('acked')
    })
  }

  it('a crash after send leaves a record replay can still find, not a lost message', () => {
    const state = freshState()
    commitAndEnqueue(state, 'msg-1', 'none')
    runDispatcher(state, 'after-send')

    // The distinguishing observation: the effect has NOT happened yet, and the
    // record survives in a non-terminal state. A lost message would show an
    // empty outbox here, which replay could never repair.
    expect(state.effects).toEqual([])
    expect(state.outbox.get('msg-1' as BusMessageId)?.state).toBe('sent')

    runDispatcher(state, 'none')
    expect(state.effects).toEqual(['msg-1'])
  })

  it('ten thousand redeliveries of one message produce one effect (validation[1])', () => {
    const state = freshState()
    commitAndEnqueue(state, 'msg-1', 'none')
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const record = state.outbox.get('msg-1' as BusMessageId) as OutboxRecord
      state.outbox.set(record.id, { ...record, state: 'pending', attempts: 0 })
      runDispatcher(state, 'none')
    }
    expect(state.effects).toEqual(['msg-1'])
  })
})

describe('P4-06 acceptance[1]: undelivered messages are queryable and replayable', () => {
  it('a pending message is visible as undelivered and still delivers after replay', () => {
    const state = freshState()
    commitAndEnqueue(state, 'msg-1', 'after-commit')

    const undelivered = [...state.outbox.values()].filter(record => record.state !== 'acked')
    expect(undelivered.map(record => record.id)).toEqual(['msg-1'])

    runDispatcher(state, 'none')
    expect(state.effects).toEqual(['msg-1'])
  })

  it('an expired message is dead-lettered rather than dispatched, and says why', () => {
    const state = freshState()
    commitAndEnqueue(state, 'msg-1', 'none')
    const record = state.outbox.get('msg-1' as BusMessageId) as OutboxRecord
    const decision = decideDelivery(record, record.deadlineMs + 1, 5)
    expect(decision).toEqual({ action: 'dead-letter', reason: 'deadline-expired' })
  })

  it('an out-of-budget message reports attempts-exhausted, distinct from expiry', () => {
    const record = newRecord('msg-1', { attempts: 5 })
    expect(decideDelivery(record, 0, 5)).toEqual({ action: 'dead-letter', reason: 'attempts-exhausted' })
  })

  it('a message that is BOTH expired and out of attempts reports the expiry', () => {
    // The only observation that pins the check ORDER rather than the two
    // conditions separately: both hold, so whichever is tested first decides
    // the reason an operator reads. Deadline wins -- the message stopped being
    // worth sending, which is a different response from delivery failing.
    const record = newRecord('msg-1', { attempts: 5, deadlineMs: 100 })
    expect(decideDelivery(record, 101, 5)).toEqual({ action: 'dead-letter', reason: 'deadline-expired' })
  })

  it('a replayed receipt does not overwrite the consumer that took responsibility', () => {
    const record = newRecord('msg-1', { state: 'sent' })
    const first: DeliveryReceipt = { messageId: record.id, epoch: record.epoch, consumer: 'consumer-1' }
    const acked = applyReceipt(record, first)
    // A second receipt for the same message from a DIFFERENT consumer is the
    // shape a redelivery takes after a rebalance. Idempotence here means the
    // record keeps the first consumer, not merely that it stays acked.
    const replayed = applyReceipt(acked, { ...first, consumer: 'consumer-2' })
    expect(replayed.receipt?.consumer).toBe('consumer-1')
    expect(replayed).toBe(acked)
  })
})

describe('P4-06 acceptance[2]: a cross-tenant message is never consumed', () => {
  it('refuses a foreign-tenant message and records nothing about it', () => {
    const seen = new Set<string>()
    const decision = classifyIntake(
      { id: 'msg-1' as BusMessageId, epoch: 1 as MessageEpoch, tenant: OTHER_TENANT },
      seen,
      TENANT,
    )
    expect(decision).toEqual({ action: 'refuse', reason: 'foreign-tenant' })
    expect(seen.size).toBe(0)
  })

  it('a foreign message is refused WITHOUT its key being looked up in the seen-set', () => {
    // Seed the seen-set with the key the foreign message would produce. If the
    // duplicate check ran first, this returns `drop` -- which tells the foreign
    // tenant that this id/epoch was already processed here, a fact about
    // another tenant's traffic. Refusal must not depend on our seen-set at all.
    const seen = new Set([dedupKey({ id: 'msg-1' as BusMessageId, epoch: 1 as MessageEpoch })])
    const decision = classifyIntake(
      { id: 'msg-1' as BusMessageId, epoch: 1 as MessageEpoch, tenant: OTHER_TENANT },
      seen,
      TENANT,
    )
    expect(decision).toEqual({ action: 'refuse', reason: 'foreign-tenant' })
  })

  it('a refused foreign message cannot suppress a later legitimate one sharing its key', () => {
    const state = freshState()
    state.outbox.set('msg-1' as BusMessageId, newRecord('msg-1', { tenant: OTHER_TENANT }))
    runDispatcher(state, 'none')
    expect(state.effects).toEqual([])

    // Same id and epoch, this time genuinely ours. If the refusal had recorded
    // a dedup key, this legitimate message would be silently dropped.
    state.outbox.set('msg-1' as BusMessageId, newRecord('msg-1'))
    runDispatcher(state, 'none')
    expect(state.effects).toEqual(['msg-1'])
  })
})
