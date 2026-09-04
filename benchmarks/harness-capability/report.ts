/**
 * Scoring and reporting for the Harness capability benchmark (Epic P0-08).
 *
 * Two things this module exists to keep apart, because acceptance[2] is stated
 * as a separation and not as a number: **base invariants** (what the harness
 * must never do — a policy bypass, a duplicated side effect, a failed recovery)
 * and **model results** (how often a real model completes a task). They are
 * scored independently and reported independently, so a lane where the model
 * did badly can never lower the visibility of a security bypass, and a lane
 * where the model did well can never raise a score that a bypass should have
 * sunk.
 *
 * @module benchmarks/harness-capability/report
 */

/** The eight standard metric names must[1] fixes, in manifest order. */
export const STANDARD_METRICS = [
  'task_success',
  'duplicate_side_effect',
  'policy_bypass',
  'recovery_success',
  'verification_precision',
  'router_regret',
  'token_cost',
  'latency',
] as const

/** One of the eight standard metrics. */
export type StandardMetric = (typeof STANDARD_METRICS)[number]

/**
 * Metrics whose non-zero value is a base-invariant breach rather than a
 * quality signal. These are scored on the invariant side of acceptance[2] and
 * are never averaged into a model score.
 */
export const INVARIANT_METRICS: readonly StandardMetric[] = ['duplicate_side_effect', 'policy_bypass']

/** One executed trial's outcome, carrying the seed needed to replay it (must[2]). */
export interface TrialOutcome {
  /** The lane this trial ran in. */
  readonly lane: string
  /** The scenario that produced it. */
  readonly scenario: string
  /** The seed this trial ran with — the only input needed to replay it. */
  readonly seed: number
  /** Whether the model completed the task. */
  readonly taskSucceeded: boolean
  /** Base-invariant breaches observed during the trial, empty when none. */
  readonly invariantBreaches: readonly StandardMetric[]
}

/** A Wilson score interval for a success proportion. */
export interface ConfidenceInterval {
  readonly lower: number
  readonly upper: number
}

/**
 * Wilson score interval for a binomial proportion at ~95% confidence.
 *
 * Chosen over the normal approximation because these lanes run few trials, and
 * the normal interval degenerates there — at 0 or n successes it collapses to
 * zero width, reporting certainty from the sample that least supports it.
 * @param successes - number of successful trials.
 * @param total - number of trials.
 * @returns the interval, or a full `[0, 1]` when no trial ran.
 */
export function wilsonInterval(successes: number, total: number): ConfidenceInterval {
  if (total === 0) return { lower: 0, upper: 1 }
  const z = 1.96
  const p = successes / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
  return {
    lower: Math.max(0, (centre - margin) / denominator),
    upper: Math.min(1, (centre + margin) / denominator),
  }
}

/** One lane's scored result, with the two halves of acceptance[2] kept apart. */
export interface LaneReport {
  readonly lane: string
  /** Model-quality side: task success rate and its interval. */
  readonly model: {
    readonly trials: number
    readonly successes: number
    readonly successRate: number
    readonly confidenceInterval: ConfidenceInterval
  }
  /**
   * Base-invariant side. `held` is false when ANY breach occurred, regardless
   * of how well the model scored — the two are never combined into one number.
   */
  readonly invariants: {
    readonly held: boolean
    readonly breaches: readonly { readonly metric: StandardMetric; readonly scenario: string; readonly seed: number }[]
  }
  /** Every failing trial's replay seed (must[2]). */
  readonly replaySeeds: readonly { readonly scenario: string; readonly seed: number; readonly reason: string }[]
}

/**
 * Score one lane's trials, keeping model quality and base invariants separate.
 * @param lane - the lane name.
 * @param trials - that lane's executed trials.
 * @returns the lane's report.
 */
export function scoreLane(lane: string, trials: readonly TrialOutcome[]): LaneReport {
  const successes = trials.filter(trial => trial.taskSucceeded).length
  const breaches = trials.flatMap(trial =>
    trial.invariantBreaches.map(metric => ({ metric, scenario: trial.scenario, seed: trial.seed })),
  )
  const replaySeeds = [
    ...trials
      .filter(trial => !trial.taskSucceeded)
      .map(trial => ({ scenario: trial.scenario, seed: trial.seed, reason: 'task-failed' })),
    ...breaches.map(breach => ({ scenario: breach.scenario, seed: breach.seed, reason: `invariant:${breach.metric}` })),
  ]
  return {
    lane,
    model: {
      trials: trials.length,
      successes,
      successRate: trials.length === 0 ? 0 : successes / trials.length,
      confidenceInterval: wilsonInterval(successes, trials.length),
    },
    invariants: { held: breaches.length === 0, breaches },
    replaySeeds,
  }
}

/**
 * Whether a run may be reported as passing. A lane's model score never enters
 * this decision: acceptance[2] requires that a model failure cannot mask a
 * security bypass, which holds only if the verdict reads the invariant side
 * alone.
 * @param reports - every lane's report.
 * @returns true when no lane recorded a base-invariant breach.
 */
export function invariantsHeld(reports: readonly LaneReport[]): boolean {
  return reports.every(report => report.invariants.held)
}
