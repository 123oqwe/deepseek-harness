import type { CircuitState } from './types.ts'

const FAILURE_THRESHOLD = 5
const RECOVERY_TIMEOUT_MS = 30000
const HALF_OPEN_MAX_REQUESTS = 3

/** Circuit breaker for a provider. Prevents cascading failures. */
export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>()
  private readonly halfOpenSuccesses = new Map<string, number>()

  /** Record a failure for a provider. */
  recordFailure(provider: string, timestamp: number): CircuitState {
    const current = this.states.get(provider)
    const failureCount = (current?.failureCount ?? 0) + 1

    let state: CircuitState
    if (failureCount >= FAILURE_THRESHOLD) {
      state = {
        provider,
        state: 'open',
        failureCount,
        // eslint-disable-next-line no-unnecessary-condition
        ...(timestamp !== undefined && { lastFailureTime: timestamp }),
        openUntil: timestamp + RECOVERY_TIMEOUT_MS,
      }
    } else {
      state = {
        provider,
        state: 'closed',
        failureCount,
        // eslint-disable-next-line no-unnecessary-condition
        ...(timestamp !== undefined && { lastFailureTime: timestamp }),
      }
    }
    this.states.set(provider, state)
    return state
  }

  /** Record a success for a provider. */
  recordSuccess(provider: string): CircuitState {
    const current = this.states.get(provider)
    if (current?.state === 'half-open') {
      const successes = (this.halfOpenSuccesses.get(provider) ?? 0) + 1
      this.halfOpenSuccesses.set(provider, successes)
      if (successes >= HALF_OPEN_MAX_REQUESTS) {
        const closed: CircuitState = { provider, state: 'closed', failureCount: 0 }
        this.states.set(provider, closed)
        this.halfOpenSuccesses.delete(provider)
        return closed
      }
      return current
    }
    if (current?.state === 'closed') {
      const reset: CircuitState = { provider, state: 'closed', failureCount: 0 }
      this.states.set(provider, reset)
      return reset
    }
    return current ?? { provider, state: 'closed', failureCount: 0 }
  }

  /** Check if requests are allowed for a provider. */
  canRequest(provider: string, timestamp: number): { allowed: boolean; state: CircuitState } {
    const current = this.states.get(provider)
    if (!current) {
      const closed: CircuitState = { provider, state: 'closed', failureCount: 0 }
      return { allowed: true, state: closed }
    }

    if (current.state === 'open') {
      if (current.openUntil !== undefined && timestamp >= current.openUntil) {
        // Transition to half-open
        const halfOpen: CircuitState = {
          provider,
          state: 'half-open',
          failureCount: current.failureCount,
          ...(current.lastFailureTime !== undefined && { lastFailureTime: current.lastFailureTime }),
        }
        this.states.set(provider, halfOpen)
        this.halfOpenSuccesses.set(provider, 0)
        return { allowed: true, state: halfOpen }
      }
      return { allowed: false, state: current }
    }

    if (current.state === 'half-open') {
      return { allowed: true, state: current }
    }

    return { allowed: true, state: current }
  }

  /** Get current state for a provider. */
  getState(provider: string): CircuitState {
    return this.states.get(provider) ?? { provider, state: 'closed', failureCount: 0 }
  }
}
