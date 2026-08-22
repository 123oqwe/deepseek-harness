import { describe, it, expect } from 'vitest'
import { routeModel, scoreCandidate } from '../src/index.ts'
import type { ModelCandidate, RoutingRequest } from '../src/index.ts'

const candidates: ModelCandidate[] = [
  { provider: 'openai', model: 'gpt-4', successRate: 0.95, costPer1kTokens: 0.03, latencyMs: 2000, privacyLevel: 'public', toolSupport: true, contextWindow: 128000, available: true },
  { provider: 'anthropic', model: 'claude-3', successRate: 0.92, costPer1kTokens: 0.015, latencyMs: 1500, privacyLevel: 'confidential', toolSupport: true, contextWindow: 200000, available: true },
  { provider: 'local', model: 'llama-3', successRate: 0.80, costPer1kTokens: 0.001, latencyMs: 500, privacyLevel: 'restricted', toolSupport: false, contextWindow: 8000, available: true },
  { provider: 'unavailable', model: 'x', successRate: 0.5, costPer1kTokens: 0.1, latencyMs: 5000, privacyLevel: 'public', toolSupport: true, contextWindow: 32000, available: false },
]

const request: RoutingRequest = {
  requiredPrivacy: 'confidential', requiresTools: true, estimatedTokens: 50000, maxCost: 0.05, maxLatencyMs: 3000,
}

describe('P5-02 Model Router', () => {
  it('scores candidates', () => {
    const score = scoreCandidate(candidates[1]!, request)
    expect(score).toBeGreaterThan(0)
  })

  it('disqualifies insufficient privacy', () => {
    const score = scoreCandidate(candidates[0]!, request)
    expect(score).toBe(-1)
  })

  it('disqualifies missing tool support', () => {
    const score = scoreCandidate(candidates[2]!, { ...request, requiredPrivacy: 'restricted' })
    expect(score).toBe(-1)
  })

  it('disqualifies small context window', () => {
    const score = scoreCandidate(candidates[2]!, { ...request, requiresTools: false, requiredPrivacy: 'restricted', estimatedTokens: 20000 })
    expect(score).toBe(-1)
  })

  it('routes to best candidate', () => {
    const result = routeModel(candidates, request)
    expect(result).toBeDefined()
    expect(result?.selected.provider).toBe('anthropic')
  })

  it('provides fallback when multiple qualify', () => {
    const result = routeModel(candidates, { ...request, requiredPrivacy: 'public' as const })
    expect(result?.fallback).toBeDefined()
  })

  it('filters unavailable candidates', () => {
    const result = routeModel(candidates, request)
    expect(result?.selected.provider).not.toBe('unavailable')
  })

  it('returns undefined when no candidates qualify', () => {
    const result = routeModel(candidates, { ...request, requiredPrivacy: 'restricted', estimatedTokens: 500000 })
    expect(result).toBeUndefined()
  })

  it('selects cheaper model when cost is priority', () => {
    const cheapReq = { ...request, maxCost: 0.002, requiredPrivacy: 'public' as const, requiresTools: false, estimatedTokens: 5000 }
    const result = routeModel(candidates, cheapReq)
    expect(result?.selected.provider).toBe('local')
  })
})
