export type RunState = 'running' | 'completed' | 'verifying' | 'accepted' | 'rejected' | 'needs-human' | 'compensating'

export interface RequiredCheck {
  readonly checkId: string
  readonly required: boolean
}

export interface RequiredApproval {
  readonly approvalId: string
  readonly approved: boolean
}

export interface GateInput {
  readonly verificationResults: readonly { checkId: string; status: string }[]
  readonly requiredChecks: readonly RequiredCheck[]
  readonly claimGraphStatuses: readonly { claimId: string; status: string }[]
  readonly requiredApprovals: readonly RequiredApproval[]
}

export interface GateDecision {
  readonly newState: RunState
  readonly accepted: boolean
  readonly reason: string
}
