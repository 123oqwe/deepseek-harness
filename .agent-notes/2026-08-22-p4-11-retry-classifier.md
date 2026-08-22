# P4-11 Retry Classifier Agent Note
## Status: IMPLEMENTED
## Date: 2026-08-22
## What was done
- Created packages/reliability/retry/ with:
  - src/types.ts: ErrorCategory, ErrorClassification, RetryBudgetSpec, CircuitState
  - src/classify.ts: classifyError, isSideEffectRetryable
  - src/budget.ts: RetryBudget with exponential backoff + jitter
  - src/circuit.ts: CircuitBreaker with closed/open/half-open
  - tests/retry.spec.ts: 17 tests
  - package.json, tsconfig.json, README.md
## Acceptance Criteria
- [x] Permanent 4xx, policy deny, invalid input not retried
- [x] Multiple plugins cannot exceed total Run budget
- [x] Provider circuit opens and recovers
## Dependencies: P4-01, P4-12
