# Agent Note: P4-11 — Unified Retry Classifier, Circuit Breaker & Retry Budget
## Problem
LLM retry can stack multiple budgets, always-retry permanent failures, and retry side effects without idempotency.
## Contract
- classifyError: status/code → category + retryability
- RetryBudget: shared Run-level budget with exponential backoff + jitter
- CircuitBreaker: per-provider closed/open/half-open with 5 failure threshold
- isSideEffectRetryable: requires idempotency key for side effects
## State Machine
closed → (5 failures) → open → (30s timeout) → half-open → (3 successes) → closed
## Failure Semantics
- 403/400/422: never retryable
- Ambiguous: not retryable without idempotency key
- Budget exhausted: decision = 'budget-exhausted', no retry
- Circuit open: decision = 'circuit-open', no retry
## Rejection
- Retry without idempotency for side effects: rejected
- Retry exceeding total budget: rejected
- Retry while circuit open: rejected
