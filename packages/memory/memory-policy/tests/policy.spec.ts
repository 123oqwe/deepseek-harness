/**
 * Suite for the proposal-policy service (`MemoryProposalPolicyService`,
 * `../src/index.ts`): mounting it on a Context registers `memoryProposalPolicy`,
 * and its `decide` applies the deployment's review threshold to a candidate write
 * — the seam `dsh-memory`'s `propose` reaches through `ctx.get`. The service has
 * no injections, so a bare Context mounts it.
 * @module
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MemoryProposalPolicyService from '@deepseek-ai/dsh-memory-policy'
import type { MemoryProposeRequest } from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'

/** Brand a raw string as a source event id, as P6-02's vocabulary spells it. */
const sourceEventId = (id: string): never => id as never

/**
 * A complete, normal, derived candidate write with the given writer confidence —
 * complete (stated intended use and TTL) so only the confidence bar, not the
 * `must[0]` completeness rule, decides its disposition.
 * @param confidence - the derived claim's writer confidence.
 * @returns the request.
 */
function derivedRequest(confidence: number): MemoryProposeRequest {
  return {
    principal: createUserPrincipal(PrincipalId('user-1'), TenantId('tenant-a')),
    scope: { tenantId: TenantId('tenant-a') },
    content: { note: 'candidate' },
    purpose: 'answer questions about this project',
    validUntil: '2099-01-01T00:00:00Z',
    sensitivity: 'normal',
    origin: { kind: 'derived', sourceEvents: [sourceEventId('evt-1')], confidence },
  }
}

/** Mount the policy with an explicit review threshold and return the registered service. */
async function mountPolicy(reviewBelowConfidence: number): Promise<MemoryProposalPolicyService> {
  const ctx = new Context()
  await ctx.plugin(MemoryProposalPolicyService, { reviewBelowConfidence })
  const policy = ctx.get('memoryProposalPolicy') as MemoryProposalPolicyService | undefined
  if (policy === undefined) throw new Error('memoryProposalPolicy is not mounted')
  return policy
}

describe('MemoryProposalPolicyService', () => {
  it('mounts memoryProposalPolicy and decides against its threshold', async () => {
    const policy = await mountPolicy(0.5)
    expect(policy.decide(derivedRequest(0.4)).disposition).toBe('review')
    expect(policy.decide(derivedRequest(0.9)).disposition).toBe('auto-accept')
  })

  it('carries the deployment review threshold into the decision', async () => {
    // A higher bar sends a claim the default would have accepted to review instead.
    const policy = await mountPolicy(0.95)
    expect(policy.decide(derivedRequest(0.9)).disposition).toBe('review')
  })
})
