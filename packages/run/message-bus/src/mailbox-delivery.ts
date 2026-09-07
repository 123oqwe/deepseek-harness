/**
 * The production call site for P4-06 must[2]: a real mailbox arrival, decided
 * against the durable consumed set.
 *
 * BLOCKED-136 measured why this file exists. `classifyIntake` had no
 * production caller at all, so "the classifier decides correctly" was provable
 * and "a real arrival was deduplicated" was not; and the seen-set both
 * consumers took was caller-supplied, with nothing durable behind it. The bus
 * store now holds one — the consumed rows — and the mailbox is the surface
 * where messages really arrive.
 *
 * **Why the join lives here and not in `dsh-mailbox`.** The store is
 * orchestration-runtime and the mailbox is a capability definition, so a
 * mailbox reaching for the store would be a definition depending on a runtime.
 * This package is already the runtime side, so importing the mailbox is a
 * downward edge and the direction stays honest.
 *
 * @module @deepseek-ai/dsh-message-bus/mailbox-delivery
 */

import { decideDelivery } from '@deepseek-ai/dsh-mailbox'
import type { DeliveryDecision, Message, ParticipantId } from '@deepseek-ai/dsh-mailbox'
import type { BusStore } from './bus-store.ts'

/**
 * Decide one arriving mailbox message against what this bus has consumed.
 *
 * The seen-set is read at decision time rather than passed in, which is the
 * whole point: a caller that assembles its own set can forget, and a set
 * assembled before a restart is empty after one. `consumedKeys()` reads the
 * rows a committed intake wrote.
 *
 * Returns the mailbox's own decision unchanged, including its refusal for a
 * message addressed elsewhere — that check runs first, inside `decideDelivery`,
 * and a message this recipient may not read never reaches the seen-set.
 * @param store - the bus store whose consumed rows are the durable seen-set.
 * @param message - the arriving message.
 * @param recipient - the participant reading its mailbox.
 * @returns the delivery decision; only `deliver` authorizes an effect.
 */
export function decideMailboxDelivery(store: BusStore, message: Message, recipient: ParticipantId): DeliveryDecision {
  return decideDelivery(message, recipient, store.consumedKeys())
}
