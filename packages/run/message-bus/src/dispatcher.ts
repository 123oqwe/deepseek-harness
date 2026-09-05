/**
 * The dispatch loop that drives outbox records to a transport (Epic P4-06).
 *
 * The Contract stage's decisions are pure and answer one record at a time.
 * This is the consumer that runs them in order and applies their outcomes,
 * which is where must[1] — "the dispatcher marks with an idempotent receipt
 * after sending" — becomes a real operation rather than a property of a
 * function nobody calls.
 *
 * The loop owns no clock and no transport. Both arrive as parameters, because
 * a dispatcher that read the clock itself could not be driven through a
 * deadline, and one that owned its transport could not be tested against a
 * failing send without a live socket.
 *
 * @module @deepseek-ai/dsh-message-bus/dispatcher
 */

import {
  applyReceipt,
  decideDelivery,
  orderForDispatch,
  type BusMessageId,
  type DeliveryReceipt,
  type OutboxRecord,
} from './outbox.ts'

/** How one send attempt ended, as the transport reports it. */
export type SendOutcome =
  /** The consumer took responsibility and returned its receipt. */
  | { readonly delivered: true; readonly receipt: DeliveryReceipt }
  /** The send failed; the record stays claimable and its attempt is spent. */
  | { readonly delivered: false }

/** What one dispatch pass did, per record. */
export interface DispatchReport {
  readonly acked: readonly BusMessageId[]
  readonly retried: readonly BusMessageId[]
  readonly deadLettered: readonly { readonly id: BusMessageId; readonly reason: string }[]
  readonly skipped: readonly BusMessageId[]
}

/** The transport and clock one pass runs against. */
export interface DispatchDeps {
  /** Hand one record to the transport. */
  readonly send: (record: OutboxRecord) => Promise<SendOutcome>
  /** Current epoch milliseconds, read ONCE per pass. */
  readonly now: () => number
  /** Retry budget before a record is dead-lettered. */
  readonly maxAttempts: number
  /** Persist a record's new state; called at most once per record per pass. */
  readonly persist: (record: OutboxRecord) => void
  /**
   * Report a record entering dead-letter, for operator alerting (validation[2]).
   *
   * Separate from the returned {@link DispatchReport} because the report tells
   * the CALLER what happened and an alert must reach someone who is not
   * watching the return value. A dead-letter that only appeared in a return
   * value would be silent to exactly the person who needs it: a message has
   * stopped being retried, and nothing else in the system will mention it
   * again.
   *
   * Called after the record is persisted, so an alert never describes a state
   * that failed to become durable.
   */
  readonly onDeadLetter?: (record: OutboxRecord, reason: string) => void
}

/**
 * Run one dispatch pass over the given records.
 *
 * The clock is read ONCE for the whole pass rather than per record. A pass
 * that re-read it could dead-letter a later record for a deadline that expired
 * while earlier records were being sent, which makes a record's fate depend on
 * its position in the batch — the same input yielding different outcomes
 * depending on how slow the transport was that day.
 *
 * A send failure spends an attempt and leaves the record claimable, rather
 * than dead-lettering it immediately: the attempt budget is what distinguishes
 * a transient failure from a permanent one, and consuming the budget is how
 * this pass reports the difference to the next one.
 * @param records - the records to consider; not mutated.
 * @param deps - transport, clock, retry budget, and durable sink.
 * @returns what happened to each record, for the caller's telemetry.
 */
export async function dispatchOnce(
  records: readonly OutboxRecord[],
  deps: DispatchDeps,
): Promise<DispatchReport> {
  const nowMs = deps.now()
  const acked: BusMessageId[] = []
  const retried: BusMessageId[] = []
  const deadLettered: { id: BusMessageId; reason: string }[] = []
  const skipped: BusMessageId[] = []

  for (const record of orderForDispatch(records)) {
    const decision = decideDelivery(record, nowMs, deps.maxAttempts)
    if (decision.action === 'skip') {
      skipped.push(record.id)
      continue
    }
    if (decision.action === 'dead-letter') {
      const buried: OutboxRecord = { ...record, state: 'dead-letter' }
      deps.persist(buried)
      deps.onDeadLetter?.(buried, decision.reason)
      deadLettered.push({ id: record.id, reason: decision.reason })
      continue
    }

    // The attempt is spent BEFORE the send, and persisted with the record as
    // `sent`. A dispatcher that incremented afterwards would lose the attempt
    // whenever the process died mid-send, and a record that never spends an
    // attempt can be retried forever — the attempt budget would bound nothing.
    const attempted: OutboxRecord = { ...record, state: 'sent', attempts: decision.attempt }
    deps.persist(attempted)

    const outcome = await deps.send(attempted)
    if (!outcome.delivered) {
      // Back to claimable. The spent attempt stays spent, which is the whole
      // record of this failure.
      deps.persist({ ...attempted, state: 'pending' })
      retried.push(record.id)
      continue
    }

    // Idempotent by construction: applying a receipt that was already applied
    // returns the same record, so a replayed outcome after a crash cannot ack
    // twice or overwrite the consumer that actually took responsibility.
    deps.persist(applyReceipt(attempted, outcome.receipt))
    acked.push(record.id)
  }

  return { acked, retried, deadLettered, skipped }
}
