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
import { mayStartNewWork } from '@deepseek-ai/dsh-control-plane'
// The `ctx.controlPlane` slot is declared by the control plane's PLUGIN module,
// so the service's type reaches `ctx.get` only when that module is in the
// program. Nothing else here needs it, hence a type-only import.
import type {} from '@deepseek-ai/dsh-control-plane/plugin'
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

  private opened: LeaseStoreContract | undefined

  /** Leases this mount issued that no holder has given back, keyed by item and epoch. */
  private readonly held = new Set<string>()

  /** Set by the teardown: from then on the handle is kept only for {@link held}. */
  private closing = false

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.leaseStore`.
   * @param config - the validated configuration, naming the directory the store lives in.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'leaseStore')
  }

  /**
   * Open the database at mount.
   *
   * In `Service.init` rather than in the constructor, and the difference is not
   * stylistic: creating the directory and opening SQLite are the two steps that
   * can fail on a real deployment, and a constructor that throws during service
   * construction unwinds the tree into `cannot create effect on inactive
   * context` — a message naming neither the path nor the database. Measured:
   * pointing this row at a derived home path made every SDK snapshot scenario
   * fail with exactly that, and nothing in the failure said `leases`.
   *
   * The teardown drops the handle at once only when every lease this mount
   * issued has been given back. Otherwise it keeps the handle until the last
   * one is: a fiber unload runs every disposer concurrently, so a holder that
   * is still finishing the writes its lease authorizes, such as a Run's
   * terminal transitions after its session ended, would otherwise find the
   * store gone between two of them (P4-07 blind review 2-1). No new lease is
   * issued once the teardown has run.
   * @yields the teardown that closes the store handle.
   */
  * [Service.init](): Generator<() => void, void, void> {
    this.opened = openLeaseStore(this.config.directory)
    yield () => {
      this.closing = true
      if (this.held.size === 0) this.opened = undefined
    }
  }

  /**
   * The opened store.
   *
   * **The reachable failure is at teardown, not at startup.** A consumer cannot
   * read this before the mount finishes — `inject` holds it until the service is
   * available. After the teardown the handle is gone as soon as no lease this
   * mount issued is still held, and a fiber unload runs every disposer
   * concurrently, so a consumer that holds no lease and awaits anything in its
   * own disposer before calling in finds it gone. A holder releases before it
   * awaits (`@deepseek-ai/dsh-run`'s `pauseRun`, BLOCKED-197) or keeps the
   * handle alive until it does.
   * @returns the store this mount opened.
   * @throws when the handle is absent: almost always because this mount has
   * already been unloaded, and only in principle because it has not yet opened.
   */
  private get store(): LeaseStoreContract {
    if (this.opened === undefined) {
      throw new Error('LeaseStorePlugin has no open database: this mount was already unloaded, or has not opened yet')
    }
    return this.opened
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
   * Acquire the item for `worker`, unless an emergency stop forbids new work.
   *
   * The stop is consulted BEFORE the database is opened or touched, so a
   * refused acquisition writes nothing and issues no epoch: an epoch granted
   * under a stop would outlive it and authorize writes afterwards. The control
   * plane is read at call time — `ctx.get`, not `inject`, and nothing cached —
   * because the answer changes while this mount lives.
   *
   * This is the provider the shipped `dsh-base` bundle mounts, so it is the one
   * whose refusal an operator actually gets; the in-memory provider holds the
   * same gate and the contract's shared conformance suite runs it against both.
   *
   * A composition that mounts no control plane admits the acquisition, the
   * answer `stopGateFor` already gives on the dispatch path. A plane that is
   * mounted but not yet active is not absence: `state()` throws, and this does
   * not catch it.
   * @param workItem - the item to acquire.
   * @param worker - the acquiring worker.
   * @param nowMs - the instant to judge the incumbent's expiry against.
   * @param leaseMs - how long the new lease should run from `nowMs`.
   * @returns the new lease and its token, or the reason for refusal.
   */
  acquire(workItem: WorkItemId, worker: WorkerId, nowMs: number, leaseMs: number): AcquireResult {
    const plane = this.ctx.get('controlPlane')
    if (plane !== undefined && mayStartNewWork(plane.state()) !== undefined) {
      return { acquired: false, reason: 'stopped' }
    }
    if (this.closing) throw new Error('LeaseStorePlugin has no open database: this mount was already unloaded')
    const result = this.store.acquire(workItem, worker, nowMs, leaseMs)
    if (result.acquired) this.held.add(heldKey(result.token))
    return result
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
    // After the teardown, giving back the last lease this mount issued drops
    // the handle the teardown kept for it.
    this.store.release(token)
    this.held.delete(heldKey(token))
    if (this.closing && this.held.size === 0) this.opened = undefined
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

/**
 * The key under which a mount records a lease it issued: one per item and epoch.
 * @param token - the lease's fencing token.
 * @returns the key.
 */
function heldKey(token: FencingToken): string {
  return `${token.workItem}\u0000${String(token.epoch)}`
}
