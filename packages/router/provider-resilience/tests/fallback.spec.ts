import { describe, it, expect } from 'vitest'
import { HedgingManager, RateLimiter } from '../src/index.ts'

describe('P5-04 Provider Resilience', () => {
  it('allows hedging within limit', () => {
    const h = new HedgingManager()
    expect(h.canHedge('req-1', 2).allowed).toBe(true)
  })

  it('blocks hedging over limit', () => {
    const h = new HedgingManager()
    h.canHedge('req-1', 1)
    expect(h.canHedge('req-2', 1).allowed).toBe(false)
  })

  it('completes hedge with winner', () => {
    const h = new HedgingManager()
    h.canHedge('req-1', 2)
    const result = h.completeHedge('req-1', true)
    expect(result.winner).toBe('primary')
  })

  it('rate limiter allows within limit', () => {
    const rl = new RateLimiter()
    const result = rl.check('openai', 0)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(59)
  })

  it('rate limiter blocks when exhausted', () => {
    const rl = new RateLimiter()
    for (let i = 0; i < 60; i++) rl.check('openai', 0)
    expect(rl.check('openai', 0).allowed).toBe(false)
  })

  it('rate limiter resets after window', () => {
    const rl = new RateLimiter()
    for (let i = 0; i < 60; i++) rl.check('openai', 0)
    const result = rl.check('openai', 61000)
    expect(result.allowed).toBe(true)
  })

  it('updates from headers', () => {
    const rl = new RateLimiter()
    rl.check('openai', 0)
    rl.updateFromHeaders('openai', 10, 30000)
    expect(rl.getState('openai')?.tokensRemaining).toBe(10)
  })
})
