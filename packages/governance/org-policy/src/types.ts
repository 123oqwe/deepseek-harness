export type PolicyLevel = 'org' | 'tenant' | 'workspace' | 'run'

export interface OrgPolicy {
  readonly id: string
  readonly level: PolicyLevel
  readonly rule: string
  readonly value: unknown
  readonly overrideable: boolean
  readonly parentPolicyId?: string | undefined
}

export interface Quota {
  readonly resourceType: string
  readonly limit: number
  readonly used: number
  readonly level: PolicyLevel
}

export interface RetentionPolicy {
  readonly dataCategory: string
  readonly retentionDays: number
  readonly legalHold: boolean
}

export interface AuditExportEntry {
  readonly exportId: string
  readonly tenantId: string
  readonly exportedAt: number
  readonly recordCount: number
  readonly format: string
}
