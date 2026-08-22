export type PolicyDecision = 'allow' | 'deny'

export interface PolicyRule {
  readonly id: string
  readonly capability: string
  readonly decision: PolicyDecision
  readonly priority: number
  readonly condition?: (ctx: PolicyContext) => boolean
  readonly source: 'kernel' | 'config' | 'plugin'
  readonly reason: string
}

export interface PolicyContext {
  readonly principalId: string
  readonly tenantId: string
  readonly runId: string
  readonly capability: string
  readonly parameters?: Record<string, unknown>
}

export interface PolicyResult {
  readonly decision: PolicyDecision
  readonly reason: string
  readonly source: string
  readonly ruleId: string
  readonly monotonic: boolean
}

export class MonotonicDenyViolation extends Error {
  constructor(ruleId: string) {
    super(`Monotonic deny violation: rule '${ruleId}' attempted to change a deny to allow`)
    this.name = 'MonotonicDenyViolation'
  }
}
