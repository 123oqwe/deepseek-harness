# @deepseek-ai/dsh-retry
Unified retry classifier, circuit breaker, and retry budget for the Harness.
## Overview
- **classifyError**: HTTP status / error code → retryability taxonomy
- **RetryBudget**: Shared budget across plugins with exponential backoff + jitter
- **CircuitBreaker**: Per-provider circuit with closed → open → half-open recovery
- **isSideEffectRetryable**: Side effects only retryable with idempotency key
## Key Invariants
- Policy denials (403) and invalid input (400/422) are never retryable
- Multiple plugins cannot exceed the total Run retry budget
- Ambiguous completion requires idempotency key to retry
- Circuit opens after 5 failures, recovers after 30s timeout
