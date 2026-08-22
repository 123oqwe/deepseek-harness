export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical' | 'irreversible'
export type SideEffectType = 'read' | 'local-write' | 'network-read' | 'network-write' | 'process' | 'external' | 'irreversible'
export type DataSensitivity = 'public' | 'internal' | 'confidential' | 'restricted'

export interface RiskClassification {
  readonly riskLevel: RiskLevel
  readonly sideEffectType: SideEffectType
  readonly dataSensitivity: DataSensitivity
  readonly requiresApproval: boolean
  readonly requiresDualApproval: boolean
  readonly requiresIdempotency: boolean
  readonly requiresCompensation: boolean
  readonly reason: string
}
