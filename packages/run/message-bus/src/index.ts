/**
 * Durable inbox/outbox message bus (Epic P4-06).
 *
 * Re-exports both halves of the effective-once handoff so a consumer imports
 * one package rather than reaching into file paths: the outbox's record states
 * and dispatch decisions, and the inbox's deduplication and tenant refusal.
 *
 * Also owns the one place those decisions meet durable storage:
 * {@link commitWithOutbox} is how must[0]'s "write the domain event and the
 * outbox record in one transaction" becomes a real operation rather than a
 * convention callers are trusted to follow.
 *
 * @module @deepseek-ai/dsh-message-bus
 */

export {
  admitEnqueue,
  applyReceipt,
  canTransition,
  decideDelivery,
  IllegalOutboxTransitionError,
  orderForDispatch,
} from './outbox.ts'
export type {
  BusMessageId,
  DeliveryDecision,
  DeliveryReceipt,
  MessageEpoch,
  OutboxRecord,
  OutboxState,
  TenantId,
} from './outbox.ts'
export { classifyIntake, dedupKey } from './inbox.ts'
export { dispatchOnce } from './dispatcher.ts'
export type { DispatchDeps, DispatchReport, SendOutcome } from './dispatcher.ts'
export type { IncomingMessage, IntakeDecision } from './inbox.ts'

/**
 * The durable sink a commit writes through.
 *
 * Narrowed to the one method this package needs rather than accepting a whole
 * write controller: the guarantee being relied on is "these entries reach one
 * batch", and a wider parameter would let a caller believe any other method on
 * it carried the same promise.
 */
export interface AtomicBatchSink<TEntry> {
  /** Append several entries as one indivisible group. */
  enqueueAll(entries: readonly TEntry[]): void
}

/**
 * Commit a domain event together with the outbox records it produced.
 *
 * The single `enqueueAll` call is the whole mechanism, and calling it once is
 * the point: handing the event and its records to the sink separately lets a
 * durable write begin between them, which leaves a committed event whose
 * outgoing message no record explains. Replay cannot repair a message it
 * cannot find.
 *
 * **This guarantees one batch, which is weaker than one transaction, and the
 * gap is real rather than theoretical.** Entering one batch removes the
 * failure above — the two can no longer straddle a write that begins between
 * them. It does not make them commit atomically under a crash: the JSONL
 * backend writes a batch as one buffer but recovery truncates to the last
 * COMPLETE record (`truncateTo: committedBytes`), so a tear inside the batch
 * can keep the earlier lines and drop the later ones. Only the write-ERROR
 * path is atomic, by rolling the file back to its pre-batch size.
 *
 * Ordering the records before the event would turn the surviving failure into
 * the recoverable direction, but the batch is written in seq order and
 * reordering it breaks the contiguity the log requires. Closing that path
 * needs backend atomicity or a change to seq assignment, both wider than this
 * operation — recorded as BLOCKED-089 rather than guessed at here.
 *
 * Refuses an empty record list. A caller that has nothing to send should
 * append its event directly; accepting the empty case here would make
 * "committed with an outbox" and "committed alone" indistinguishable at the
 * call site, and the distinction is exactly what an auditor reads.
 * @param sink - the durable batch sink, typically a session write controller.
 * @param event - the domain event being committed.
 * @param records - the outbox entries derived from it; must not be empty.
 * @throws {RangeError} when `records` is empty.
 */
export function commitWithOutbox<TEntry>(
  sink: AtomicBatchSink<TEntry>,
  event: TEntry,
  records: readonly TEntry[],
): void {
  if (records.length === 0) {
    throw new RangeError('commitWithOutbox requires at least one outbox record')
  }
  sink.enqueueAll([event, ...records])
}
