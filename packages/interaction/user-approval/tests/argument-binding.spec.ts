import { describe, it, expect } from 'vitest'
import { canonicalizeApproval, verifyDigest, isExpired, redactSensitive, checkPreconditions } from '../src/index.ts'

const baseReq = {
  actionManifestDigest: 'abc123',
  redactedParameters: { path: '/test', content: 'hello' },
  resources: ['/test'],
  riskLevel: 'medium',
  validFrom: new Date().toISOString(),
  validUntil: new Date(Date.now() + 3600000).toISOString(),
  policyVersion: '1.0',
}

describe('P2-06 Approval Argument Binding', () => {
  it('canonicalizes approval request with digest id', () => {
    const req = canonicalizeApproval(baseReq)
    expect(req.id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('same request produces same digest', () => {
    const r1 = canonicalizeApproval(baseReq)
    const r2 = canonicalizeApproval(baseReq)
    expect(r1.id).toBe(r2.id)
  })

  it('different parameters produce different digest', () => {
    const r1 = canonicalizeApproval(baseReq)
    const r2 = canonicalizeApproval({ ...baseReq, redactedParameters: { path: '/other' } })
    expect(r1.id).not.toBe(r2.id)
  })

  it('verifyDigest checks integrity', () => {
    const req = canonicalizeApproval(baseReq)
    expect(verifyDigest(req, req.id)).toBe(true)
    expect(verifyDigest(req, 'wrong')).toBe(false)
  })

  it('isExpired checks validity', () => {
    const expired = canonicalizeApproval({ ...baseReq, validUntil: new Date(Date.now() - 1000).toISOString() })
    expect(isExpired(expired)).toBe(true)
    const valid = canonicalizeApproval(baseReq)
    expect(isExpired(valid)).toBe(false)
  })

  it('redactSensitive replaces sensitive keys', () => {
    const params = { password: 'secret', path: '/test', apiKey: 'key123' }
    const redacted = redactSensitive(params, ['password', 'apikey'])
    expect(redacted.password).toBe('[REDACTED]')
    expect(redacted.apiKey).toBe('[REDACTED]')
    expect(redacted.path).toBe('/test')
  })

  it('checkPreconditions passes when all satisfied', () => {
    const result = checkPreconditions('abc', true, '1.0', '1.0', true)
    expect(result.satisfied).toBe(true)
    expect(result.failedChecks).toHaveLength(0)
  })

  it('checkPreconditions fails on token invalid', () => {
    const result = checkPreconditions('abc', false, '1.0', '1.0', true)
    expect(result.satisfied).toBe(false)
    expect(result.failedChecks).toContain('capability token is not valid or expired')
  })

  it('checkPreconditions fails on policy mismatch', () => {
    const result = checkPreconditions('abc', true, '0.9', '1.0', true)
    expect(result.satisfied).toBe(false)
    expect(result.failedChecks.some(c => c.includes('mismatch'))).toBe(true)
  })
})
