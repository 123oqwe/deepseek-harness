/** Unified retry types: error taxonomy, budget, circuit breaker. */

export type ErrorCategory =
  | 'permanent'
  | 'transient'
  | 'rate-limited'
  | 'timeout'
  | 'policy-denied'
  | 'invalid-input'
  | 'server-error'
  | 'network-error'
  | 'ambiguous'

export type RetryDecision = 'retry' | 'fail' | 'circuit-open' | 'budget-exhausted'

export interface ErrorClassification {
  readonly category: ErrorCategory
  readonly retryable: boolean
  readonly reason: string
  readonly retryAfterMs?: number
}

export interface RetryBudgetSpec {
  readonly maxAttempts: number
  readonly maxTotalRetries: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

export interface RetryAttempt {
  readonly attempt: number
  readonly delayMs: number
  readonly error?: ErrorClassification
}

export interface CircuitState {
  readonly provider: string
  readonly state: 'closed' | 'open' | 'half-open'
  readonly failureCount: number
  readonly lastFailureTime?: number
  readonly openUntil?: number
}
