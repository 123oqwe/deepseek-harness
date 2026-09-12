/**
 * The human-interaction channel's vocabulary (Epic P2-12, Contract stage).
 *
 * Two things a long-running task needs and the harness had no words for: a way
 * to STOP everything new, and a way to suspend and ask a human a question that
 * is not a permission request. Approval already exists and is one-shot; a
 * question is not an approval, and must[3] makes that separation a requirement
 * rather than a convention.
 *
 * **Written so that BLOCKED-215's four gaps are type errors.** That entry is
 * P5-10's answer routing: correct code, a well-stated property, and no
 * production path — the delivery callback was an optional third constructor
 * parameter the single production call site omitted, and the only entry that
 * designates a destination had zero production callers, so the guard that
 * checks the destination could never fire. A guard that cannot fire is worse
 * than no guard, because it reads as enforcement. Here the destination is a
 * required parameter of the ask, the delivery seam is a required field of the
 * channel, and neither has a default.
 *
 * Types only, per the repository rule for `src/types.ts`.
 *
 * @module @deepseek-ai/dsh-human-channel/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'

/**
 * The five control verbs must[0] requires.
 *
 * A closed exported constant rather than a bare union, so a sixth verb fails
 * every exhaustive decision over it instead of being silently unhandled. The
 * spelling is the clause's own.
 */
export const CONTROL_VERBS = ['pause-new-actions', 'cancel-run', 'kill-execution-world', 'ask-question', 'resume'] as const

/** One control verb. */
export type ControlVerb = typeof CONTROL_VERBS[number]

/**
 * Which waiting point a question belongs to.
 *
 * Opaque and branded because it crosses the process boundary to a surface and
 * comes back with the answer: an answer routed by anything coarser than this —
 * the asking child, the session, the agent — settles whichever question that
 * coarser key happens to name, which with two outstanding is the wrong one
 * (BLOCKED-215, P5-10 acceptance[1]).
 */
export type WaitingPointId = Branded<'WaitingPointId'>

/** Which run a control command addresses. */
export type RunRef = Branded<'RunRef'>

/**
 * Which execution world `kill-execution-world` addresses.
 *
 * An opaque reference rather than P3-01's `WorldHandle`. This epic specifies
 * the verb because must[0] lists it; it does not implement the kill, and it
 * must not import the world vocabulary to say so — P3-01 owns what a world is,
 * and a dependency here would make this epic's contract wait on that one's.
 * The provider stage that performs the kill resolves this reference through
 * P3-01's seam; until then the verb is specified and refused as unimplemented,
 * which is a state a caller can read rather than a silent no-op.
 */
export type WorldRef = Branded<'WorldRef'>

/** Why a stop was requested, as the requester stated it. */
export type StopReason =
  /** A human asked for everything new to halt. */
  | 'human-requested'
  /** A policy or budget decided the run may take no new action. */
  | 'policy-halted'
  /** An operator is draining the host and no new work may start. */
  | 'host-draining'

/**
 * The durable record that a stop is in force.
 *
 * **A record, not a flag, and the difference is acceptance[2].** The stop
 * survives a restart and must be lifted EXPLICITLY, so what persists has to
 * carry who stopped it and why — a boolean restored from disk cannot be
 * distinguished from a default, and "must be lifted explicitly" is not a
 * property a value can have unless lifting it is a transition over that value.
 */
export interface StopRecord {
  /** The principal that requested the stop; an audit reads this and the reason together. */
  readonly requestedBy: PrincipalId
  readonly reason: StopReason
  /** Unix epoch milliseconds, so a restart can order the stop against what it finds. */
  readonly requestedAtMs: number
  /**
   * How the stop may be released.
   *
   * `'explicit-resume'` is the only value today, and it exists as a field
   * rather than as an implied rule so that a later automatic release — a
   * deadline, a policy re-evaluation — is a new value here and not a second
   * code path that happens to clear the record.
   */
  readonly release: 'explicit-resume'
}

