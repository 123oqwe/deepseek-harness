/**
 * The one retry budget every in-scope layer accounts against (Epic P4-11
 * must[1], acceptance[1]).
 *
 * Pure and total. The budget is a VALUE a caller threads through, not a
 * counter this module owns: two mounted retry layers holding two counters is
 * precisely the defect the registry describes ("多个有限 budget 可叠加"), and a
 * module-level mutable count would reproduce it one layer down, where a second
 * import would get a second count.
 *
 * Accounting is per RUN rather than per request or per layer. A run that
 * retried five times has spent five attempts whether one layer spent them or
 * five layers spent one each, which is the whole of acceptance[1].
 *
 * **Scope (§12.64).** The layers in scope are LLM retry, MCP retries taken FOR
 * a run action, subagent attempts made on behalf of a parent run, and any
 * tool or web retry. The message-bus outbox is NOT one of them: its
 * `decideDelivery` is a per-message dead-letter policy inside the accepted
 * P4-06 and answers when to stop delivering a message, not how much a run may
 * spend redoing failed work. A background reconnect with no run attached
 * likewise spends nothing here and keeps its own policy.
 *
 * @module @deepseek-ai/dsh-retry/budget
 */

/** What a run is allowed to spend on retries. */
export interface RunRetryBudget {
  /** Retries permitted across the whole run; 0 forbids retrying at all. */
  readonly maxRetries: number
  /** Wall-clock ceiling for retry DELAYS, absent when only attempts are capped. */
  readonly maxDelayBudgetMs?: number
}

/** What a run has already spent, from every layer that retried. */
export interface RetryUsage {
  /** Retries already performed, by any in-scope layer. */
  readonly retriesUsed: number
  /** Milliseconds already committed to WAITING between attempts. */
  readonly delayMsUsed: number
}

/** Why one more retry is refused. */
export type BudgetDenialReason = 'retry-cap-reached' | 'delay-budget-exhausted'

/** Whether the run may spend one more retry, and what it would cost. */
export type BudgetDecision =
  | { readonly admitted: true; readonly next: RetryUsage }
  | { readonly admitted: false; readonly reason: BudgetDenialReason }

/**
 * The empty usage a run starts from.
 *
 * A shared constant rather than a literal at each call site: two spellings of
 * "spent nothing" is how one layer starts counting from a different zero.
 */
export const NO_RETRIES_USED: RetryUsage = Object.freeze({ retriesUsed: 0, delayMsUsed: 0 })

/**
 * Admit or refuse one more retry, returning the usage it would produce
 * (acceptance[1]).
 *
 * The caller passes the usage it holds and stores the returned `next`, so two
 * layers sharing one run share one total by construction rather than by
 * agreement. A refusal returns NO usage: there is nothing to store when
 * nothing was spent, and returning an unchanged usage would let a caller
 * record a refusal as if it had been admitted.
 *
 * The delay is charged on ADMISSION rather than after the wait, so a run
 * cannot begin a wait it has no budget to finish. The delay itself comes from
 * `@deepseek-ai/dsh-llm-retry`, which this epic unifies rather than replaces —
 * this module never computes one.
 * @param usage - what this run has spent so far, across every in-scope layer.
 * @param budget - what the run is allowed to spend.
 * @param delayMs - the wait this retry would take, already computed by the caller.
 * @returns the admission with the usage to store, or the refusal.
 */
export function admitRetry(usage: RetryUsage, budget: RunRetryBudget, delayMs: number): BudgetDecision {
  if (usage.retriesUsed >= budget.maxRetries) {
    return { admitted: false, reason: 'retry-cap-reached' }
  }
  const spend = Math.max(0, delayMs)
  const nextDelay = usage.delayMsUsed + spend
  if (budget.maxDelayBudgetMs !== undefined && nextDelay > budget.maxDelayBudgetMs) {
    return { admitted: false, reason: 'delay-budget-exhausted' }
  }
  return { admitted: true, next: { retriesUsed: usage.retriesUsed + 1, delayMsUsed: nextDelay } }
}
