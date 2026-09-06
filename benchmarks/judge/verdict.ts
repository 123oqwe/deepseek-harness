/**
 * How a benchmark task is scored (Epic P9-08, Contract stage).
 *
 * The number this benchmark produces is only worth having if a rerun on the
 * same commit produces the same number, so every check here is a mechanical
 * observation: a command's exit code, a file's contents, a test run's result.
 * **A model never scores a task** (must[0]). An LLM judge would make the metric
 * depend on a second model's mood, and the thing being measured is the first
 * one — a regression and a judge drift would be indistinguishable.
 *
 * Contract stage: pure decisions over observations a runner supplies. Nothing
 * here executes a task, reads a file, or spawns a process.
 *
 * @module benchmarks/judge/verdict
 */

/** One mechanical check a task must satisfy. */
export type TaskCheck =
  /** A command that must exit with `expectedExitCode`. */
  | { readonly kind: 'exit-code'; readonly id: string; readonly expectedExitCode: number }
  /** A file that must exist and contain `substring`. */
  | { readonly kind: 'file-contains'; readonly id: string; readonly path: string; readonly substring: string }
  /** A file that must NOT exist, or must not contain `substring` if it does. */
  | { readonly kind: 'file-omits'; readonly id: string; readonly path: string; readonly substring: string }

/** What the runner observed for one check. */
export interface CheckObservation {
  readonly id: string
  /** Whether the observation satisfied the check. */
  readonly satisfied: boolean
  /** What was seen, for the report's per-task evidence (must[1]). */
  readonly detail: string
}

/** Why a task did not pass. */
export type TaskFailure =
  /** At least one check was not satisfied. */
  | { readonly reason: 'check-failed'; readonly failed: readonly string[] }
  /** A check produced no observation at all — untested, which is never passed. */
  | { readonly reason: 'check-unobserved'; readonly missing: readonly string[] }
  /** The judge's own definition changed between freezing and scoring. */
  | { readonly reason: 'judge-tampered'; readonly detail: string }
  /** The task declares no checks, so passing it would mean nothing. */
  | { readonly reason: 'no-checks'; readonly detail: string }

/** One task's outcome. */
export type TaskVerdict =
  | { readonly passed: true; readonly checks: number }
  | { readonly passed: false; readonly failure: TaskFailure }

/**
 * Score one task from its checks and the runner's observations.
 *
 * Fails closed in three separate ways, because each is a different mistake and
 * collapsing them would hide which one happened:
 *
 * - a check with no observation is NOT a pass. A runner that crashed before
 *   running a check produces the same empty result as one whose check was
 *   satisfied trivially, and the benchmark must not read those alike.
 * - a task with no checks is NOT a pass. An empty task list is the cheapest
 *   possible way to make a score go up.
 * - an observation the runner supplied for a check the task never declared is
 *   ignored rather than counted, so a fabricated observation cannot add credit.
 *
 * @param checks - the task's frozen checks.
 * @param observations - what the runner saw, in any order.
 * @returns whether the task passed, and why not when it did not.
 */
export function judgeTask(
  checks: readonly TaskCheck[],
  observations: readonly CheckObservation[],
): TaskVerdict {
  if (checks.length === 0) {
    return { passed: false, failure: { reason: 'no-checks', detail: 'a task with no checks cannot be passed' } }
  }
  const byId = new Map(observations.map(observation => [observation.id, observation]))
  const missing = checks.filter(check => !byId.has(check.id)).map(check => check.id)
  if (missing.length > 0) return { passed: false, failure: { reason: 'check-unobserved', missing } }
  const failed = checks.filter(check => byId.get(check.id)?.satisfied !== true).map(check => check.id)
  if (failed.length > 0) return { passed: false, failure: { reason: 'check-failed', failed } }
  return { passed: true, checks: checks.length }
}

/**
 * Score a task whose judge definition may have been edited by the run itself
 * (must[5]).
 *
 * The executor works in the same workspace the checks describe, so "make the
 * checks pass" and "change the checks" are both available to it. The digest is
 * taken before the run and compared after; a mismatch is a FAIL for the task,
 * not a warning, because a task whose criteria moved has no score at all rather
 * than a low one.
 *
 * Checked BEFORE the checks themselves: a tampered judge may well report every
 * check satisfied, and reporting that as `check-failed` would name the wrong
 * cause.
 * @param frozenDigest - digest of the judge definition taken before the run.
 * @param observedDigest - digest taken after the run.
 * @param checks - the task's frozen checks.
 * @param observations - what the runner saw.
 * @returns the verdict, with tampering reported ahead of any check result.
 */
export function judgeTaskWithIntegrity(
  frozenDigest: string,
  observedDigest: string,
  checks: readonly TaskCheck[],
  observations: readonly CheckObservation[],
): TaskVerdict {
  if (frozenDigest !== observedDigest) {
    return {
      passed: false,
      failure: {
        reason: 'judge-tampered',
        detail: `judge definition changed during the run (frozen ${frozenDigest}, observed ${observedDigest})`,
      },
    }
  }
  return judgeTask(checks, observations)
}

/** Whether a suite may run at all, and what to report when it may not. */
export type SuiteStatus =
  | { readonly status: 'RUN' }
  /** No credential, so no task ran; must[3] forbids reporting this as a score. */
  | { readonly status: 'BLOCKED'; readonly reason: string }

/**
 * Decide whether the suite can produce a number (must[3]).
 *
 * A keyless environment must report BLOCKED rather than a success rate. Zero
 * tasks passing out of zero tasks run is arithmetically 0% or 100% depending on
 * the convention, and either is a fabricated measurement of a model that was
 * never asked anything.
 * @param apiKeyPresent - whether a usable credential was resolved.
 * @returns whether to run, or the blocked reason to report.
 */
export function resolveSuiteStatus(apiKeyPresent: boolean): SuiteStatus {
  return apiKeyPresent
    ? { status: 'RUN' }
    : { status: 'BLOCKED', reason: 'no model credential resolved; the suite reports BLOCKED rather than a success rate' }
}

/** A suite's aggregate over tasks that actually ran. */
export interface SuiteScore {
  readonly tasks: number
  readonly passed: number
  /** Passed over tasks, or `null` when no task ran — never 0 or 1 by default. */
  readonly successRate: number | null
}

/**
 * Aggregate task verdicts into the suite's number.
 *
 * `successRate` is `null` for an empty suite rather than `0`: the point of the
 * benchmark is that its number means something, and 0% claims every task failed
 * when none was attempted.
 * @param verdicts - one verdict per task that ran.
 * @returns the aggregate.
 */
export function scoreSuite(verdicts: readonly TaskVerdict[]): SuiteScore {
  const passed = verdicts.filter(verdict => verdict.passed).length
  return {
    tasks: verdicts.length,
    passed,
    successRate: verdicts.length === 0 ? null : passed / verdicts.length,
  }
}
