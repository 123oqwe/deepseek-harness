/**
 * Unit suite for the pure proposal decision (`decideProposal`, `../src/proposal.ts`):
 * every branch of P6-03 `must[1]`/`must[2]` — sensitive and unassessed writes go
 * to review, a weakly-inferred claim goes to review, and a normal, sufficiently
 * evidenced write is auto-accepted. Acting on the decision is `dsh-memory`'s
 * `propose`; this suite exercises only the decision.
 * @module
 */

import { describe, expect, it } from 'vitest'
import { decideProposal } from '@deepseek-ai/dsh-memory-policy'
import type { MemoryProposeRequest } from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'

/** Brand a raw string as a source event id, as P6-02's vocabulary spells it. */
const sourceEventId = (id: string): never => id as never

/** The deployment thresholds under test: a derived claim below 0.5 goes to review. */
const thresholds = { reviewBelowConfidence: 0.5 }

/** A traceable candidate write; `sensitivity` and `origin` are overridden per case. */
function requestWith(fields: Partial<Pick<MemoryProposeRequest, 'sensitivity' | 'origin'>>): MemoryProposeRequest {
  return {
    principal: createUserPrincipal(PrincipalId('user-1'), TenantId('tenant-a')),
    scope: { tenantId: TenantId('tenant-a') },
    content: { note: 'candidate' },
    origin: { kind: 'user-asserted', assertedBy: 'test' },
    ...fields,
  }
}

describe('decideProposal (P6-03 must[1]/must[2])', () => {
  it('sends sensitive content to review whatever its origin', () => {
    expect(decideProposal(requestWith({ sensitivity: 'sensitive' }), thresholds).disposition).toBe('review')
  })

  it('sends a write whose sensitivity nobody stated to review (fail closed)', () => {
    // No `sensitivity` key: an unassessed write is not auto-admissible (must[2]).
    expect(decideProposal(requestWith({}), thresholds).disposition).toBe('review')
  })

  it('sends a derived claim below the review-confidence threshold to review', () => {
    const request = requestWith({
      sensitivity: 'normal',
      origin: { kind: 'derived', sourceEvents: [sourceEventId('evt-1')], confidence: 0.4 },
    })
    expect(decideProposal(request, thresholds).disposition).toBe('review')
  })

  it('auto-accepts a derived claim at or above the confidence threshold', () => {
    const request = requestWith({
      sensitivity: 'normal',
      origin: { kind: 'derived', sourceEvents: [sourceEventId('evt-1')], confidence: 0.9 },
    })
    expect(decideProposal(request, thresholds).disposition).toBe('auto-accept')
  })

  it('auto-accepts a normal, user-asserted write (confidence 1 by the vocabulary)', () => {
    const request = requestWith({ sensitivity: 'normal', origin: { kind: 'user-asserted', assertedBy: 'alice' } })
    expect(decideProposal(request, thresholds).disposition).toBe('auto-accept')
  })
})
