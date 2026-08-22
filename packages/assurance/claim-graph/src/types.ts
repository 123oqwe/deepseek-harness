export type ClaimStatus = 'verified' | 'unverified' | 'stale' | 'conflicted'

export interface ClaimNode {
  readonly id: string
  readonly text: string
  readonly status: ClaimStatus
  readonly confidence: number
  readonly scope: string
  readonly createdAt: number
}

export interface EvidenceEdge {
  readonly sourceClaimId: string
  readonly evidenceRef: string
  readonly evidenceType: string
  readonly supports: boolean
  readonly createdAt: number
  readonly expiresAt?: number | undefined
}

export interface DerivedFromEdge {
  readonly claimId: string
  readonly derivedFromClaimId: string
}
