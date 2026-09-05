/**
 * What it means for an adapter route to have passed conformance
 * (Epic P9-01, Contract stage).
 *
 * `LlmAdapter`'s observable behaviour is defined today only by what
 * `llm-deepseek` happens to do, so a new route — a pi-ai protocol, another
 * service — has no way to show it connected correctly. This module defines the
 * behaviours a route must demonstrate, and the decision must[1] calls the
 * registration gate: whether a route may be offered for use at all.
 *
 * Contract stage. The kit that PRODUCES these results, and the mock servers it
 * runs against, are the Provider stage; nothing here performs I/O or knows what
 * a wire protocol looks like.
 *
 * @module @deepseek-ai/dsh-llm/conformance
 */

/**
 * The six observable behaviours a route must demonstrate (must[0]).
 *
 * Each names something a caller depends on and cannot check for itself once a
 * route is in use. They are enumerated as a closed union rather than free
 * strings so that adding a behaviour is a compile error at every gate that
 * consults one, instead of a silently weaker standard.
 */
export type ConformanceBehavior =
  /** Tool calls arriving as incremental deltas are merged into whole calls. */
  | 'streaming-tool-call-deltas'
  /** Several tool calls in one response are all surfaced, not just the first. */
  | 'parallel-tool-calls'
  /** An abort mid-stream stops the stream and reports cancellation. */
  | 'mid-stream-abort'
  /** Transport and status failures map onto `llm-retry`'s classification. */
  | 'error-retry-classification'
  /** Reported usage, cache reads and cache writes are accounted consistently. */
  | 'usage-accounting'
  /** An over-long input is refused with a typed rejection rather than truncated. */
  | 'oversized-input-rejection'

/** Every behaviour a route must demonstrate, in a fixed order for reporting. */
export const REQUIRED_BEHAVIORS: readonly ConformanceBehavior[] = [
  'streaming-tool-call-deltas',
  'parallel-tool-calls',
  'mid-stream-abort',
  'error-retry-classification',
  'usage-accounting',
  'oversized-input-rejection',
]

/** One behaviour's outcome for one route. */
export interface ConformanceOutcome {
  readonly behavior: ConformanceBehavior
  readonly passed: boolean
  /** How many cases the kit ran for this behaviour. */
  readonly cases: number
}

/** Why a route may not be registered as usable. */
export type ConformanceDenialReason =
  /** A required behaviour has no result at all — untested, which is not passed. */
  | 'behavior-not-demonstrated'
  /** A required behaviour was demonstrated and failed. */
  | 'behavior-failed'
  /** A behaviour reported a pass while running no cases, which shows nothing. */
  | 'behavior-vacuous'

/** Whether a route may be offered for use. */
export type ConformanceDecision =
  | { readonly admitted: true }
  | {
    readonly admitted: false
    readonly reason: ConformanceDenialReason
    /** The behaviours responsible, in `REQUIRED_BEHAVIORS` order. */
    readonly behaviors: readonly ConformanceBehavior[]
  }

/**
 * Decide whether a route may be registered as usable (must[1]).
 *
 * **An absent result denies.** A behaviour nobody ran is not a behaviour that
 * works, and the difference is the entire reason this gate exists: a route that
 * skipped the abort cases and one that handles aborts correctly are
 * indistinguishable from their result sets unless absence is a denial. Treating
 * a missing result as a pass would make the gate strongest against routes that
 * bothered to test and weakest against routes that did not.
 *
 * **A pass over zero cases denies too.** A behaviour that reports success
 * without running anything has demonstrated nothing, and it is the shape a
 * broken kit produces — a suite that silently matched no cases still reports
 * every one of them green.
 *
 * Denials are reported by class, most fundamental first: nothing demonstrated,
 * then vacuous demonstrations, then real failures. A route missing half its
 * behaviours should be told that before it is told which of the rest failed.
 * @param outcomes - what the kit observed for this route.
 * @returns whether the route may be offered for use.
 */
export function admitConformantRoute(outcomes: readonly ConformanceOutcome[]): ConformanceDecision {
  const byBehavior = new Map<ConformanceBehavior, ConformanceOutcome>()
  for (const outcome of outcomes) byBehavior.set(outcome.behavior, outcome)

  const missing = REQUIRED_BEHAVIORS.filter(behavior => !byBehavior.has(behavior))
  if (missing.length > 0) {
    return { admitted: false, reason: 'behavior-not-demonstrated', behaviors: missing }
  }

  const vacuous = REQUIRED_BEHAVIORS.filter((behavior) => {
    const outcome = byBehavior.get(behavior)
    return outcome !== undefined && outcome.passed && outcome.cases === 0
  })
  if (vacuous.length > 0) {
    return { admitted: false, reason: 'behavior-vacuous', behaviors: vacuous }
  }

  const failed = REQUIRED_BEHAVIORS.filter(behavior => byBehavior.get(behavior)?.passed === false)
  if (failed.length > 0) {
    return { admitted: false, reason: 'behavior-failed', behaviors: failed }
  }

  return { admitted: true }
}

/**
 * Behaviours a route demonstrated beyond the required set.
 *
 * Reported rather than rejected: a kit may grow behaviours before this build
 * knows them, and refusing a route for demonstrating MORE than required would
 * make the gate fail on improvement.
 * @param outcomes - what the kit observed.
 * @returns behaviours not in {@link REQUIRED_BEHAVIORS}, in the order given.
 */
export function extraBehaviors(outcomes: readonly ConformanceOutcome[]): readonly string[] {
  const required = new Set<string>(REQUIRED_BEHAVIORS)
  return outcomes.map(outcome => outcome.behavior as string).filter(behavior => !required.has(behavior))
}
