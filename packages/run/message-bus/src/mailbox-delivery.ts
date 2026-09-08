/**
 * Mailbox arrival: a directed message, decided against the durable consumed
 * set (Epic P4-06 must[2], and Epic P5-11's mailbox clause).
 *
 * **One implementation, because there was only ever one rule.** A mailbox
 * carries messages between agents that do not share a call stack, and its one
 * guarantee is that a message delivered twice produces one effect — a sender
 * that cannot confirm delivery resends, and a transport that cannot confirm
 * receipt redelivers. That is the same problem this bus solves for durable
 * effects, and `@deepseek-ai/dsh-intake-dedup` is the rule both applied.
 * `@deepseek-ai/dsh-mailbox` held the remainder: a recipient-address check and
 * a set of type names. A package for that is a seam where none exists, and the
 * split had already produced one duplicated rule (BLOCKED-136), so the address
 * check moved here and the package was retired.
 *
 * BLOCKED-136 measured why the join belongs on this side. `classifyIntake` had
 * no production caller at all, so "the classifier decides correctly" was
 * provable and "a real arrival was deduplicated" was not; and the seen-set both
 * consumers took was caller-supplied, with nothing durable behind it. The bus
 * store holds one — the consumed rows — and a mailbox arrival is the surface
 * where messages really arrive.
 *
 * @module @deepseek-ai/dsh-message-bus/mailbox-delivery
 */

import { classifyDedup, dedupKey } from '@deepseek-ai/dsh-intake-dedup'
import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { BusStore } from './bus-store.ts'

/** Identifies one message for the life of the program. */
export type MailboxMessageId = Branded<'MailboxMessageId'>

/** The sender generation that emitted a message. */
export type SenderEpoch = BrandedNumber<'SenderEpoch'>

/** An addressable participant. */
export type ParticipantId = Branded<'ParticipantId'>

/**
 * One directed message.
 *
 * `Mailbox`-prefixed throughout, because this package also carries the OUTBOX's
 * `decideDelivery` and `DeliveryDecision` — a different decision about a
 * different record. When `@deepseek-ai/dsh-mailbox` was its own package the
 * bare names could not collide; inside one package they would, and two
 * `decideDelivery`s one import apart is exactly the confusion that made the
 * split look necessary in the first place.
 */
export interface MailboxMessage {
  readonly id: MailboxMessageId
  readonly epoch: SenderEpoch
  readonly from: ParticipantId
  readonly to: ParticipantId
  /** Structured payload; delivery does not interpret it. */
  readonly body: Record<string, unknown>
}

/** What a recipient should do with an arriving message. */
export type MailboxDeliveryDecision =
  | { readonly action: 'deliver'; readonly key: string }
  | { readonly action: 'drop'; readonly reason: 'duplicate'; readonly key: string }
  | { readonly action: 'refuse'; readonly reason: 'not-addressed-to-recipient' }

/**
 * The deduplication key for one message.
 *
 * The rule itself lives in `@deepseek-ai/dsh-intake-dedup` and this is its name
 * here. Until BLOCKED-136, the derivation was written out again in the mailbox
 * package with a comment saying it matched this one — a citation in prose where
 * an import belonged, which is how one rule came to have two implementations.
 * @param message - the message to key.
 * @returns a key unique to this sender, id and epoch.
 */
export function mailboxDeliveryKey(message: Pick<MailboxMessage, 'from' | 'id' | 'epoch'>): string {
  return dedupKey({ source: message.from, id: message.id, epoch: message.epoch })
}

/**
 * Decide whether an arriving message should be delivered, against a
 * caller-supplied seen-set.
 *
 * The ADDRESS is checked before the duplicate check, and the order is
 * load-bearing for the same reason the tenant check precedes deduplication in
 * this bus: consulting the seen-set for a message addressed to someone else
 * would let a misdirected message suppress a later legitimate one sharing its
 * key, and would reveal whether that key had been seen here.
 * @param message - the arriving message.
 * @param recipient - the participant reading its mailbox.
 * @param seen - keys already delivered to this recipient.
 * @returns the decision; only `deliver` authorizes an effect.
 */
export function decideMailboxArrival(
  message: MailboxMessage,
  recipient: ParticipantId,
  seen: ReadonlySet<string>,
): MailboxDeliveryDecision {
  if (message.to !== recipient) return { action: 'refuse', reason: 'not-addressed-to-recipient' }
  // `from` is the rule's `source`: a message id is unique only within its
  // sender, so keying without it lets one participant's message suppress
  // another's (BLOCKED-140).
  const decided = classifyDedup({ source: message.from, id: message.id, epoch: message.epoch }, seen)
  return decided.action === 'accept' ? { action: 'deliver', key: decided.key } : decided
}

/**
 * Decide one arriving mailbox message against what this bus has consumed.
 *
 * The seen-set is read at decision time rather than passed in, which is the
 * whole point: a caller that assembles its own set can forget, and a set
 * assembled before a restart is empty after one. `consumedKeys()` reads the
 * rows a committed intake wrote.
 *
 * Returns {@link decideMailboxArrival}'s decision unchanged, including its refusal
 * for a message addressed elsewhere — that check runs first, and a message this
 * recipient may not read never reaches the seen-set.
 * @param store - the bus store whose consumed rows are the durable seen-set.
 * @param message - the arriving message.
 * @param recipient - the participant reading its mailbox.
 * @returns the delivery decision; only `deliver` authorizes an effect.
 */
export function decideMailboxDelivery(store: BusStore, message: MailboxMessage, recipient: ParticipantId): MailboxDeliveryDecision {
  return decideMailboxArrival(message, recipient, store.consumedKeys())
}
