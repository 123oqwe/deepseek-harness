/**
 * Incremental projection of durable agent inbox events, and the arrival
 * deduplication that makes redelivery into this inbox effective-once (Epic
 * P4-06 must[2]).
 *
 * @module @deepseek-ai/dsh-agent/inbox
 */

import { orderByControlPriority } from '@deepseek-ai/dsh-control-priority'
import type { ControlKind } from '@deepseek-ai/dsh-control-priority'
import { dedupKey } from '@deepseek-ai/dsh-intake-dedup'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEventMap, UserMessage } from '@deepseek-ai/dsh-session'
import type { InboxTarget } from './types.ts'

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
function arrivalKey(message: UserMessage): string | undefined {
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

/** Mutable state privately owned by an {@link Inbox}. */
type InboxState = Record<InboxTarget, UserMessage[]>

/** Live notifications committed by inbox mutations. */
export interface InboxNotifications {
  /** Publish one inserted message. */
  inserted(message: UserMessage): void
  /** Publish one discarded message. */
  discarded(message: UserMessage): void
  /** Publish one claimed message inside its owning turn. */
  claimed(message: UserMessage, turn: number): void
}

/** A replay-once projection that incrementally consumes later inbox splices. */
export class Inbox {
  private readonly state: InboxState = { 'next-turn': [], 'next-step': [] }
  /**
   * Keys of arrivals this inbox has already CONSUMED (Epic P4-06 must[2]).
   *
   * Rebuilt from this session's own log, so it survives a restart — which is
   * the only reason it means anything. At-least-once delivery is the sender's
   * guarantee and effective-once is the consumer's, and the consumer half is
   * unreachable from a set assembled in memory: the restart is precisely the
   * event that empties it, and the redelivery that follows is precisely what
   * it exists to refuse.
   *
   * Pending-identity rejection (see {@link Inbox.validate}) does not cover
   * this. A message that was claimed and run is no longer pending, so a second
   * arrival of it inserts cleanly and its effect happens twice —
   * acceptance[0]'s exact failure.
   */
  private readonly consumed = new Set<string>()
  /**
   * The control kind each pending message was inserted as (Epic P5-10 must[1]).
   *
   * Recorded by the OPERATION, not read off the message: `followup`, `steer`
   * and `inject` each know which they are at the call site, while the message
   * they carry is ordinary content that could have come from anywhere. Held
   * beside the queue rather than on the message so nothing durable changes —
   * urgency is about the order a batch is claimed in, not about what the model
   * later reads.
   */
  private readonly controlKinds = new Map<MessageId, ControlKind>()

  constructor(
    private readonly session: Session,
    private readonly notifications: InboxNotifications,
  ) {
    for (const event of session.ownEvents()) {
      if (event.type !== 'agent/inbox/spliced') continue
      try {
        this.recordConsumed(this.apply(event.data), event.data)
      } catch (error: unknown) {
        throw new Error(`invalid persisted inbox splice at session seq ${event.seq}`, { cause: error })
      }
    }
  }

  /** Prompts awaiting individual turns. */
  get nextTurn(): readonly UserMessage[] {
    return this.state['next-turn']
  }

  /** Input awaiting the next step boundary. */
  get nextStep(): readonly UserMessage[] {
    return this.state['next-step']
  }

  /** Whether either pending-message list contains work. */
  get hasPending(): boolean {
    return this.nextTurn.length > 0 || this.nextStep.length > 0
  }

  /** Durably cancel all pending input, clearing next-step before next-turn. */
  clear(): void {
    this.splice('next-step', 0, this.nextStep.length, [])
    this.splice('next-turn', 0, this.nextTurn.length, [])
  }

  /**
   * Remove and return the complete batch proposed for one step, publishing
   * each claimed message. The durable splices are pure deletions.
   * @param target - whether this boundary also consumes one queued turn.
   * @param turn - turn that will own the claimed batch.
   * @returns next-step input followed by the queued turn, when requested.
   * @internal - The agent loop's step-boundary operation, not a plugin extension point.
   */
  claim(target: InboxTarget, turn: number): UserMessage[] {
    const claimed = this.mutate('next-step', 0, this.nextStep.length, [], false)
    if (target === 'next-turn') {
      claimed.push(...this.mutate('next-turn', 0, 1, [], false))
    }
    // must[1]'s ordering, at the point every source converges. A router orders
    // only what was routed through it; `steer`, `inject` and `followup` reach
    // this queue directly from a user, a team, or a goal driver, and a batch
    // holding a cancel beside a steer must apply the cancel first however the
    // transport delivered them (acceptance[0]).
    const ordered = orderByControlPriority(claimed, message => this.controlKinds.get(message.id))
    for (const message of ordered) {
      this.controlKinds.delete(message.id)
      this.notifications.claimed(message, turn)
    }
    return [...ordered]
  }

  /**
   * Append one message to a pending list and durably record the insertion.
   * @param target - pending list to extend.
   * @param message - message to append.
   * @throws if the message identity is already pending.
   */
  append(target: InboxTarget, message: UserMessage, controlKind?: ControlKind): void {
    this.splice(target, this.state[target].length, 0, [message], controlKind)
  }

  /**
   * Prepend one message to a pending list and durably record the insertion.
   * @param target - pending list to extend.
   * @param message - message to prepend.
   * @throws if the message identity is already pending.
   */
  prepend(target: InboxTarget, message: UserMessage, controlKind?: ControlKind): void {
    this.splice(target, 0, 0, [message], controlKind)
  }

  /**
   * Replace one pending message in place, possibly changing its identity. A
   * successful replacement publishes the old message as discarded and the new
   * message as inserted.
   * @param messageId - identity of the pending message to replace.
   * @param newMessage - replacement message.
   * @returns whether the message was still pending.
   * @throws if the replacement duplicates another pending message identity.
   */
  replace(messageId: MessageId, newMessage: UserMessage): boolean {
    const location = this.locate(messageId)
    if (location === undefined) return false
    this.splice(location.target, location.index, 1, [newMessage])
    return true
  }

  /**
   * Remove one pending message and durably record its cancellation.
   * @param messageId - identity of the pending message to remove.
   * @returns whether the message was still pending.
   */
  remove(messageId: MessageId): boolean {
    const location = this.locate(messageId)
    if (location === undefined) return false
    this.splice(location.target, location.index, 1, [])
    return true
  }

  /**
   * Apply standard splice semantics and durably record the normalized result.
   * The durable event commits before the live projection mutates, so synchronous
   * `session/event` observers see the pre-splice lists and can reconstruct the
   * removed messages from the normalized coordinates.
   * @param target - pending list to mutate.
   * @param start - splice position.
   * @param deleteCount - maximum number of messages to remove.
   * @param inserted - messages to insert at the resolved position.
   * @returns messages removed by the splice.
   */
  splice(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
    controlKind?: ControlKind,
  ): UserMessage[] {
    if (controlKind !== undefined) {
      for (const message of inserted) this.controlKinds.set(message.id, controlKind)
    }
    return this.mutate(target, start, deleteCount, inserted, true)
  }

  /** Locate one pending identity across both owned lists. */
  private locate(messageId: MessageId): { target: InboxTarget; index: number } | undefined {
    for (const target of ['next-turn', 'next-step'] as const) {
      const index = this.state[target].findIndex(message => message.id === messageId)
      if (index >= 0) return { target, index }
    }
    return undefined
  }

  /** Commit one normalized mutation and publish its live notifications. */
  private mutate(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
    discardRemoved: boolean,
  ): UserMessage[] {
    const inbox = this.state[target]
    const truncatedStart = Math.trunc(start)
    const offset = Number.isNaN(truncatedStart) ? 0 : truncatedStart
    const actualStart = offset < 0
      ? Math.max(inbox.length + offset, 0)
      : Math.min(offset, inbox.length)
    const truncatedDeleteCount = Math.trunc(deleteCount)
    const actualDeleteCount = Math.min(
      Math.max(Number.isNaN(truncatedDeleteCount) ? 0 : truncatedDeleteCount, 0),
      inbox.length - actualStart,
    )
    if (actualDeleteCount === 0 && inserted.length === 0) return []
    const outcome = discardRemoved && actualDeleteCount > 0 ? 'canceled' as const : undefined
    const splice = {
      target,
      start: actualStart,
      ...(actualDeleteCount === 0 ? {} : { removedCount: actualDeleteCount }),
      inserted,
      ...(outcome === undefined ? {} : { outcome }),
    }
    this.validate(splice)
    const event = this.session.append('agent/inbox/spliced', splice)
    const removed = inbox.splice(actualStart, actualDeleteCount, ...event.data.inserted)
    this.recordConsumed(removed, event.data)
    if (discardRemoved) {
      for (const message of removed) this.notifications.discarded(message)
    }
    for (const message of event.data.inserted) this.notifications.inserted(message)
    return removed
  }

  /**
   * Record the keys of messages this splice CONSUMED (P4-06 must[2]).
   *
   * A claim, and only a claim: a splice that removes messages, inserts none,
   * and is not marked `canceled` is the step boundary taking its batch. A
   * cancellation removes messages too, and those were never run, so keying
   * them would refuse a legitimate resend of work that never happened.
   *
   * Derived from the splice rather than from a flag on the event, because the
   * log already distinguishes the two and a second marker could disagree with
   * the first.
   * @param removed - the messages this splice took out of a pending list.
   * @param splice - the durable splice, whose shape says whether they were consumed.
   */
  private recordConsumed(removed: readonly UserMessage[], splice: SessionEventMap['agent/inbox/spliced']): void {
    if (splice.outcome === 'canceled' || splice.inserted.length > 0) return
    for (const message of removed) {
      const key = arrivalKey(message)
      if (key !== undefined) this.consumed.add(key)
    }
  }

  /** Apply one normalized durable splice to the projection. */
  private apply(splice: SessionEventMap['agent/inbox/spliced']): UserMessage[] {
    this.validate(splice)
    const inbox = this.state[splice.target]
    return inbox.splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
  }

  /** Validate one normalized splice against the current projection. */
  private validate(splice: SessionEventMap['agent/inbox/spliced']): void {
    const inbox = this.state[splice.target]
    const removedCount = splice.removedCount ?? 0
    if (!Number.isSafeInteger(splice.start) || splice.start < 0 || splice.start > inbox.length
      || !Number.isSafeInteger(removedCount) || removedCount < 0
      || splice.start + removedCount > inbox.length) {
      throw new Error('invalid inbox splice')
    }
    for (const message of splice.inserted) {
      const key = arrivalKey(message)
      if (key !== undefined && this.consumed.has(key)) {
        throw new DuplicateArrivalError(key, message.id)
      }
    }
    const candidate = inbox.toSpliced(splice.start, removedCount, ...splice.inserted)
    const ids = new Set<string>()
    for (const message of splice.target === 'next-turn'
      ? [...candidate, ...this.nextStep]
      : [...this.nextTurn, ...candidate]) {
      if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`)
      ids.add(message.id)
    }
  }
}
