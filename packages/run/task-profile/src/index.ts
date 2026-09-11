/**
 * The deterministic TaskProfile compiler (Epic P4-02, Provider stage), and the
 * type-only barrel the Contract stage needed before it.
 *
 * **What "deterministic parser" means here, and what it refuses to mean.**
 * {@link compileTaskProfile} reads only facts that arrive ALREADY STRUCTURED —
 * the goal message's own reference, the budget the composition stated, the
 * workspace's trust state, whether an identity is attached. It performs no
 * natural-language inference on the goal text: a constraint nobody stated does
 * not become a constraint because the text hints at one. Everything it cannot
 * determine from a structured field becomes an `unknown-default` side effect
 * and a question (must[2]), not a guess.
 *
 * That makes the first profiles mostly questions, and that is the honest
 * outcome rather than a shortfall: this epic's subject is provenance,
 * confidence and asking — not extraction. Model-assisted inference belongs to a
 * later epic and must arrive behind a provider, because the moment it lands in
 * this function acceptance[0]'s "same input, same output" stops holding.
 *
 * **Pure and total.** No clock, no I/O, no ambient policy, and it never awaits.
 * It does not take a `RiskPolicy`: classification is the business of a consumer
 * that holds one (P2-04's `classify`, or P4-03), and taking one here would make
 * the profile a function of the organisation as well as the goal. It also never
 * queries policy enforcement — see this epic's preFlight for why a
 * `policy-unavailable` from this function would be a must[2] violation rather
 * than someone else's defect arriving.
 *
 * @module @deepseek-ai/dsh-task-profile
 */

import { createHash } from 'node:crypto'
import type { TrustState } from '@deepseek-ai/dsh-workspace-trust/types'
import type {
  InferenceProvenance,
  TaskConstraint,
  TaskGoalRef,
  TaskOrigin,
  TaskProfile,
  TaskQuestion,
  TaskSideEffect,
} from './types.ts'

export type * from './types.ts'

/** The field name a side-effect question carries, mirrored from `./validate.ts`'s `SIDE_EFFECT_FIELD`. */
const SIDE_EFFECT_FIELD = 'sideEffect'

/** The field name an authorization question carries when no identity is attached. */
const IDENTITY_FIELD = 'actingIdentity'

/**
 * Everything one compile is allowed to see.
 *
 * A closed input is what makes acceptance[0] checkable: a function that could
 * reach a clock, a filesystem or a model would not have "the same input" twice.
 * Deliberately NOT the live `Agent` handle — that would make this package
 * depend on `core/agent` and would let a later edit read something unstructured
 * off it without the type changing.
 */
export interface TaskProfileInput {
  /** The `user/message` event this compile is about (must[1]). */
  readonly goalRef: TaskGoalRef
  /** That message's text, used verbatim as the objective and never parsed for constraints. */
  readonly goalText: string
  /** What kind of message it was; only `user-goal` is a task (must[2], delegate ruling). */
  readonly origin: TaskOrigin
  /**
   * The ceilings the composition stated (`AgentOptions.budget`). Absent means
   * unstated; a present `0` means explicitly unbounded, and the two must not
   * collapse or a stated "no cap" becomes an inferred one.
   */
  readonly budget?: { readonly maxTurns?: number; readonly maxSpendUsd?: number }
  /** The workspace's trust state, which bounds the side-effect class a profile may claim. */
  readonly workspaceTrust?: TrustState
  /** Whether an acting identity is attached; absence is a reason to ask, never to default. */
  readonly identityKnown: boolean
}

/** Why {@link compileTaskProfile} returned no profile. */
export type TaskProfileRefusal = 'not-a-task' | 'empty-goal'

/**
 * The outcome of one compile: a profile, or a refusal naming why there is none.
 *
 * A refusal rather than a thrown error or an empty profile. `not-a-task` is the
 * ordinary case for every injected context message, and an empty profile would
 * be indistinguishable from a real goal that yielded nothing.
 */
export type TaskProfileCompilation =
  | { readonly compiled: true; readonly profile: TaskProfile }
  | { readonly compiled: false; readonly reason: TaskProfileRefusal }

/**
 * A stable id for one constraint, derived from what it says and where it came from.
 *
 * A digest rather than a counter, because the id has to survive recompiling an
 * unchanged goal: a counter would renumber when an unrelated constraint appears
 * earlier, every id would change, and the profile's digest would move for a
 * decision that did not (validation[2]'s revision chain).
 *
 * Module-private: its only callers are in this file, and the stability property
 * it carries is observed through {@link compileTaskProfile} rather than by
 * calling this directly. Exporting it would also widen this module's runtime
 * surface past the one function the Provider stage promises.
 * @param statement - the constraint's text.
 * @param origin - the provenance origin that produced it.
 * @returns the first 16 hex characters of the sha256 of both, joined by a NUL
 * that no statement can contain.
 */
