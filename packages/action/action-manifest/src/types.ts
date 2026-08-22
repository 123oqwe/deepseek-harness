export type ActionRiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'irreversible'

export interface ActionManifest {
  readonly actionId: string
  readonly toolName: string
  readonly principalId: string
  readonly tenantId: string
  readonly runId: string
  readonly parameters: Record<string, unknown>
  readonly canonicalParameters: string
  readonly riskLevel: ActionRiskLevel
  readonly requiresApproval: boolean
  readonly idempotencyKey?: string
  readonly createdAt: string
  readonly signature?: string
}

export interface CanonicalizedManifest extends ActionManifest {
  readonly digest: string
}
