import { describe, it, expect } from 'vitest'
import { ApprovalQuorum } from '../src/index.ts'

const spec = {
  requiredRoles: ['finance', 'legal'],
  minApprovals: 2,
  mutualExclusion: [] as readonly string[][],
  ordered: false,
  timeoutMs: 60000,
}
const digest = 'abc123'

describe('P2-09 Approval Quorum', () => {
  it('initiates a quorum request', () => {
    const q = new ApprovalQuorum()
    const state = q.initiate('r1', spec, 'initiator-1')
    expect(state.status).toBe('pending')
  })

  it('satisfies quorum with required roles', () => {
    const q = new ApprovalQuorum()
    q.initiate('r1', spec, 'initiator-1')
    q.submitVote('r1', { approver: 'alice', role: 'finance', decision: 'approve', timestamp: 1, actionManifestDigest: digest })
    const state = q.submitVote('r1', { approver: 'bob', role: 'legal', decision: 'approve', timestamp: 2, actionManifestDigest: digest })
    expect(state.status).toBe('satisfied')
  })

  it('denies on any deny vote', () => {
    const q = new ApprovalQuorum()
    q.initiate('r1', spec, 'initiator-1')
    q.submitVote('r1', { approver: 'alice', role: 'finance', decision: 'approve', timestamp: 1, actionManifestDigest: digest })
    const state = q.submitVote('r1', { approver: 'bob', role: 'legal', decision: 'deny', timestamp: 2, actionManifestDigest: digest })
    expect(state.status).toBe('denied')
  })

  it('rejects initiator approval', () => {
    const q = new ApprovalQuorum()
    q.initiate('r1', spec, 'initiator-1')
    expect(() => q.submitVote('r1', { approver: 'initiator-1', role: 'finance', decision: 'approve', timestamp: 1, actionManifestDigest: digest })).toThrow('Initiator')
  })

  it('rejects duplicate approver', () => {
    const q = new ApprovalQuorum()
    q.initiate('r1', spec, 'initiator-1')
    q.submitVote('r1', { approver: 'alice', role: 'finance', decision: 'approve', timestamp: 1, actionManifestDigest: digest })
    expect(() => q.submitVote('r1', { approver: 'alice', role: 'legal', decision: 'approve', timestamp: 2, actionManifestDigest: digest })).toThrow('already voted')
  })

  it('rejects action manifest digest mismatch', () => {
    const q = new ApprovalQuorum()
    q.initiate('r1', spec, 'initiator-1')
    q.submitVote('r1', { approver: 'alice', role: 'finance', decision: 'approve', timestamp: 1, actionManifestDigest: digest })
    expect(() => q.submitVote('r1', { approver: 'bob', role: 'legal', decision: 'approve', timestamp: 2, actionManifestDigest: 'different' })).toThrow('digest mismatch')
  })

  it('expires after timeout', () => {
    const q = new ApprovalQuorum()
    q.initiate('r1', spec, 'initiator-1')
    const state = q.checkExpiry('r1', 70000)
    expect(state.status).toBe('expired')
  })

  it('rejects role not in required list', () => {
    const q = new ApprovalQuorum()
    q.initiate('r1', spec, 'initiator-1')
    expect(() => q.submitVote('r1', { approver: 'alice', role: 'unknown', decision: 'approve', timestamp: 1, actionManifestDigest: digest })).toThrow('not in required')
  })

  it('enforces ordered approval', () => {
    const orderedSpec = { ...spec, ordered: true, requiredRoles: ['finance', 'legal'] }
    const q = new ApprovalQuorum()
    q.initiate('r1', orderedSpec, 'initiator-1')
    // Try legal before finance — should fail
    expect(() => q.submitVote('r1', { approver: 'bob', role: 'legal', decision: 'approve', timestamp: 1, actionManifestDigest: digest })).toThrow('Ordered')
  })

  it('enforces mutual exclusion for same person', () => {
    // Use spec with extra optional roles that are mutually exclusive
    const exclSpec = { requiredRoles: ['finance', 'legal', 'audit'], minApprovals: 2, mutualExclusion: [['finance', 'audit']], ordered: false, timeoutMs: 60000 }
    const q = new ApprovalQuorum()
    q.initiate('r1', exclSpec, 'initiator-1')
    q.submitVote('r1', { approver: 'alice', role: 'finance', decision: 'approve', timestamp: 1, actionManifestDigest: digest })
    // Same person trying to also be audit (mutually exclusive with finance)
    expect(() => q.submitVote('r1', { approver: 'alice', role: 'audit', decision: 'approve', timestamp: 2, actionManifestDigest: digest })).toThrow('already voted')
  })
})
