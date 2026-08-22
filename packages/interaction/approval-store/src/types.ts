export type ApprovalState = 'requested' | 'approved' | 'denied' | 'expired' | 'revoked' | 'consumed'

export interface ApprovalRecord {
  readonly id: string
  readonly runId: string
  readonly state: ApprovalState
  readonly requestDigest: string
  readonly policyVersion: string
  readonly actor: string
  readonly deadline: string
  readonly createdAt: string
  readonly decidedAt?: string
  readonly decidedBy?: string
  readonly consumedAt?: string
  readonly rejectionReason?: string
}
