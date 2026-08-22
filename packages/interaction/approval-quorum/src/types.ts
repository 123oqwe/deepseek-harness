export type QuorumResult = 'satisfied' | 'pending' | 'denied' | 'expired'

export interface QuorumSpec {
  readonly requiredRoles: readonly string[]
  readonly minApprovals: number
  readonly mutualExclusion: readonly string[][]
  readonly ordered: boolean
  readonly timeoutMs: number
}

export interface ApprovalVote {
  readonly approver: string
  readonly role: string
  readonly decision: 'approve' | 'deny'
  readonly timestamp: number
  readonly actionManifestDigest: string
}

export interface QuorumState {
  readonly spec: QuorumSpec
  readonly votes: readonly ApprovalVote[]
  readonly status: QuorumResult
  readonly initiator: string
}
