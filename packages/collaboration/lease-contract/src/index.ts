/**
 * The lease capability definition: what a lease means, and the two rules every
 * holder and every store decide by (Epic P4-07).
 *
 * Separated from `@deepseek-ai/dsh-lease` and from every store so that a
 * consumer — a workflow host, an agent dispatcher — can depend on the rule
 * without depending on orchestration runtime or on a storage choice. The
 * providers live elsewhere: an in-memory store in `@deepseek-ai/dsh-lease`, the
 * durable one in `@deepseek-ai/dsh-lease-sqlite`.
 *
 * @module @deepseek-ai/dsh-lease-contract
 */

import type {} from '@deepseek-ai/cordis'
import type { FencingDecision, FencingToken, Lease, LeaseStoreContract } from './types.ts'

/**
 * The mounted lease store, published by whichever provider a profile mounts.
 *
 * Declared HERE rather than in a provider so the name means the contract and
 * not an implementation: a consumer injecting `leaseStore` gets the same type
 * whether the deployment mounted the durable SQLite store or the in-memory one,
 * and two providers cannot disagree about what the service is.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    leaseStore: LeaseStoreContract
  }
}

export type * from './types.ts'
export { acquireRunLease } from './run-lease.ts'
export type { RunLease, RunLeaseDenial } from './run-lease.ts'

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
 * too. That looks wrong and is deliberate: epochs are issued only by a store,
 * so an epoch larger than any it has issued did not come from it, and treating
 * a forged-high epoch as authoritative would invert the whole mechanism.
 * Refusing the unknown is the fail-closed direction.
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
