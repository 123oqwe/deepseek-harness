/**
 * Driver-owned durable agent inbox projection and command facade.
 *
 * @module @deepseek-ai/dsh-agent-loop/inbox
 */

import { orderByControlPriority } from '@deepseek-ai/dsh-control-priority'
import type { ControlKind } from '@deepseek-ai/dsh-control-priority'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Session, SessionEventMap, UserMessage } from '@deepseek-ai/dsh-session'
import { arrivalKey, DuplicateArrivalError } from '@deepseek-ai/dsh-agent'
import type {
  AgentEventDispatch,
  Inbox as InboxContract,
  InboxArrivalsState,
  InboxState,
  InboxTarget,
  InboxWireState,
} from '@deepseek-ai/dsh-agent'
import { z } from 'zod'

/** Wire validation for pending agent input reconstructed from durable inbox splices. */
export const inboxProjectionSchema = z.object({
  'next-turn': z.array(z.custom<UserMessage>()).readonly(),
  'next-step': z.array(z.custom<UserMessage>()).readonly(),
}).readonly()

/** Standard fold that reconstructs pending input and rejects invalid durable splice history. */
export const inboxProjectionDefinition = {
  key: 'inbox',
  stateSchema: inboxProjectionSchema,
  init: (): InboxState => ({ 'next-turn': [], 'next-step': [] }),
  apply(state: InboxState, event) {
    if (event.type !== 'agent/inbox/spliced') return state
    const splice = event.data
    try {
      const inbox = state[splice.target]
      const removedCount = splice.removedCount ?? 0
      if (!Number.isSafeInteger(splice.start) || splice.start < 0 || splice.start > inbox.length
        || !Number.isSafeInteger(removedCount) || removedCount < 0
        || splice.start + removedCount > inbox.length) {
        throw new Error('invalid inbox splice')
      }
      const next = inbox.toSpliced(splice.start, removedCount, ...splice.inserted)
      const ids = new Set<string>()
      for (const message of splice.target === 'next-turn'
        ? [...next, ...state['next-step']]
        : [...state['next-turn'], ...next]) {
        if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`)
        ids.add(message.id)
      }
      return splice.target === 'next-turn'
        ? { 'next-turn': next, 'next-step': state['next-step'] }
        : { 'next-turn': state['next-turn'], 'next-step': next }
    } catch (error: unknown) {
      throw new Error(`invalid persisted inbox splice at session seq ${event.seq}`, { cause: error })
    }
  },
  wire: {
    // The wire value is the fold state itself: every pending message already
    // round-trips the session log as lossless JSON. Only the static type
    // narrows to the JSON-safe projection table entry.
    viewSchema: inboxProjectionSchema as unknown as z.ZodType<InboxWireState>,
    view: (state: InboxState) => state as unknown as InboxWireState,
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'inbox', InboxState>

/** Validates persisted arrival bookkeeping before it seeds a fold. */
export const inboxArrivalsProjectionSchema = z.object({
  pending: z.object({
    'next-turn': z.array(z.string().nullable()).readonly(),
    'next-step': z.array(z.string().nullable()).readonly(),
  }).readonly(),
  consumed: z.array(z.string()).readonly(),
}).readonly()

/**
 * Host-only fold of the `(source, id, epoch)` keys that inbox claims consumed
 * (Epic P4-06 must[2]). A claim is a splice that removes messages, inserts
 * none, and is not `canceled`; a cancellation removes messages that never ran,
 * so it consumes nothing. The fold runs over the whole log, fork-inherited
 * prefix included, so a restarted or forked agent still refuses a redelivery.
 * The `inbox` fold validates splice coordinates for the same events.
 */
export const inboxArrivalsProjectionDefinition = {
  key: 'inboxArrivals',
  stateSchema: inboxArrivalsProjectionSchema,
  init: (): InboxArrivalsState => ({ pending: { 'next-turn': [], 'next-step': [] }, consumed: [] }),
  apply(state: InboxArrivalsState, event) {
    if (event.type !== 'agent/inbox/spliced') return state
    const splice = event.data
    const removedCount = splice.removedCount ?? 0
    const keys = state.pending[splice.target]
    const removed = keys.slice(splice.start, splice.start + removedCount)
    const next = keys.toSpliced(splice.start, removedCount, ...splice.inserted.map(message => arrivalKey(message) ?? null))
    const pending = splice.target === 'next-turn'
      ? { 'next-turn': next, 'next-step': state.pending['next-step'] }
      : { 'next-turn': state.pending['next-turn'], 'next-step': next }
    const claimed = splice.outcome === 'canceled' || splice.inserted.length > 0
      ? []
      : removed.filter((key): key is string => key !== null && !state.consumed.includes(key))
    return { pending, consumed: claimed.length === 0 ? state.consumed : [...state.consumed, ...claimed] }
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'inboxArrivals', InboxArrivalsState>

/**
 * Driver-owned durable Inbox implementation used by ReactLoopAgent and focused
 * provider tests.
 * @param projections - registry that owns the standard Inbox projection.
 * @param session - session whose durable events store pending input.
 * @param dispatch - agent-scoped notifications for Inbox lifecycle events.
 */
export class ReactLoopInbox implements InboxContract {
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
    private readonly projections: SessionProjectionRegistry,
    private readonly session: Session,
    private readonly dispatch: AgentEventDispatch,
  ) {
    this.projections.register(inboxProjectionDefinition)
    this.projections.register(inboxArrivalsProjectionDefinition)
  }

  /** Prompts awaiting individual turns. */
  get nextTurn(): readonly UserMessage[] {
    return this.current()['next-turn']
  }

  /** Input awaiting the next step boundary. */
  get nextStep(): readonly UserMessage[] {
    return this.current()['next-step']
  }

  /** Whether either pending-message list contains work. */
  get hasPending(): boolean {
    const state = this.current()
    return state['next-turn'].length > 0 || state['next-step'].length > 0
  }

  /** Durably cancel all pending input, clearing next-step before next-turn. */
  clear(): void {
    this.splice('next-step', 0, this.nextStep.length, [])
    this.splice('next-turn', 0, this.nextTurn.length, [])
  }

  /**
   * Remove and return the complete batch proposed for one step, ordered by
   * control priority.
   * @param target - whether this boundary also consumes one queued turn.
   * @param turn - turn that will own the claimed batch.
   * @returns next-step input followed by the queued turn, when requested, with a cancel promoted ahead of the rest.
   */
  claim(target: InboxTarget, turn: number): UserMessage[] {
    const claimed = this.mutate('next-step', 0, this.nextStep.length, [], false)
    if (target === 'next-turn') claimed.push(...this.mutate('next-turn', 0, 1, [], false))
    // must[1]'s ordering, at the point every source converges. A router orders
    // only what was routed through it; `steer`, `inject` and `followup` reach
    // this queue directly from a user, a team, or a goal driver, and a batch
    // holding a cancel beside a steer must apply the cancel first however the
    // transport delivered them (acceptance[0]).
    const ordered = orderByControlPriority(claimed, message => this.controlKinds.get(message.id))
    for (const message of ordered) {
      this.controlKinds.delete(message.id)
      this.dispatch.emit('agent/inbox/claimed', { message, turn })
    }
    return [...ordered]
  }

  /**
   * Append one message to a pending list.
   * @param target - pending list to extend.
   * @param message - message to append.
   * @param controlKind - the control kind this insertion carries, used to order
   *   the batch it is claimed in; absent for ordinary input, which is not a
   *   control message and keeps its arrival position.
   * @throws {DuplicateArrivalError} when the message repeats an arrival key a claim already consumed.
   */
  append(target: InboxTarget, message: UserMessage, controlKind?: ControlKind): void {
    this.splice(target, this.current()[target].length, 0, [message], controlKind)
  }

  /**
   * Prepend one message to a pending list.
   * @param target - pending list to extend.
   * @param message - message to prepend.
   * @param controlKind - the control kind this insertion carries, used to order
   *   the batch it is claimed in; absent for ordinary input.
   * @throws {DuplicateArrivalError} when the message repeats an arrival key a claim already consumed.
   */
  prepend(target: InboxTarget, message: UserMessage, controlKind?: ControlKind): void {
    this.splice(target, 0, 0, [message], controlKind)
  }

  /**
   * Replace one pending message in place.
   * @param messageId - identity of the pending message to replace.
   * @param newMessage - replacement message.
   * @returns whether the message was still pending.
   */
  replace(messageId: MessageId, newMessage: UserMessage): boolean {
    const location = this.locate(messageId)
    if (location === undefined) return false
    this.splice(location.target, location.index, 1, [newMessage])
    return true
  }

  /**
   * Remove one pending message.
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
   * @param target - pending list to mutate.
   * @param start - splice position.
   * @param deleteCount - maximum number of messages to remove.
   * @param inserted - messages to insert at the resolved position.
   * @param controlKind - the control kind recorded for every inserted message,
   *   which decides its rank in the batch a turn claims; absent leaves the
   *   messages unranked.
   * @returns messages removed by the splice.
   * @throws {DuplicateArrivalError} when an inserted message repeats an arrival key a claim already consumed.
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
    const state = this.current()
    for (const target of ['next-turn', 'next-step'] as const) {
      const index = state[target].findIndex(message => message.id === messageId)
      if (index >= 0) return { target, index }
    }
    return undefined
  }

  /** Read the current durable projection state. */
  private current(): InboxState {
    const state = this.projections.stateOf(this.session, 'inbox')
    /* v8 ignore next -- the constructor registers this key before any read */
    if (state === undefined) {
      throw new Error(
        `agent "${this.session.id}" cannot read inbox state: its projection registration is not active`,
      )
    }
    return state
  }

  /** Read the current arrival bookkeeping projection state. */
  private arrivals(): InboxArrivalsState {
    const state = this.projections.stateOf(this.session, 'inboxArrivals')
    /* v8 ignore next -- the constructor registers this key before any read */
    if (state === undefined) {
      throw new Error(
        `agent "${this.session.id}" cannot read inbox arrival state: its projection registration is not active`,
      )
    }
    return state
  }

  /** Commit one normalized mutation and publish its live events. */
  private mutate(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
    discardRemoved: boolean,
  ): UserMessage[] {
    const state = this.current()
    const inbox = state[target]
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
    // Epic P4-06 must[2]: refuse before the durable append, so a redelivery
    // leaves no splice in the log and no live notification.
    const consumed = new Set(this.arrivals().consumed)
    for (const message of inserted) {
      const key = arrivalKey(message)
      if (key !== undefined && consumed.has(key)) throw new DuplicateArrivalError(key, message.id)
    }
    const candidate = inbox.toSpliced(actualStart, actualDeleteCount, ...inserted)
    const ids = new Set<string>()
    for (const message of target === 'next-turn'
      ? [...candidate, ...state['next-step']]
      : [...state['next-turn'], ...candidate]) {
      if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`)
      ids.add(message.id)
    }
    const outcome = discardRemoved && actualDeleteCount > 0 ? 'canceled' as const : undefined
    const splice: SessionEventMap['agent/inbox/spliced'] = {
      target,
      start: actualStart,
      ...(actualDeleteCount === 0 ? {} : { removedCount: actualDeleteCount }),
      inserted,
      ...(outcome === undefined ? {} : { outcome }),
    }
    const removed = inbox.slice(actualStart, actualStart + actualDeleteCount)
    const event = this.session.append('agent/inbox/spliced', splice)
    if (discardRemoved) {
      for (const message of removed) this.dispatch.emit('agent/inbox/discarded', { message })
    }
    for (const message of event.data.inserted) {
      this.dispatch.emit('agent/inbox/inserted', { message })
    }
    return removed
  }
}
