export type { ErrorCategory, RetryDecision, ErrorClassification, RetryBudgetSpec, RetryAttempt, CircuitState } from './types.ts'
export { classifyError, isSideEffectRetryable } from './classify.ts'
export { RetryBudget, DEFAULT_BUDGET } from './budget.ts'
export { CircuitBreaker } from './circuit.ts'
