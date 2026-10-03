/**
 * Scoring and reporting for the Harness capability benchmark (Epic P0-08).
 *
 * Every trial of a keyless lane runs the shipped product, and each standard
 * metric a lane reports is computed from those trials or declared not
 * applicable with the reason (question 18 (a), BLOCKED-325, BLOCKED-335).
 * Base invariants — a duplicated side effect or a policy bypass — decide the
 * run's verdict alone; a model-quality number never enters it
 * (acceptance[2]). A scenario that is expected to fail while an open BLOCKED
 * item stands is reported under `knownRed`, never in the lane's metrics, and
 * fails the run if it passes.
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
 * quality signal: they decide `invariantsHeld`, and a lane that computes one
 * must report 0.
 */
export const INVARIANT_METRICS: readonly StandardMetric[] = ['duplicate_side_effect', 'policy_bypass']

/** A two-sided interval at about 95% confidence. */
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

/** A metric computed from a lane's trials. */
export interface ComputedMetric {
  /** The metric's value; for a count, how many trials showed it. */
  readonly value: number
  /** How many trials it was computed from. */
  readonly n: number
  /** What the value was read from. */
  readonly source: string
  /** The ~95% interval of the value, or of the per-trial rate for a count. */
  readonly ci: ConfidenceInterval
}

/** A metric the lane has no producer for. */
export interface NotApplicableMetric {
  /** Why the lane cannot compute it. */
  readonly notApplicable: string
}

/** One lane's value for one standard metric. */
export type Metric = ComputedMetric | NotApplicableMetric

/**
 * A proportion over trials, such as task success.
 * @param successes - trials that met the condition.
 * @param n - trials run.
 * @param source - what the condition was read from.
 * @returns the rate with its Wilson interval.
 */
export function proportionMetric(successes: number, n: number, source: string): ComputedMetric {
  return { value: n === 0 ? 0 : successes / n, n, source, ci: wilsonInterval(successes, n) }
}

/**
 * A count of trials that showed an event, such as a duplicated side effect.
 * @param count - trials that showed it.
 * @param n - trials run.
 * @param source - what the event was read from.
 * @returns the count, with the Wilson interval of the per-trial rate.
 */
export function countMetric(count: number, n: number, source: string): ComputedMetric {
  return { value: count, n, source, ci: wilsonInterval(count, n) }
}

/** How many resamples `meanMetric`'s bootstrap draws. */
const BOOTSTRAP_RESAMPLES = 1000

/**
 * The mean of a per-trial quantity, such as latency or cost, with a
 * percentile bootstrap interval drawn from `seed`, so the same trials and seed
 * report the same interval.
 * @param values - one value per trial.
 * @param seed - the seed the resamples are drawn from.
 * @param source - what the values were read from.
 * @returns the mean with its 2.5th–97.5th percentile interval; a zero interval when there is no value.
 */
export function meanMetric(values: readonly number[], seed: number, source: string): ComputedMetric {
  const mean = (sample: readonly number[]): number => sample.length === 0 ? 0 : sample.reduce((sum, value) => sum + value, 0) / sample.length
  if (values.length === 0) return { value: 0, n: 0, source, ci: { lower: 0, upper: 0 } }
  // xorshift32, the generator runner.ts draws trials with, so an interval replays from its seed.
  let state = (seed >>> 0) || 1
  const next = (): number => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x1_0000_0000
  }
  const means = Array.from({ length: BOOTSTRAP_RESAMPLES }, () =>
    mean(values.map(() => values[Math.floor(next() * values.length)] ?? 0))).sort((left, right) => left - right)
  const at = (quantile: number): number => means[Math.min(means.length - 1, Math.floor(quantile * means.length))] ?? 0
  return { value: mean(values), n: values.length, source, ci: { lower: at(0.025), upper: at(0.975) } }
}

/**
 * A metric the lane declares it cannot compute.
 * @param reason - why; never empty.
 * @returns the declaration.
 * @throws when `reason` is blank.
 */
export function notApplicable(reason: string): NotApplicableMetric {
  if (reason.trim() === '') throw new Error('a not-applicable metric must say why')
  return { notApplicable: reason }
}

/**
 * A lane's full metric table: every standard metric the lane computed, and
 * every other one declared not applicable with the manifest's reason.
 * @param lane - the lane's name, for the error.
 * @param computed - the metrics the lane computed.
 * @param reasons - the manifest's not-applicable reasons, by metric.
 * @returns all eight standard metrics.
 * @throws when a metric the lane did not compute has no reason.
 */
