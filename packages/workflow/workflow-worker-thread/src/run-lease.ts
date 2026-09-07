/**
 * The lease a workflow run holds while it is the current owner of its work
 * item (Epic P4-07 must[0]–must[2]).
 *
 * **This is the holder P4-07's clauses did not have.** The lease package has
 * had `LeaseStore.acquire`/`renew`, `checkFencing` and `isReclaimable` since
 * its Contract stage, and `dsh-agent`'s `advanceAgentLifecycleFenced` has
 * existed beside them — with, measured, zero production callers of either. A
 * fencing rule nothing holds refuses nothing, which is why P4-07's sign-off
 * was withdrawn (§12.15).
 *
 * A workflow run is the work item because it is the thing two hosts could
 * both believe they own: it has a durable id, it writes state its parent
 * reads, and it outlives individual messages.
 *
 * @module @deepseek-ai/dsh-workflow-worker-thread/run-lease
 */

import { LeaseStore, checkFencing } from '@deepseek-ai/dsh-lease'
import type { FencingToken, WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease'

/** Why a run could not take, or could not keep, its lease. */
export type RunLeaseDenial =
  /** The store could not be reached, so no new work may start (acceptance[2]). */
  | { readonly reason: 'store-unavailable' }
  /** Another holder owns this item and its lease has not expired. */
  | { readonly reason: 'held-by-another' }
  /** This holder's epoch is behind the store's: it was reclaimed and must stop. */
  | { readonly reason: 'fenced-out'; readonly currentEpoch: number }

/** What a run does with a lease while it is alive. */
export interface RunLease {
  /** The authority every state write carries (must[1]). */
  readonly token: FencingToken
  /**
   * Extend the lease.
   *
   * Returns the denial rather than throwing, because a heartbeat that fails is
   * ordinary — a reclaimed run must stop, and stopping is a decision its caller
   * makes with its own teardown in hand.
   */
  renew: (nowMs: number) => RunLeaseDenial | undefined
  /** Whether this holder may still write (must[1]). */
  mayWrite: (nowMs: number) => boolean
}

/**
 * Take the lease for one run, or say why not.
 *
 * The store's availability is checked FIRST and separately from ownership.
 * acceptance[2] is "stop new work when the lease store fails", and a store
 * that cannot answer is not the same as an item someone else holds: conflating
 * them would let an outage read as a busy item and be retried forever.
 * @param store - the lease store this host writes through.
 * @param workItem - the run, as the item being owned.
 * @param holder - this host's worker identity.
 * @param nowMs - the caller's clock reading.
 * @param leaseMs - how long the lease is granted for.
 * @returns the lease, or the denial that stops the run before it starts.
 */
export function acquireRunLease(
  store: LeaseStore,
  workItem: WorkItemId,
  holder: WorkerId,
  nowMs: number,
  leaseMs: number,
): { readonly lease: RunLease } | { readonly denied: RunLeaseDenial } {
  const acquired = store.acquire(workItem, holder, nowMs, leaseMs)
  if (!acquired.acquired) {
    return { denied: acquired.reason === 'store-unavailable' ? { reason: 'store-unavailable' } : { reason: 'held-by-another' } }
  }
  const token = acquired.token
  return {
    lease: {
      token,
      renew: (at) => {
        const renewed = store.renew(token, at, leaseMs)
        if (renewed.renewed) return undefined
        if (renewed.reason === 'store-unavailable') return { reason: 'store-unavailable' }
        const current = store.get(workItem)
        return { reason: 'fenced-out', currentEpoch: current?.epoch ?? 0 }
      },
      // Read through `checkFencing` rather than by comparing epochs here. The
      // comparison is the lease package's rule and the reason it is exported;
      // a second implementation of "is this token current" is the shape
      // BLOCKED-136 records, and this one would be the shape that decides
      // whether a stale worker may write.
      mayWrite: () => checkFencing(token, store.get(workItem)).admitted,
    },
  }
}
