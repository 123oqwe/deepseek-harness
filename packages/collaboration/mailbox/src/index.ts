/**
 * The mailbox: at-most-once delivery of directed messages (Epic P5-11).
 *
 * A mailbox carries messages between agents that do not share a call stack.
 * Its one guarantee is deduplication: a message delivered twice produces one
 * effect, because a sender that cannot confirm delivery will resend, and a
 * transport that cannot confirm receipt will redeliver.
 *
 * This is the same problem P4-06's message bus solves for durable effects, and
 * the resemblance is deliberate rather than duplicated logic: dedup here keys
 * on `(id, epoch)` for exactly the reason recorded there — a message id alone
 * cannot separate a replayed message from a genuinely new one after a sender
 * restarts and reuses a counter.
 *
 * @module @deepseek-ai/dsh-mailbox
 */

import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'

/** Identifies one message for the life of the program. */
export type MessageId = Branded<'MessageId'>

/** The sender generation that emitted a message. */
export type SenderEpoch = BrandedNumber<'SenderEpoch'>

/** An addressable participant. */
export type ParticipantId = Branded<'ParticipantId'>

/** One directed message. */
export interface Message {
  readonly id: MessageId
  readonly epoch: SenderEpoch
  readonly from: ParticipantId
  readonly to: ParticipantId
  /** Structured payload; the mailbox does not interpret it. */
  readonly body: Record<string, unknown>
}

/** What a recipient should do with an arriving message. */
export type DeliveryDecision =
  | { readonly action: 'deliver'; readonly key: string }
  | { readonly action: 'drop'; readonly reason: 'duplicate'; readonly key: string }
  | { readonly action: 'refuse'; readonly reason: 'not-addressed-to-recipient' }

/**
 * The deduplication key for one message.
 *
 * Length-prefixes the id so an id containing the separator cannot collide with
 * a different id/epoch pair, exactly as `dsh-message-bus` does.
 * @param message - the message to key.
 * @returns a key unique to this id and epoch.
 */
export function deliveryKey(message: Pick<Message, 'id' | 'epoch'>): string {
  return `${message.id.length}:${message.id}:${message.epoch}`
}

/**
 * Decide whether an arriving message should be delivered.
 *
 * The ADDRESS is checked before the duplicate check, and the order is
 * load-bearing for the same reason the tenant check precedes deduplication in
 * `dsh-message-bus`: consulting the seen-set for a message addressed to
 * someone else would let a misdirected message suppress a later legitimate one
 * sharing its key, and would reveal whether that key had been seen here.
 * @param message - the arriving message.
 * @param recipient - the participant reading its mailbox.
 * @param seen - keys already delivered to this recipient.
 * @returns the decision; only `deliver` authorizes an effect.
 */
export function decideDelivery(
  message: Message,
  recipient: ParticipantId,
  seen: ReadonlySet<string>,
): DeliveryDecision {
  if (message.to !== recipient) return { action: 'refuse', reason: 'not-addressed-to-recipient' }
  const key = deliveryKey(message)
  if (seen.has(key)) return { action: 'drop', reason: 'duplicate', key }
  return { action: 'deliver', key }
}
