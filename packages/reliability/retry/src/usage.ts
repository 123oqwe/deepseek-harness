/**
 * Where one run's retry spending is kept, so the layers share a total rather
 * than agree to (Epic P4-11 must[1]).
 *
 * `admitRetry` is pure: it takes the usage a caller holds and returns the
 * usage that caller should store. Two layers can only share a total if they
 * read and write the SAME store, so the store is a service every layer reaches
 * rather than a field each keeps — a per-layer copy is precisely the stacking
 * this epic exists to end.
 */

import type { RunId } from '@deepseek-ai/dsh-principal/types'

import { admitRetry, NO_RETRIES_USED, type BudgetDecision, type RetryUsage, type RunRetryBudget } from './budget.ts'

/**
 * The mounted run-retry accounting, published by whichever provider a profile
 * mounts.
 *
 * `admit` decides AND stores in one call rather than exposing a read and a
 * write: two layers retrying concurrently would each read the same usage,
 * decide against it and store their own successor, and one retry would vanish.
 * The decision is the only thing a caller needs, and the arithmetic behind it
 * is not a caller's to redo.
 */
export interface RunRetryUsageContract {
  /**
   * Charge one retry to `run` if its budget allows it.
   * @param run - the run the retry is charged to — the DELEGATION ROOT's run,
   *   not the session that happens to be retrying.
   * @param budget - what that run is allowed to spend.
   * @param delayMs - the wait this retry would take, already computed.
   * @returns the admission, or the refusal and why.
   */
  admit(run: RunId, budget: RunRetryBudget, delayMs: number): BudgetDecision
  /**
   * What `run` has spent so far, for reporting.
   * @param run - the run to report on.
   * @returns its usage, or {@link NO_RETRIES_USED} when it has spent nothing.
   */
  usageOf(run: RunId): RetryUsage
}

/**
 * In-memory run-retry accounting.
 *
 * Not configurable and not durable: a retry budget bounds one run's live
 * attempts, and a run that has ended has nothing left to charge. Persisting it
 * would keep a record whose only reader is a run that no longer exists.
 */
export class RunRetryUsageStore implements RunRetryUsageContract {
  readonly #usage = new Map<RunId, RetryUsage>()

  /**
   * Charge one retry to `run` if its budget allows it (must[1]).
   * @param run - the delegation root's run.
   * @param budget - what that run may spend.
   * @param delayMs - the wait this retry would take.
   * @returns the admission with the usage now stored, or the refusal.
   */
  admit(run: RunId, budget: RunRetryBudget, delayMs: number): BudgetDecision {
    const decision = admitRetry(this.#usage.get(run) ?? NO_RETRIES_USED, budget, delayMs)
    // Stored on admission only: a refusal spent nothing, and recording it
    // would charge a run for a retry it was not allowed to make.
    if (decision.admitted) this.#usage.set(run, decision.next)
    return decision
  }

  /**
   * What `run` has spent so far.
   * @param run - the run to report on.
   * @returns its usage, or {@link NO_RETRIES_USED}.
   */
  usageOf(run: RunId): RetryUsage {
    return this.#usage.get(run) ?? NO_RETRIES_USED
  }

  /**
   * Forget a finished run's spending.
   *
   * Called when a run reaches a terminal state: without it this map holds one
   * entry per run for the life of the process, and nothing would ever read
   * them again.
   * @param run - the run that ended.
   */
  forget(run: RunId): void {
    this.#usage.delete(run)
  }
}
