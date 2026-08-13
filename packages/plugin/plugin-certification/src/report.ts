import { createHash } from 'node:crypto'
import type { CertificationCheck, CertificationReport, TrustLevel } from './types.ts'

const LEVEL_ORDER: TrustLevel[] = ['L0-unknown', 'L1-inspected', 'L2-signed', 'L3-verified', 'L4-production', 'L5-kernel-trusted']

export function evaluateTrustLevel(checks: readonly CertificationCheck[]): TrustLevel {
  if (checks.length === 0) return 'L0-unknown'

  const allPassed = checks.every(c => c.passed)
  if (!allPassed) {
    // Find the highest level where all required checks up to that level pass
    if (hasPassed(checks, 'manifest-parsed') && hasPassed(checks, 'static-scan')) return 'L1-inspected'
    if (hasPassed(checks, 'manifest-parsed')) return 'L1-inspected'
    return 'L0-unknown'
  }

  // All checks passed — determine level by which checks exist
  if (hasCheck(checks, 'org-allowlist') && hasCheck(checks, 'audit-rollback')) return 'L4-production'
  if (hasCheck(checks, 'dynamic-test')) return 'L3-verified'
  if (hasCheck(checks, 'signature-verified') && hasCheck(checks, 'sbom-verified')) return 'L2-signed'
  if (hasCheck(checks, 'manifest-parsed') && hasCheck(checks, 'static-scan')) return 'L1-inspected'
  if (hasCheck(checks, 'manifest-parsed')) return 'L1-inspected'
  return 'L0-unknown'
}

function hasPassed(checks: readonly CertificationCheck[], name: string): boolean {
  const check = checks.find(c => c.name === name)
  return check?.passed ?? false
}

function hasCheck(checks: readonly CertificationCheck[], name: string): boolean {
  return checks.some(c => c.name === name)
}

export function createReport(pluginDigest: string, checks: readonly CertificationCheck[]): CertificationReport {
  const trustLevel = evaluateTrustLevel(checks)
  const bindingDigest = createHash('sha256').update(pluginDigest + trustLevel).digest('hex')
  return {
    pluginDigest,
    trustLevel,
    checks,
    timestamp: Date.now(),
    bindingDigest,
  }
}

export function isReportValidForLevel(report: CertificationReport, requiredLevel: TrustLevel): boolean {
  const reportLevel = LEVEL_ORDER.indexOf(report.trustLevel)
  const required = LEVEL_ORDER.indexOf(requiredLevel)
  return reportLevel >= required
}
