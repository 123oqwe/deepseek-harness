import type { RiskClassification, RiskLevel, SideEffectType, DataSensitivity } from './types.ts'

export function classifyRisk(
  sideEffectType: SideEffectType,
  dataSensitivity: DataSensitivity = 'internal',
  toolName?: string,
): RiskClassification {
  const sensitivityBoost: Record<DataSensitivity, number> = { public: 0, internal: 0, confidential: 1, restricted: 2 }
  const baseRisk: Record<SideEffectType, RiskLevel> = {
    'read': 'low',
    'local-write': 'medium',
    'network-read': 'low',
    'network-write': 'high',
    'process': 'high',
    'external': 'critical',
    'irreversible': 'irreversible',
  }

  let riskLevel = baseRisk[sideEffectType]
  const boost = sensitivityBoost[dataSensitivity]

  const levels: RiskLevel[] = ['none', 'low', 'medium', 'high', 'critical', 'irreversible']
  const currentIdx = levels.indexOf(riskLevel)
  const boostedIdx = Math.min(currentIdx + boost, levels.length - 1)
  riskLevel = levels[boostedIdx] ?? riskLevel

  const requiresApproval = ['high', 'critical', 'irreversible'].includes(riskLevel)
  const requiresDualApproval = ['critical', 'irreversible'].includes(riskLevel)
  const requiresIdempotency = ['external', 'irreversible'].includes(sideEffectType)
  const requiresCompensation = sideEffectType === 'irreversible' || (sideEffectType === 'external' && riskLevel === 'critical')

  // Tool name override
  if (toolName?.includes('delete') || toolName?.includes('drop')) {
    riskLevel = 'irreversible'
  }
  if (toolName?.includes('pay') || toolName?.includes('transfer')) {
    riskLevel = 'critical'
    return {
      riskLevel, sideEffectType, dataSensitivity,
      requiresApproval: true, requiresDualApproval: true,
      requiresIdempotency: true, requiresCompensation: true,
      reason: `Payment/transfer operation: ${toolName}`,
    }
  }

  return {
    riskLevel, sideEffectType, dataSensitivity,
    requiresApproval, requiresDualApproval,
    requiresIdempotency, requiresCompensation,
    reason: `Classified as ${riskLevel} based on side-effect ${sideEffectType} and sensitivity ${dataSensitivity}`,
  }
}
