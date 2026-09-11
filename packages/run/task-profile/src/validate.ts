/**
 * Structural and semantic validation of a compiled TaskProfile, and the
 * content-addressed reference the Run event log names it by.
 *
 * **Why runtime validation exists here at all.** This repository trusts
 * TypeScript at typed same-process boundaries and validates at the durable
 * ones. A profile read back out of the session log is a durable boundary: the
 * log outlives the build that wrote it, so a `TaskProfile` recovered from an
 * older event is an `unknown` that claims to be one. {@link validateTaskProfile}
 * is that boundary's check, and `spec/task-profile.schema.json` is the same
 * requirements expressed in P0-06's JSON Schema 2020-12 family for readers
 * outside TypeScript.
 *
 * **Two semantic rules the shape alone cannot carry**, both of them clauses
 * rather than hygiene:
 *
 * 1. acceptance[2] — an unknown side effect classifies at
 *    `ground: 'unknown-default'` with `confidence: 0`. `RiskClass` has no
 *    `none` member, so the type already refuses the marking the clause names;
 *    what the type cannot refuse is an unknown classification claiming to be
 *    certain.
 * 2. must[2] — a question about a field means this compile did NOT decide that
 *    field. A profile that asks whether it may send mail AND records a decided
 *    `external-communication` side effect has guessed the authorization it
 *    claimed to be asking about, which is the exact behaviour must[2] forbids.
 *
 * @module @deepseek-ai/dsh-task-profile/validate
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalizeArguments } from '@deepseek-ai/dsh-action-manifest/canonicalize'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { type TaskProfile, TaskProfileRef } from './types.ts'

/** The field name {@link TaskQuestion.field} carries when the question is about the profile's side effect. */
export const SIDE_EFFECT_FIELD = 'sideEffect'

// The two ids are re-branded on the way through rather than cast at the end:
// a value out of the durable log is a plain string until something admits it,
// and `SessionId`/`MessageId` are the admissions this repository already has.
const goalRef = z.strictObject({
  sessionId: z.string().min(1).transform(SessionId),
  messageId: z.string().min(1).transform(MessageId),
  // Optional because most goals are direct prompts, which continue no entered
  // goal. `round` is bounded below at 1: the goal domain admits positive rounds
  // only, so a stored 0 is a corrupted record rather than a first round.
  goalRound: z.strictObject({
    // `brandString` rather than the goal domain's own `GoalId` constructor,
    // which is a cast with no validation and lives on the package ROOT —
    // importing it would make this package's dependency on the goal domain a
    // RUNTIME one, pulling the goal service into the compiler's module graph
    // for a function that does nothing. The type comes from `/types`, the pure
    // outlet, where the name means only the brand.
    goalId: z.string().min(1).transform(value => brandString<GoalId>(value)),
    revision: z.number().int().min(0),
    round: z.number().int().min(1),
  }).optional(),
})

const provenance = z.strictObject({
  origin: z.enum(['user-stated', 'derived', 'default']),
  goalRef,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
})

const constraint = z.strictObject({
  id: z.string().min(1),
  strength: z.enum(['hard', 'soft']),
  statement: z.string().min(1),
  provenance,
})

const sideEffect = z.strictObject({
  riskClass: z.enum([
    'read',
    'local-reversible',
    'internal-write',
    'external-communication',
    'destructive',
    'financial',
    'security-sensitive',
    'safety-critical',
  ]),
  ground: z.enum(['policy-rule', 'kernel-hard-deny', 'unknown-default']),
  provenance,
})

const question = z.strictObject({
  id: z.string().min(1),
  field: z.string().min(1),
  reason: z.enum(['ambiguous', 'high-risk-missing']),
  prompt: z.string().min(1),
  goalRef,
})

/**
 * The structural half of a valid profile: every field must[0] admits, and no
 * field it does not. `strictObject` throughout is must[0]'s nonGoal made
 * mechanical — an unrecognised key is where a vertical field would arrive.
 */
export const taskProfileSchema = z.strictObject({
  goalRef,
  objective: z.string().min(1),
  constraints: z.array(constraint),
  sideEffect,
  questions: z.array(question),
})

/** Machine-readable reason {@link validateTaskProfile} refused a value. */
export type TaskProfileValidationCode =
  /** The value does not have the shape of a profile at all. */
  | 'malformed'
  /** Two constraints or two questions share an id, so a question could not name one of them. */
  | 'duplicate-id'
  /** An unknown-default classification reported a confidence other than 0 (acceptance[2]). */
  | 'unknown-side-effect-claims-confidence'
  /** A question names a field this compile also decided (must[2]). */
  | 'question-field-also-decided'

