/**
 * The channel that composes P2-12's decisions into a host-side surface
 * (Epic P2-12, Provider stage).
 *
 * **It lives here rather than in `dsh-human-channel`, and the reason is the
 * dependency direction.** The channel needs the vocabulary AND the decisions;
 * `dsh-control-plane` already depends on the vocabulary, so composing here is
 * one edge. Putting it in the vocabulary package would have made the two
 * packages import each other — a cycle the module graph rejects, and a
 * layering inversion besides: a vocabulary that depends on decisions over it
 * cannot be read on its own.
 *
 * The store is the vocabulary package's (`dsh-human-channel/store`) because it
 * depends on the record type and nothing else. This module holds no I/O: it
 * orders the write, the state change and the broadcast, which is the part
 * acceptance[2] is about.
 *
 * @module @deepseek-ai/dsh-control-plane/channel
 */

import type { StopStore } from '@deepseek-ai/dsh-human-channel/store'
import type {
  AnswerDelivery,
  ControlState,
  ControlVerb,
  HumanAnswer,
  HumanChannelRefusal,
  HumanQuestion,
  StopRecord,
  WaitingPointId,
} from '@deepseek-ai/dsh-human-channel/types'
import { decideControl, decideSettlement, mayStartNewWork } from './index.ts'
import type { WaitingPointRegistry } from './index.ts'

/** Who is asking for a control change, and why; the stop record is built from it. */
export type ControlRequest = Omit<StopRecord, 'release'>

/**
 * Told whenever the control state changes.
 *
 * must[1] says the kernel broadcasts the stop. The channel does not know what
 * the kernel is, and must not: it reports every transition to one injected
 * listener, and the Usage stage hands it the kernel's own publish. A worker
 * that never asks still learns, which is the half of acceptance[0] that a
 * readable store alone does not buy.
 */
export type ControlBroadcast = (state: ControlState) => void

/** What a channel needs, all of it required. */
export interface HumanChannelOptions {
  /** Where the stop record lives. Required: a channel with nowhere to persist cannot keep acceptance[2]. */
  readonly store: StopStore
  /** Where a control transition is announced. Required, for must[1]. */
  readonly broadcast: ControlBroadcast
  /**
   * How an answer reaches the waiting point that asked.
   *
   * Required, and the reason is BLOCKED-215: there the equivalent callback was
   * an optional third constructor parameter, production passed two arguments,
   * and the routing was dead in a way only an argument count revealed.
   */
  readonly delivery: AnswerDelivery
}

/** The channel's host-side surface. */
export interface HumanChannel {
  /** The control state as it stands, which is what a gate must consult rather than a cached flag. */
  state: () => ControlState
  /** Apply one control verb, persisting and announcing any transition. */
  control: (verb: ControlVerb, request: ControlRequest) => ReturnType<typeof decideControl>
  /** Whether a worker may take a new lease or start a new action (must[2]). */
  mayStartNewWork: () => HumanChannelRefusal | undefined
  /** Register a question and its waiting point, or refuse; the registry is host-side and authoritative. */
  ask: (question: HumanQuestion) => HumanChannelRefusal | undefined
  /** Deliver one answer to the point that asked it, out of band from the asking call stack. */
  settle: (answer: HumanAnswer) => HumanChannelRefusal | undefined
  /** The waiting points still unanswered, for a surface that renders them. */
  pending: () => readonly WaitingPointId[]
}

/**
 * Create the channel over a store, a broadcast and a delivery seam.
 *
 * **The initial state is READ, not assumed.** A process that comes up over a
 * store holding a record is stopped before it asks anyone, with nothing
 * re-applying the stop — which is what acceptance[2]'s "survives a restart"
 * means mechanically. Reading lazily would answer the first question after a
 * restart as if the run were running.
 * @param options - the store, broadcast and delivery seam; none is optional.
 * @returns the channel.
 */
export function createHumanChannel(options: HumanChannelOptions): HumanChannel {
  const restored = options.store.read()
  let state: ControlState = restored === undefined ? { stopped: false } : { stopped: true, record: restored }
  // The registry is the channel's own, because a per-surface copy of what is
  // pending is acceptance[3]'s failure in miniature and is also how one
  // question answered twice looks reasonable to both answerers.
  const open = new Set<WaitingPointId>()
  const closed = new Set<WaitingPointId>()
  const registry = (): WaitingPointRegistry => ({ open, closed })

  /**
   * Persist, then announce, then return.
   *
   * The ORDER is the contract. The record is durable before any caller is told
   * the stop is in force, for the same reason P4-12 writes its reservation
   * before the send: a report that outlives its record is a lie the next
   * process cannot detect. Broadcasting first would mean a crash between the
   * two leaves every worker told to halt and a file saying nothing happened.
   * @param next - the state to persist and announce.
   */
  const commit = (next: ControlState): void => {
    options.store.write(next.stopped ? next.record : undefined)
    state = next
    options.broadcast(next)
  }

  return {
    state: () => state,
    control: (verb, request) => {
      const decision = decideControl(verb, state, request)
      if (decision.action === 'stop') commit({ stopped: true, record: decision.record })
      if (decision.action === 'released') commit({ stopped: false })
      return decision
    },
    mayStartNewWork: () => mayStartNewWork(state),
    ask: (question) => {
      const refusal = mayStartNewWork(state)
      // The stop is checked here as well as inside the decision, because a
      // question is a new action and this is the boundary that registers one.
      if (refusal !== undefined) return refusal
      if (closed.has(question.waitingPoint)) {
        return { reason: 'waiting-point-vanished', waitingPoint: question.waitingPoint }
      }
      open.add(question.waitingPoint)
      return undefined
    },
    settle: (answer) => {
      const decision = decideSettlement(answer, registry())
      if (decision.action === 'refused') return decision.refusal
      // Settled points move to `closed` rather than simply leaving `open`, so a
      // second answer for the same point is refused as VANISHED rather than as
      // never registered. The two say different things to a surface that
      // delivered twice.
      open.delete(answer.waitingPoint)
      closed.add(answer.waitingPoint)
      return options.delivery.deliver(answer)
    },
    pending: () => [...open],
  }
}
