/**
 * Outbox record states and the pure decisions that move them (Epic P4-06).
 *
 * The outbox exists because a domain event and its outgoing message must
 * become durable together or not at all. A dispatcher that sent first and
 * recorded afterwards would produce a message no record explains after a
 * crash between the two; one that recorded first and sent afterwards produces
 * a record with no message, which is recoverable by replay. This module owns
 * the second arrangement's state set and the decisions over it, and nothing
 * here performs I/O -- a decision that cannot be taken without a clock, a
 * socket, or a transaction is not a decision this module makes.
 *
 * `effective-once` rather than `exactly-once` throughout: the transport may
 * deliver a message any number of times, and what the epic's acceptance[0]
 * requires is that the business effect happen once. Deduplication at the
 * consumer is what makes repeated delivery harmless, so the two halves are
 * load-bearing together and neither is sufficient alone.
 *
 * @module @deepseek-ai/dsh-message-bus/outbox
 */

import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'

/** Identifies one logical message for the life of the program. */
export type BusMessageId = Branded<'BusMessageId'>

/**
 * The producer generation that emitted a message.
 *
 * A message id alone cannot separate a replayed message from a genuinely new
 * one after a producer restarts and reuses a counter. The epoch advances once
 * per producer incarnation, so `(id, epoch)` stays unique across restarts
 * where the id alone does not.
 */
export type MessageEpoch = BrandedNumber<'MessageEpoch'>

/** Identifies the tenant a message belongs to; never crosses between them. */
export type TenantId = Branded<'TenantId'>

/**
 * Where an outbox record sits in its lifecycle.
 *
 * `sent` means the dispatcher believes it handed the message to the transport,
 * which is strictly weaker than the consumer having seen it -- that is what
 * `acked` records, and the gap between them is exactly where a crash leaves
 * ambiguity that replay must resolve.
 */
export type OutboxState = 'pending' | 'sent' | 'acked' | 'dead-letter'

/** Transitions the outbox permits; anything absent here is a defect, not a variant. */
const LEGAL_TRANSITIONS: Readonly<Record<OutboxState, readonly OutboxState[]>> = {
  // A pending record may go straight to dead-letter: its deadline can expire
  // before any dispatcher ever picks it up.
  pending: ['sent', 'dead-letter'],
  // `sent` returns to `pending` on redelivery, which is the normal path after
  // a crash between send and ack rather than an error path.
  sent: ['acked', 'pending', 'dead-letter'],
  // Terminal. An acked message has produced its effect; re-opening it would
  // be the double-effect this epic exists to prevent.
  acked: [],
  // Terminal by policy, not by nature: a dead-lettered message is replayed by
  // creating a new record, so the audit trail keeps the failure.
  'dead-letter': [],
}

/** One durable outbox row, written in the same transaction as its domain event. */
export interface OutboxRecord {
  readonly id: BusMessageId
  readonly epoch: MessageEpoch
  readonly tenant: TenantId
  readonly state: OutboxState
  /** Higher dispatches first; equal priorities fall back to deadline. */
  readonly priority: number
  /** Epoch milliseconds after which the message is worthless to send. */
  readonly deadlineMs: number
  /** How many delivery attempts have been made. */
  readonly attempts: number
  /** Set once the consumer acknowledges; the presence of this is what makes an ack idempotent. */
  readonly receipt: DeliveryReceipt | null
}

/**
 * A consumer's acknowledgement that it has taken responsibility for a message.
 *
 * Carries the consumer's identity so a receipt from an unexpected consumer is
 * distinguishable from a replayed one; the two look identical if only the
 * message id is recorded.
 */
export interface DeliveryReceipt {
  readonly messageId: BusMessageId
  readonly epoch: MessageEpoch
  readonly consumer: string
}

/** Whether `from -> to` is a transition the outbox permits. */
export function canTransition(from: OutboxState, to: OutboxState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to)
}

/** Raised when a caller attempts a transition the outbox does not permit. */
export class IllegalOutboxTransitionError extends Error {
  constructor(
    readonly from: OutboxState,
    readonly to: OutboxState,
    readonly id: BusMessageId,
  ) {
    super(`outbox message ${id} cannot move from ${from} to ${to}`)
    this.name = 'IllegalOutboxTransitionError'
  }
}

