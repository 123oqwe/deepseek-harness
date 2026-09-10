/**
 * Contract-stage vocabulary for Epic P4-02's generic compiled TaskProfile: the
 * reference back to the user goal every inference is traceable to (must[1]),
 * the hard and soft constraints that each carry their own source and
 * confidence (must[1], acceptance[1]), the side-effect classification that
 * cannot say "none" for something unknown (acceptance[2]), the questions an
 * ambiguous or high-risk missing field produces instead of a guess (must[2]),
 * and the durable `run/task-profile` session event the profile itself lives in.
 *
 * **Grounding: this module mints as little as it can.** must[0] restricts the
 * profile to generic fields, and the cheapest way to stay generic is to import
 * vocabulary that already exists rather than to declare a parallel one:
 *
 * - {@link TaskSideEffect} carries P2-04's `RiskClass` and `RiskGroundKind`
 *   (`@deepseek-ai/dsh-risk-taxonomy/types`, accepted). That import is what
 *   makes acceptance[2] true by construction rather than by a rule someone
 *   remembers to apply: `RiskClass` has eight members and **none of them is
 *   `none`**, so an unknown side effect has no `none` to be marked with, and
 *   `RiskGroundKind`'s `unknown-default` already distinguishes "classified by
 *   a rule" from "classified because nothing matched". A second, locally
 *   declared side-effect enum with a `none` member would reopen exactly the
 *   hole acceptance[2] names.
 * - {@link TaskGoalRef} is a REFERENCE, not a copy: `SessionId` from
 *   `@deepseek-ai/dsh-session/types` and `MessageId` from
 *   `@deepseek-ai/dsh-llm/brand`, the two brands that already identify the
 *   `user/message` event this profile was compiled from. must[1] asks the
 *   profile to keep the original goal REFERENCE; inlining the goal text would
 *   be a second copy of a durable fact with no way to detect divergence from
 *   the session log that owns it.
 *
 * **What this module deliberately does NOT have is a task-kind field.** The
 * registry's validation[0] asks for fixtures over four task kinds (code,
 * research, external action, personal plan) and those four are test INPUTS. A
 * closed four-member `kind` union on the type would be a taxonomy of tasks
 * baked into the contract, and must[0]'s whole subject is that the profile
 * expresses generic fields only — a fifth generic task shape that is none of
 * those four would have nowhere to go.
 *
 * @module @deepseek-ai/dsh-task-profile/types
 */

