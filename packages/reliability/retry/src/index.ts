/**
 * Retry decision vocabulary for Epic P4-11's Contract stage: one failure
 * taxonomy read against the action ledger, one run-wide budget, one hedge rule.
 *
 * Every export is a pure function or a value type. The clock, the jitter
 * source, the backoff computation and the storage of budget usage all belong
 * to the caller — `@deepseek-ai/dsh-llm-retry` already computes backoff with
 * symmetric jitter, and this epic unifies that implementation rather than
 * placing a second one beside it (§12.64). What this package removes is the
 * duplication of the DECISION, not of the mechanics.
 *
 * @module @deepseek-ai/dsh-retry
 */
export { classifyFailure, spendsRetryBudget } from './classify.ts'
export type { FailureFacts, PermanentReason, RetryVerdict } from './classify.ts'
export { admitRetry, NO_RETRIES_USED } from './budget.ts'
export type { BudgetDecision, BudgetDenialReason, RetryUsage, RunRetryBudget } from './budget.ts'