/**
 * Whether new work may start.
 *
 * The stop's presence IS the state: `{ stopped: false }` and a record are the
 * two readings, and a worker's gate is a question about this value rather than
 * about a flag it read somewhere earlier (must[2]).
 */
export type ControlState =
  | { readonly stopped: false }
  | { readonly stopped: true; readonly record: StopRecord }

/** One question put to a human, addressed to the waiting point that asked it. */
export interface HumanQuestion {
  /**
   * The waiting point this question's answer must reach, and the only thing it
   * may be routed by. REQUIRED: there is no ask without a destination, which is
   * the shape BLOCKED-215's `awaitHuman` had and production never used.
   */
  readonly waitingPoint: WaitingPointId
  /** The question text as the human sees it. */
  readonly prompt: string
  /** Optional choices a capable surface may render as a menu. */
  readonly options?: readonly string[]
}

/**
 * A human's answer to one question.
 *
 * **It carries no authority, and that is enforced by what is absent.** must[3]
 * says an answer is input and never a grant. So there is no decision field, no
 * boolean, and nothing an approval path can consume: an approval is carried by
 * `ApprovalGrant`, which this type cannot produce and which only the approval
 * seam mints. A shared `approved` field would have made the separation a rule
 * about who reads it, which is the kind of rule that holds until someone reads
 * it differently.
 */
export interface HumanAnswer {
  /** The waiting point that asked; an answer for any other point is a misroute, not a late arrival. */
  readonly waitingPoint: WaitingPointId
  /** What the human chose or typed. Opaque to the channel: only the asker interprets it. */
  readonly text: string
}

declare const APPROVAL_GRANT: unique symbol

/**
 * Proof that a human granted a permission.
 *
 * Unforgeable by construction: the brand is a module-private `unique symbol`,
 * so no caller outside the approval seam can produce a value of this type and
 * no answer can be widened into one. This is the type-level half of must[3] —
 * the other half is that {@link HumanAnswer} has no field this could be built
 * from — and it follows `dsh-capability-token`'s precedent rather than trusting
 * a naming convention.
 */
export interface ApprovalGrant {
  readonly [APPROVAL_GRANT]: true
  readonly grantedBy: PrincipalId
  readonly grantedAtMs: number
}

/** Why the channel refused to ask, settle, or act. */
export type HumanChannelRefusal =
  /** No surface in this composition can answer; the request fails closed rather than waiting forever. */
  | { readonly reason: 'no-answerer' }
  /** A stop is in force, so no new action — including a new question — may start (must[2]). */
  | { readonly reason: 'stopped'; readonly record: StopRecord }
  /** The waiting point was never registered: the asker and the router disagree about what exists. */
  | { readonly reason: 'unknown-waiting-point'; readonly waitingPoint: WaitingPointId }
  /** The waiting point existed and is gone — cancelled, timed out, or already settled. */
  | { readonly reason: 'waiting-point-vanished'; readonly waitingPoint: WaitingPointId }
  /** The verb is specified and not implemented here; `kill-execution-world` awaits P3-01's provider. */
  | { readonly reason: 'verb-unimplemented'; readonly verb: ControlVerb }

/**
 * How an answer reaches the waiting point that asked.
 *
 * **A required field, and the reason is BLOCKED-215.** There the equivalent
 * callback was the third, optional constructor parameter; production passed two
 * arguments; and the feature was dead in a way only an argument count revealed.
 * A composition that cannot deliver an answer must fail to construct the
 * channel rather than construct one that never delivers.
 */
export interface AnswerDelivery {
  /**
   * Hand one answer to the waiting point it names.
   * @param answer - the answer, carrying the waiting point it belongs to.
   * @returns the refusal when it could not be delivered, or undefined on delivery.
   */
  deliver: (answer: HumanAnswer) => HumanChannelRefusal | undefined
}