import { type Branded, brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { RiskClass, RiskGroundKind } from '@deepseek-ai/dsh-risk-taxonomy/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * must[1]'s reference to the original user goal: the exact `user/message`
 * session event this profile was compiled from.
 *
 * Both fields are brands this repository already owns, so a goal reference
 * resolves against the real session log rather than against a parallel record
 * of what the goal was. Every inference in the profile carries one of these
 * (see {@link InferenceProvenance}), which is what makes acceptance[1]'s
 * "every hard constraint is traceable to its original source" a property of
 * the type rather than of the compiler that fills it in.
 */
export interface TaskGoalRef {
  /** The session whose log holds the goal message. */
  readonly sessionId: SessionId
  /** The `user/message` event's own stable id within that session. */
  readonly messageId: MessageId
}

/**
 * How a field in the profile came to have the value it has (must[1]'s
 * 推断的来源, "the source of every inference").
 *
 * The three are separated because they answer different questions for a
 * reader: `user-stated` means the goal said it, `derived` means this compile
 * concluded it from what the goal said, and `default` means nothing in the
 * goal decided it. Collapsing `derived` into `user-stated` would let a
 * conclusion present itself as the user's own words, which is the failure
 * must[2] guards on the authorization side.
 */
export type InferenceOrigin = 'user-stated' | 'derived' | 'default'

/**
 * The source-and-confidence pair must[1] requires every inferred field to
 * keep, and the reference acceptance[1] traces a hard constraint back through.
 *
 * `confidence` is a closed `[0, 1]` real, validated rather than trusted (see
 * `./validate.ts`). A `user-stated` origin is not automatically confidence 1:
 * a user can state something ambiguously, and reporting that as certain would
 * misstate what is known — the same reasoning P2-04 gives for reporting its
 * unknown default at confidence 0.
 */
export interface InferenceProvenance {
  /** Whether the goal stated this, this compile derived it, or nothing decided it. */
  readonly origin: InferenceOrigin
  /** The goal message this field is traceable back to. */
  readonly goalRef: TaskGoalRef
  /** How certain this compile is of the value, in `[0, 1]`. */
  readonly confidence: number
  /** What in the goal supports the value; free text, for a human reading the trace. */
  readonly rationale: string
}

/**
 * Whether a constraint must hold or is preferred (must[1], acceptance[1]).
 *
 * acceptance[1] names hard constraints specifically, but provenance is
 * required on BOTH: a soft constraint with no source would be a preference
 * this system invented, and the compiler would have no way to say where it
 * came from when a later stage asks why the plan honoured it.
 */
export type TaskConstraintStrength = 'hard' | 'soft'

/**
 * One constraint the compiled profile carries (must[1], acceptance[1]).
 *
 * `provenance` is REQUIRED, not optional. acceptance[1] says every hard
 * constraint must be traceable to its original source; an optional field
 * would make that a property the compiler has to remember to fill, and the
 * one case where it forgot would be indistinguishable from a constraint with
 * no source. Required makes the clause true by construction.
 */
export interface TaskConstraint {
  /** Stable identifier of this constraint within the profile. */
  readonly id: string
  /** Whether it must hold or is preferred. */
  readonly strength: TaskConstraintStrength
  /** What the constraint says, in the profile's own generic terms. */
  readonly statement: string
  /** Where it came from and how certain this compile is of it. */
  readonly provenance: InferenceProvenance
}

/**
 * What the task is expected to do to the world (acceptance[2]).
 *
 * Both `riskClass` and `ground` are P2-04's, imported rather than re-declared.
 * The pair is what carries acceptance[2]: a side effect this compile could not
 * determine is `ground: 'unknown-default'` at `confidence: 0`, and there is no
 * `none` member in `RiskClass` for it to be marked with instead. A profile
 * whose side effect is genuinely a read reaches `riskClass: 'read'` through a
 * stated or derived origin, which is a different value from the unknown
 * default and distinguishable by `ground` alone.
 */
export interface TaskSideEffect {
  /** P2-04's risk class for the effect this task has. */
  readonly riskClass: RiskClass
  /** P2-04's ground: whether a rule decided it, the kernel refuses it, or nothing matched. */
  readonly ground: RiskGroundKind
  /** Where the classification came from and how certain this compile is of it. */
  readonly provenance: InferenceProvenance
}

/**
 * Why the compiler asked instead of deciding (must[2]).
 *
 * `ambiguous` — the goal supports more than one reading of the field.
 * `high-risk-missing` — the field is absent and the class of action it governs
 * is one must[2] refuses to assume authorization for. The two are separate
 * because they need different answers: a reading can be chosen between, while
 * a missing authorization can only be granted.
 */
export type TaskQuestionReason = 'ambiguous' | 'high-risk-missing'

/**
 * One question the compile produced rather than guessing (must[2]).
 *
 * **A question is DATA, not a prompt this module delivers.** The compile step
 * is deterministic (acceptance[0]) and therefore cannot await a human; the
 * `ctx.userQuestions` seam blocks on an answerer, so asking through it inside
 * the compiler would make the same input produce different profiles depending
 * on who was at the keyboard. Putting the questions in the profile leaves
 * asking them to a consumer that is allowed to wait.
 */
export interface TaskQuestion {
  /** Stable identifier of this question within the profile. */
  readonly id: string
  /** The profile field the question is about, so a consumer can route it. */
  readonly field: string
  /** Whether the field is ambiguous or is a high-risk absence. */
  readonly reason: TaskQuestionReason
  /** The question itself, in the user's terms. */
  readonly prompt: string
  /** The goal message the question arose from. */
  readonly goalRef: TaskGoalRef
}

/**
 * The compiled generic task profile (must[0]).
 *
 * Six fields, every one of them generic: no vertical stage, pipeline, deal,
 * ticket or account appears here, and must[0]'s nonGoal is enforced by there
 * being nowhere to put one.
 *
 * `questions` being non-empty and a field being absent are the SAME
 * situation seen from two sides, and must[2] requires it: a high-risk or
 * ambiguous field that produced a question must not also carry a value this
 * compile invented for it. `./validate.ts` refuses a profile that does both.
 */
export interface TaskProfile {
  /** The `user/message` this profile was compiled from (must[1]). */
  readonly goalRef: TaskGoalRef
  /** The goal restated in the profile's own generic terms; never a substitute for {@link goalRef}. */
  readonly objective: string
  /** Hard and soft constraints, each with its own source and confidence. */
  readonly constraints: readonly TaskConstraint[]
  /** What this task does to the world, in P2-04's vocabulary. */
  readonly sideEffect: TaskSideEffect
  /** What the compile asked instead of guessing (must[2]); empty when it had to ask nothing. */
  readonly questions: readonly TaskQuestion[]
}

/**
 * A content-addressed reference to one compiled profile: the lowercase hex
 * sha256 of its RFC 8785 canonical form (`./validate.ts`'s
 * {@link taskProfileRef}).
 *
 * **It is minted here, in the package that owns the entity, and imported by
 * `@deepseek-ai/dsh-run`** — the reverse of P4-01's five `*Ref` brands, which
 * that package had to mint locally because none of their owners existed yet.
 * Defining it here keeps the dependency edge acyclic: `dsh-run` reads this
 * type, and this package reads nothing of `dsh-run`.
 *
 * A digest rather than a serial number because it is the revision identity
 * validation[2] asks for: recompiling the same goal yields the same profile
 * (acceptance[0]) and therefore the same ref, while a revised profile is a
 * different digest, a new `run/task-profile` event, and a new Run event log
 * entry — three records that cannot disagree about which profile is which.
 */
export type TaskProfileRef = Branded<'TaskProfileRef'>

/**
 * Admit a lowercase hex sha256 string as a task-profile reference.
 * @param digest - 64 lowercase hex characters, produced by `./validate.ts`'s
 * {@link taskProfileRef} from a canonicalized profile, never chosen by a caller.
 * @returns the same string with the task-profile-reference brand.
 */
export function TaskProfileRef(digest: string): TaskProfileRef {
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new TypeError(`TaskProfileRef must be 64 lowercase hex characters, got ${JSON.stringify(digest)}`)
  }
  return brandString<TaskProfileRef>(digest)
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One compiled TaskProfile, and the durable home of the profile itself
     * (validation[2]).
     *
     * The Run event log carries a {@link TaskProfileRef} to this profile; it
     * does not carry the profile. That split follows every other entity P4-01
     * references — a Run event names an approval or an artifact and their
     * bodies live with their owners — and a TaskProfile's owner is the
     * session, because it is compiled from a message in that session's log
     * and is meaningless outside it.
     *
     * Persistence and revision (validation[2]) are the same mechanism: the
     * log is append-only, so a revised profile is a NEW event carrying a new
     * `ref`, and `previousRef` names the profile it revises. A first compile
     * has no `previousRef`. Nothing is ever edited in place, so the revision
     * chain is recoverable by reading the events in order.
     *
     * The event exists here rather than only on the Run so that a later
     * stage putting the profile into a model request (P4-03) satisfies
     * "model-visible ⟺ logged" without adding a second record of the same
     * fact.
     */
    'run/task-profile': {
      /** The digest of {@link profile}; the same value the Run event log references. */
      ref: TaskProfileRef
      /** The compiled profile. */
      profile: TaskProfile
      /** The profile this one revises, absent on a first compile. */
      previousRef?: TaskProfileRef
    }
  }
}
