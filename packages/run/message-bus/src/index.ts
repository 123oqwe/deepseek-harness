/**
 * Durable inbox/outbox message bus (Epic P4-06).
 *
 * Re-exports both halves of the effective-once handoff so a consumer imports
 * one package rather than reaching into file paths: the outbox's record states
 * and dispatch decisions, and the inbox's deduplication and tenant refusal.
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
export type { IncomingMessage, IntakeDecision } from './inbox.ts'