function constraintId(statement: string, origin: InferenceProvenance['origin']): string {
  return createHash('sha256').update(`${statement}\0${origin}`, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Build the provenance for a fact that arrived in a structured field.
 * @param goalRef - the goal this compile is about.
 * @param rationale - which structured field supplied the value.
 * @returns a `user-stated` provenance at confidence 1.
 */
function stated(goalRef: TaskGoalRef, rationale: string): InferenceProvenance {
  return { origin: 'user-stated', goalRef, confidence: 1, rationale }
}

/**
 * Build the provenance for a field nothing decided.
 * @param goalRef - the goal this compile is about.
 * @param rationale - why nothing decided it.
 * @returns a `default` provenance at confidence 0.
 */
function undetermined(goalRef: TaskGoalRef, rationale: string): InferenceProvenance {
  return { origin: 'default', goalRef, confidence: 0, rationale }
}

/**
 * The constraints the stated budget produces.
 *
 * Hard, because these are ceilings the loop enforces for itself rather than
 * preferences.
 *
 * An explicit `0` and an absent field both yield no constraint, because both
 * mean there is no ceiling to record. They are NOT distinguished here, and the
 * honest reason is that the profile vocabulary cannot express the difference: a
 * stated "no cap" and an unstated budget would need a constraint whose content
 * is its own absence. Noted rather than papered over with a question the
 * clauses do not ask for — `dsh-agent-loop/budget` already defines both as
 * unbounded, so nothing downstream reads them apart either.
 * @param input - the compile's input.
 * @returns zero to two hard constraints.
 */
function budgetConstraints(input: TaskProfileInput): readonly TaskConstraint[] {
  const constraints: TaskConstraint[] = []
  const add = (statement: string, field: string): void => {
    const provenance = stated(input.goalRef, `stated by the composition in AgentOptions.budget.${field}`)
    constraints.push({ id: constraintId(statement, provenance.origin), strength: 'hard', statement, provenance })
  }
  const turns = input.budget?.maxTurns
  if (turns !== undefined && turns > 0) add(`at most ${String(turns)} turns`, 'maxTurns')
  const spend = input.budget?.maxSpendUsd
  if (spend !== undefined && spend > 0) add(`at most ${String(spend)} USD of model spend`, 'maxSpendUsd')
  return constraints
}

/**
 * The side effect this compile can honestly report, and the question it owes.
 *
 * Nothing in the structured input says what the task does to the world, so the
 * class is always the unknown default here — `security-sensitive` with
 * `ground: 'unknown-default'` at confidence 0. An `untrusted` workspace is the
 * one case that adds information, and it narrows rather than decides: it cannot
 * make the effect known, so it is recorded in the rationale and still asked
 * about.
 * @param input - the compile's input.
 * @returns the side effect and the question that must accompany it.
 */
function undeterminedSideEffect(input: TaskProfileInput): { effect: TaskSideEffect; question: TaskQuestion } {
  // "Not supplied" and "untrusted" are different facts and the rationale says
  // which one it has. The DECISION stays fail-closed either way -- the class is
  // the unknown default regardless -- but writing `workspace trust is untrusted`
  // when no trust state was passed would state an observation this compile never
  // made. The id token and the sentence use the same word so a reader matching
  // one against the other finds the same case.
  const trust = input.workspaceTrust ?? 'not-supplied'
  const rationale = input.workspaceTrust === undefined
    ? 'no structured field states the effect; workspace trust was not supplied'
    : `no structured field states the effect; workspace trust is ${input.workspaceTrust}`
  const effect: TaskSideEffect = {
    riskClass: 'security-sensitive',
    ground: 'unknown-default',
    provenance: undetermined(input.goalRef, rationale),
  }
  const question: TaskQuestion = {
    id: constraintId(`${SIDE_EFFECT_FIELD}:${trust}`, 'default'),
    field: SIDE_EFFECT_FIELD,
    reason: 'high-risk-missing',
    prompt: 'What should this task be allowed to change outside this workspace?',
    goalRef: input.goalRef,
  }
  return { effect, question }
}

/**
 * Compile one already-structured goal into a generic TaskProfile.
 *
 * @param input - the closed set of structured facts one compile may read.
 * @returns the profile, or a refusal: `not-a-task` when the message is not a
 * human goal (must[2], only `user-goal` compiles), `empty-goal` when the goal
 * text is blank, which would otherwise produce a profile whose objective says
 * nothing.
 */
export function compileTaskProfile(input: TaskProfileInput): TaskProfileCompilation {
  if (input.origin !== 'user-goal') return { compiled: false, reason: 'not-a-task' }
  const objective = input.goalText.trim()
  if (objective === '') return { compiled: false, reason: 'empty-goal' }

  const { effect, question } = undeterminedSideEffect(input)
  const questions: TaskQuestion[] = [question]
  if (!input.identityKnown) {
    // must[2]'s "不擅自猜授权": with no acting identity attached there is no
    // principal whose authorization could be assumed, so the compile asks.
    questions.push({
      id: constraintId(IDENTITY_FIELD, 'default'),
      field: IDENTITY_FIELD,
      reason: 'high-risk-missing',
      prompt: 'Whose authorization should this task act under?',
      goalRef: input.goalRef,
    })
  }

  return {
    compiled: true,
    profile: {
      goalRef: input.goalRef,
      objective,
      constraints: budgetConstraints(input),
      sideEffect: effect,
      questions,
    },
  }
}
