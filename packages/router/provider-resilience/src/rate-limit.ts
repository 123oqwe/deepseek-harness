export interface RateLimitState {
  readonly provider: string
  readonly requestsPerWindow: number
  readonly windowMs: number
  readonly tokensRemaining: number
  readonly resetAt: number
}

export class RateLimiter {
  private states = new Map<string, RateLimitState>()

  check(provider: string, now: number): { allowed: boolean; resetAt: number; remaining: number } {
    const state = this.states.get(provider)
    if (!state) {
      const newState: RateLimitState = {
        provider, requestsPerWindow: 60, windowMs: 60000,
        tokensRemaining: 59, resetAt: now + 60000,
      }
      this.states.set(provider, newState)
      return { allowed: true, resetAt: newState.resetAt, remaining: newState.tokensRemaining }
    }

    if (now >= state.resetAt) {
      const newState: RateLimitState = {
        ...state, tokensRemaining: state.requestsPerWindow - 1,
        resetAt: now + state.windowMs,
      }
      this.states.set(provider, newState)
      return { allowed: true, resetAt: newState.resetAt, remaining: newState.tokensRemaining }
    }

    if (state.tokensRemaining <= 0) {
      return { allowed: false, resetAt: state.resetAt, remaining: 0 }
    }

    const newState = { ...state, tokensRemaining: state.tokensRemaining - 1 }
    this.states.set(provider, newState)
    return { allowed: true, resetAt: state.resetAt, remaining: newState.tokensRemaining }
  }

  updateFromHeaders(provider: string, remaining: number, resetAt: number): void {
    const state = this.states.get(provider)
    if (state) {
      this.states.set(provider, { ...state, tokensRemaining: remaining, resetAt })
    }
  }

  getState(provider: string): RateLimitState | undefined {
    return this.states.get(provider)
  }
}
