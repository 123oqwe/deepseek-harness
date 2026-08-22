import type { ModelCandidate, RoutingRequest, RoutingResult } from './types.ts'

export function scoreCandidate(candidate: ModelCandidate, request: RoutingRequest): number {
  let score = 0

  // Privacy check (disqualifier)
  if (!privacyLevelSatisfies(candidate.privacyLevel, request.requiredPrivacy)) {
    return -1
  }

  // Tool support check (disqualifier)
  if (request.requiresTools && !candidate.toolSupport) {
    return -1
  }

  // Context window check (disqualifier)
  if (candidate.contextWindow < request.estimatedTokens) {
    return -1
  }

  // Success rate (0-40 points)
  score += candidate.successRate * 40

  // Cost efficiency (0-30 points)
  const costScore = Math.max(0, 30 - (candidate.costPer1kTokens / request.maxCost) * 30)
  score += costScore

  // Latency (0-20 points)
  const latencyScore = Math.max(0, 20 - (candidate.latencyMs / request.maxLatencyMs) * 20)
  score += latencyScore

  // Privacy bonus (0-10 points)
  const privacyScores: Record<string, number> = { public: 10, confidential: 7, restricted: 4 }
  score += privacyScores[candidate.privacyLevel] ?? 0

  return score
}

export function routeModel(candidates: readonly ModelCandidate[], request: RoutingRequest): RoutingResult | undefined {
  const scored = candidates
    .filter(c => c.available)
    .map(c => ({ candidate: c, score: scoreCandidate(c, request) }))
    .filter(s => s.score >= 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return undefined

  const best = scored[0]
  if (!best) return undefined
  const fallback = scored.length > 1 ? scored[1]?.candidate : undefined

  return {
    selected: best.candidate,
    reason: `Best score ${best.score.toFixed(1)}`,
    score: best.score,
    fallback,
  }
}

function privacyLevelSatisfies(candidate: 'public' | 'confidential' | 'restricted', required: 'public' | 'confidential' | 'restricted'): boolean {
  const levels: Record<string, number> = { public: 1, confidential: 2, restricted: 3 }
  return levels[candidate] >= levels[required]
}
