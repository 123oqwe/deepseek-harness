import { describe, it, expect } from 'vitest'
import { classifyError, isSideEffectRetryable, RetryBudget, DEFAULT_BUDGET, CircuitBreaker } from '../src/index.ts'

describe('P4-11 Retry Classifier', () => {
  describe('classifyError', () => {
    it('classifies 429 as rate-limited and retryable', () => {
      const result = classifyError({ status: 429 })
      expect(result.category).toBe('rate-limited')
      expect(result.retryable).toBe(true)
    })

    it('classifies 403 as policy-denied and not retryable', () => {
      const result = classifyError({ status: 403 })
      expect(result.category).toBe('policy-denied')
      expect(result.retryable).toBe(false)
    })

    it('classifies 400 as invalid-input and not retryable', () => {
      const result = classifyError({ status: 400 })
      expect(result.category).toBe('invalid-input')
      expect(result.retryable).toBe(false)
    })

    it('classifies 404 as permanent and not retryable', () => {
      const result = classifyError({ status: 404 })
      expect(result.category).toBe('permanent')
      expect(result.retryable).toBe(false)
    })

    it('classifies 500 as server-error and retryable', () => {
      const result = classifyError({ status: 500 })
      expect(result.category).toBe('server-error')
      expect(result.retryable).toBe(true)
    })

    it('classifies ECONNRESET as network-error and retryable', () => {
      const result = classifyError({ code: 'ECONNRESET' })
      expect(result.category).toBe('network-error')
      expect(result.retryable).toBe(true)
    })

    it('classifies ambiguous as not retryable', () => {
      const result = classifyError({ message: 'ambiguous completion' })
      expect(result.category).toBe('ambiguous')
      expect(result.retryable).toBe(false)
    })

    it('classifies timeout as retryable', () => {
      const result = classifyError({ code: 'ETIMEDOUT' })
      expect(result.category).toBe('timeout')
      expect(result.retryable).toBe(true)
    })
  })

  describe('isSideEffectRetryable', () => {
    it('rejects side effect without idempotency key', () => {
      const classification = classifyError({ status: 500 })
      expect(isSideEffectRetryable(classification, false)).toBe(false)
    })

    it('allows side effect with idempotency key for retryable errors', () => {
      const classification = classifyError({ status: 500 })
      expect(isSideEffectRetryable(classification, true)).toBe(true)
    })

    it('rejects even with idempotency key for non-retryable errors', () => {
      const classification = classifyError({ status: 403 })
      expect(isSideEffectRetryable(classification, true)).toBe(false)
    })
  })

  describe('RetryBudget', () => {
    it('allows retry within budget', () => {
      const budget = new RetryBudget(DEFAULT_BUDGET)
      const result = budget.canRetry('action-1', 0)
      expect(result.decision).toBe('retry')
      expect(result.delayMs).toBeGreaterThanOrEqual(0)
    })

    it('exhausts per-action budget', () => {
      const budget = new RetryBudget({ ...DEFAULT_BUDGET, maxAttempts: 2 })
      budget.recordRetry('action-1', 0, 100)
      budget.recordRetry('action-1', 1, 200)
      const result = budget.canRetry('action-1', 2)
      expect(result.decision).toBe('budget-exhausted')
    })

    it('exhausts total budget across actions', () => {
      const budget = new RetryBudget({ ...DEFAULT_BUDGET, maxTotalRetries: 2 })
      budget.recordRetry('action-1', 0, 100)
      budget.recordRetry('action-2', 0, 100)
      const result = budget.canRetry('action-3', 0)
      expect(result.decision).toBe('budget-exhausted')
    })

    it('multiple plugins cannot exceed total budget', () => {
      const budget = new RetryBudget({ ...DEFAULT_BUDGET, maxTotalRetries: 3 })
      budget.recordRetry('plugin-a-action', 0, 100)
      budget.recordRetry('plugin-b-action', 0, 100)
      budget.recordRetry('plugin-c-action', 0, 100)
      const result = budget.canRetry('plugin-d-action', 0)
      expect(result.decision).toBe('budget-exhausted')
    })

    it('computes exponential backoff', () => {
      const budget = new RetryBudget({ ...DEFAULT_BUDGET, baseDelayMs: 100, maxDelayMs: 10000, jitterRatio: 0 })
      const r1 = budget.canRetry('a', 0)
      const r2 = budget.canRetry('a', 1)
      const r3 = budget.canRetry('a', 2)
      expect(r2.delayMs).toBeGreaterThanOrEqual(r1.delayMs)
      expect(r3.delayMs).toBeGreaterThanOrEqual(r2.delayMs)
    })
  })

  describe('CircuitBreaker', () => {
    it('starts closed', () => {
      const cb = new CircuitBreaker()
      const result = cb.canRequest('provider-1', 0)
      expect(result.allowed).toBe(true)
      expect(result.state.state).toBe('closed')
    })

    it('opens after threshold failures', () => {
      const cb = new CircuitBreaker()
      for (let i = 0; i < 5; i++) {
        cb.recordFailure('provider-1', i * 1000)
      }
      const result = cb.canRequest('provider-1', 6000)
      expect(result.allowed).toBe(false)
      expect(result.state.state).toBe('open')
    })

    it('transitions to half-open after timeout', () => {
      const cb = new CircuitBreaker()
      for (let i = 0; i < 5; i++) {
        cb.recordFailure('provider-1', i * 1000)
      }
      const result = cb.canRequest('provider-1', 35000)
      expect(result.state.state).toBe('half-open')
    })

    it('closes after enough half-open successes', () => {
      const cb = new CircuitBreaker()
      for (let i = 0; i < 5; i++) {
        cb.recordFailure('provider-1', i * 1000)
      }
      cb.canRequest('provider-1', 35000) // transition to half-open
      cb.recordSuccess('provider-1')
      cb.recordSuccess('provider-1')
      cb.recordSuccess('provider-1')
      const finalState = cb.getState('provider-1')
      expect(finalState.state).toBe('closed')
    })

    it('reopens on half-open failure', () => {
      const cb = new CircuitBreaker()
      for (let i = 0; i < 5; i++) {
        cb.recordFailure('provider-1', i * 1000)
      }
      cb.canRequest('provider-1', 35000) // half-open
      cb.recordFailure('provider-1', 36000) // failure during half-open
      const state = cb.getState('provider-1')
      expect(state.state).toBe('open')
    })
  })
})
