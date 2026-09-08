/**
 * Durable inbox/outbox message bus (Epic P4-06).
 *
 * Re-exports both halves of the effective-once handoff so a consumer imports
 * one package rather than reaching into file paths: the outbox's record states
 * and dispatch decisions, and the inbox's deduplication and tenant refusal.
 *
 * must[0]'s "write the domain event and the outbox record in one transaction"
 * is `commitIntake` in `./bus-store.ts`, which does it inside one
 * `BEGIN IMMEDIATE`. A second entry point, `commitWithOutbox`, offered the
 * same promise over an `AtomicBatchSink` that nothing implemented, and could
 * only ever guarantee one BATCH rather than one transaction; it was deleted
 * with that interface (§12.35), because two commit paths for one clause is the
 * arrangement where the weaker one gets used by accident.
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
export { decideMailboxArrival, decideMailboxDelivery, mailboxDeliveryKey } from './mailbox-delivery.ts'
export type {
  MailboxDeliveryDecision,
  MailboxMessage,
  MailboxMessageId,
  ParticipantId,
  SenderEpoch,
} from './mailbox-delivery.ts'
export type { DispatchDeps, DispatchReport, SendOutcome } from './dispatcher.ts'
export type { IncomingMessage, IntakeDecision } from './inbox.ts'
export { default } from './plugin.ts'
export type { Config } from './plugin.ts'
export { commitIntake, openBusStore, recoverStaleClaims } from './bus-store.ts'
export type { BusMessage, BusStore, InboxRow, InboxState, IntakeCommit, OutboxRow, RecoveryWindow, StoredOutboxRow } from './bus-store.ts'
