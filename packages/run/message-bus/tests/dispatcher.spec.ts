/**
 * P4-06 must[1], Usage stage: the dispatcher marks with an idempotent receipt
 * after sending.
 *
 * The Contract stage proved `applyReceipt` is idempotent in isolation. What is
 * checked here is that a real loop applies it, spends attempts in an order
 * that survives a crash, and reads its clock once — properties of the
 * sequence, not of any single decision.
 */

import { describe, expect, it, vi } from 'vitest'
import { dispatchOnce, type DispatchDeps, type SendOutcome } from '../src/dispatcher.ts'
import type { BusMessageId, DeliveryReceipt, MessageEpoch, OutboxRecord, TenantId } from '../src/outbox.ts'

function record(id: string, overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: id as BusMessageId,
    epoch: 1 as MessageEpoch,
    tenant: 'tenant-a' as TenantId,
    state: 'pending',
    priority: 0,
    deadlineMs: 10_000,
    attempts: 0,
    receipt: null,
    ...overrides,
  }
}

function receiptFor(record: OutboxRecord, consumer = 'consumer-1'): DeliveryReceipt {
  return { messageId: record.id, epoch: record.epoch, consumer }
}

/** Collects every persisted revision so write ORDER is observable. */
function harness(send: (record: OutboxRecord) => Promise<SendOutcome>, now = () => 0): {
  deps: DispatchDeps
  writes: OutboxRecord[]
} {
  const writes: OutboxRecord[] = []
  return { writes, deps: { send, now, maxAttempts: 3, persist: entry => void writes.push(entry) } }
}

describe('P4-06 must[1]: the dispatcher marks an idempotent receipt after sending', () => {
  it('spends the attempt and persists `sent` BEFORE handing the record to the transport', async () => {
    // The record handed to `send` says `sent` whichever order the dispatcher
    // uses, so reading it proves nothing. What separates the two orders is
    // what has reached the DURABLE store at the moment the send begins: a
    // dispatcher that persisted afterwards would lose the spent attempt
    // whenever the process died mid-send, and the record would look untried.
    let durableAtSendTime: string[] = []
    const writes: OutboxRecord[] = []
    const deps: DispatchDeps = {
      now: () => 0,
      maxAttempts: 3,
      persist: entry => void writes.push(entry),
      send: async (entry) => {
        durableAtSendTime = writes.map(written => `${written.state}:${written.attempts}`)
        return { delivered: true, receipt: receiptFor(entry) }
      },
    }
    await dispatchOnce([record('m1')], deps)

    expect(durableAtSendTime).toEqual(['sent:1'])
    expect(writes.map(entry => `${entry.state}:${entry.attempts}`)).toEqual(['sent:1', 'acked:1'])
  })

  it('applies the receipt, and applying the same outcome twice does not ack twice', async () => {
    const { deps, writes } = harness(async entry => ({ delivered: true, receipt: receiptFor(entry) }))
    const first = await dispatchOnce([record('m1')], deps)
    expect(first.acked).toEqual(['m1'])

    // Replay the pass against the record as it now stands: an acked record is
    // skipped, so the second run cannot produce a second ack.
    const acked = writes.at(-1) as OutboxRecord
    const second = await dispatchOnce([acked], deps)

    expect(second).toMatchObject({ acked: [], skipped: ['m1'] })
    expect(acked.receipt?.consumer).toBe('consumer-1')
  })

  it('returns a failed send to pending with its attempt spent, not dead-lettered', async () => {
    const { deps, writes } = harness(async () => ({ delivered: false }))
    const report = await dispatchOnce([record('m1')], deps)

    expect(report).toMatchObject({ retried: ['m1'], deadLettered: [] })
    // The spent attempt IS the record of this failure; without it the budget
    // would bound nothing and the record could retry forever.
    expect(writes.at(-1)).toMatchObject({ state: 'pending', attempts: 1 })
  })

  it('dead-letters once the attempt budget is exhausted, and says which reason', async () => {
    const { deps } = harness(async () => ({ delivered: false }))
    const report = await dispatchOnce([record('m1', { attempts: 3 })], deps)

    expect(report.deadLettered).toEqual([{ id: 'm1', reason: 'attempts-exhausted' }])
  })

  it('reads the clock ONCE, so a slow transport cannot expire a later record', async () => {
    // A clock that advances past the deadline on its second read. If the loop
    // re-read it per record, m2 would dead-letter purely because m1 was sent
    // first — the same input giving different outcomes on a slow day.
    const now = vi.fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValue(50_000)
    const { deps } = harness(async entry => ({ delivered: true, receipt: receiptFor(entry) }), now)
    const report = await dispatchOnce([record('m1'), record('m2')], deps)

    expect(report.acked).toEqual(['m1', 'm2'])
    expect(report.deadLettered).toEqual([])
    expect(now).toHaveBeenCalledTimes(1)
  })

  it('dispatches in priority order, so a starved low-priority record cannot jump ahead', async () => {
    const order: string[] = []
    const { deps } = harness(async (entry) => {
      order.push(entry.id)
      return { delivered: true, receipt: receiptFor(entry) }
    })
    await dispatchOnce([
      record('low', { priority: 0 }),
      record('high', { priority: 9 }),
      record('urgent', { priority: 9, deadlineMs: 5 }),
    ], deps)

    expect(order).toEqual(['urgent', 'high', 'low'])
  })
})
