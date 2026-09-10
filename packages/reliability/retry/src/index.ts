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
 * The one exception is the circuit-breaker Service Definition in
 * `./provider.ts`: a breaker owns state over time, so it is a service a
 * profile mounts rather than a function a caller applies. The implementation
 * lives in `@deepseek-ai/dsh-retry-cockatiel`, and this package depends on no
 * breaker library.
 *
 * @module @deepseek-ai/dsh-retry
 */
import type {} from '@deepseek-ai/cordis'
import type { CircuitBreakerContract } from './provider.ts'

/**
 * The mounted circuit breaker, published by whichever provider a profile
 * mounts.
 *
 * Declared in the definition so the name means the contract rather than an
 * implementation, and two providers cannot disagree about what the service is.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    circuitBreaker: CircuitBreakerContract
  }
}

export { BreakerOpenError } from './provider.ts'
export type { BreakerDestination, CircuitBreakerContract } from './provider.ts'
export { classifyFailure, spendsRetryBudget } from './classify.ts'
export type { FailureFacts, PermanentReason, RetryVerdict } from './classify.ts'
export { admitRetry, NO_RETRIES_USED } from './budget.ts'
export type { BudgetDecision, BudgetDenialReason, RetryUsage, RunRetryBudget } from './budget.ts'
