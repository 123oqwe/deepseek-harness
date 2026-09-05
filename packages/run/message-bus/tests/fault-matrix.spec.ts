/**
 * P4-06 validation[0]: a systematic fault matrix over the outbox boundaries.
 *
 * "Systematic" is the requirement, so the boundaries are enumerated as data
 * and every row is asserted by one driver. A hand-written case per boundary
 * would let a boundary be omitted without anything noticing — the count below
 * is checked against the clause's floor for exactly that reason.
 *
 * Each row names the fault, the state it is injected into, and the observable
 * outcome. Rows assert OUTCOMES, never that a function was called: a matrix of
 * call assertions would pass against an implementation that did the wrong
 * thing correctly.
 */

import { describe, expect, it, vi } from 'vitest'
import { dispatchOnce } from '../src/dispatcher.ts'
import { classifyIntake, dedupKey } from '../src/inbox.ts'
import {
  admitEnqueue,
  applyReceipt,
  canTransition,
  decideDelivery,
  IllegalOutboxTransitionError,
  type BusMessageId,
  type DeliveryReceipt,
  type MessageEpoch,
  type OutboxRecord,
  type TenantId,
} from '../src/outbox.ts'

const TENANT = 'tenant-a' as TenantId

function record(id: string, overrides: Partial<OutboxRecord> = {}): OutboxRecord {
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

/** One enumerated fault boundary and the outcome it must produce. */
interface FaultRow {
  readonly boundary: string
  readonly run: () => void
}

const MATRIX: readonly FaultRow[] = [
  {
    boundary: '01 deadline expired before any attempt',
    run: () =>{  expect(decideDelivery(record('m'), 10_001, 3))
      .toEqual({ action: 'dead-letter', reason: 'deadline-expired' }) },
  },
  {
    boundary: '02 attempt budget exhausted',
    run: () =>{  expect(decideDelivery(record('m', { attempts: 3 }), 0, 3))
      .toEqual({ action: 'dead-letter', reason: 'attempts-exhausted' }) },
  },
  {
    boundary: '03 expired AND exhausted reports the expiry, pinning check order',
    run: () =>{  expect(decideDelivery(record('m', { attempts: 3, deadlineMs: 5 }), 6, 3))
      .toEqual({ action: 'dead-letter', reason: 'deadline-expired' }) },
  },
  {
    boundary: '04 exactly at the deadline is still deliverable, not expired',
    run: () =>{  expect(decideDelivery(record('m', { deadlineMs: 100 }), 100, 3).action).toBe('deliver') },
  },
  {
    boundary: '05 exactly at the attempt budget is exhausted, not deliverable',
    run: () =>{  expect(decideDelivery(record('m', { attempts: 3 }), 0, 3).action).toBe('dead-letter') },
  },
  {
    boundary: '06 an acked record is skipped, never re-sent',
    run: () =>{  expect(decideDelivery(record('m', { state: 'acked' }), 0, 3))
      .toEqual({ action: 'skip', reason: 'already-acked' }) },
  },
  {
    boundary: '07 a dead-lettered record is skipped, never resurrected',
    run: () =>{  expect(decideDelivery(record('m', { state: 'dead-letter' }), 0, 3))
      .toEqual({ action: 'skip', reason: 'dead-lettered' }) },
  },
  {
    boundary: '08 acked is terminal: no transition out of it is legal',
    run: () => {
      for (const to of ['pending', 'sent', 'dead-letter'] as const) {
        expect(canTransition('acked', to), `acked -> ${to}`).toBe(false)
      }
    },
  },
  {
    boundary: '09 dead-letter is terminal: no transition out of it is legal',
    run: () => {
      for (const to of ['pending', 'sent', 'acked'] as const) {
        expect(canTransition('dead-letter', to), `dead-letter -> ${to}`).toBe(false)
      }
    },
  },
  {
    boundary: '10 a receipt naming another message id is refused',
    run: () => {
      // `sent`, so acking WOULD be a legal transition. From `pending` the
      // transition table throws on its own and the assertion would pass
      // without the identity check ever running.
      const target = record('m', { state: 'sent' })
      const foreign: DeliveryReceipt = { messageId: 'other' as BusMessageId, epoch: target.epoch, consumer: 'c' }
      expect(() => applyReceipt(target, foreign)).toThrow(IllegalOutboxTransitionError)
    },
  },
  {
    boundary: '11 a receipt naming another epoch is refused',
    run: () => {
      const target = record('m', { state: 'sent' })
      const stale: DeliveryReceipt = { messageId: target.id, epoch: 0 as MessageEpoch, consumer: 'c' }
      expect(() => applyReceipt(target, stale)).toThrow(IllegalOutboxTransitionError)
    },
  },
  {
    boundary: '12 acking a dead-lettered record is refused',
    run: () => {
      const buried = record('m', { state: 'dead-letter' })
      expect(() => applyReceipt(buried, { messageId: buried.id, epoch: buried.epoch, consumer: 'c' }))
        .toThrow(IllegalOutboxTransitionError)
    },
  },
  {
    boundary: '13 a replayed receipt from another consumer keeps the first consumer',
    run: () => {
      const sent = record('m', { state: 'sent' })
      const acked = applyReceipt(sent, { messageId: sent.id, epoch: sent.epoch, consumer: 'first' })
      expect(applyReceipt(acked, { messageId: sent.id, epoch: sent.epoch, consumer: 'second' }))
        .toBe(acked)
    },
  },
  {
    boundary: '14 a duplicate arrival is dropped without a second effect',
    run: () => {
      const message = { id: 'm' as BusMessageId, epoch: 1 as MessageEpoch, tenant: TENANT }
      expect(classifyIntake(message, new Set([dedupKey(message)]), TENANT).action).toBe('drop')
    },
  },
  {
    boundary: '15 a foreign-tenant arrival is refused and records nothing',
    run: () => {
      const seen = new Set<string>()
      const message = { id: 'm' as BusMessageId, epoch: 1 as MessageEpoch, tenant: 'other' as TenantId }
      expect(classifyIntake(message, seen, TENANT)).toEqual({ action: 'refuse', reason: 'foreign-tenant' })
      expect(seen.size).toBe(0)
    },
  },
  {
    boundary: '16 a foreign-tenant arrival is refused even when its key is already seen',
    run: () => {
      const message = { id: 'm' as BusMessageId, epoch: 1 as MessageEpoch, tenant: 'other' as TenantId }
      const seen = new Set([dedupKey(message)])
      expect(classifyIntake(message, seen, TENANT).action).toBe('refuse')
    },
  },
  {
    boundary: '17 the same id at a different epoch is NOT a duplicate',
    run: () => {
      const first = { id: 'm' as BusMessageId, epoch: 1 as MessageEpoch, tenant: TENANT }
      const next = { ...first, epoch: 2 as MessageEpoch }
      expect(classifyIntake(next, new Set([dedupKey(first)]), TENANT).action).toBe('accept')
    },
  },
  {
    boundary: '18 backpressure refuses AT the limit, not above it',
    run: () => {
      expect(admitEnqueue(9, 10)).toBe(true)
      expect(admitEnqueue(10, 10)).toBe(false)
    },
  },
]

describe('P4-06 validation[0]: systematic fault matrix', () => {
  it('enumerates at least the twelve boundaries the clause requires', () => {
    // The floor is asserted so a boundary cannot be deleted silently. The
    // matrix is data, so a deletion would otherwise just shrink the run count
    // and every remaining row would still pass.
    expect(MATRIX.length).toBeGreaterThanOrEqual(12)
    expect(new Set(MATRIX.map(row => row.boundary)).size).toBe(MATRIX.length)
  })

  for (const row of MATRIX) {
    it(`fault boundary ${row.boundary}`, () => { row.run() })
  }
})

describe('P4-06 validation[2]: a dead-letter raises an alert, not only a return value', () => {
  it('reports the buried record and its reason to the alert channel', async () => {
    const onDeadLetter = vi.fn<(record: OutboxRecord, reason: string) => void>()
    const report = await dispatchOnce([record('m', { attempts: 5 })], {
      send: async () => ({ delivered: false }),
      now: () => 0,
      maxAttempts: 3,
      persist: () => {},
      onDeadLetter,
    })

    expect(report.deadLettered).toEqual([{ id: 'm', reason: 'attempts-exhausted' }])
    expect(onDeadLetter).toHaveBeenCalledTimes(1)
    expect(onDeadLetter.mock.calls[0]?.[0]).toMatchObject({ id: 'm', state: 'dead-letter' })
    expect(onDeadLetter.mock.calls[0]?.[1]).toBe('attempts-exhausted')
  })

  it('alerts only AFTER the dead-letter state is persisted', async () => {
    const order: string[] = []
    await dispatchOnce([record('m', { attempts: 5 })], {
      send: async () => ({ delivered: false }),
      now: () => 0,
      maxAttempts: 3,
      // An alert describing a state that failed to persist would send an
      // operator after a record the log does not show as dead.
      persist: entry => void order.push(`persist:${entry.state}`),
      onDeadLetter: () => void order.push('alert'),
    })

    expect(order).toEqual(['persist:dead-letter', 'alert'])
  })

  it('does not alert when a send merely fails and the record stays retryable', async () => {
    const onDeadLetter = vi.fn()
    await dispatchOnce([record('m')], {
      send: async () => ({ delivered: false }),
      now: () => 0,
      maxAttempts: 3,
      persist: () => {},
      onDeadLetter,
    })

    // Alerting on every transient failure would make the alert worthless
    // precisely when it matters.
    expect(onDeadLetter).not.toHaveBeenCalled()
  })
})
