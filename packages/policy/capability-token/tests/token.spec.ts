import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { issueToken, attenuateToken, getToken, isExpired, hasCapability, clearTokens, TokenAttenuationError } from '../src/index.ts'

const futureDate = new Date(Date.now() + 86400000).toISOString()

describe('P2-02 Capability Token', () => {
  beforeEach(() =>{  clearTokens(); })
  afterEach(() =>{  clearTokens(); })

  it('issues a token with capabilities', () => {
    const token = issueToken({
      principalId: 'user-1', tenantId: 'tenant-a',
      capabilities: ['fs:read', 'fs:write'],
      constraints: { maxDelegationDepth: 3 },
      expiresAt: futureDate, issuedBy: 'root',
    })
    expect(hasCapability(token, 'fs:read')).toBe(true)
    expect(hasCapability(token, 'fs:write')).toBe(true)
    expect(hasCapability(token, 'net:egress')).toBe(false)
  })

  it('attenuates token with subset of capabilities', () => {
    const parent = issueToken({
      principalId: 'user-1', tenantId: 'tenant-a',
      capabilities: ['fs:read', 'fs:write', 'net:egress'],
      constraints: { maxDelegationDepth: 3 },
      expiresAt: futureDate, issuedBy: 'root',
    })
    const child = attenuateToken(parent, {
      principalId: 'agent-1', capabilities: ['fs:read'],
      constraints: {},
    })
    expect(hasCapability(child, 'fs:read')).toBe(true)
    expect(hasCapability(child, 'fs:write')).toBe(false)
    expect(child.delegationDepth).toBe(1)
    expect(child.parentTokenId).toBe(parent.id)
  })

  it('rejects attenuation beyond max depth', () => {
    const parent = issueToken({
      principalId: 'user-1', tenantId: 'tenant-a',
      capabilities: ['fs:read'],
      constraints: { maxDelegationDepth: 0 },
      expiresAt: futureDate, issuedBy: 'root',
    })
    expect(() => attenuateToken(parent, {
      principalId: 'agent-1', capabilities: ['fs:read'], constraints: {},
    })).toThrow(TokenAttenuationError)
  })

  it('rejects attenuation with capabilities not in parent', () => {
    const parent = issueToken({
      principalId: 'user-1', tenantId: 'tenant-a',
      capabilities: ['fs:read'],
      constraints: { maxDelegationDepth: 3 },
      expiresAt: futureDate, issuedBy: 'root',
    })
    expect(() => attenuateToken(parent, {
      principalId: 'agent-1', capabilities: ['fs:write'], constraints: {},
    })).toThrow(TokenAttenuationError)
  })

  it('rejects child expiry beyond parent', () => {
    const farFuture = new Date(Date.now() + 2 * 86400000).toISOString()
    const parent = issueToken({
      principalId: 'user-1', tenantId: 'tenant-a',
      capabilities: ['fs:read'],
      constraints: { maxDelegationDepth: 3 },
      expiresAt: futureDate, issuedBy: 'root',
    })
    expect(() => attenuateToken(parent, {
      principalId: 'agent-1', capabilities: ['fs:read'], constraints: {}, expiresAt: farFuture,
    })).toThrow(TokenAttenuationError)
  })

  it('expired token has no capabilities', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString()
    const token = issueToken({
      principalId: 'user-1', tenantId: 'tenant-a',
      capabilities: ['fs:read'],
      constraints: { maxDelegationDepth: 3 },
      expiresAt: pastDate, issuedBy: 'root',
    })
    expect(isExpired(token)).toBe(true)
    expect(hasCapability(token, 'fs:read')).toBe(false)
  })

  it('can retrieve token by id', () => {
    const token = issueToken({
      principalId: 'user-1', tenantId: 'tenant-a',
      capabilities: ['fs:read'],
      constraints: { maxDelegationDepth: 3 },
      expiresAt: futureDate, issuedBy: 'root',
    })
    const retrieved = getToken(String(token.id))
    expect(retrieved).toBeDefined()
    expect(retrieved!.principalId).toBe('user-1')
  })
})
