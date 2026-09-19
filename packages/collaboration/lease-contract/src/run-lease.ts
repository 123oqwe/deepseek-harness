/**
 * The lease one run holds while it is the current owner of its work item
 * (Epic P4-07 must[0]–must[2]).
 *
 * **This is the holder P4-07's clauses did not have.** The lease package has
 * had `acquire`/`renew`, `checkFencing` and `isReclaimable` since its Contract
 * stage, and `dsh-agent`'s `advanceAgentLifecycleFenced` has existed beside
 * them — with, measured, zero production callers of either. A fencing rule
 * nothing holds refuses nothing, which is why P4-07's sign-off was withdrawn
 * (§12.15).
 *
 * A run is the work item because it is the thing two hosts could both believe
 * they own: it has a durable id, it writes state its parent reads, and it
 * outlives individual messages. Two holders exist and share this shape
 * (§12.19-3): the core agent run, whose lease `dsh-run` takes when it opens a
 * Run and whose authority `agent-loop` presents on every tool dispatch, and a
 * workflow run in `dsh-workflow-worker-thread`. It lives HERE, beside the
 * contract, because a holder is not a storage choice and neither consumer may
 * depend on the other.
 *
 * @module @deepseek-ai/dsh-lease-contract/run-lease
 */

import { assertNever } from '@deepseek-ai/dsh-util-values'
import { checkFencing, isReclaimable } from './index.ts'
import type { AcquireDenialReason, FencingToken, Lease, LeaseStoreContract, WorkItemId, WorkerId } from './types.ts'

/** Why a run could not take, or could not keep, its lease. */
export type RunLeaseDenial =
  /** The store could not be reached, so no new work may start (acceptance[2]). */
  | { readonly reason: 'store-unavailable' }
  /** Another holder owns this item and its lease has not expired. */
  | { readonly reason: 'held-by-another'; readonly holder: WorkerId | undefined }
  /** This holder's epoch is behind the store's: it was reclaimed and must stop. */
  | { readonly reason: 'fenced-out'; readonly currentEpoch: number }
  /** An emergency stop is in force, so no new run may take an item (P2-12 must[2]). */
  | { readonly reason: 'stopped' }

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
  /**
   * Give the work item back when the run is over.
   *
   * A finished run is not a lapsed one. Holding the item until a deadline it
   * no longer needs blocks the caller most likely to want it next — a resume
   * of this very run — and makes a host of many short runs spend its capacity
   * waiting out leases nobody holds.
   */
  release: () => void
  /**
   * The item's lease as the store holds it NOW, for a caller that must check a
   * token against current authority — `dsh-agent`'s
   * `advanceAgentLifecycleFenced` is the one that matters.
   *
   * Read through rather than cached: a lease this holder lost is exactly the
   * case the check exists for, and a cached copy would report the authority
   * the holder wishes it still had.
   */
  currentLease: () => Lease | undefined
}

/**
 * What the item's previous holder left behind, as far as this host can tell.
 *
 * Three answers and not two, because a run whose holder GAVE THE ITEM BACK is
 * finished work, while one whose holder stopped renewing is work nobody is
 * doing: the first is resumed by opening a new run, the second is taken over,
 * and P4-05's acceptance[2] — "after a restart an orphaned Agent can be
 * reclaimed or fail safely" — is about the second alone.
 */
export type PredecessorState =
  /** Nobody has ever held this item: the store issued epoch 0. */
  | { readonly kind: 'none' }
  /** Someone held it and released it, so the item was free when this host asked. */
  | { readonly kind: 'released' }
  /** Someone held it and stopped renewing; this host is taking over from them. */
  | { readonly kind: 'lapsed'; readonly holder: WorkerId; readonly expiredAtMs: number }

