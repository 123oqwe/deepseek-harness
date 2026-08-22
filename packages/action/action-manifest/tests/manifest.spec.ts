import { describe, it, expect } from 'vitest'
import { canonicalizeParameters, computeDigest, canonicalize, classifyRisk, requiresApproval, type ActionManifest } from '../src/index.ts'

const manifest: ActionManifest = {
  actionId: 'act-1', toolName: 'fs:write', principalId: 'user-1',
  tenantId: 'tenant-a', runId: 'run-1', parameters: { path: '/test', content: 'hello' },
  canonicalParameters: '', riskLevel: 'medium', requiresApproval: false, createdAt: '2026-01-01T00:00:00Z',
}

describe('P2-03 ActionManifest', () => {
  it('canonicalizes parameters deterministically', () => {
    const a = canonicalizeParameters({ b: 2, a: 1 })
    const b = canonicalizeParameters({ a: 1, b: 2 })
    expect(a).toBe(b)
  })

  it('computes digest', () => {
    const m = { ...manifest, canonicalParameters: canonicalizeParameters(manifest.parameters) }
    const digest = computeDigest(m)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('canonicalize adds digest', () => {
    const result = canonicalize(manifest)
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(result.canonicalParameters).toBeTruthy()
  })

  it('same manifest produces same digest', () => {
    const r1 = canonicalize(manifest)
    const r2 = canonicalize(manifest)
    expect(r1.digest).toBe(r2.digest)
  })

  it('different parameters produce different digests', () => {
    const m1 = canonicalize({ ...manifest, parameters: { path: '/a' } })
    const m2 = canonicalize({ ...manifest, parameters: { path: '/b' } })
    expect(m1.digest).not.toBe(m2.digest)
  })

  it('classifies risk levels', () => {
    expect(classifyRisk('fs:read', {})).toBe('low')
    expect(classifyRisk('fs:write', {})).toBe('medium')
    expect(classifyRisk('payment:transfer', {})).toBe('critical')
    expect(classifyRisk('file:delete', {})).toBe('irreversible')
  })

  it('requiresApproval for high risk', () => {
    expect(requiresApproval('low')).toBe(false)
    expect(requiresApproval('medium')).toBe(false)
    expect(requiresApproval('high')).toBe(true)
    expect(requiresApproval('critical')).toBe(true)
    expect(requiresApproval('irreversible')).toBe(true)
  })
})
