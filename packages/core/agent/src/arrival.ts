/**
 * Arrival deduplication vocabulary for durable agent inbox redelivery (Epic
 * P4-06 must[2]): the `(source, id, epoch)` key an inbox consumer refuses once
 * a claim consumed it, and the error that refusal throws.
 *
 * @module @deepseek-ai/dsh-agent/arrival
 */

import { dedupKey } from '@deepseek-ai/dsh-intake-dedup'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

/**
 * A second arrival of a message this inbox already consumed.
 *
 * Thrown rather than dropped silently. A sender presenting a key that was
 * already run has a real fault — a retry loop that never sees its own
 * acknowledgement, or a manager delivering a settlement twice — and swallowing
 * it would hide the fault while the caller believed the message was queued.
 * The caller decides what a duplicate means to it; only the effect is refused
 * here.
 */
export class DuplicateArrivalError extends Error {
  /**
   * @param key - the `(source, id, epoch)` key this arrival repeats.
   * @param messageId - the arriving message's own id, for the caller's log.
   */
  constructor(readonly key: string, readonly messageId: MessageId) {
    super(`inbox arrival ${messageId} repeats a consumed key`)
    this.name = 'DuplicateArrivalError'
  }
}

/**
 * The `(source, id, epoch)` key of one arrival, or `undefined` when its source
 * carries no sender generation.
 *
 * **Only a source that states an epoch is deduplicated**, and that is the
 * contract rather than a gap. The triple's whole job is to separate "this
 * message again" from "a new message that looks alike", and the epoch is what
 * does the separating; keying a source without one would make every future
 * message from that sender collide with an earlier one and be dropped as a
 * duplicate. A sender that wants effective-once delivery states its
 * generation.
 * @param message - the arriving message.
 * @returns the dedup key, or `undefined` when this source does not carry one.
 */
export function arrivalKey(message: UserMessage): string | undefined {
  const source = message.source as { kind: string; senderSessionId?: string; senderEpoch?: number }
  if (typeof source.senderEpoch !== 'number' || typeof source.senderSessionId !== 'string') return undefined
  // NOT `message.id`: `createUserMessage` mints a fresh one per call, so a
  // redelivery would key differently from the delivery it repeats and the rule
  // would refuse nothing. The id is the SENDER's stable identity — a child
  // session outlives each of its activations — and the epoch is which
  // activation spoke, so a genuine second settlement of the same child is a
  // different key rather than a suppressed message.
  return dedupKey({ source: source.kind, id: source.senderSessionId, epoch: source.senderEpoch })
}
