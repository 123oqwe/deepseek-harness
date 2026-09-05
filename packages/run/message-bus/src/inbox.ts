/**
 * Consumer-side deduplication and tenant refusal (Epic P4-06).
 *
 * The outbox guarantees a message is never lost; it cannot guarantee a message
 * arrives once, because the crash window between sending and recording the ack
 * is real and no protocol closes it. This module is the other half: given
 * repeated delivery, it decides which arrivals produce a business effect. That
 * pairing is what "effective-once" means here, and neither side delivers it
 * alone.
 *
 * @module @deepseek-ai/dsh-message-bus/inbox
 */

import type { BusMessageId, MessageEpoch, TenantId } from './outbox.ts'

/** One arriving message, as the consumer sees it. */
export interface IncomingMessage {
  readonly id: BusMessageId
  readonly epoch: MessageEpoch
  readonly tenant: TenantId
}

/**
 * The deduplication key for one message.
 *
 * Length-prefixes the id so a message id containing the separator cannot
 * collide with a different id/epoch pair -- `('a:1', 2)` and `('a', '1:2')`
 * would otherwise produce the same key.
 * @param message - the message to key.
 * @returns a string key unique to this `(id, epoch)` pair.
 */
export function dedupKey(message: Pick<IncomingMessage, 'id' | 'epoch'>): string {
  return `${message.id.length}:${message.id}:${message.epoch}`
}

/** What the consumer should do with an arriving message. */
export type IntakeDecision =
  /** First arrival: the caller runs the business effect and then records the key. */
  | { readonly action: 'accept'; readonly key: string }
  /** Seen before: the effect already happened, so this arrival is dropped. */
  | { readonly action: 'drop'; readonly reason: 'duplicate'; readonly key: string }
  /** Belongs to another tenant: refused, and deliberately NOT recorded as seen. */
  | { readonly action: 'refuse'; readonly reason: 'foreign-tenant' }

/**
 * Classify one arriving message against what this consumer has already seen.
 *
 * The tenant check runs BEFORE the duplicate check, and the order is
 * load-bearing rather than stylistic. Deciding duplication first would consult
 * -- and, at the caller, extend -- this consumer's seen-set using a key derived
 * from another tenant's message, which both leaks whether that tenant sent a
 * given id and lets a foreign message suppress a later legitimate one that
 * happens to share its key. A refused message must leave no trace in the
 * consumer's state, which is why `refuse` carries no key to record.
 * @param message - the arriving message.
 * @param seen - keys of messages this consumer has already applied.
 * @param consumerTenant - the tenant this consumer is permitted to act for.
 * @returns the decision; only `accept` authorizes a business effect.
 */
export function classifyIntake(
  message: IncomingMessage,
  seen: ReadonlySet<string>,
  consumerTenant: TenantId,
): IntakeDecision {
  if (message.tenant !== consumerTenant) return { action: 'refuse', reason: 'foreign-tenant' }
  const key = dedupKey(message)
  if (seen.has(key)) return { action: 'drop', reason: 'duplicate', key }
  return { action: 'accept', key }
}
