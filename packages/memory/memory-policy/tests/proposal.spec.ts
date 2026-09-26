/**
 * Unit suite for the pure proposal decision (`decideProposal`, `../src/proposal.ts`):
 * every branch of P6-03 `must[0]`/`must[1]`/`must[2]` — an incomplete proposal
 * (no intended use, or an omitted TTL) is held for review, sensitive and
 * unassessed writes go to review, a weakly-inferred claim goes to review, and a
 * complete, normal, sufficiently-evidenced write is auto-accepted. Acting on the
 * decision is `dsh-memory`'s `propose`; this suite exercises only the decision.
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

const principal = createUserPrincipal(PrincipalId('user-1'), TenantId('tenant-a'))
const scope = { tenantId: TenantId('tenant-a') }
const purpose = 'answer questions about this project'
const validUntil = '2099-01-01T00:00:00Z'

/** Fields a case overrides on the complete base below. */
type Overrides = Partial<Pick<MemoryProposeRequest, 'sensitivity' | 'origin' | 'purpose' | 'validUntil'>>

/**
 * A complete, traceable candidate write — stated intended use and TTL, a
 * user-asserted origin — with per-case overrides. `sensitivity` is NOT in the
 * base, so a case that states none exercises the unstated-sensitivity branch.
 * @param fields - the fields this case overrides.
 * @returns the request.
 */
function requestWith(fields: Overrides): MemoryProposeRequest {
  return {
    principal,
    scope,
    content: { note: 'candidate' },
    origin: { kind: 'user-asserted', assertedBy: 'test' },
    purpose,
    validUntil,
    ...fields,
  }
}

describe('decideProposal (P6-03 must[0]/must[1]/must[2])', () => {
  it('sends a proposal that states no intended use to review (must[0])', () => {
    const request: MemoryProposeRequest = {
      principal,
      scope,
      content: { note: 'candidate' },
      origin: { kind: 'user-asserted', assertedBy: 'test' },
      validUntil,
      sensitivity: 'normal',
    }
    expect(decideProposal(request, thresholds).disposition).toBe('review')
  })

  it('sends a proposal that states no TTL to review (must[0])', () => {
    const request: MemoryProposeRequest = {
      principal,
      scope,
      content: { note: 'candidate' },
      origin: { kind: 'user-asserted', assertedBy: 'test' },
      purpose,
      sensitivity: 'normal',
    }
    expect(decideProposal(request, thresholds).disposition).toBe('review')
  })

  it('treats an explicit validUntil: null ("no expiry") as stated, not missing, and auto-accepts', () => {
    const request = requestWith({ sensitivity: 'normal', validUntil: null })
    expect(decideProposal(request, thresholds).disposition).toBe('auto-accept')
  })

  it('sends sensitive content to review whatever its origin', () => {
    expect(decideProposal(requestWith({ sensitivity: 'sensitive' }), thresholds).disposition).toBe('review')
  })

  it('sends a write whose sensitivity nobody stated to review (fail closed)', () => {
    // Complete but for sensitivity: an unassessed write is not auto-admissible (must[2]).
    expect(decideProposal(requestWith({}), thresholds).disposition).toBe('review')
  })

  it('sends a derived claim below the review-confidence threshold to review', () => {
    const request = requestWith({
      sensitivity: 'normal',
      origin: { kind: 'derived', sourceEvents: [sourceEventId('evt-1')], confidence: 0.4 },
    })
    expect(decideProposal(request, thresholds).disposition).toBe('review')
  })

  it('auto-accepts a complete derived claim at or above the confidence threshold', () => {
    const request = requestWith({
      sensitivity: 'normal',
      origin: { kind: 'derived', sourceEvents: [sourceEventId('evt-1')], confidence: 0.9 },
    })
    expect(decideProposal(request, thresholds).disposition).toBe('auto-accept')
  })

  it('auto-accepts a complete, normal, user-asserted write (confidence 1 by the vocabulary)', () => {
    const request = requestWith({ sensitivity: 'normal', origin: { kind: 'user-asserted', assertedBy: 'alice' } })
    expect(decideProposal(request, thresholds).disposition).toBe('auto-accept')
  })
})
