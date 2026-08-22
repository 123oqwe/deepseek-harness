import type { VerificationContract } from './types.ts'

export function checkInvariants(contract: VerificationContract): { passed: boolean; violations: string[] } {
  const violations: string[] = []
  // Contract must be frozen before evaluation
  if (contract.status === 'draft') {
    violations.push('Contract must be frozen before evaluation')
  }
  // All criteria must have been evaluated
  const unevaluated = contract.criteria.filter(c => c.passed === undefined)
  if (unevaluated.length > 0) {
    violations.push(`${unevaluated.length} criteria not yet evaluated`)
  }
  // Contract must not be expired
  if (Date.now() > contract.frozenAt + contract.expiryMs) {
    violations.push('Contract has expired')
  }
  return { passed: violations.length === 0, violations }
}

export function isSatisfied(contract: VerificationContract): boolean {
  return contract.criteria.every(c => c.passed === true)
}
