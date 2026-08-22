import type { OrgPolicy, Quota, RetentionPolicy, AuditExportEntry, PolicyLevel } from './types.ts'
import { randomUUID } from 'node:crypto'

export type { OrgPolicy, Quota, RetentionPolicy, AuditExportEntry, PolicyLevel } from './types.ts'

export class GovernanceManager {
  private policies = new Map<string, OrgPolicy>()
  private quotas = new Map<string, Quota>()
  private retentionPolicies = new Map<string, RetentionPolicy>()
  private auditExports: AuditExportEntry[] = []

  addPolicy(policy: Omit<OrgPolicy, 'id'>): OrgPolicy {
    const full: OrgPolicy = { ...policy, id: `pol-${randomUUID().slice(0, 12)}` }
    this.policies.set(full.id, full)
    return full
  }

  getEffectivePolicy(rule: string, level: PolicyLevel): OrgPolicy | undefined {
    const levelOrder: PolicyLevel[] = ['org', 'tenant', 'workspace', 'run']
    const matching = Array.from(this.policies.values())
      .filter(p => p.rule === rule)
      .sort((a, b) => levelOrder.indexOf(b.level) - levelOrder.indexOf(a.level))
    for (const p of matching) {
      if (levelOrder.indexOf(p.level) <= levelOrder.indexOf(level)) return p
    }
    return matching[0]
  }

  isOverrideable(parentId: string, childLevel: PolicyLevel): boolean {
    const parent = this.policies.get(parentId)
    if (!parent) return false
    if (!parent.overrideable) return false
    const levelOrder: PolicyLevel[] = ['org', 'tenant', 'workspace', 'run']
    return levelOrder.indexOf(childLevel) > levelOrder.indexOf(parent.level)
  }

  setQuota(resourceType: string, limit: number, level: PolicyLevel): void {
    this.quotas.set(resourceType, { resourceType, limit, used: 0, level })
  }

  checkQuota(resourceType: string, requested: number): { allowed: boolean; remaining: number } {
    const quota = this.quotas.get(resourceType)
    if (!quota) return { allowed: true, remaining: Infinity }
    const remaining = quota.limit - quota.used
    return { allowed: requested <= remaining, remaining: Math.max(0, remaining) }
  }

  recordUsage(resourceType: string, amount: number): void {
    const quota = this.quotas.get(resourceType)
    if (quota) this.quotas.set(resourceType, { ...quota, used: quota.used + amount })
  }

  setRetention(dataCategory: string, retentionDays: number, legalHold = false): void {
    this.retentionPolicies.set(dataCategory, { dataCategory, retentionDays, legalHold })
  }

  checkLegalHold(dataCategory: string): boolean {
    return this.retentionPolicies.get(dataCategory)?.legalHold ?? false
  }

  exportAudit(tenantId: string, recordCount: number, format = 'json'): AuditExportEntry {
    const entry: AuditExportEntry = {
      exportId: `exp-${randomUUID().slice(0, 12)}`,
      tenantId, exportedAt: Date.now(), recordCount, format,
    }
    this.auditExports.push(entry)
    return entry
  }

  getAuditExports(): readonly AuditExportEntry[] {
    return this.auditExports
  }

  clear(): void {
    this.policies.clear()
    this.quotas.clear()
    this.retentionPolicies.clear()
    this.auditExports = []
  }
}