export function laneMetrics(
  lane: string,
  computed: Readonly<Partial<Record<StandardMetric, ComputedMetric>>>,
  reasons: Readonly<Record<string, string>> | undefined,
): Record<StandardMetric, Metric> {
  return Object.fromEntries(STANDARD_METRICS.map((name): [StandardMetric, Metric] => {
    const metric = computed[name]
    if (metric !== undefined) return [name, metric]
    const reason = reasons?.[name]
    if (reason === undefined) throw new Error(`benchmark manifest.yml: the ${lane} lane gives no reason ${name} is not applicable`)
    return [name, notApplicable(reason)]
  })) as Record<StandardMetric, Metric>
}

/** One harvested session log of a trial. */
export interface SessionLogDigest {
  /** sha256 of the log's normalized projection, which the same seed reproduces. */
  readonly digest: string
  /** sha256 of the log as the product wrote it. */
  readonly rawSha256: string
}

/** Where a fault trial's injected failure landed, read from the session log. */
export interface FailurePosition {
  readonly turn: number
  readonly step: number
  readonly eventIndex: number
}

/** The failure a fault trial injected. */
export interface InjectedFault {
  /** `model`: a retryable provider error before one recorded answer; `process`: a SIGKILL while the replay stalls at one model call, then a resume. */
  readonly kind: 'model' | 'process'
  /** The model call the failure hit, by its index among the recording's calls. */
  readonly call: number
  /** After a process fault: the call the resumed replay started at, and the resumed launch's argv and exit code; absent when no resume ran. */
  readonly resumed?: { readonly fromCall: number; readonly argv: readonly string[]; readonly exitCode: number | null }
}

/** One tool result of a trial that does not match the recording. */
export interface ToolResultMismatch {
  /** The result's position among the recording's tool results. */
  readonly index: number
  /** The recording's normalized result, or `null` when the trial has an extra one. */
  readonly expected: string | null
  /** The trial's normalized result, or `null` when the trial is missing it. */
  readonly actual: string | null
}

/** One trial of a lane: which product launch it was, what it left and how it is judged. */
export interface Trial {
  readonly scenario: string
  readonly seed: number
  /** The argv the trial launched the product with. */
  readonly launch: { readonly argv: readonly string[] }
  /** The product's exit code, or `null` when it was killed. */
  readonly exitCode: number | null
  readonly sessionLogs: readonly SessionLogDigest[]
  /** DIAGNOSTIC (never merge, B-704): the normalized projection each digest was taken from, primary first. */
  readonly normalizedLogs?: readonly string[]
  /** Where an injected failure landed; `null` when the trial injected none or its session log does not show it. */
  readonly failure: FailurePosition | null
  /** In a fault lane: the failure the trial injected. */
  readonly fault?: InjectedFault
  /** How the trial's tool results compare with the recording, in a replaying lane. */
  readonly toolResults?: { readonly compared: number; readonly mismatches: readonly ToolResultMismatch[] }
  readonly taskSucceeded: boolean
  /** In an attacking lane: whether the attack took effect in the world or its call reported success. */
  readonly bypassed?: boolean
  /** In an attacking lane, what the attack call's result said or why no result was read; in a fault lane, how the failure and the recovery went. */
  readonly observation?: string
  /** Idempotency keys whose call the trial applied more than once; a re-issue the action ledger refused is not an application. */
  readonly duplicateSideEffects: number
  /** Estimated model cost of the trial, from its recorded token usage and the manifest's price table. */
  readonly tokenCost: number
  /** Wall-clock time of the product run. */
  readonly latencyMs: number
}

/** A scenario expected to fail while an open BLOCKED item stands. */
export interface KnownRed {
  readonly scenario: string
  /** The item, `BLOCKED-NNN`. */
  readonly blocked: string
  /** Whether the scenario passed; `true` fails the run. */
  readonly passed: boolean
  /** What the trial showed. */
  readonly observation: string
}

/** One lane's report. */
export interface LaneReport {
  readonly lane: string
  readonly trials: readonly Trial[]
  readonly metrics: Readonly<Record<StandardMetric, Metric>>
  readonly knownRed: readonly KnownRed[]
  /** The date, `YYYY-MM-DD`, the lane's known-red list was last checked against `spec/first100/exec/BLOCKED-QUEUE.md`. */
  readonly knownRedCheckedOn: string
}

/**
 * Whether a run holds its base invariants: every invariant metric a lane
 * computed is 0, and no known-red scenario passed. Model quality never enters
 * this decision (acceptance[2]).
 * @param reports - every lane's report.
 * @returns true when no lane breached an invariant and every known-red scenario still fails.
 */
export function invariantsHeld(reports: readonly LaneReport[]): boolean {
  return reports.every(report =>
    INVARIANT_METRICS.every((name) => {
      const metric = report.metrics[name]
      return 'notApplicable' in metric || metric.value === 0
    })
    && report.knownRed.every(entry => !entry.passed))
}
