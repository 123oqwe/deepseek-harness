import { describe, it, expect } from 'vitest'
import { createProposal, decideProposal, canAutoMerge, shouldForget, exportProposals, type MemoryProposal } from '../src/index.ts'

const baseProposal = {
  content: 'test memory',
  evidence: ['event-1'],
  intendedUse: 'context',
  sensitivity: 'public' as const,
  principalId: 'user-1',
  tenantId: 'tenant-a',
}

describe('P6-03 Memory Policy', () => {
  it('creates a proposal in pending state', () => {
    const p = createProposal(baseProposal)
    expect(p.state).toBe('pending')
    expect(p.id).toBeTruthy()
  })

  it('auto-accepts public with evidence', () => {
    const p = createProposal(baseProposal)
    expect(decideProposal(p)).toBe('auto-accept')
    expect(canAutoMerge(p)).toBe(true)
  })

  it('rejects proposals without evidence', () => {
    const p = createProposal({ ...baseProposal, evidence: [] })
    expect(decideProposal(p)).toBe('reject')
  })

  it('reviews restricted sensitivity', () => {
    const p = createProposal({ ...baseProposal, sensitivity: 'restricted' })
    expect(decideProposal(p)).toBe('review')
  })

  it('reviews confidential sensitivity', () => {
    const p = createProposal({ ...baseProposal, sensitivity: 'confidential' })
    expect(decideProposal(p)).toBe('review')
  })

  it('shouldForget checks TTL', () => {
    const p = createProposal({ ...baseProposal, ttl: 1 })
    expect(shouldForget(p, new Date(Date.now() + 2000))).toBe(true)
  })

  it('exportProposals filters by tenant and sensitivity', () => {
    const accepted = createProposal(baseProposal) as MemoryProposal
    const wrongTenant = createProposal({ ...baseProposal, tenantId: 'other' }) as MemoryProposal
    const restricted = createProposal({ ...baseProposal, sensitivity: 'restricted' }) as MemoryProposal
    const pending = createProposal(baseProposal) as MemoryProposal
    // Manually set states since createProposal always sets to pending
    Object.assign(accepted, { state: 'accepted' })
    Object.assign(wrongTenant, { state: 'accepted' })
    Object.assign(restricted, { state: 'accepted' })
    const result = exportProposals([accepted, wrongTenant, restricted, pending], 'tenant-a')
    expect(result.exported).toBe(1)
    expect(result.skipped).toBe(3)
  })
})
