import type { VerifierAssignment, VerificationReport } from './types.ts'

export function checkExecutorVerifierSeparation(
  executorId: string,
  verifierId: string,
  explicitlyApproved = false,
): VerifierAssignment {
  if (executorId === verifierId && !explicitlyApproved) {
    return {
      verifierId,
      executorId,
      canVerifyExecutor: false,
      reason: 'Verifier must differ from executor for high-risk runs',
    }
  }
  if (executorId === verifierId && explicitlyApproved) {
    return {
      verifierId,
      executorId,
      canVerifyExecutor: true,
      reason: 'Self-verification explicitly approved (degraded assurance)',
    }
  }
  return {
    verifierId,
    executorId,
    canVerifyExecutor: true,
    reason: 'Executor and verifier are distinct',
  }
}

export function isFailClosed(report: VerificationReport): boolean {
  for (const result of report.results) {
    if (result.status === 'abstain' || result.status === 'timeout' || result.status === 'unverified') {
      return true
    }
  }
  return false
}

export function rejectUnsignedTestPass(
  evidence: ReadonlyMap<string, unknown>,
  evidenceRefs: readonly string[],
): { accepted: boolean; rejected: string[] } {
  const rejected: string[] = []
  for (const ref of evidenceRefs) {
    const ev = evidence.get(ref)
    if (ev !== undefined && typeof ev === 'object' && ev !== null && 'claimedPass' in ev) {
      const claimedPass = (ev as Record<string, unknown>).claimedPass
      if (claimedPass === true && !('signature' in ev)) {
        rejected.push(`Unsigned test pass rejected: ${ref}`)
      }
    }
  }
  return { accepted: rejected.length === 0, rejected }
}
