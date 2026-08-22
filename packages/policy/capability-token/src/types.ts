import type { Branded } from '@deepseek-ai/dsh-brand'

export type CapabilityTokenId = Branded<'CapabilityTokenId'>

export interface CapabilityToken {
  readonly id: CapabilityTokenId
  readonly principalId: string
  readonly tenantId: string
  readonly capabilities: string[]
  readonly constraints: TokenConstraints
  readonly expiresAt: string
  readonly issuedAt: string
  readonly issuedBy: string
  readonly parentTokenId?: CapabilityTokenId
  readonly delegationDepth: number
}

export interface TokenConstraints {
  readonly maxDelegationDepth: number
  readonly allowedResources?: string[]
  readonly deniedResources?: string[]
  readonly rateLimit?: number
  readonly budget?: number
}

export class TokenExpiredError extends Error {
  constructor(tokenId: string) {
    super(`Capability token '${tokenId}' has expired`)
    this.name = 'TokenExpiredError'
  }
}

export class TokenAttenuationError extends Error {
  constructor(reason: string) {
    super(`Token attenuation failed: ${reason}`)
    this.name = 'TokenAttenuationError'
  }
}