/** One reason a profile was refused, and where in it the reason applies. */
export interface TaskProfileValidationError {
  readonly code: TaskProfileValidationCode
  /** Dotted path to the offending member, or `''` for the profile as a whole. */
  readonly path: string
  /** What is wrong, in the clause's own terms. */
  readonly detail: string
}

/**
 * The outcome of validating one value: either a profile this build is willing
 * to read, or every reason it is not — all of them, so a caller fixing a
 * stored profile is not made to discover the faults one round-trip at a time.
 */
export type TaskProfileValidation =
  | { readonly valid: true; readonly profile: TaskProfile }
  | { readonly valid: false; readonly errors: readonly [TaskProfileValidationError, ...TaskProfileValidationError[]] }

/**
 * Duplicate ids among a set of members, in first-seen order.
 * @param ids - the ids to inspect.
 * @returns each id that appears more than once, once.
 */
function duplicates(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id)
    seen.add(id)
  }
  return [...repeated]
}

/**
 * Validate one value as a compiled TaskProfile, structurally and against the
 * two clause rules its shape cannot carry.
 * @param value - a value claiming to be a profile, typically read back from a
 * `run/task-profile` session event written by an older build.
 * @returns the profile when every rule holds, or every violated rule.
 */
export function validateTaskProfile(value: unknown): TaskProfileValidation {
  const parsed = taskProfileSchema.safeParse(value)
  if (!parsed.success) {
    const errors = parsed.error.issues.map(issue => ({
      code: 'malformed' as const,
      path: issue.path.join('.'),
      detail: issue.message,
    }))
    return { valid: false, errors: errors as unknown as readonly [TaskProfileValidationError, ...TaskProfileValidationError[]] }
  }

  const profile = parsed.data as TaskProfile
  const errors: TaskProfileValidationError[] = []

  for (const id of duplicates(profile.constraints.map(entry => entry.id))) {
    errors.push({ code: 'duplicate-id', path: 'constraints', detail: `constraint id ${JSON.stringify(id)} appears more than once` })
  }
  for (const id of duplicates(profile.questions.map(entry => entry.id))) {
    errors.push({ code: 'duplicate-id', path: 'questions', detail: `question id ${JSON.stringify(id)} appears more than once` })
  }

  // acceptance[2]: nothing this compile could not determine may present itself
  // as determined. The class it lands in is P2-04's business; the certainty it
  // reports is this clause's.
  if (profile.sideEffect.ground === 'unknown-default' && profile.sideEffect.provenance.confidence !== 0) {
    errors.push({
      code: 'unknown-side-effect-claims-confidence',
      path: 'sideEffect.provenance.confidence',
      detail: `an unknown-default side effect reports confidence ${profile.sideEffect.provenance.confidence}; nothing decided it, so it is not known`,
    })
  }

  // must[2]: asking about a field and deciding it are mutually exclusive.
  const constraintIds = new Set(profile.constraints.map(entry => entry.id))
  for (const asked of profile.questions) {
    if (asked.field === SIDE_EFFECT_FIELD) {
      if (profile.sideEffect.ground !== 'unknown-default') {
        errors.push({
          code: 'question-field-also-decided',
          path: `questions.${asked.id}`,
          detail: `question ${JSON.stringify(asked.id)} asks about the side effect while the profile records it as decided by ${profile.sideEffect.ground}`,
        })
      }
      continue
    }
    if (constraintIds.has(asked.field)) {
      errors.push({
        code: 'question-field-also-decided',
        path: `questions.${asked.id}`,
        detail: `question ${JSON.stringify(asked.id)} asks about constraint ${JSON.stringify(asked.field)}, which the profile also states`,
      })
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors: errors as [TaskProfileValidationError, ...TaskProfileValidationError[]] }
  }
  return { valid: true, profile }
}

/**
 * The content-addressed reference the Run event log names one profile by.
 *
 * Canonicalization is P2-03's `canonicalizeArguments` (RFC 8785 JCS), imported
 * rather than reimplemented: this repository already decided what its canonical
 * JSON form is, and a second one would let the same profile carry two different
 * refs depending on which module hashed it.
 * @param profile - a profile whose fields are already valid.
 * @returns the lowercase hex sha256 of its canonical form.
 */
export function taskProfileRef(profile: TaskProfile): TaskProfileRef {
  const canonical = canonicalizeArguments(profile as unknown as JsonValue)
  return TaskProfileRef(createHash('sha256').update(canonical, 'utf8').digest('hex'))
}
