import { describe, it, expect } from 'vitest'
import { evaluateGate, canTransition } from '../src/evaluate.ts'
import type { GateInput } from '../src/types.ts'
import { buildOutcomePackage, verifyOutcomePackage } from '../../outcome-package/src/index.ts'

function makeInput(opts: Partial<GateInput> = {}): GateInput {
  return {
    verificationResults: [],
    requiredChecks: [],
    claimGraphStatuses: [],
    requiredApprovals: [],
    ...opts,
  }
}

describe('P7-05 AcceptanceGate & OutcomePackage', () => {
  it('rejects when required check is missing', () => {
    const input = makeInput({
      requiredChecks: [{ checkId: 'c1', required: true }],
      verificationResults: [],
    })
    const decision = evaluateGate(input, 'verifying')
    expect(decision.accepted).toBe(false)
    expect(decision.newState).toBe('rejected')
  })

  it('rejects when required check fails', () => {
    const input = makeInput({
      requiredChecks: [{ checkId: 'c1', required: true }],
      verificationResults: [{ checkId: 'c1', status: 'fail' }],
    })
    const decision = evaluateGate(input, 'verifying')
    expect(decision.accepted).toBe(false)
    expect(decision.newState).toBe('rejected')
  })

  it('needs-human when claims are conflicted', () => {
    const input = makeInput({
      requiredChecks: [{ checkId: 'c1', required: true }],
      verificationResults: [{ checkId: 'c1', status: 'pass' }],
      claimGraphStatuses: [{ claimId: 'claim-1', status: 'conflicted' }],
    })
    const decision = evaluateGate(input, 'verifying')
    expect(decision.newState).toBe('needs-human')
  })

  it('needs-human when approval pending', () => {
    const input = makeInput({
      requiredChecks: [{ checkId: 'c1', required: true }],
      verificationResults: [{ checkId: 'c1', status: 'pass' }],
      requiredApprovals: [{ approvalId: 'a1', approved: false }],
    })
    const decision = evaluateGate(input, 'verifying')
    expect(decision.newState).toBe('needs-human')
  })

  it('accepts when all checks pass, no conflicts, approvals granted', () => {
    const input = makeInput({
      requiredChecks: [{ checkId: 'c1', required: true }],
      verificationResults: [{ checkId: 'c1', status: 'pass' }],
      requiredApprovals: [{ approvalId: 'a1', approved: true }],
    })
    const decision = evaluateGate(input, 'verifying')
    expect(decision.accepted).toBe(true)
    expect(decision.newState).toBe('accepted')
  })

  it('skips non-required failed checks', () => {
    const input = makeInput({
      requiredChecks: [{ checkId: 'c1', required: true }, { checkId: 'c2', required: false }],
      verificationResults: [{ checkId: 'c1', status: 'pass' }, { checkId: 'c2', status: 'fail' }],
    })
    const decision = evaluateGate(input, 'verifying')
    expect(decision.accepted).toBe(true)
  })

  it('enforces state transition rules', () => {
    expect(canTransition('running', 'completed')).toBe(true)
    expect(canTransition('completed', 'verifying')).toBe(true)
    expect(canTransition('verifying', 'accepted')).toBe(true)
    expect(canTransition('accepted', 'verifying')).toBe(false)
    expect(canTransition('running', 'accepted')).toBe(false)
  })

  it('OutcomePackage has stable content digest and signature', () => {
    const pkg = buildOutcomePackage('run-1', {
      finalAnswer: 'done',
      artifacts: ['art-1'],
      stateDiffs: [],
      actionTrace: ['a1'],
      policyDecisions: [],
      verificationReport: { summary: 'pass', results: [] },
      costs: { tokens: 100, durationMs: 5000 },
      failures: [],
      compensations: [],
      memoryProposals: [],
    })
    expect(pkg.contentDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(pkg.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(verifyOutcomePackage(pkg)).toBe(true)
  })

  it('OutcomePackage detects tampering', () => {
    const pkg = buildOutcomePackage('run-1', {
      finalAnswer: 'done',
      artifacts: ['art-1'],
      stateDiffs: [],
      actionTrace: ['a1'],
      policyDecisions: [],
      verificationReport: { summary: 'pass', results: [] },
      costs: { tokens: 100, durationMs: 5000 },
      failures: [],
      compensations: [],
      memoryProposals: [],
    })
    const tampered = { ...pkg, finalAnswer: 'tampered' }
    expect(verifyOutcomePackage(tampered)).toBe(false)
  })

  it('execution completed does not equal accepted', () => {
    const input = makeInput()
    const decision = evaluateGate(input, 'completed')
    expect(decision.accepted).toBe(false)
    expect(decision.newState).toBe('verifying')
  })
})
