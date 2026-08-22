export type GrantScope = 'read' | 'write' | 'execute' | 'admin'
export type GrantStatus = 'active' | 'expired' | 'revoked' | 'consumed'

export interface Grant {
  readonly id: string
  readonly principal: string
  readonly resource: string
  readonly scope: GrantScope
  readonly constraints?: {
    readonly maxAmount?: number
    readonly timeWindowMs?: number
    readonly allowedDestinations?: readonly string[]
  }
  readonly issuedAt: number
  readonly expiresAt: number
  readonly revokedAt?: number
  readonly parentGrantId?: string
  readonly digest: string
}

export interface GrantMatchResult {
  readonly matched: boolean
  readonly reason: string
  readonly grantId?: string
}
