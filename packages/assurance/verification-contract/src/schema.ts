import type { VerificationContract, VerificationCriterion } from './types.ts'

export function validateContract(contract: VerificationContract): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!contract.id) errors.push('id required')
  if (!contract.runPlanId) errors.push('runPlanId required')
  if (!contract.objective) errors.push('objective required')
  if (contract.criteria.length === 0) errors.push('at least one criterion required')
  if (!contract.verifierId) errors.push('verifierId required')
  if (!contract.digest) errors.push('digest required')
  if (contract.schemaVersion !== '1.0.0') errors.push('schemaVersion must be 1.0.0')
  for (const c of contract.criteria) {
    if (!c.id) errors.push('criterion missing id')
    if (!c.description) errors.push('criterion missing description')
    if (!c.expectedValue) errors.push('criterion missing expectedValue')
  }
  return { valid: errors.length === 0, errors }
}

export function evaluateCriterion(criterion: VerificationCriterion, actualValue: string): VerificationCriterion {
  const passed = actualValue === criterion.expectedValue
  return { ...criterion, actualValue, passed }
}
