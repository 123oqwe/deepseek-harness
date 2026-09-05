/**
 * The lease store: acquisition, heartbeat renewal, and scheduler reclaim
 * (Epic P4-07).
 *
 * The store is the sole issuer of epochs, which is what makes
 * `./types.ts`'s `checkFencing` meaningful: a token can only carry an epoch
 * this store handed out, so refusing anything that is not the item's current
 * epoch refuses every forgery too.
 *
 * Availability is part of the contract rather than an error path bolted on.
 * acceptance[2] requires that new work STOP when the store fails, and a store
 * that answered "no lease" while unavailable would be indistinguishable from
 * one reporting a genuinely free item — which is exactly how a partitioned
 * scheduler hands the same work to a second worker.
 *
 * @module @deepseek-ai/dsh-lease/store
 */

import { brandNumber } from '@deepseek-ai/dsh-brand'
import { isReclaimable, type FencingToken, type Lease, type LeaseEpoch, type WorkerId, type WorkItemId } from './types.ts'

/** Why an acquisition was refused. */
export type AcquireDenialReason =
  /** Another worker holds an unexpired lease on this item. */
  | 'held-by-another'
  /** The store is unavailable, so no answer about ownership is possible. */
  | 'store-unavailable'

/** The outcome of an acquisition attempt. */
export type AcquireResult =
  | { readonly acquired: true; readonly lease: Lease; readonly token: FencingToken }
  | { readonly acquired: false; readonly reason: AcquireDenialReason }

/** Why a renewal was refused. */
export type RenewDenialReason =
  /** The presented token is not the item's current authority. */
  | 'not-holder'
  /** The lease had already expired; renewing it would resurrect a fenced worker. */
  | 'already-expired'
  /** The store is unavailable. */
  | 'store-unavailable'

/** The outcome of a heartbeat. */
export type RenewResult =
  | { readonly renewed: true; readonly lease: Lease }
  | { readonly renewed: false; readonly reason: RenewDenialReason }

/**
 * An in-memory lease store.
 *
 * `available` is settable so acceptance[2] can be driven directly: a test, and
 * a real deployment's health check, need the same switch.
 */
export class LeaseStore {
  private readonly leases = new Map<WorkItemId, Lease>()
  private readonly nextEpoch = new Map<WorkItemId, number>()
  private available = true

  /** Mark the store reachable or not; an unreachable store refuses all work. */
  setAvailable(available: boolean): void {
    this.available = available
  }

  /** The item's current lease, or `undefined` when none is held. */
  get(workItem: WorkItemId): Lease | undefined {
    return this.leases.get(workItem)
  }

  /**
   * Acquire the item for `worker`, issuing a strictly greater epoch.
   *
   * An expired lease is taken over rather than refused: expiry is precisely
   * the condition under which the scheduler may reclaim (must[2]). The
   * previous holder is not consulted and is not notified — it will discover it
   * was fenced when its next write is refused, which is the only notification
   * that cannot be lost.
   *
   * Refuses while unavailable rather than reporting the item free, because
   * "nobody holds this" and "I cannot tell you who holds this" must not look
   * alike to a scheduler (acceptance[2]).
   * @param workItem - the item to acquire.
   * @param worker - the acquiring worker.
   * @param nowMs - the instant to judge the incumbent's expiry against.
   * @param leaseMs - how long the new lease should run from `nowMs`.
   * @returns the new lease and its token, or the reason for refusal.
   */
  acquire(workItem: WorkItemId, worker: WorkerId, nowMs: number, leaseMs: number): AcquireResult {
    if (!this.available) return { acquired: false, reason: 'store-unavailable' }
    const incumbent = this.leases.get(workItem)
    if (incumbent !== undefined && !isReclaimable(incumbent, nowMs)) {
      return { acquired: false, reason: 'held-by-another' }
    }
    const epoch = brandNumber<LeaseEpoch>(this.nextEpoch.get(workItem) ?? 0)
    this.nextEpoch.set(workItem, epoch + 1)
    const lease: Lease = { workItem, holder: worker, epoch, expiresAtMs: nowMs + leaseMs }
    this.leases.set(workItem, lease)
    return { acquired: true, lease, token: { workItem, epoch, holder: worker } }
  }

  /**
   * Extend the lease `token` authorizes (must[2]).
   *
   * Refuses an ALREADY-EXPIRED lease even when the token is otherwise current.
   * A worker whose lease lapsed has already become reclaimable, and letting it
   * renew would resurrect an authority the scheduler may have handed to
   * someone else in the meantime — the two-masters state this epic exists to
   * prevent. Renewal does not issue a new epoch: the holder's authority is
   * unchanged, only its deadline moves.
   * @param token - the holder's current authority.
   * @param nowMs - the instant to judge expiry against.
   * @param leaseMs - how long the renewed lease should run from `nowMs`.
   * @returns the extended lease, or the reason for refusal.
   */
  renew(token: FencingToken, nowMs: number, leaseMs: number): RenewResult {
    if (!this.available) return { renewed: false, reason: 'store-unavailable' }
    const lease = this.leases.get(token.workItem)
    if (lease === undefined || lease.epoch !== token.epoch || lease.holder !== token.holder) {
      return { renewed: false, reason: 'not-holder' }
    }
    if (isReclaimable(lease, nowMs)) return { renewed: false, reason: 'already-expired' }
    const renewed: Lease = { ...lease, expiresAtMs: nowMs + leaseMs }
    this.leases.set(token.workItem, renewed)
    return { renewed: true, lease: renewed }
  }

  /**
   * Every item whose lease has expired and may be reclaimed at `nowMs`.
   *
   * Returns an empty list while unavailable rather than throwing: a scheduler
   * asking "what can I pick up" during an outage should find nothing to do,
   * and `acquire` refuses anyway, so this is stop-work in both directions.
   * @param nowMs - the instant to judge expiry against.
   * @returns the reclaimable work items, in insertion order.
   */
  reclaimable(nowMs: number): readonly WorkItemId[] {
    if (!this.available) return []
    return [...this.leases.values()].filter(lease => isReclaimable(lease, nowMs)).map(lease => lease.workItem)
  }
}
