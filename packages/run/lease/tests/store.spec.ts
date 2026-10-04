/**
 * P4-07 Provider stage: the lease store issues epochs, renews, reclaims, and
 * stops work when it cannot answer.
 *
 * The store is the only issuer of epochs, so these cases are what make
 * `checkFencing` meaningful — a token can carry only an epoch this store
 * handed out.
 */

import { describe, expect, it } from 'vitest'
import { LeaseStore } from '../src/store.ts'
import { checkFencing, type WorkerId, type WorkItemId } from '../src/types.ts'

const ITEM = 'work-item-1' as WorkItemId
const WORKER_A = 'worker-a' as WorkerId
const WORKER_B = 'worker-b' as WorkerId

describe('P4-07 must[0]: each acquisition owns the item at a strictly greater epoch', () => {
  it('issues increasing epochs across successive acquisitions of one item', () => {
    const store = new LeaseStore()
    const first = store.acquire(ITEM, WORKER_A, 0, 1_000)
    expect(first.acquired).toBe(true)
    if (!first.acquired) throw new Error('unreachable: asserted acquired above')

    // Expire the first lease, then let B take over.
    const second = store.acquire(ITEM, WORKER_B, 1_001, 1_000)
    expect(second.acquired).toBe(true)
    if (!second.acquired) throw new Error('unreachable: asserted acquired above')

    expect(second.lease.epoch).toBeGreaterThan(first.lease.epoch)
  })

  it('refuses a second worker while the incumbent lease is unexpired', () => {
    const store = new LeaseStore()
    store.acquire(ITEM, WORKER_A, 0, 1_000)

    // The refusal NAMES the incumbent (P4-09 §12.66). A denial that only says
    // "held by another" sends an operator looking for a second host, and the
    // commonest holder is the asking process itself.
    expect(store.acquire(ITEM, WORKER_B, 500, 1_000))
      .toEqual({ acquired: false, reason: 'held-by-another', holder: WORKER_A })
  })

  it('keeps epochs per work item, so acquiring one does not advance another', () => {
    const store = new LeaseStore()
    const other = 'work-item-2' as WorkItemId
    store.acquire(ITEM, WORKER_A, 0, 1_000)
    store.acquire(ITEM, WORKER_B, 1_001, 1_000)
    const fresh = store.acquire(other, WORKER_A, 0, 1_000)

    expect(fresh.acquired).toBe(true)
    if (!fresh.acquired) throw new Error('unreachable: asserted acquired above')
    // A shared counter would start item-2 at 2. Epoch 7 of item A says nothing
    // about item B, which is why the counter is per item.
    expect(fresh.lease.epoch).toBe(0)
  })
})

describe('P4-07 must[2]: heartbeat renews, and expiry lets the scheduler reclaim', () => {
  it('extends the deadline without issuing a new epoch', () => {
    const store = new LeaseStore()
    const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!acquired.acquired) throw new Error('unreachable')

    const renewed = store.renew(acquired.token, 500, 1_000)
    expect(renewed.renewed).toBe(true)
    if (!renewed.renewed) throw new Error('unreachable')

    // The holder's authority is unchanged; only its deadline moved. A renewal
    // that bumped the epoch would fence the holder out of its own work.
    expect(renewed.lease.epoch).toBe(acquired.lease.epoch)
    expect(renewed.lease.expiresAtMs).toBe(1_500)
    expect(checkFencing(acquired.token, store.get(ITEM))).toEqual({ admitted: true })
  })

  it('refuses to renew an ALREADY-EXPIRED lease, rather than resurrecting it', () => {
    const store = new LeaseStore()
    const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!acquired.acquired) throw new Error('unreachable')

    // The scheduler may already have handed this item to someone else. Letting
    // a lapsed holder renew is exactly the two-masters state.
    expect(store.renew(acquired.token, 1_001, 1_000))
      .toEqual({ renewed: false, reason: 'already-expired' })
  })

  it('refuses to renew on a token that is not the current authority', () => {
    const store = new LeaseStore()
    const first = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!first.acquired) throw new Error('unreachable')
    store.acquire(ITEM, WORKER_B, 1_001, 1_000)

    expect(store.renew(first.token, 1_100, 1_000))
      .toEqual({ renewed: false, reason: 'not-holder' })
  })

  it('lists an expired item as reclaimable and an unexpired one as not', () => {
    const store = new LeaseStore()
    store.acquire(ITEM, WORKER_A, 0, 1_000)

    expect(store.reclaimable(999)).toEqual([])
    expect(store.reclaimable(1_000)).toEqual([])
    expect(store.reclaimable(1_001)).toEqual([ITEM])
  })
})

