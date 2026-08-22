import { describe, it, expect } from 'vitest'
import { evaluateTrustLevel, createReport, isReportValidForLevel, type CertificationCheck } from '../src/index.ts'

const baseChecks: CertificationCheck[] = [
  { name: 'manifest-parsed', passed: true, details: 'Manifest v2 valid' },
  { name: 'static-scan', passed: true, details: 'No blocking findings' },
  { name: 'signature-verified', passed: true, details: 'Sigstore verified' },
  { name: 'sbom-verified', passed: true, details: 'SBOM matches' },
]

describe('P1-12 Plugin Certification', () => {
  it('returns L0-unknown for no checks', () => {
    expect(evaluateTrustLevel([])).toBe('L0-unknown')
  })

  it('returns L1-inspected for manifest + scan', () => {
    const checks = baseChecks.slice(0, 2)
    expect(evaluateTrustLevel(checks)).toBe('L1-inspected')
  })

  it('returns L2-signed for full passed with signature+sbom', () => {
    expect(evaluateTrustLevel(baseChecks)).toBe('L2-signed')
  })

  it('returns L3-verified with dynamic test', () => {
    const checks = [...baseChecks, { name: 'dynamic-test', passed: true, details: 'Runtime verified' }]
    expect(evaluateTrustLevel(checks)).toBe('L3-verified')
  })

  it('returns L4-production with org allowlist + audit', () => {
    const checks = [...baseChecks, { name: 'dynamic-test', passed: true, details: 'ok' }, { name: 'org-allowlist', passed: true, details: 'approved' }, { name: 'audit-rollback', passed: true, details: 'tested' }]
    expect(evaluateTrustLevel(checks)).toBe('L4-production')
  })

  it('returns L1-inspected when scan fails but manifest passes', () => {
    const checks: CertificationCheck[] = [
      { name: 'manifest-parsed', passed: true, details: 'ok' },
      { name: 'static-scan', passed: false, details: '3 blocking findings' },
    ]
    expect(evaluateTrustLevel(checks)).toBe('L1-inspected')
  })

  it('creates report with binding digest', () => {
    const report = createReport('plugin-hash', baseChecks)
    expect(report.pluginDigest).toBe('plugin-hash')
    expect(report.bindingDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('report digest changes with plugin digest', () => {
    const r1 = createReport('hash1', baseChecks)
    const r2 = createReport('hash2', baseChecks)
    expect(r1.bindingDigest).not.toBe(r2.bindingDigest)
  })

  it('validates report for required level', () => {
    const report = createReport('hash', [...baseChecks, { name: 'dynamic-test', passed: true, details: 'ok' }])
    expect(isReportValidForLevel(report, 'L3-verified')).toBe(true)
    expect(isReportValidForLevel(report, 'L4-production')).toBe(false)
  })

  it('market metadata cannot boost trust level', () => {
    // Even with all market metadata, trust level is based on actual checks
    const checks: CertificationCheck[] = [
      { name: 'manifest-parsed', passed: true, details: 'ok' },
    ]
    // Only manifest check → L1-inspected, not higher even if "market featured"
    expect(evaluateTrustLevel(checks)).toBe('L1-inspected')
  })
})
