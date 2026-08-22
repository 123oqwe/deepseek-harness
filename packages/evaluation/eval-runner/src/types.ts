export interface EvalMetrics {
  readonly verifiedTaskSuccess: number
  readonly policyViolations: number
  readonly duplicateSideEffects: number
  readonly recoveryRate: number
  readonly routerRegret: number
  readonly cost: number
  readonly latencyMs: number
  readonly humanInterventions: number
  readonly memoryPollution: number
  readonly evidenceCompleteness: number
}

export interface EvalResult {
  readonly evalId: string
  readonly candidateId: string
  readonly metrics: EvalMetrics
  readonly replayable: boolean
  readonly auditable: boolean
}

export interface EvalConfig {
  readonly mode: 'offline-replay' | 'shadow' | 'ab' | 'canary'
  readonly replayBundleId?: string | undefined
  readonly canaryThreshold?: { maxSuccessRateDegradation: number } | undefined
}