describe('P4-07 acceptance[0]: the fenced worker learns only when its write is refused', () => {
  it('refuses the old token after reclaim, and admits the new one', () => {
    const store = new LeaseStore()
    const old = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!old.acquired) throw new Error('unreachable')
    const taken = store.acquire(ITEM, WORKER_B, 1_001, 1_000)
    if (!taken.acquired) throw new Error('unreachable')

    expect(checkFencing(old.token, store.get(ITEM)))
      .toEqual({ admitted: false, reason: 'stale-epoch' })
    expect(checkFencing(taken.token, store.get(ITEM))).toEqual({ admitted: true })
  })
})

describe('P4-07 acceptance[2]: an unavailable store stops new work', () => {
  it('refuses acquisition with a reason distinct from a free item', () => {
    const store = new LeaseStore()
    store.setAvailable(false)

    // "Nobody holds this" and "I cannot tell you who holds this" must not look
    // alike: reporting the item free during an outage is how the same work
    // reaches a second worker.
    expect(store.acquire(ITEM, WORKER_A, 0, 1_000))
      .toEqual({ acquired: false, reason: 'store-unavailable' })
  })

  it('refuses renewal while unavailable, so a holder cannot extend blindly', () => {
    const store = new LeaseStore()
    const acquired = store.acquire(ITEM, WORKER_A, 0, 1_000)
    if (!acquired.acquired) throw new Error('unreachable')
    store.setAvailable(false)

    expect(store.renew(acquired.token, 500, 1_000))
      .toEqual({ renewed: false, reason: 'store-unavailable' })
  })

  it('offers nothing reclaimable while unavailable, even for a lapsed lease', () => {
    const store = new LeaseStore()
    store.acquire(ITEM, WORKER_A, 0, 1_000)
    store.setAvailable(false)

    // Stop-work in both directions: nothing to pick up, and acquire refuses.
    expect(store.reclaimable(1_001)).toEqual([])
  })

  it('resumes normally once the store is available again', () => {
    const store = new LeaseStore()
    store.setAvailable(false)
    store.setAvailable(true)

    // A positive control: without it, a store stuck permanently unavailable
    // would satisfy every refusal case above.
    expect(store.acquire(ITEM, WORKER_A, 0, 1_000).acquired).toBe(true)
  })
})

describe('B-711b 1-4: shared holds keep an exclusive holder out, and an exclusive lease keeps them out', () => {
  it('refuses an exclusive acquire while a shared hold is live, naming the holder', () => {
    const store = new LeaseStore()
    expect(store.acquireShared(ITEM, WORKER_A, 0, 1_000))
      .toEqual({ acquired: true, hold: { workItem: ITEM, holder: WORKER_A, expiresAtMs: 1_000 } })
    expect(store.acquireShared(ITEM, WORKER_B, 0, 1_000).acquired).toBe(true)
    expect(store.acquire(ITEM, 'upgrader' as WorkerId, 500, 1_000)).toEqual({ acquired: false, reason: 'held-shared', holder: WORKER_A })
  })

  it('admits the exclusive acquire once every shared hold is released or lapsed', () => {
    const store = new LeaseStore()
    store.acquireShared(ITEM, WORKER_A, 0, 1_000)
    store.acquireShared(ITEM, WORKER_B, 0, 5_000)
    store.releaseShared(ITEM, WORKER_B)
    expect(store.acquire(ITEM, 'upgrader' as WorkerId, 1_000, 1_000).acquired).toBe(false)
    expect(store.acquire(ITEM, 'upgrader' as WorkerId, 1_001, 1_000).acquired).toBe(true)
  })

  it('refuses a shared hold while a live exclusive lease holds the item, and admits it once the lease lapses', () => {
    const store = new LeaseStore()
    store.acquire(ITEM, WORKER_A, 0, 1_000)
    expect(store.acquireShared(ITEM, WORKER_B, 500, 1_000)).toEqual({ acquired: false, reason: 'held-exclusive', holder: WORKER_A })
    expect(store.acquireShared(ITEM, WORKER_B, 1_001, 1_000).acquired).toBe(true)
  })

  it('refuses a shared hold while unavailable, and a release then changes nothing', () => {
    const store = new LeaseStore()
    store.acquireShared(ITEM, WORKER_A, 0, 1_000)
    store.setAvailable(false)
    expect(store.acquireShared(ITEM, WORKER_B, 0, 1_000)).toEqual({ acquired: false, reason: 'store-unavailable' })
    store.releaseShared(ITEM, WORKER_A)
    store.setAvailable(true)
    expect(store.acquire(ITEM, 'upgrader' as WorkerId, 0, 1_000).acquired).toBe(false)
  })
})
