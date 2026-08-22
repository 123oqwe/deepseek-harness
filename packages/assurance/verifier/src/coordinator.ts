import type { VerifierProvider, VerificationRequest, VerificationReport } from './types.ts'
import { checkExecutorVerifierSeparation, isFailClosed } from './invariant.ts'

export class VerifierCoordinator {
  private providers = new Map<string, VerifierProvider>()
  private auditLog: { verifierId: string; action: string; at: number }[] = []

  register(provider: VerifierProvider): void {
    this.providers.set(provider.id, provider)
  }

  unregister(id: string): void {
    this.providers.delete(id)
  }

  async verify(
    verifierId: string,
    request: VerificationRequest,
    evidence: ReadonlyMap<string, unknown>,
  ): Promise<VerificationReport> {
    const provider = this.providers.get(verifierId)
    if (!provider) {
      return {
        request,
        verifierId,
        results: [],
        summary: 'abstain',
      }
    }

    const assignment = checkExecutorVerifierSeparation(request.executorId, verifierId)
    if (!assignment.canVerifyExecutor) {
      this.auditLog.push({ verifierId, action: 'rejected: executor==verifier', at: Date.now() })
      return {
        request,
        verifierId,
        results: request.requiredChecks.map(c => ({
          checkId: c,
          status: 'unverified' as const,
          reason: assignment.reason,
        })),
        summary: 'abstain',
      }
    }

    const report = await provider.verify(request, evidence)

    if (isFailClosed(report)) {
      this.auditLog.push({ verifierId, action: 'fail-closed: timeout/abstain treated as fail', at: Date.now() })
      return { ...report, summary: 'fail' }
    }

    this.auditLog.push({ verifierId, action: `verified: ${report.summary}`, at: Date.now() })
    return report
  }

  getAuditLog(): readonly { verifierId: string; action: string; at: number }[] {
    return this.auditLog
  }

  listProviders(): readonly string[] {
    return Array.from(this.providers.keys())
  }

  clear(): void {
    this.providers.clear()
    this.auditLog = []
  }
}
