/**
 * The in-memory lease store, published as `ctx.leaseStore` (Epic P4-07).
 *
 * The counterpart to `@deepseek-ai/dsh-lease-sqlite`, for a caller that is
 * genuinely alone: a single-process harness, and every suite whose subject is
 * the consumer's behaviour rather than contention between hosts. It is NOT a
 * substitute for the durable store in a deployment — leases here die with the
 * process, so two hosts each hold their own map and both win, which is the
 * failure the durable provider exists to prevent.
 *
 * @module @deepseek-ai/dsh-lease/plugin
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  AcquireResult,
  FencingToken,
  Lease,
  RenewResult,
  WorkerId,
  WorkItemId,
} from '@deepseek-ai/dsh-lease-contract'
import { LeaseStore } from './store.ts'

/**
 * The mounted in-memory store.
 *
 * Forwards the contract rather than exposing {@link LeaseStore}, so a consumer
 * injecting the service cannot reach past the contract into this provider's
 * own surface and become unable to run against the durable one.
 */
export default class InMemoryLeaseStorePlugin extends Service {
  private readonly store = new LeaseStore()

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.leaseStore`.
   */
  constructor(ctx: Context) {
    super(ctx, 'leaseStore')
  }

  /**
   * Mark the store reachable or not.
   * @param available - whether the store can be reached.
   */
  setAvailable(available: boolean): void {
    this.store.setAvailable(available)
  }

  /**
   * The item's current lease.
   * @param workItem - the item to look up.
   * @returns the lease, or `undefined` when none is held.
   */
  get(workItem: WorkItemId): Lease | undefined {
    return this.store.get(workItem)
  }

  /**
   * Acquire the item for `worker`.
   * @param workItem - the item to acquire.
   * @param worker - the acquiring worker.
   * @param nowMs - the instant to judge the incumbent's expiry against.
   * @param leaseMs - how long the new lease should run from `nowMs`.
   * @returns the new lease and its token, or the reason for refusal.
   */
  acquire(workItem: WorkItemId, worker: WorkerId, nowMs: number, leaseMs: number): AcquireResult {
    return this.store.acquire(workItem, worker, nowMs, leaseMs)
  }

  /**
   * Extend the lease `token` authorizes.
   * @param token - the holder's current authority.
   * @param nowMs - the instant to judge expiry against.
   * @param leaseMs - how long the renewed lease should run from `nowMs`.
   * @returns the extended lease, or the reason for refusal.
   */
  renew(token: FencingToken, nowMs: number, leaseMs: number): RenewResult {
    return this.store.renew(token, nowMs, leaseMs)
  }

  /**
   * Give up the lease `token` authorizes.
   * @param token - the holder's authority over the item it is giving up.
   */
  release(token: FencingToken): void {
    this.store.release(token)
  }

  /**
   * Every item whose lease has expired at `nowMs`.
   * @param nowMs - the instant to judge expiry against.
   * @returns the reclaimable work items.
   */
  reclaimable(nowMs: number): readonly WorkItemId[] {
    return this.store.reclaimable(nowMs)
  }
}
