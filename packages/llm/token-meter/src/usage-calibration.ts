/**
 * Narrow the estimator's error against what the provider actually reported
 * (Epic P9-05 must[1], Contract stage).
 *
 * `./estimate.ts` prices text at a fixed four characters per token. That
 * density is wrong by a different factor for TypeScript, for Chinese prose, and
 * for JSON, and nothing in the loop ever learns which one it is looking at. But
 * every real response comes back carrying `usage.inputTokens` — the provider's
 * own count of the very content just priced — so the correction is available
 * for free on each turn, without a tokenizer and without a network call.
 *
 * **This module is deliberately half of P9-05.** must[0] (exact DeepSeek
 * counting) and must[2] (p95 error against four corpora) both need a real
 * tokenizer, and choosing where one comes from is a maintainer's decision
 * (BLOCKED-107). Neither is attempted here, and this calibration must not be
 * mistaken for either: it makes an estimate less wrong for one session, and it
 * cannot make it exact.
 *
 * Contract stage: a pure fold over observations a caller supplies. No I/O, no
 * clock, no session, and — must[3] — nothing asynchronous, because the
 * estimator it corrects is called on the request path.
 *
 * @module @deepseek-ai/dsh-token-meter/usage-calibration
 */

/** One response's estimate against the count the provider reported for it. */
export interface UsageObservation {
  /** What `./estimate.ts` predicted for the content sent. */
  readonly estimatedTokens: number
  /** What the provider reported it actually charged for that content. */
  readonly reportedTokens: number
}

/**
 * The running correction for one session.
 *
 * A ratio rather than a difference: the estimator's error scales with content
 * size, so a session that once under-counted by 300 tokens on a large request
 * would over-correct every small one afterwards.
 */
export interface CalibrationState {
  /** Multiplier applied to a raw estimate; `1` until an observation lands. */
  readonly factor: number
  /** How many observations the factor rests on. */
  readonly samples: number
}

/** A session that has seen no response yet: no correction, no evidence. */
export const UNCALIBRATED: CalibrationState = { factor: 1, samples: 0 }

/**
 * The most a single observation may move the factor.
 *
 * Without a bound, one outlier — a truncated response, a provider counting a
 * cached prefix differently — would swing the next request's estimate by its
 * whole error. The correction is meant to converge, and a converging sequence
 * cannot be led by its worst member.
 */
const MAX_STEP = 0.25

/** Bounds on the factor itself, so no sequence of observations can invert the estimator. */
const MIN_FACTOR = 0.25
const MAX_FACTOR = 4

/** Clamp `value` into `[low, high]`. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * Fold one observation into the running calibration (must[1]).
 *
 * An observation that cannot inform the factor is IGNORED rather than folded:
 * a zero or negative estimate has no ratio to take, and a zero reported count
 * would drive the factor to its floor on a response the provider did not
 * charge for. Both return the state unchanged, so a caller cannot silently
 * degrade the correction by feeding it responses it learns nothing from.
 * @param state - the session's calibration so far.
 * @param observation - one response's estimate and reported count.
 * @returns the updated calibration.
 */
export function calibrate(state: CalibrationState, observation: UsageObservation): CalibrationState {
  const { estimatedTokens, reportedTokens } = observation
  if (!Number.isFinite(estimatedTokens) || !Number.isFinite(reportedTokens)) return state
  if (estimatedTokens <= 0 || reportedTokens <= 0) return state
  // The factor this single observation implies, relative to the CORRECTED
  // estimate rather than the raw one: the caller applied the current factor
  // before sending, so the residual error is what is left after it.
  const corrected = estimatedTokens * state.factor
  const implied = reportedTokens / corrected
  const step = clamp(implied, 1 - MAX_STEP, 1 + MAX_STEP)
  return {
    factor: clamp(state.factor * step, MIN_FACTOR, MAX_FACTOR),
    samples: state.samples + 1,
  }
}

/**
 * Apply a session's calibration to a raw estimate (must[3]).
 *
 * Synchronous and pure, like everything in `./estimate.ts`: this runs while a
 * request is being assembled, and an await here would put the network on the
 * path of deciding what to send.
 * @param state - the session's calibration.
 * @param estimatedTokens - the raw estimate from `./estimate.ts`.
 * @returns the corrected estimate, rounded up to a whole token.
 */
export function applyCalibration(state: CalibrationState, estimatedTokens: number): number {
  return Math.ceil(estimatedTokens * state.factor)
}

/**
 * How far a corrected estimate was from the reported count, as a fraction.
 *
 * Exported because "the error narrowed" is the claim acceptance[2] makes about
 * a session, and a caller asserting it needs the same measure the calibration
 * is trying to reduce rather than one it invents.
 * @param observation - one response's estimate and reported count.
 * @returns the absolute relative error, or `null` when there is nothing to measure against.
 */
export function relativeError(observation: UsageObservation): number | null {
  const { estimatedTokens, reportedTokens } = observation
  if (!Number.isFinite(estimatedTokens) || !Number.isFinite(reportedTokens) || reportedTokens <= 0) return null
  return Math.abs(estimatedTokens - reportedTokens) / reportedTokens
}
