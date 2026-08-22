export interface EvalResult {
  readonly evalId: string
  readonly candidateId: string
  readonly metrics: {
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
  readonly replayable: boolean
  readonly auditable: boolean
}
