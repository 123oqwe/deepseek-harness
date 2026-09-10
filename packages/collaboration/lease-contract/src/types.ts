/**
 * The lease capability's declarations (Epic P4-07).
 *
 * A distributed scheduler cannot prevent an old worker from waking up. It can
 * only make sure that when one does, nothing it says is believed. That is the
 * whole design: authority is an epoch, every state write carries the epoch it
 * was authorized under, and a write naming an older epoch is refused whatever
 * it contains.
 *
 * No clock appears in these declarations. A heartbeat renews a lease by
 * advancing a deadline the caller supplies, and expiry is decided by comparing
 * that deadline to a caller-supplied instant — but the *staleness* test never
 * consults time at all. Two workers with skewed clocks still agree on which
 * epoch is larger, which is what makes acceptance[1] ("clock skew within
 * tolerance does not produce two masters") hold by construction rather than by
 * tuning.
 *
 * @module @deepseek-ai/dsh-lease-contract/types
 */

import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'

/** One unit of schedulable work, owned by at most one lease at a time. */
export type WorkItemId = Branded<'WorkItemId'>

/** A worker that may hold leases. */
export type WorkerId = Branded<'WorkerId'>

/**
 * A lease generation.
 *
 * Monotonic per work item: each acquisition receives an epoch strictly greater
 * than every epoch issued for that item before it. Comparing epochs is the
 * entire staleness test — there is nothing a stale worker can forge by
 * retrying, because it can only ever present the epoch it was given.
 */
export type LeaseEpoch = BrandedNumber<'LeaseEpoch'>

/**
 * The authority a worker attaches to every state write and action execution
 * (must[1]).
 *
 * Carries the work item as well as the epoch, because an epoch alone is
 * meaningless across items: epoch 7 of item A says nothing about item B, and a
 * token that omitted the item would let a worker holding any current lease
 * write to work it does not own.
 */
export interface FencingToken {
  readonly workItem: WorkItemId
  readonly epoch: LeaseEpoch
  readonly holder: WorkerId
}

/** A lease as the store holds it. */
export interface Lease {
  readonly workItem: WorkItemId
  readonly holder: WorkerId
  readonly epoch: LeaseEpoch
  /** Epoch milliseconds after which the scheduler may reclaim this item. */
  readonly expiresAtMs: number
}

/** Why a fencing check refused a write (must[3]). */
export type FencingDenialReason =
  /** The token names an epoch older than the item's current lease. */
  | 'stale-epoch'
  /** The token names a work item this lease does not cover. */
  | 'wrong-work-item'
  /** The token's epoch matches, but it names a different holder. */
  | 'holder-mismatch'
  /** No lease exists for this work item at all. */
  | 'no-lease'

/** The outcome of checking one token against the item's current lease. */
export type FencingDecision =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: FencingDenialReason }

/** Why an acquisition was refused. */
export type AcquireDenialReason =
  /** Another worker holds an unexpired lease on this item. */
  | 'held-by-another'
  /** The store is unavailable, so no answer about ownership is possible. */
  | 'store-unavailable'

/** The outcome of an acquisition attempt. */
export type AcquireResult =
  | { readonly acquired: true; readonly lease: Lease; readonly token: FencingToken }
  | {
    readonly acquired: false
    readonly reason: AcquireDenialReason
    /**
     * The worker that holds the item, present only for `'held-by-another'`.
     *
     * Reported because a refusal that cannot name the holder sends an operator
     * looking for a second host that may not exist: the commonest case is a
     * process asking for an item it already holds itself.
     */
    readonly holder?: WorkerId
  }

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
 * What a lease store must do, independent of where it keeps the leases.
 *
 * Declared here, away from every implementation, so a consumer depends on the
 * RULE rather than on whichever store happens to be nearest. A consumer that
 * `new`s a concrete store instead of taking one is choosing the storage for its
 * callers, which is how a workflow engine came to hold every lease in a `Map`
 * nobody could share.
 */
export interface LeaseStoreContract {
  /**
   * Mark the store reachable or not; an unreachable store refuses all work.
   * @param available - whether the store can be reached.
   */
  setAvailable(available: boolean): void
  /**
   * The item's current lease.
   * @param workItem - the item to look up.
   * @returns the lease, or `undefined` when none is held.
   */
  get(workItem: WorkItemId): Lease | undefined
  /**
   * Take an item, issuing a strictly greater epoch, or say why not.
   *
   * An expired lease is taken over rather than refused: expiry is precisely
   * the condition under which the scheduler may reclaim (must[2]). The
   * previous holder is not consulted and is not notified — it discovers it was
   * fenced when its next write is refused, the one notification that cannot be
   * lost. While the store is unavailable this refuses rather than reporting
   * the item free, because "nobody holds this" and "I cannot tell you who
   * holds this" must not look alike to a scheduler (acceptance[2]).
   * @param workItem - the item to acquire.
   * @param worker - the acquiring worker.
   * @param nowMs - the instant to judge the incumbent's expiry against.
   * @param leaseMs - how long the new lease should run from `nowMs`.
   * @returns the new lease and its token, or the reason for refusal.
   */
  acquire(workItem: WorkItemId, worker: WorkerId, nowMs: number, leaseMs: number): AcquireResult
  /**
   * Extend the lease a token authorizes (must[2]).
   *
   * Refuses an already-expired lease even when the token is otherwise current:
   * a holder whose lease lapsed has become reclaimable, and reviving it would
   * resurrect an authority the scheduler may already have handed elsewhere.
   * Renewal issues no new epoch — only the deadline moves.
   * @param token - the holder's current authority.
   * @param nowMs - the instant to judge expiry against.
   * @param leaseMs - how long the renewed lease should run from `nowMs`.
   * @returns the extended lease, or the reason for refusal.
   */
  renew(token: FencingToken, nowMs: number, leaseMs: number): RenewResult
  /**
   * Give up the lease a token authorizes, so the item is free immediately.
   *
   * A run that FINISHED is not the same as one whose lease lapsed. Without
   * this, every completed run leaves its item owned until the deadline it
   * never needed, and a scheduler with a thousand short runs spends its
   * capacity waiting for leases nobody holds. Releasing is not reclaiming: it
   * issues no epoch and hands the item to nobody, it only stops this holder
   * from owning it.
   *
   * Idempotent, and silent when the token is not current — a holder that was
   * already fenced out has nothing to give up, and reporting that as an error
   * would make ordinary teardown noisy.
   * @param token - the holder's authority over the item it is giving up.
   */
  release(token: FencingToken): void
  /**
   * Every item whose lease has expired at `nowMs` and may be reclaimed.
   *
   * Empty while the store is unavailable rather than throwing: a scheduler
   * asking what it may pick up during an outage should find nothing, and
   * `acquire` refuses anyway, so this is stop-work in both directions.
   * @param nowMs - the instant to judge expiry against.
   * @returns the reclaimable work items.
   */
  reclaimable(nowMs: number): readonly WorkItemId[]
}
