export type VerifierKind = 'deterministic' | 'model' | 'human' | 'quorum'
export type CheckStatus = 'pass' | 'fail' | 'abstain' | 'timeout' | 'unverified'

export interface VerificationRequest {
  readonly runId: string
  readonly executorId: string
  readonly verificationContractId: string
  readonly evidenceRefs: readonly string[]
  readonly requiredChecks: readonly string[]
}

export interface CheckResult {
  readonly checkId: string
  readonly status: CheckStatus
  readonly reason: string
  readonly evidenceRef?: string | undefined
}

export interface VerificationReport {
  readonly request: VerificationRequest
  readonly verifierId: string
  readonly results: readonly CheckResult[]
  readonly summary: 'pass' | 'fail' | 'abstain' | 'degraded'
}

export interface VerifierProvider {
  readonly id: string
  readonly kind: VerifierKind
  readonly verify: (request: VerificationRequest, evidence: ReadonlyMap<string, unknown>) => Promise<VerificationReport>
}

export interface VerifierAssignment {
  readonly verifierId: string
  readonly executorId: string
  readonly canVerifyExecutor: boolean
  readonly reason: string
}
