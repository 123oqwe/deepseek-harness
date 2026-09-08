/**
 * A child's settlement, committed to the durable bus before anyone tries to
 * deliver it (Epic P4-06 must[0], must[1], acceptance[1]; §12.35-2(c)).
 *
 * **The send side had no producer.** P4-06's outbox decisions — enqueue
 * admission, dispatch ordering, the retry budget, dead-lettering — ran over
 * records nothing created: `dispatchOnce`'s only caller in the repository was
 * an experimental package that does not ship. Meanwhile the one real handoff
 * between agents, a child telling its parent how it ended, was delivered by
 * hand: if the parent was gone, or tearing down, or the delivery threw, the
 * notice was logged and dropped.
 *
 * So the settlement is committed FIRST and delivered second. A row that cannot
 * be delivered now stays `pending` and is delivered when the parent next
 * starts, which is the difference between a message bus and a function call.
 *
 * **The key is the same triple the inbox deduplicates on.** `source` is the
 * settlement kind, `id` is the child session, and `epoch` is the child's lease
 * epoch — exactly what `arrivalKey` derives on the receiving side. Two
 * different keys for one message would let the bus consider a redelivery new
 * while the inbox refused it, or the reverse.
 *
 * @module @deepseek-ai/dsh-subagent/settlement-outbox
 */

import { applyReceipt, decideDelivery } from '@deepseek-ai/dsh-message-bus'
import type MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import type { DeliveryReceipt, OutboxRecord, StoredOutboxRow } from '@deepseek-ai/dsh-message-bus'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** The settlement source name, shared with the inbox's own key derivation. */
const SETTLEMENT_SOURCE = 'subagent-settled'

/**
 * A settlement waiting to reach its parent, as the drain hands it back.
 */
export interface PendingSettlement {
  /** The row's delivery record, for persisting the outcome. */
  readonly record: OutboxRecord
  /** The child whose settlement this is. */
  readonly childId: SessionId
  /** The parent session it is addressed to. */
  readonly parentSessionId: SessionId
  /** The message content, as the sender committed it. */
  readonly payload: unknown
}

/**
 * Commit one settlement as a domain event plus the outbox row that owes it to
 * the parent, in a single transaction.
 *
 * Committed before any delivery attempt, which is the whole point: a notice
 * that exists only in a live parent's inbox is lost when that parent is gone,
 * and the cases that most need it — a token ceiling, a model failure, a
 * cancellation, a teardown — are exactly the ones where nothing is listening.
 * @param bus - the mounted durable bus.
 * @param settlement - the child, its parent, its epoch, and what to deliver.
 * @returns whether the commit stored a new row; `false` when this settlement was already committed.
 */
export function commitSettlement(
  bus: MessageBusPlugin,
  settlement: {
    readonly childId: SessionId
    readonly parentSessionId: SessionId
    readonly epoch: number
    readonly payload: unknown
    readonly tenant: string
    readonly deadlineMs: number
  },
): boolean {
  const { childId, parentSessionId, epoch } = settlement
  // Already consumed means the parent ran this settlement in an earlier
  // process; committing again would owe a second delivery of one event.
  if (bus.inboxRow(SETTLEMENT_SOURCE, childId, epoch)?.state === 'consumed') return false
  bus.commitIntake({
    message: {
      id: childId,
      epoch,
      source: SETTLEMENT_SOURCE,
      type: 'subagent/end',
      time: new Date().toISOString(),
      subject: parentSessionId,
      data: settlement.payload,
    },
    claimedByTurn: 0,
    outbox: [{
      target: parentSessionId,
      payload: settlement.payload,
      tenant: settlement.tenant as never,
      // One priority for every settlement: the bus orders by arrival within a
      // priority, and a settlement is not more urgent than another settlement.
      priority: 0,
      deadlineMs: settlement.deadlineMs,
    }],
  })
  return true
}

/**
 * Every committed settlement still owed to one parent.
 *
 * `pending` only. A `sent` row was handed to a parent that has not
 * acknowledged, and redelivering it here would produce the second effect the
 * inbox's dedup exists to refuse; recovering those is a reconciler's job, not
 * a drain's.
 * @param bus - the mounted durable bus.
 * @param parentSessionId - the parent whose owed settlements are wanted.
 * @returns the pending settlements, in commit order.
 */
export function pendingSettlementsFor(bus: MessageBusPlugin, parentSessionId: SessionId): PendingSettlement[] {
  return bus.outboxRows()
    .filter((row: StoredOutboxRow) => row.target === parentSessionId && row.record.state === 'pending')
    .map((row: StoredOutboxRow) => ({
      record: row.record,
      childId: row.record.id as unknown as SessionId,
      parentSessionId,
      payload: row.payload,
    }))
}

/**
 * Deliver every settlement owed to one parent, through the caller's own
 * insertion rules (§12.39).
 *
 * **Idempotent by construction, because three triggers call it.** A commit
 * signals the target's driver, a parent drains on start, and a pre-step drains
 * as a fallback; any of them can run when another already has. The dispatch
 * decision skips a record that is already `acked`, and the receiving inbox
 * refuses a repeated `(source, id, epoch)` — so the second and third drains of
 * one settlement produce no second effect even if delivery itself is retried.
 *
 * A delivery the caller declines (no live parent, a tearing-down lineage) is
 * left `pending` rather than counted as an attempt: the message is still owed,
 * and spending its retry budget on a moment when nobody could have received it
 * would dead-letter a settlement that was never actually tried.
 * @param bus - the mounted durable bus.
 * @param parentSessionId - the parent to deliver to.
 * @param nowMs - the instant deadlines are judged against, read once per drain.
 * @param maxAttempts - the retry budget before a settlement is dead-lettered.
 * @param deliver - performs one delivery; `false` means nobody could receive it now.
 * @returns how many settlements this drain delivered.
 */
export function drainSettlements(
  bus: MessageBusPlugin,
  parentSessionId: SessionId,
  nowMs: number,
  maxAttempts: number,
  deliver: (settlement: PendingSettlement) => boolean,
): number {
  let delivered = 0
  for (const settlement of pendingSettlementsFor(bus, parentSessionId)) {
    const decision = decideDelivery(settlement.record, nowMs, maxAttempts)
    if (decision.action === 'skip') continue
    if (decision.action === 'dead-letter') {
      bus.persistOutbox({ ...settlement.record, state: 'dead-letter' })
      continue
    }
    if (!deliver(settlement)) continue
    const receipt: DeliveryReceipt = {
      messageId: settlement.record.id,
      epoch: settlement.record.epoch,
      consumer: parentSessionId,
    }
    bus.persistOutbox(applyReceipt({ ...settlement.record, state: 'sent', attempts: decision.attempt }, receipt))
    delivered++
  }
  return delivered
}
