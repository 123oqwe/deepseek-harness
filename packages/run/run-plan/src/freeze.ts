import { createHash } from 'node:crypto'
import type { RunPlan } from './types.ts'

export interface FrozenPlan {
  readonly plan: RunPlan
  readonly signature: string
  readonly frozenAt: number
  readonly frozenBy: string
  readonly kernelVerified: boolean
}

export function freezePlan(plan: RunPlan, signedBy: string): FrozenPlan {
  const signature = signPlan(plan, signedBy)
  return {
    plan,
    signature,
    frozenAt: Date.now(),
    frozenBy: signedBy,
    kernelVerified: true,
  }
}

export function verifyFrozenPlan(frozen: FrozenPlan): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const expectedSig = signPlan(frozen.plan, frozen.frozenBy)
  if (frozen.signature !== expectedSig) {
    errors.push('Signature mismatch — plan has been tampered')
  }
  return { valid: errors.length === 0, errors }
}

function signPlan(plan: RunPlan, signer: string): string {
  const content = JSON.stringify({ plan, signer })
  return createHash('sha256').update(content).digest('hex')
}
