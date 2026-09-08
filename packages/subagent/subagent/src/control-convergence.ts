/**
 * Control-message classification and the cancellation convergence barrier
 * (Epic P5-10, Contract stage).
 *
 * Five kinds of message can reach a running child, and they are not
 * interchangeable: `continue` and `steer` want a running child, `cancel` wants
 * to stop one, `inject` adds context without driving a turn, and
 * `human-answer` belongs to one specific waiting point rather than to the child
 * in general. Treating them as one queue is what lets a `steer` that raced a
 * `cancel` wake a child that was already stopping.
 *
 * **Cancellation is not terminal until its participants have stopped.** The
 * barrier here takes a SET of participants rather than a fixed list, and today
 * that set has one member: the child, whose stop is observable through
 * `run-settlement.ts`. must[3] also names `world` and `actions`; neither has a
 * runtime entity in this repository yet (BLOCKED-116), and this module
 * deliberately does not define the interface they would implement — fixing that
 * shape before `ExecutionWorld` is designed would create a hook that has to
 * match something that does not exist. A supplier adds itself when it lands.
 *
 * Contract stage: pure decisions over caller-supplied state. Nothing here sends
 * a message, stops a child, or touches a session.
 *
 * @module @deepseek-ai/dsh-subagent/control-convergence
 */

/** The five kinds of control message a child can receive (must[0]). */
export type ControlKind = 'continue' | 'steer' | 'inject' | 'cancel' | 'human-answer'

/** What a child is doing when a control message arrives. */
export type ChildPhase = 'running' | 'awaiting-human' | 'cancelling' | 'terminal'

/**
 * One control message.
 *
 * `controlEpoch` is NOT the continuation residency epoch of
 * `./continuation.ts`, despite the shared word — that one counts how many times
 * a durable child has been reconstructed, while this one identifies a single
 * message for idempotency (must[2]). They are named apart here because a reader
 * who conflates them would take a redelivered message for a new residency.
 */
export interface ControlMessage {
  readonly kind: ControlKind
  /** Stable per-message identity; a redelivery carries the same value. */
  readonly controlEpoch: number
  /** For `human-answer`: which waiting point the answer belongs to. */
  readonly waitingPointId?: string
}

/** Why a control message was not applied. */
export type ControlDenial =
  /** The child's phase does not admit this kind (must[1]). */
  | { readonly reason: 'phase-forbids'; readonly kind: ControlKind; readonly phase: ChildPhase }
  /** Already applied: the same `controlEpoch` was seen before (must[2]). */
  | { readonly reason: 'already-applied'; readonly controlEpoch: number }
  /** A `human-answer` naming a waiting point the child is not at. */
  | { readonly reason: 'wrong-waiting-point'; readonly expected: string | undefined; readonly received: string | undefined }
  /**
   * The message is admissible but no live child is there to receive it.
   *
   * Distinct from `already-applied`, and the distinction is the reason the
   * epoch ledger had to stop living inside the router (§12.26): a redelivery
   * to a finished child means "your message already arrived", while a NEW
   * message to a finished child means "there is nothing to send it to". A
   * router that answered `already-applied` for both would tell a caller its
   * first message had landed when it never did.
   */
  | { readonly reason: 'no-child' }

/**
 * What answers "was this control epoch already applied".
 *
 * Narrowed to `has` so a `ReadonlySet` and a log-backed ledger both satisfy it:
 * must[2] wants the answer DURABLE, and a signature demanding a set would have
 * forced the durable version to materialise every applied epoch just to be
 * passed here.
 */
export interface AppliedEpochs {
  has(controlEpoch: number): boolean
}

/** Whether a control message may be applied. */
export type ControlDecision =
  | { readonly applied: true; readonly kind: ControlKind }
  | { readonly applied: false; readonly denial: ControlDenial }

/**
 * Which phases each kind may act in (must[1]).
 *
 * `cancel` is admitted while already cancelling: a second cancel is not an
 * error, it is a caller who did not see the first one land, and refusing it
 * would make the caller retry something that already happened.
 *
 * Nothing is admitted in `terminal`. A message that arrives after a child has
 * finished has nothing to act on, and admitting it would mean reviving one.
 */
