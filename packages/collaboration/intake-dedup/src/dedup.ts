/**
 * The (source, message id, epoch) deduplication rule (Epic P4-06 must[2]).
 *
 * At-least-once delivery is the transport's guarantee; effective-once is the
 * consumer's. The consumer half is this rule: derive a key from the message's
 * identity, and drop an arrival whose key has already been applied.
 *
 * Identity is the TRIPLE, not the id. A message id is unique only within its
 * sender, so `source` is what keeps two senders from colliding; and a sender
 * that restarts and reuses a counter emits a message whose id has been seen
 * before and whose effect has not happened, so `epoch` is what separates
 * "this message again" from "a new message that happens to look alike".
 *
 * @module @deepseek-ai/dsh-intake-dedup/dedup
 */

/**
 * A message this rule can key: who emitted it, its id, and the sender
 * generation.
 *
 * `source` is part of the identity because a message id is only unique WITHIN
 * a sender. CloudEvents says so — uniqueness is `source` + `id` — and this
 * package briefly ignored it: with a key of `(id, epoch)` alone, two senders
 * emitting `('evt-1', 1)` produced the same key and the second message was
 * dropped as a duplicate of the first (BLOCKED-140, measured).
 */
export interface DedupableMessage {
  /** The emitter's identity: a CloudEvents `source`, or a mailbox sender. */
  readonly source: string
  readonly id: string
  readonly epoch: number
}

/** What a consumer should do with an arriving message, on identity alone. */
export type DedupDecision =
  /** First arrival: the caller applies the effect and then records the key. */
  | { readonly action: 'accept'; readonly key: string }
  /** Seen before: the effect already happened, so this arrival is dropped. */
  | { readonly action: 'drop'; readonly reason: 'duplicate'; readonly key: string }

/**
 * The deduplication key for one message: `(source, id, epoch)`.
 *
 * BOTH the source and the id are length-prefixed, so no combination of
 * separators inside either one can produce another triple's key — `('a:1', 2)`
 * and `('a', '1:2')` would otherwise agree, and the collision silently drops a
 * real message rather than failing.
 * @param message - the message to key.
 * @returns a key unique to this `(source, id, epoch)` triple.
 */
export function dedupKey(message: DedupableMessage): string {
  return `${String(message.source.length)}:${message.source}:${String(message.id.length)}:${message.id}:${String(message.epoch)}`
}

/**
 * Decide an arrival against the keys this consumer has already applied.
 *
 * **Deliberately knows nothing about who may receive the message.** Both
 * callers have a precedence check of their own — the bus refuses a foreign
 * tenant, the mailbox refuses a message addressed elsewhere — and each runs it
 * BEFORE this one. Consulting a seen-set with a key derived from a message the
 * consumer may not act on would let that message suppress a later legitimate
 * one sharing its key, and would reveal whether the key had been seen here.
 * Those checks stay with the callers because what counts as "may act on it"
 * differs; what does not differ is this rule, which is why it lives here once.
 * @param message - the arriving message.
 * @param seen - keys of messages already applied by this consumer.
 * @returns the decision; only `accept` authorizes an effect.
 */
export function classifyDedup(message: DedupableMessage, seen: ReadonlySet<string>): DedupDecision {
  const key = dedupKey(message)
  if (seen.has(key)) return { action: 'drop', reason: 'duplicate', key }
  return { action: 'accept', key }
}