/**
 * Apply a delivery receipt, idempotently.
 *
 * Applying the same receipt twice returns a record equal to the first
 * application rather than acking twice or raising. This is the property the
 * whole epic rests on: the dispatcher cannot know whether a receipt it is
 * replaying after a crash was already applied, so the operation must not care.
 *
 * A receipt whose `(id, epoch)` does not match the record is rejected -- it
 * belongs to a different message, and applying it would ack something no
 * consumer ever received.
 * @param record - the record being acknowledged.
 * @param receipt - the consumer's acknowledgement.
 * @returns the acked record, or `record` unchanged when this receipt was already applied.
 * @throws {IllegalOutboxTransitionError} when the record is dead-lettered or the receipt names another message.
 */
export function applyReceipt(record: OutboxRecord, receipt: DeliveryReceipt): OutboxRecord {
  if (receipt.messageId !== record.id || receipt.epoch !== record.epoch) {
    throw new IllegalOutboxTransitionError(record.state, 'acked', record.id)
  }
  if (record.state === 'acked') {
    // Already acked. Idempotent by returning the existing record rather than
    // rebuilding it, so a replayed receipt cannot overwrite the consumer that
    // actually took responsibility with a later duplicate.
    return record
  }
  if (!canTransition(record.state, 'acked')) {
    throw new IllegalOutboxTransitionError(record.state, 'acked', record.id)
  }
  return { ...record, state: 'acked', receipt }
}

/** What a dispatcher should do with a record at a given moment. */
export type DeliveryDecision =
  | { readonly action: 'deliver'; readonly attempt: number }
  | { readonly action: 'skip'; readonly reason: 'already-acked' | 'dead-lettered' }
  | { readonly action: 'dead-letter'; readonly reason: 'deadline-expired' | 'attempts-exhausted' }

/**
 * Decide what to do with one record, given the clock and the retry budget.
 *
 * The deadline is checked before the attempt budget so an expired message
 * reports `deadline-expired` even when it also happens to be out of attempts.
 * The two produce different operator responses -- a deadline says the message
 * stopped being worth sending, attempts say delivery kept failing -- and
 * reporting whichever was checked first would make the alert depend on check
 * order rather than on what happened.
 * @param record - the record under consideration.
 * @param nowMs - current epoch milliseconds, passed in because this module owns no clock.
 * @param maxAttempts - the retry budget before a record is dead-lettered.
 * @returns the decision, which the caller is responsible for carrying out.
 */
export function decideDelivery(record: OutboxRecord, nowMs: number, maxAttempts: number): DeliveryDecision {
  if (record.state === 'acked') return { action: 'skip', reason: 'already-acked' }
  if (record.state === 'dead-letter') return { action: 'skip', reason: 'dead-lettered' }
  if (nowMs > record.deadlineMs) return { action: 'dead-letter', reason: 'deadline-expired' }
  if (record.attempts >= maxAttempts) return { action: 'dead-letter', reason: 'attempts-exhausted' }
  return { action: 'deliver', attempt: record.attempts + 1 }
}

/**
 * Order pending records for dispatch: higher priority first, then earlier
 * deadline, then id.
 *
 * The id tiebreak is what makes the order total. Without it two records with
 * equal priority and deadline could dispatch in either order, and a crash
 * replay could produce a different sequence than the original run -- which is
 * indistinguishable from a bug when reading two traces side by side.
 * @param records - the records to order; not mutated.
 * @returns a new array in dispatch order.
 */
export function orderForDispatch(records: readonly OutboxRecord[]): readonly OutboxRecord[] {
  return [...records].sort((left, right) => {
    if (left.priority !== right.priority) return right.priority - left.priority
    if (left.deadlineMs !== right.deadlineMs) return left.deadlineMs - right.deadlineMs
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

/**
 * Whether the producer may enqueue another message (must[3] backpressure).
 *
 * Refuses at the limit rather than above it, so `limit` names the depth the
 * queue is allowed to reach and not the first depth it is allowed to exceed.
 * @param pendingDepth - how many records are currently unacknowledged.
 * @param limit - the configured maximum depth.
 * @returns whether an enqueue is admitted.
 */
export function admitEnqueue(pendingDepth: number, limit: number): boolean {
  return pendingDepth < limit
}