const PHASES_BY_KIND: Record<ControlKind, readonly ChildPhase[]> = {
  continue: ['running', 'awaiting-human'],
  steer: ['running'],
  inject: ['running', 'awaiting-human'],
  cancel: ['running', 'awaiting-human', 'cancelling'],
  'human-answer': ['awaiting-human'],
}

/**
 * Relative urgency when several messages arrive together (must[1]).
 *
 * `cancel` outranks everything. The race acceptance[0] names — a `steer` or
 * `continue` arriving at the same moment as a `cancel` — is decided here rather
 * than by arrival order, because arrival order is a property of the transport
 * and would make the outcome depend on scheduling.
 */
const PRIORITY_BY_KIND: Record<ControlKind, number> = {
  cancel: 0,
  'human-answer': 1,
  steer: 2,
  continue: 3,
  inject: 4,
}

/**
 * Order control messages by urgency, keeping arrival order within one kind.
 * @param messages - the messages that arrived together.
 * @returns the same messages, most urgent first.
 */
export function orderByPriority(messages: readonly ControlMessage[]): readonly ControlMessage[] {
  return [...messages].sort((a, b) => PRIORITY_BY_KIND[a.kind] - PRIORITY_BY_KIND[b.kind])
}

/**
 * Decide whether one control message may be applied (must[1], must[2]).
 *
 * Idempotency is checked FIRST: a redelivered message must be refused as a
 * redelivery whatever the phase now is, because a `continue` that was applied
 * while running and redelivered after cancellation began would otherwise be
 * reported as a phase conflict — a different fact, and one that would send a
 * caller looking for a race that did not happen (acceptance[2]).
 * @param message - the arriving message.
 * @param phase - what the child is doing now.
 * @param appliedEpochs - what already had this child's control epochs applied;
 *   a `ReadonlySet` in a unit case, and a durable ledger in production
 *   (must[2]), which is why this reads `has` rather than taking a set.
 * @param waitingPointId - the waiting point the child is at, when it is at one.
 * @returns whether to apply it, and why not when not.
 */
export function decideControl(
  message: ControlMessage,
  phase: ChildPhase,
  appliedEpochs: AppliedEpochs,
  waitingPointId?: string,
): ControlDecision {
  if (appliedEpochs.has(message.controlEpoch)) {
    return { applied: false, denial: { reason: 'already-applied', controlEpoch: message.controlEpoch } }
  }
  if (!PHASES_BY_KIND[message.kind].includes(phase)) {
    return { applied: false, denial: { reason: 'phase-forbids', kind: message.kind, phase } }
  }
  if (message.kind === 'human-answer' && message.waitingPointId !== waitingPointId) {
    return {
      applied: false,
      denial: { reason: 'wrong-waiting-point', expected: waitingPointId, received: message.waitingPointId },
    }
  }
  return { applied: true, kind: message.kind }
}

/**
 * One thing whose stop cancellation must observe before the child is terminal.
 *
 * A set rather than named slots: must[3] lists `child`, `world` and `actions`,
 * and only `child` exists today. A supplier that lands later reports itself
 * here under its own name, so nothing has to be redesigned to admit it and
 * nothing is designed now for a shape that has not been chosen (BLOCKED-116).
 */
export interface ConvergenceParticipant {
  /** What this participant is, for the barrier's report. */
  readonly name: string
  /** Whether it has stopped. */
  readonly stopped: boolean
}

/** What the barrier decided, and what it was still waiting on. */
export type ConvergenceState =
  | { readonly converged: true; readonly participants: readonly string[] }
  | { readonly converged: false; readonly pending: readonly string[] }

/**
 * Whether a cancelling child may reach terminal state (must[3]).
 *
 * An EMPTY participant set does not converge. A barrier over nothing is
 * trivially satisfied, and that is exactly how this clause would silently stop
 * meaning anything if a participant were ever dropped from the set — the run
 * would go terminal immediately and every test would still pass.
 * @param participants - everything whose stop this cancellation must observe.
 * @returns whether the barrier is satisfied, and what remains when it is not.
 */
export function decideConvergence(participants: readonly ConvergenceParticipant[]): ConvergenceState {
  if (participants.length === 0) return { converged: false, pending: ['(no participants registered)'] }
  const pending = participants.filter(participant => !participant.stopped).map(participant => participant.name)
  return pending.length === 0
    ? { converged: true, participants: participants.map(participant => participant.name) }
    : { converged: false, pending }
}