/**
 * Decide which of the three a successful acquisition just took.
 *
 * **`before` is read from the store BEFORE acquiring, and the reading is
 * advisory.** The durable provider acquires inside one `BEGIN IMMEDIATE`
 * transaction while this read happens outside it, so another host may act in
 * between. That is acceptable for what this decides — which edge the caller's
 * own in-memory lifecycle walks, and what it says in the log — and it is NOT
 * acceptable for anything about authority: whether this host may write is
 * decided by the epoch it was issued and by `checkFencing`, never by this.
 *
 * `acquire`'s own answer cannot make the distinction: the high-water epoch
 * survives a release (`lease_epochs` is left alone when a lease row is
 * deleted), and an expired row is left in place until someone takes it over,
 * so "released cleanly" and "lapsed" both come back as a granted epoch above
 * zero. The difference is visible only in the row that was there beforehand.
 * @param before - the item's lease as the store held it before this acquisition, if any.
 * @param nowMs - the instant the acquisition judged expiry against.
 * @param grantedEpoch - the epoch the store issued for this acquisition.
 * @returns which of the three situations this host just stepped into.
 */
export function describePredecessor(
  before: Lease | undefined,
  nowMs: number,
  grantedEpoch: number,
): PredecessorState {
  if (before === undefined) return grantedEpoch === 0 ? { kind: 'none' } : { kind: 'released' }
  // A row that was still live would have made the acquisition fail, so a row
  // present at a granted acquisition is one the store judged reclaimable.
  if (!isReclaimable(before, nowMs)) return { kind: 'released' }
  return { kind: 'lapsed', holder: before.holder, expiredAtMs: before.expiresAtMs }
}

/**
 * Carry a store's refusal to the run's caller under its own name.
 *
 * **A switch and not a test-and-otherwise.** This mapping was a ternary whose
 * `else` said `'held-by-another'`, so the reason a provider added later — the
 * emergency stop — arrived at every caller as "another worker holds this item",
 * with no holder to name and no compiler complaint: the two unions are
 * declared separately, and a ternary type-checks however many members the
 * source union grows. `assertNever` makes the next added reason a typecheck
 * failure here instead of a wrong sentence in an operator's log.
 * @param reason - the store's own refusal.
 * @param holder - the incumbent worker the store named, for the one reason that has one.
 * @returns the same refusal in the run-side vocabulary.
 */
function denialFor(reason: AcquireDenialReason, holder: WorkerId | undefined): RunLeaseDenial {
  switch (reason) {
    case 'store-unavailable': return { reason: 'store-unavailable' }
    case 'held-by-another': return { reason: 'held-by-another', holder }
    case 'stopped': return { reason: 'stopped' }
    default: return assertNever(reason, 'AcquireDenialReason')
  }
}

/**
 * Take the lease for one run, or say why not.
 *
 * The store's availability is checked FIRST and separately from ownership.
 * acceptance[2] is "stop new work when the lease store fails", and a store
 * that cannot answer is not the same as an item someone else holds: conflating
 * them would let an outage read as a busy item and be retried forever.
 *
 * A provider that refuses because an emergency stop is in force answers
 * `'stopped'` without consulting its storage, and that answer reaches the
 * caller under its own name through {@link denialFor}.
 * @param store - the lease store this host writes through, durable and shared.
 * @param workItem - the run, as the item being owned.
 * @param holder - this host's worker identity.
 * @param nowMs - the caller's clock reading.
 * @param leaseMs - how long the lease is granted for.
 * @returns the lease, or the denial that stops the run before it starts.
 */
export function acquireRunLease(
  store: LeaseStoreContract,
  workItem: WorkItemId,
  holder: WorkerId,
  nowMs: number,
  leaseMs: number,
): { readonly lease: RunLease } | { readonly denied: RunLeaseDenial } {
  const acquired = store.acquire(workItem, holder, nowMs, leaseMs)
  if (!acquired.acquired) return { denied: denialFor(acquired.reason, acquired.holder) }
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
      currentLease: () => store.get(workItem),
      release: () => { store.release(token) },
    },
  }
}
