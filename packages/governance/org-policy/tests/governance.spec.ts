import { describe, it, expect, beforeEach } from 'vitest'
import { GovernanceManager } from '../src/index.ts'

describe('P8-09 Organization Governance', () => {
  let gov: GovernanceManager

  beforeEach(() => { gov = new GovernanceManager() })

  it('adds org-level policy', () => {
    const p = gov.addPolicy({ level: 'org', rule: 'max-concurrent-runs', value: 50, overrideable: true })
    expect(p.level).toBe('org')
    expect(p.overrideable).toBe(true)
  })

  it('gets effective policy with hierarchy', () => {
    gov.addPolicy({ level: 'org', rule: 'max-runs', value: 100, overrideable: true })
    gov.addPolicy({ level: 'tenant', rule: 'max-runs', value: 50, overrideable: true })
    const effective = gov.getEffectivePolicy('max-runs', 'tenant')
    expect(effective?.value).toBe(50)
  })

  it('org policy is not overridable by org level', () => {
    const p = gov.addPolicy({ level: 'org', rule: 'test', value: 1, overrideable: true })
    expect(gov.isOverrideable(p.id, 'org')).toBe(false)
    expect(gov.isOverrideable(p.id, 'tenant')).toBe(true)
  })

  it('non-overrideable policy cannot be overridden', () => {
    const p = gov.addPolicy({ level: 'org', rule: 'test', value: 1, overrideable: false })
    expect(gov.isOverrideable(p.id, 'tenant')).toBe(false)
  })

  it('quota check allows within limit', () => {
    gov.setQuota('runs', 100, 'tenant')
    const result = gov.checkQuota('runs', 50)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(100)
  })

  it('quota check denies over limit', () => {
    gov.setQuota('runs', 10, 'tenant')
    gov.recordUsage('runs', 8)
    const result = gov.checkQuota('runs', 5)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(2)
  })

  it('legal hold prevents deletion', () => {
    gov.setRetention('audit-logs', 365, true)
    expect(gov.checkLegalHold('audit-logs')).toBe(true)
    expect(gov.checkLegalHold('temp-data')).toBe(false)
  })

  it('audit export creates record', () => {
    const entry = gov.exportAudit('t1', 1000, 'csv')
    expect(entry.tenantId).toBe('t1')
    expect(entry.recordCount).toBe(1000)
    expect(gov.getAuditExports()).toHaveLength(1)
  })
})
