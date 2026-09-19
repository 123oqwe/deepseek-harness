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
import { mayStartNewWork } from '@deepseek-ai/dsh-control-plane'
// The `ctx.controlPlane` slot is declared by the control plane's PLUGIN module,
// so the service's type reaches `ctx.get` only when that module is in the
// program. Nothing else here needs it, hence a type-only import.
import type {} from '@deepseek-ai/dsh-control-plane/plugin'
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
   * Acquire the item for `worker`, unless an emergency stop forbids new work.
   *
   * The stop is consulted BEFORE the store, so a refused acquisition leaves no
   * trace in it: an epoch issued under a stop would outlive the stop and
   * authorize writes afterwards. The control plane is read at call time —
   * `ctx.get`, not `inject`, and nothing cached — because the answer changes
   * while this mount lives, and a copy taken at mount would report the state
   * the deployment was in when it started.
   *
   * A composition that mounts no control plane admits the acquisition, which
   * is the answer `stopGateFor` already gives on the dispatch path: capability
   * absence is not a stop. A plane that is mounted but not yet active is a
   * different case and stays a refusal — `state()` throws, and this does not
   * catch it, because a stop that cannot be read is not a stop that is absent.
   * @param workItem - the item to acquire.
   * @param worker - the acquiring worker.
   * @param nowMs - the instant to judge the incumbent's expiry against.
   * @param leaseMs - how long the new lease should run from `nowMs`.
   * @returns the new lease and its token, or the reason for refusal.
   */
  acquire(workItem: WorkItemId, worker: WorkerId, nowMs: number, leaseMs: number): AcquireResult {
    // The durable provider (`@deepseek-ai/dsh-lease-sqlite`) holds the same
    // four lines: the rule is one rule, and the shared conformance suite in
    // `@deepseek-ai/dsh-lease-contract` runs it against both. It is not
    // extracted into a package because the contract cannot depend on the
    // control plane — `dsh-control-plane` depends on `dsh-agent`, which
    // depends on `dsh-lease-contract`.
    const plane = this.ctx.get('controlPlane')
    if (plane !== undefined && mayStartNewWork(plane.state()) !== undefined) {
      return { acquired: false, reason: 'stopped' }
    }
    return this.store.acquire(workItem, worker, nowMs, leaseMs)
  }

  /**
   * Extend the lease `token` authorizes; an emergency stop does not gate this,
   * because a heartbeat keeps work already under way rather than starting any
   * — `LeaseStoreContract.renew` carries the reasoning.
   * @param token - the holder's current authority.
   * @param nowMs - the instant to judge expiry against.
   * @param leaseMs - how long the renewed lease should run from `nowMs`.
   * @returns the extended lease, or the reason for refusal.
   */
  renew(token: FencingToken, nowMs: number, leaseMs: number): RenewResult {
    return this.store.renew(token, nowMs, leaseMs)
  }

  /**
   * Give up the lease `token` authorizes; an emergency stop never gates this,
   * since handing an item back is what a stopped deployment wants.
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
