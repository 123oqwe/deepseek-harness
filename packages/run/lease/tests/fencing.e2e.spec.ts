/**
 * P4-07 acceptance: an old worker that wakes up cannot write anything.
 *
 * The subject is the fencing decision under the sequences that actually
 * produce a stale worker — a lease expiring and being reclaimed, then the
 * original holder returning with the token it still believes is valid. Cases
 * assert what the decision REFUSES, not that a function was called.
 *
 * `.e2e.spec.ts` rather than `.e2e.ts`: the latter routes into
 * vitest.e2e.config.ts, whose suites self-skip without an API key, and the
 * exact-SHA CI job runs the default config. Recorded as an adjudicated path
 * patch before this file was written (adjudication.json,
 * P4-07-C-fencing-e2e-not-yet-created).
 */

import { describe, expect, it } from 'vitest'
import {
  checkFencing,
  isReclaimable,
  type FencingToken,
  type Lease,
  type LeaseEpoch,
  type WorkerId,
  type WorkItemId,
} from '../src/types.ts'

const ITEM = 'work-item-1' as WorkItemId
const OTHER_ITEM = 'work-item-2' as WorkItemId
const OLD_WORKER = 'worker-old' as WorkerId
const NEW_WORKER = 'worker-new' as WorkerId

function lease(overrides: Partial<Lease> = {}): Lease {
  return { workItem: ITEM, holder: OLD_WORKER, epoch: 1 as LeaseEpoch, expiresAtMs: 1_000, ...overrides }
}

function token(overrides: Partial<FencingToken> = {}): FencingToken {
  return { workItem: ITEM, epoch: 1 as LeaseEpoch, holder: OLD_WORKER, ...overrides }
}

describe('P4-07 acceptance[0]: a recovered old worker cannot submit or act', () => {
  it('refuses the old holder\'s token after the item is reclaimed at a higher epoch', () => {
    // The full sequence, not a hand-built stale token: the old lease expires,
    // the scheduler reclaims at epoch 2, and only then does the old worker
    // wake up still holding epoch 1.
    const original = lease()
    expect(isReclaimable(original, 1_001)).toBe(true)
    const reclaimed = lease({ holder: NEW_WORKER, epoch: 2 as LeaseEpoch, expiresAtMs: 2_000 })

    expect(checkFencing(token(), reclaimed)).toEqual({ admitted: false, reason: 'stale-epoch' })
  })

  it('admits the new holder\'s token against the same reclaimed lease', () => {
    // A positive control beside the refusal: without it, a check that refused
    // everything would satisfy the case above.
    const reclaimed = lease({ holder: NEW_WORKER, epoch: 2 as LeaseEpoch })

    expect(checkFencing(token({ holder: NEW_WORKER, epoch: 2 as LeaseEpoch }), reclaimed))
      .toEqual({ admitted: true })
  })

  it('refuses a token whose epoch is HIGHER than any the store issued', () => {
    // Fail-closed on the unknown. Epochs come only from the store, so an epoch
    // above the current one did not come from it; admitting it would invert
    // the mechanism by making a forged-high epoch the strongest authority.
    expect(checkFencing(token({ epoch: 99 as LeaseEpoch }), lease()))
      .toEqual({ admitted: false, reason: 'stale-epoch' })
  })

  it('refuses any write when the item holds no lease at all', () => {
    expect(checkFencing(token(), undefined)).toEqual({ admitted: false, reason: 'no-lease' })
  })
})

describe('P4-07 must[1]: a token authorizes one work item, not the holder generally', () => {
  it('refuses a token naming a different work item even at a live epoch', () => {
    // Epoch 1 is current for this lease, so only the item check can refuse.
    expect(checkFencing(token({ workItem: OTHER_ITEM }), lease()))
      .toEqual({ admitted: false, reason: 'wrong-work-item' })
  })

  it('refuses a matching epoch presented by a different holder', () => {
    expect(checkFencing(token({ holder: NEW_WORKER }), lease()))
      .toEqual({ admitted: false, reason: 'holder-mismatch' })
  })

  it('reports the work-item mismatch even when the epoch is ALSO stale', () => {
    // Pins the check ORDER rather than the two checks separately. Reporting
    // `stale-epoch` here would tell a worker it was fenced out when its real
    // defect is routing a write to work it does not own.
    const reclaimed = lease({ epoch: 5 as LeaseEpoch })
    expect(checkFencing(token({ workItem: OTHER_ITEM, epoch: 1 as LeaseEpoch }), reclaimed))
      .toMatchObject({ reason: 'wrong-work-item' })
  })
})

describe('P4-07 acceptance[1]: clock skew does not produce two masters', () => {
  it('holds the lease AT its expiry instant, so renew and reclaim cannot both be legal', () => {
    // The boundary is the two-masters window. If expiry were `>=`, a renewal
    // and a reclaim arriving at the same instant would both be admitted.
    expect(isReclaimable(lease({ expiresAtMs: 1_000 }), 1_000)).toBe(false)
    expect(isReclaimable(lease({ expiresAtMs: 1_000 }), 1_001)).toBe(true)
  })

  it('decides staleness without consulting any clock, so skewed workers agree', () => {
    // Two observers disagreeing wildly about the time still reach the same
    // verdict, because the staleness test reads epochs only. This is what
    // makes acceptance[1] hold by construction rather than by tuning a
    // tolerance.
    const current = lease({ epoch: 2 as LeaseEpoch, holder: NEW_WORKER })
    const stale = token({ epoch: 1 as LeaseEpoch })

    expect(checkFencing(stale, current)).toEqual({ admitted: false, reason: 'stale-epoch' })
    expect(checkFencing(stale, { ...current, expiresAtMs: Number.MAX_SAFE_INTEGER }))
      .toEqual({ admitted: false, reason: 'stale-epoch' })
    expect(checkFencing(stale, { ...current, expiresAtMs: Number.MIN_SAFE_INTEGER }))
      .toEqual({ admitted: false, reason: 'stale-epoch' })
  })
})

describe('P4-07 validation[1]: one hundred workers contending for one item', () => {
  it('leaves exactly one admitted holder after a hundred sequential acquisitions', () => {
    // Each acquisition issues a strictly greater epoch, so after the contest
    // exactly one token is admitted and the other ninety-nine are fenced.
    let current = lease({ holder: 'worker-0' as WorkerId, epoch: 0 as LeaseEpoch })
    const issued: FencingToken[] = [token({ holder: 'worker-0' as WorkerId, epoch: 0 as LeaseEpoch })]
    for (let attempt = 1; attempt < 100; attempt += 1) {
      current = lease({ holder: `worker-${attempt}` as WorkerId, epoch: attempt as LeaseEpoch })
      issued.push(token({ holder: `worker-${attempt}` as WorkerId, epoch: attempt as LeaseEpoch }))
    }

    const admitted = issued.filter(candidate => checkFencing(candidate, current).admitted)
    expect(admitted).toHaveLength(1)
    expect(admitted[0]?.holder).toBe('worker-99')
  })
})
