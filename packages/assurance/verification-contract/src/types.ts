export type ContractStatus = 'draft' | 'frozen' | 'active' | 'satisfied' | 'failed' | 'expired'

export interface VerificationCriterion {
  readonly id: string
  readonly description: string
  readonly type: 'test' | 'file-exists' | 'command-output' | 'external-state' | 'policy-check'
  readonly expectedValue: string
  readonly actualValue?: string
  readonly passed?: boolean
}

export interface VerificationContract {
  readonly id: string
  readonly runPlanId: string
  readonly objective: string
  readonly criteria: readonly VerificationCriterion[]
  readonly verifierId: string
  readonly frozenAt: number
  readonly frozenBy: string
  readonly digest: string
  readonly status: ContractStatus
  readonly expiryMs: number
  readonly schemaVersion: string
}
