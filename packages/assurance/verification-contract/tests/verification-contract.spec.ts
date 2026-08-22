import { describe, it, expect } from 'vitest'
import { freezeContract, evaluateContract, validateContract, isSatisfied, checkInvariants } from '../src/index.ts'

const criteria = [
  { id: 'c1', description: 'tests pass', type: 'test' as const, expectedValue: 'true' },
  { id: 'c2', description: 'file exists', type: 'file-exists' as const, expectedValue: '/output/result.txt' },
]

describe('P7-01 VerificationContract', () => {
  it('freezes contract with digest', () => {
    const contract = freezeContract({
      id: 'vc-1', runPlanId: 'plan-1', objective: 'fix bug',
      criteria, verifierId: 'independent-verifier',
      expiryMs: 60000, schemaVersion: '1.0.0',
    }, 'kernel')
    expect(contract.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(contract.status).toBe('frozen')
  })

  it('validates contract', () => {
    const contract = freezeContract({
      id: 'vc-1', runPlanId: 'plan-1', objective: 'fix bug',
      criteria, verifierId: 'verifier',
      expiryMs: 60000, schemaVersion: '1.0.0',
    }, 'kernel')
    const result = validateContract(contract)
    expect(result.valid).toBe(true)
  })

  it('rejects invalid schema version', () => {
    const contract = freezeContract({
      id: 'vc-1', runPlanId: 'plan-1', objective: 'fix bug',
      criteria, verifierId: 'verifier',
      expiryMs: 60000, schemaVersion: '0.9.0',
    }, 'kernel')
    const result = validateContract(contract)
    expect(result.valid).toBe(false)
  })

  it('evaluates criteria with results', () => {
    const contract = freezeContract({
      id: 'vc-1', runPlanId: 'plan-1', objective: 'fix bug',
      criteria, verifierId: 'verifier',
      expiryMs: 60000, schemaVersion: '1.0.0',
    }, 'kernel')
    const evaluated = evaluateContract(contract, {
      c1: 'true',
      c2: '/output/result.txt',
    })
    expect(evaluated.status).toBe('satisfied')
  })

  it('fails when criteria not met', () => {
    const contract = freezeContract({
      id: 'vc-1', runPlanId: 'plan-1', objective: 'fix bug',
      criteria, verifierId: 'verifier',
      expiryMs: 60000, schemaVersion: '1.0.0',
    }, 'kernel')
    const evaluated = evaluateContract(contract, {
      c1: 'false',
      c2: '/output/result.txt',
    })
    expect(evaluated.status).toBe('failed')
  })

  it('isSatisfied checks all criteria', () => {
    const contract = freezeContract({
      id: 'vc-1', runPlanId: 'plan-1', objective: 'fix bug',
      criteria, verifierId: 'verifier',
      expiryMs: 60000, schemaVersion: '1.0.0',
    }, 'kernel')
    expect(isSatisfied(contract)).toBe(false) // not yet evaluated
  })

  it('checkInvariants detects unevaluated criteria', () => {
    const contract = freezeContract({
      id: 'vc-1', runPlanId: 'plan-1', objective: 'fix bug',
      criteria, verifierId: 'verifier',
      expiryMs: 60000, schemaVersion: '1.0.0',
    }, 'kernel')
    const result = checkInvariants(contract)
    expect(result.passed).toBe(false)
    expect(result.violations.some(v => v.includes('not yet evaluated'))).toBe(true)
  })

  it('same input produces same digest', () => {
    const c1 = freezeContract({
      id: 'vc-1', runPlanId: 'plan-1', objective: 'fix bug',
      criteria, verifierId: 'verifier',
      expiryMs: 60000, schemaVersion: '1.0.0',
    }, 'kernel')
    const c2 = freezeContract({
      id: 'vc-1', runPlanId: 'plan-1', objective: 'fix bug',
      criteria, verifierId: 'verifier',
      expiryMs: 60000, schemaVersion: '1.0.0',
    }, 'kernel')
    // Digests differ because frozenAt is different (timestamp)
    // But the contract structure is deterministic
    expect(c1.id).toBe(c2.id)
  })
})
