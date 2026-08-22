import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { issueLease, revokeLease, getLease, isExpired, getActiveLeases, revokeAllForWorld, clearLeases } from '../src/index.ts'

describe('P3-06 Secrets Broker', () => {
  beforeEach(() =>{  clearLeases() })
  afterEach(() =>{  clearLeases() })

  it('issues a short-lived lease', () => {
    const lease = issueLease({
      credentialRef: 'api-key', principalId: 'user-1', actionManifestDigest: 'digest',
      worldId: 'world-1', purpose: 'api-call', ttlSeconds: 60, injectionMethod: 'env',
    })
    expect(lease.revoked).toBe(false)
    expect(lease.injectionMethod).toBe('env')
    expect(isExpired(lease)).toBe(false)
  })

  it('revokes a lease', () => {
    const lease = issueLease({
      credentialRef: 'key', principalId: 'u', actionManifestDigest: 'd',
      worldId: 'w', purpose: 'p', ttlSeconds: 60, injectionMethod: 'fd',
    })
    revokeLease(String(lease.id))
    const revoked = getLease(String(lease.id))
    expect(revoked!.revoked).toBe(true)
    expect(isExpired(revoked!)).toBe(true)
  })

  it('expires after TTL', () => {
    const lease = issueLease({
      credentialRef: 'key', principalId: 'u', actionManifestDigest: 'd',
      worldId: 'w', purpose: 'p', ttlSeconds: 1, injectionMethod: 'file',
    })
    expect(isExpired(lease, new Date(Date.now() + 2000))).toBe(true)
  })

  it('getActiveLeases returns only non-expired', () => {
    issueLease({ credentialRef: 'k1', principalId: 'u', actionManifestDigest: 'd', worldId: 'w', purpose: 'p', ttlSeconds: 60, injectionMethod: 'env' })
    const l2 = issueLease({ credentialRef: 'k2', principalId: 'u', actionManifestDigest: 'd', worldId: 'w', purpose: 'p', ttlSeconds: 60, injectionMethod: 'env' })
    revokeLease(String(l2.id))
    expect(getActiveLeases()).toHaveLength(1)
  })

  it('revokeAllForWorld revokes all leases for a world', () => {
    issueLease({ credentialRef: 'k1', principalId: 'u', actionManifestDigest: 'd', worldId: 'w1', purpose: 'p', ttlSeconds: 60, injectionMethod: 'env' })
    issueLease({ credentialRef: 'k2', principalId: 'u', actionManifestDigest: 'd', worldId: 'w1', purpose: 'p', ttlSeconds: 60, injectionMethod: 'env' })
    issueLease({ credentialRef: 'k3', principalId: 'u', actionManifestDigest: 'd', worldId: 'w2', purpose: 'p', ttlSeconds: 60, injectionMethod: 'env' })
    const count = revokeAllForWorld('w1')
    expect(count).toBe(2)
    expect(getActiveLeases()).toHaveLength(1)
  })
})
