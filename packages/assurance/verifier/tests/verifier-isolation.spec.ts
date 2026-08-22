import { describe, it, expect, beforeEach } from 'vitest'
import { VerifierCoordinator, createDeterministicVerifier, createHumanVerifier, checkExecutorVerifierSeparation, rejectUnsignedTestPass } from '../src/index.ts'
import type { VerificationRequest } from '../src/types.ts'

function makeRequest(executorId: string, checks: string[], evidence: string[]): VerificationRequest {
  return { runId: 'r1', executorId, verificationContractId: 'vc1', evidenceRefs: evidence, requiredChecks: checks }
}

describe('P7-03 Independent Verifier Isolation', () => {
  let coordinator: VerifierCoordinator

  beforeEach(() => {
    coordinator = new VerifierCoordinator()
  })

  it('rejects self-verification for high-risk runs', () => {
    const result = checkExecutorVerifierSeparation('agent-1', 'agent-1')
    expect(result.canVerifyExecutor).toBe(false)
  })

  it('allows self-verification with explicit degraded approval', () => {
    const result = checkExecutorVerifierSeparation('agent-1', 'agent-1', true)
    expect(result.canVerifyExecutor).toBe(true)
    expect(result.reason).toContain('degraded')
  })

  it('allows distinct executor and verifier', () => {
    const result = checkExecutorVerifierSeparation('agent-1', 'verifier-1')
    expect(result.canVerifyExecutor).toBe(true)
  })

  it('deterministic verifier checks real evidence', async () => {
    const verifier = createDeterministicVerifier('det-1', (checkId, evidence) => {
      const ev = evidence.get(checkId)
      return ev === 'pass' ? 'pass' : 'fail'
    })
    coordinator.register(verifier)
    const evidence = new Map([['check-1', 'pass']])
    const request = makeRequest('executor-1', ['check-1'], ['check-1'])
    const report = await coordinator.verify('det-1', request, evidence)
    expect(report.summary).toBe('pass')
  })

  it('verifier reads real state, not executor claims', async () => {
    const verifier = createDeterministicVerifier('det-1', (_checkId, evidence) => {
      const ev = evidence.get('evidence-1')
      if (ev && typeof ev === 'object' && 'actualStatus' in ev) {
        return (ev as Record<string, unknown>).actualStatus === 'ok' ? 'pass' : 'fail'
      }
      return 'fail'
    })
    coordinator.register(verifier)
    const evidence = new Map([
      ['evidence-1', { claimedPass: true, actualStatus: 'broken', signature: 'sig' }],
    ])
    const request = makeRequest('executor-1', ['check-1'], ['evidence-1'])
    const report = await coordinator.verify('det-1', request, evidence)
    expect(report.summary).toBe('fail')
  })

  it('rejects unsigned test pass claims', () => {
    const evidence = new Map([
      ['e1', { claimedPass: true }],
    ])
    const result = rejectUnsignedTestPass(evidence, ['e1'])
    expect(result.accepted).toBe(false)
    expect(result.rejected.length).toBeGreaterThan(0)
  })

  it('accepts signed evidence', () => {
    const evidence = new Map([
      ['e1', { claimedPass: true, signature: 'valid-sig' }],
    ])
    const result = rejectUnsignedTestPass(evidence, ['e1'])
    expect(result.accepted).toBe(true)
  })

  it('fail-closed: timeout/abstain treated as fail', async () => {
    const humanVerifier = createHumanVerifier('human-1')
    coordinator.register(humanVerifier)
    const request = makeRequest('executor-1', ['check-1'], [])
    const report = await coordinator.verify('human-1', request, new Map())
    expect(report.summary).toBe('fail')
  })

  it('verifier coordinator rejects executor==verifier', async () => {
    const verifier = createDeterministicVerifier('same-agent', () => 'pass')
    coordinator.register(verifier)
    const request = makeRequest('same-agent', ['check-1'], [])
    const report = await coordinator.verify('same-agent', request, new Map())
    expect(report.summary).toBe('abstain')
  })

  it('audit log records verification actions', async () => {
    const verifier = createDeterministicVerifier('det-1', () => 'pass')
    coordinator.register(verifier)
    const request = makeRequest('exec-1', ['c1'], [])
    await coordinator.verify('det-1', request, new Map())
    const log = coordinator.getAuditLog()
    expect(log.length).toBeGreaterThan(0)
  })
})
