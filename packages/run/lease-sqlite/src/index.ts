/**
 * The Cordis plugin that publishes the durable lease store as a service
 * (Epic P4-07 Provider).
 *
 * Without it every consumer opens its own store, which puts the storage choice
 * — and the directory it lives in — inside each consumer. A workflow host that
 * calls `openLeaseStore` decides for its callers where leases live and cannot
 * be pointed at a shared one from a profile; the same host is then also unable
 * to run against the in-memory store its unit tests want. Mounting the store
 * once and letting consumers inject it moves both decisions to the profile,
 * where a deployment can answer them.
 *
 * @module @deepseek-ai/dsh-lease-sqlite
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  AcquireResult,
  FencingToken,
  Lease,
  LeaseStoreContract,
  RenewResult,
  WorkerId,
  WorkItemId,
} from '@deepseek-ai/dsh-lease-contract'
import z from '@deepseek-ai/schemastery'
import { openLeaseStore } from './store.ts'

export { openLeaseStore } from './store.ts'

/** Where this mount keeps its leases. */
export interface Config {
  /**
   * Directory holding `leases.sqlite`.
   *
   * Deployment-varying: a laptop keeps leases beside the workspace, while two
   * hosts that must not both own a work item need one shared directory, and
   * only the profile knows which arrangement it is in.
   */
  directory: string
}

/**
 * The mounted durable lease store, published as `ctx.leaseStore`.
 *
 * Implements the store contract itself and forwards, so a consumer injecting
 * the service holds exactly what the contract describes and never learns that
 * SQLite is behind it.
 */
export default class LeaseStorePlugin extends Service implements LeaseStoreContract {
  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config = z.object({
    directory: z.string().required(),
  }) as z<Config>

  private readonly store: LeaseStoreContract

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.leaseStore`.
   * @param config - the validated configuration, naming the directory the store lives in.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'leaseStore')
    this.store = openLeaseStore(config.directory)
  }

  /**
   * Mark the store reachable or not.
   * @param available - whether the database can be reached.
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
   * Every item whose lease has expired at `nowMs`.
   * @param nowMs - the instant to judge expiry against.
   * @returns the reclaimable work items.
   */
  reclaimable(nowMs: number): readonly WorkItemId[] {
    return this.store.reclaimable(nowMs)
  }
}
