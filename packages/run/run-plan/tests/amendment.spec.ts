import { describe, it, expect } from 'vitest'
import { freezePlan, verifyFrozenPlan, AmendmentProtocol, type RunPlan } from '../src/index.ts'

const basePlan: RunPlan = {
  id: 'plan-1',
  objectives: ['fix bug'],
  constraints: ['no network'],
  modelRoutes: [{ provider: 'ds', model: 'chat' }],
  contextTopology: 'default',
  agentGraph: [{ id: 'a1', role: 'coder', modelRoute: { provider: 'ds', model: 'chat' }, tools: ['fs'], worldId: 'w1' }],
  worlds: [{ id: 'w1', kind: 'local', policyDigest: 'hash' }],
  budgets: [{ tokens: 1000, cost: 0.5, time: 300, agents: 1 }],
  approvalGates: [],
  verification: { method: 'test', criteria: ['pass'], verifier: 'independent' },
  recovery: { maxRetries: 3, checkpoint: true },
  digest: 'original-digest',
}

describe('P4-04 RunPlan Freeze & Amendment', () => {
  it('freezes a plan with signature', () => {
    const frozen = freezePlan(basePlan, 'kernel')
    expect(frozen.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(frozen.kernelVerified).toBe(true)
  })

  it('verifies untampered frozen plan', () => {
    const frozen = freezePlan(basePlan, 'kernel')
    const result = verifyFrozenPlan(frozen)
    expect(result.valid).toBe(true)
  })

  it('detects signature tampering', () => {
    const frozen = freezePlan(basePlan, 'kernel')
    const tampered = { ...frozen, signature: 'wrong' }
    const result = verifyFrozenPlan(tampered)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Signature'))).toBe(true)
  })

  it('applies add-agent amendment', () => {
    const frozen = freezePlan(basePlan, 'kernel')
    const protocol = new AmendmentProtocol(frozen)
    const result = protocol.proposeAmendment({
      type: 'add-agent',
      description: 'Add reviewer agent',
      changes: { agent: { id: 'a2', role: 'reviewer', modelRoute: { provider: 'ds', model: 'chat' }, tools: ['fs:read'], worldId: 'w1' } },
      requestedBy: 'user',
      requiresApproval: false,
    })
    expect(result.status).toBe('applied')
    expect(result.newRevision).toBe(1)
  })

  it('requires approval for budget expansion', () => {
    const frozen = freezePlan(basePlan, 'kernel')
    const protocol = new AmendmentProtocol(frozen)
    const result = protocol.proposeAmendment({
      type: 'expand-budget',
      description: 'Expand budget',
      changes: { budget: { tokens: 50000, cost: 5, time: 600, agents: 5 } },
      requestedBy: 'agent',
      requiresApproval: true,
      approved: false,
    })
    expect(result.status).toBe('pending-approval')
    expect(result.newRevision).toBe(0)
  })

  it('prevents self-escalation', () => {
    const frozen = freezePlan(basePlan, 'kernel')
    const protocol = new AmendmentProtocol(frozen)
    const check = protocol.canSelfEscalate({
      type: 'expand-budget',
      description: 'expand',
      changes: {},
      requestedBy: 'agent',
      requiresApproval: true,
    })
    expect(check.allowed).toBe(false)
  })

  it('allows non-escalation amendments', () => {
    const frozen = freezePlan(basePlan, 'kernel')
    const protocol = new AmendmentProtocol(frozen)
    const check = protocol.canSelfEscalate({
      type: 'add-agent',
      description: 'add agent',
      changes: {},
      requestedBy: 'agent',
      requiresApproval: false,
    })
    expect(check.allowed).toBe(true)
  })

  it('tracks revision history', () => {
    const frozen = freezePlan(basePlan, 'kernel')
    const protocol = new AmendmentProtocol(frozen)
    protocol.proposeAmendment({
      type: 'add-world',
      description: 'Add container world',
      changes: { world: { id: 'w2', kind: 'container', policyDigest: 'hash2' } },
      requestedBy: 'user',
      requiresApproval: false,
    })
    const history = protocol.getRevisionHistory()
    expect(history.length).toBe(2)
    expect(history[1]?.amendment?.type).toBe('add-world')
  })

  it('applies approved budget expansion', () => {
    const frozen = freezePlan(basePlan, 'kernel')
    const protocol = new AmendmentProtocol(frozen)
    const result = protocol.proposeAmendment({
      type: 'expand-budget',
      description: 'Expand budget',
      changes: { budget: { tokens: 50000, cost: 5, time: 600, agents: 5 } },
      requestedBy: 'user',
      requiresApproval: true,
      approved: true,
    })
    expect(result.status).toBe('applied')
    expect(result.newRevision).toBe(1)
  })
})
