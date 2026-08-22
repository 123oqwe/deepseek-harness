export interface ModelCandidate {
  readonly provider: string
  readonly model: string
  readonly successRate: number
  readonly costPer1kTokens: number
  readonly latencyMs: number
  readonly privacyLevel: 'public' | 'confidential' | 'restricted'
  readonly toolSupport: boolean
  readonly contextWindow: number
  readonly available: boolean
}

export interface RoutingRequest {
  readonly requiredPrivacy: 'public' | 'confidential' | 'restricted'
  readonly requiresTools: boolean
  readonly estimatedTokens: number
  readonly maxCost: number
  readonly maxLatencyMs: number
}

export interface RoutingResult {
  readonly selected: ModelCandidate
  readonly reason: string
  readonly score: number
  readonly fallback?: ModelCandidate
}
