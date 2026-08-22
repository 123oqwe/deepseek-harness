import { createHash } from 'node:crypto'
import type { VerificationContract } from './types.ts'
import { evaluateCriterion } from './schema.ts'

export type { VerificationContract, VerificationCriterion, ContractStatus } from './types.ts'
export { validateContract, evaluateCriterion } from './schema.ts'
export { checkInvariants, isSatisfied } from './invariant.ts'

export function freezeContract(
  input: Omit<VerificationContract, 'digest' | 'status' | 'frozenAt'>,
  frozenBy: string,
): VerificationContract {
  const frozenAt = Date.now()
  const content = { ...input, frozenAt, frozenBy }
  const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex')
  return { ...content, digest, status: 'frozen' }
}

export function evaluateContract(
  contract: VerificationContract,
  results: Record<string, string>,
): VerificationContract {
  const evaluated = contract.criteria.map((c) => {
    const actual = results[c.id]
    if (actual === undefined) return c
    return evaluateCriterion(c, actual)
  })
  const satisfied = evaluated.every(c => c.passed === true)
  return {
    ...contract,
    criteria: evaluated,
    status: satisfied ? 'satisfied' : 'failed',
  }
}
