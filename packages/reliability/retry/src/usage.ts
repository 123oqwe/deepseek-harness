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

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
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
   * Charge one retry to `run` if the budget allows it.
   *
   * The budget is the STORE's, not a parameter: two layers passing their own
   * allowances would share a total and disagree about the ceiling, which is
   * half of the stacking this epic ends. One store, one total, one allowance.
   * @param run - the run the retry is charged to — the DELEGATION ROOT's run,
   *   not the session that happens to be retrying.
   * @param delayMs - the wait this retry would take, already computed.
   * @returns the admission, or the refusal and why.
   */
  admit(run: RunId, delayMs: number): BudgetDecision
  /**
   * The run a session's retries are charged to, resolved once and remembered.
   *
   * Remembering is not a cache of something that might change: a session's
   * delegation root is fixed when the session is created, so the first
   * resolution is the only one there is. What it survives is the PARENT going
   * away — a continuable child outliving its parent's turn is ordinary, and
   * re-walking a chain whose parent is gone would hand that child a fresh
   * allowance, which is the stacking must[1] exists to stop.
   * @param session - the session retrying.
   * @param resolve - computes the charged run, called only on the first ask.
   * @returns the charged run, or `undefined` when none could be resolved.
   */
  chargedRunFor(session: string, resolve: () => RunId | undefined): RunId | undefined
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
  readonly #charged = new Map<string, RunId | undefined>()

  /**
   * @param budget - what any one run may spend across every in-scope layer.
   */
  constructor(private readonly budget: RunRetryBudget) {}

  /**
   * Charge one retry to `run` if the budget allows it (must[1]).
   * @param run - the delegation root's run.
   * @param delayMs - the wait this retry would take.
   * @returns the admission with the usage now stored, or the refusal.
   */
  admit(run: RunId, delayMs: number): BudgetDecision {
    const decision = admitRetry(this.#usage.get(run) ?? NO_RETRIES_USED, this.budget, delayMs)
    // Stored on admission only: a refusal spent nothing, and recording it
    // would charge a run for a retry it was not allowed to make.
    if (decision.admitted) this.#usage.set(run, decision.next)
    return decision
  }

  /**
   * The run a session's retries are charged to, resolved once (must[1]).
   * @param session - the session retrying.
   * @param resolve - computes the charged run, called only on the first ask.
   * @returns the charged run, or `undefined` when none could be resolved.
   */
  chargedRunFor(session: string, resolve: () => RunId | undefined): RunId | undefined {
    // An unresolvable answer is remembered too: without that, a child whose
    // chain never resolves re-walks it on every retry, and the walk reads live
    // registry state that a disposal can change underneath it.
    if (this.#charged.has(session)) return this.#charged.get(session)
    const charged = resolve()
    this.#charged.set(session, charged)
    return charged
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

  /**
   * Forget a session's charged run.
   *
   * Separate from {@link RunRetryUsageStore.forget} because the two maps are
   * keyed differently and end at different times: a run's spending is done
   * when the run ends, while a session's charged run is meaningful for as long
   * as that session can retry.
   * @param session - the session that ended.
   */
  forgetSession(session: string): void {
    this.#charged.delete(session)
  }
}

/** Deployment-varying run-retry allowance. */
export interface Config {
  /** Retries one run may make across every in-scope layer. */
  readonly maxRetries: number
  /** Milliseconds one run may spend WAITING between attempts; absent caps attempts only. */
  readonly maxDelayBudgetMs?: number
}

/**
 * Both fields vary by deployment: an interactive session and a long unattended
 * workflow tolerate very different amounts of redone work, and only the profile
 * knows which it is running.
 */
export const Config: z<Config> = z.object({
  maxRetries: z.natural().default(10),
  maxDelayBudgetMs: z.natural(),
})

/**
 * Mounts `ctx.runRetryUsage`, the one place a run's retry spending is counted.
 *
 * The definition provides its own implementation — the documented
 * self-providing pattern — because the accounting is a `Map` and an
 * arithmetic rule, with no deployment choice a second provider could make
 * differently. What varies is the ALLOWANCE, and that is `Config`.
 */
export default class RunRetryUsagePlugin extends Service implements RunRetryUsageContract {
  static readonly Config = Config

  private readonly store: RunRetryUsageStore

  /**
   * @param ctx - the mounting context; registers itself as `ctx.runRetryUsage`.
   * @param config - the allowance one run may spend.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'runRetryUsage')
    this.store = new RunRetryUsageStore(config)
  }

  /**
   * Charge one retry to `run` if the budget allows it (must[1]).
   * @param run - the delegation root's run.
   * @param delayMs - the wait this retry would take.
   * @returns the admission with the usage now stored, or the refusal.
   */
  admit(run: RunId, delayMs: number): BudgetDecision {
    return this.store.admit(run, delayMs)
  }

  /**
   * The run a session's retries are charged to, resolved once (must[1]).
   * @param session - the session retrying.
   * @param resolve - computes the charged run, called only on the first ask.
   * @returns the charged run, or `undefined` when none could be resolved.
   */
  chargedRunFor(session: string, resolve: () => RunId | undefined): RunId | undefined {
    return this.store.chargedRunFor(session, resolve)
  }

  /**
   * What `run` has spent so far.
   * @param run - the run to report on.
   * @returns its usage, or {@link NO_RETRIES_USED}.
   */
  usageOf(run: RunId): RetryUsage {
    return this.store.usageOf(run)
  }

  /**
   * Forget a finished run's spending.
   * @param run - the run that ended.
   */
  forget(run: RunId): void {
    this.store.forget(run)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    runRetryUsage: RunRetryUsageContract
  }
}
