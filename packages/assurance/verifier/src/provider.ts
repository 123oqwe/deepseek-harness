import type { VerifierProvider, VerificationRequest, VerificationReport, CheckResult, CheckStatus } from './types.ts'

export function createDeterministicVerifier(
  id: string,
  checkFn: (checkId: string, evidence: ReadonlyMap<string, unknown>) => CheckStatus,
): VerifierProvider {
  return {
    id,
    kind: 'deterministic',
    verify: async (request: VerificationRequest, evidence: ReadonlyMap<string, unknown>): Promise<VerificationReport> => {
      await Promise.resolve()
      const results: CheckResult[] = request.requiredChecks.map(checkId => ({
        checkId,
        status: checkFn(checkId, evidence),
        reason: `Deterministic check by ${id}`,
        evidenceRef: request.evidenceRefs.find(r => r === checkId) ?? undefined,
      }))
      const summary = results.every(r => r.status === 'pass') ? 'pass' : 'fail'
      return { request, verifierId: id, results, summary: summary as VerificationReport['summary'] }
    },
  }
}

export function createModelVerifier(
  id: string,
  modelFn: (request: VerificationRequest, evidence: ReadonlyMap<string, unknown>) => Promise<CheckResult[]>,
): VerifierProvider {
  return {
    id,
    kind: 'model',
    verify: async (request: VerificationRequest, evidence: ReadonlyMap<string, unknown>): Promise<VerificationReport> => {
      await Promise.resolve()
      const results = await modelFn(request, evidence)
      const summary = results.every(r => r.status === 'pass') ? 'pass' : 'fail'
      return { request, verifierId: id, results, summary: summary as VerificationReport['summary'] }
    },
  }
}

export function createHumanVerifier(id: string): VerifierProvider {
  return {
    id,
    kind: 'human',
    verify: async (request: VerificationRequest, _evidence: ReadonlyMap<string, unknown>): Promise<VerificationReport> => {
      const results: CheckResult[] = request.requiredChecks.map(checkId => ({
        checkId,
        status: 'unverified' as CheckStatus,
        reason: 'Awaiting human verification',
      }))
      return { request, verifierId: id, results, summary: 'abstain' }
    },
  }
}
