/**
 * Worker leases, fencing tokens, and the staleness test (Epic P4-07).
 *
 * A distributed scheduler cannot prevent an old worker from waking up. It can
 * only make sure that when one does, nothing it says is believed. That is the
 * whole design: authority is an epoch, every state write carries the epoch it
 * was authorized under, and a write naming an older epoch is refused whatever
 * it contains.
 *
 * No clock appears in this module. A heartbeat renews a lease by advancing a
 * deadline the caller supplies, and expiry is decided by comparing that
 * deadline to a caller-supplied instant — but the *staleness* test never
 * consults time at all. Two workers with skewed clocks still agree on which
 * epoch is larger, which is what makes acceptance[1] ("clock skew within
 * tolerance does not produce two masters") hold by construction rather than
 * by tuning.
 *
 * @module @deepseek-ai/dsh-lease/types
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

/**
 * Decide whether a token authorizes a write against the item's current lease.
 *
 * Checks run in a fixed order — item, then existence, then epoch, then holder
 * — and the order is part of the contract because the reason is evidence. A
 * worker learning `stale-epoch` knows it was fenced out and should stop; one
 * learning `wrong-work-item` has a bug in its own routing. Reporting whichever
 * check happened to run first would make those indistinguishable.
 *
 * A token whose epoch EXCEEDS the current lease is refused as `stale-epoch`
 * too. That looks wrong and is deliberate: epochs are issued only by the
 * store, so an epoch larger than any it has issued did not come from it, and
 * treating a forged-high epoch as authoritative would invert the whole
 * mechanism. Refusing the unknown is the fail-closed direction.
 * @param token - the authority presented with the write.
 * @param lease - the item's current lease, or `undefined` when none is held.
 * @returns admitted, or the first reason that refuses.
 */
export function checkFencing(token: FencingToken, lease: Lease | undefined): FencingDecision {
  if (lease === undefined) return { admitted: false, reason: 'no-lease' }
  if (token.workItem !== lease.workItem) return { admitted: false, reason: 'wrong-work-item' }
  if (token.epoch !== lease.epoch) return { admitted: false, reason: 'stale-epoch' }
  if (token.holder !== lease.holder) return { admitted: false, reason: 'holder-mismatch' }
  return { admitted: true }
}

/**
 * Whether a lease has expired at `nowMs` and may be reclaimed (must[2]).
 *
 * Expiry is `nowMs > expiresAtMs`, so a lease is still held at the exact
 * instant it expires. The boundary is stated rather than left to chance
 * because reclaiming at the deadline and renewing at the deadline would
 * otherwise both be legal, which is the two-masters window this epic exists
 * to close.
 * @param lease - the lease to test.
 * @param nowMs - the instant to test against, supplied by the caller.
 * @returns whether the scheduler may reclaim this item.
 */
export function isReclaimable(lease: Lease, nowMs: number): boolean {
  return nowMs > lease.expiresAtMs
}
