import { randomUUID } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CapabilityToken, TokenConstraints } from './types.ts'
import { TokenExpiredError, TokenAttenuationError } from './types.ts'

function asTokenId(s: string): Branded<'CapabilityTokenId'> {
  return s as Branded<'CapabilityTokenId'>
}

const usedTokens = new Map<string, CapabilityToken>()

export function issueToken(opts: {
  principalId: string
  tenantId: string
  capabilities: string[]
  constraints: TokenConstraints
  expiresAt: string
  issuedBy: string
}): CapabilityToken {
  const token: CapabilityToken = {
    id: asTokenId(randomUUID()),
    principalId: opts.principalId,
    tenantId: opts.tenantId,
    capabilities: opts.capabilities,
    constraints: opts.constraints,
    expiresAt: opts.expiresAt,
    issuedAt: new Date().toISOString(),
    issuedBy: opts.issuedBy,
    delegationDepth: 0,
  }
  usedTokens.set(String(token.id), token)
  return token
}

export function attenuateToken(parent: CapabilityToken, opts: {
  principalId: string
  capabilities: string[]
  constraints: Partial<TokenConstraints>
  expiresAt?: string
}): CapabilityToken {
  const now = new Date()
  if (new Date(parent.expiresAt) < now) {
    throw new TokenExpiredError(String(parent.id))
  }
  if (parent.delegationDepth >= parent.constraints.maxDelegationDepth) {
    throw new TokenAttenuationError('max delegation depth exceeded')
  }
  for (const cap of opts.capabilities) {
    if (!parent.capabilities.includes(cap)) {
      throw new TokenAttenuationError(`capability '${cap}' not in parent token`)
    }
  }
  if (opts.expiresAt && new Date(opts.expiresAt) > new Date(parent.expiresAt)) {
    throw new TokenAttenuationError('child expiry cannot exceed parent')
  }

  const child: CapabilityToken = {
    id: asTokenId(randomUUID()),
    principalId: opts.principalId,
    tenantId: parent.tenantId,
    capabilities: opts.capabilities,
    constraints: { ...parent.constraints, ...opts.constraints },
    expiresAt: opts.expiresAt ?? parent.expiresAt,
    issuedAt: new Date().toISOString(),
    issuedBy: parent.principalId,
    parentTokenId: parent.id,
    delegationDepth: parent.delegationDepth + 1,
  }
  usedTokens.set(String(child.id), child)
  return child
}

export function getToken(tokenId: string): CapabilityToken | undefined {
  return usedTokens.get(tokenId)
}

export function isExpired(token: CapabilityToken): boolean {
  return new Date(token.expiresAt) < new Date()
}

export function hasCapability(token: CapabilityToken, capability: string): boolean {
  if (isExpired(token)) return false
  if (token.constraints.deniedResources?.includes(capability)) return false
  return token.capabilities.includes(capability)
}

export function clearTokens(): void {
  usedTokens.clear()
}
