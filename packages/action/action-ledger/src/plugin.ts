/**
 * The Cordis plugin that publishes the idempotency ledger as a service
 * (Epic P4-12 must[4]).
 *
 * Without it the ledger is a library with no caller: the store, the CAS
 * reservation and the five states all existed with, measured, zero production
 * callers, so "an external effect is reserved before it is sent" held over a
 * ledger nothing reserved against.
 *
 * @module @deepseek-ai/dsh-action-ledger/plugin
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { openLedgerStore } from './store.ts'
import type { LedgerStore } from './store.ts'
import type { LedgerEntry, LedgerEpoch, LedgerScope, ReceiptDigest, ReserveDecision, ReserveRequest } from './types.ts'

/** Where this mount keeps its ledger. */
export interface Config {
  /**
   * Directory holding `action-ledger.sqlite`.
   *
   * Deployment-varying, and the choice is the same one the lease store makes:
   * two hosts that must not both perform one external effect have to be
   * pointed at the same ledger, and only the profile knows whether they are
   * two hosts or two unrelated projects.
   */
  directory: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    actionLedger: ActionLedgerPlugin
  }
}

/**
 * The mounted ledger, published as `ctx.actionLedger`.
 *
 * Forwards {@link LedgerStore} rather than exposing the opened store, so a
 * consumer reaches only the operations the contract names and cannot reach
 * past them into this provider's own surface.
 */
export default class ActionLedgerPlugin extends Service {
  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config = z.object({
    directory: z.string().required(),
  }) as z<Config>

  private opened: LedgerStore | undefined

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.actionLedger`.
   * @param config - the validated configuration, naming the directory the ledger lives in.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'actionLedger')
  }

  /**
   * Open the database at mount.
   *
   * In `Service.init` rather than the constructor for the reason
   * `dsh-lease-sqlite` records: creating the directory and opening SQLite are
   * the steps that fail on a real deployment, and a constructor that throws
   * during service construction unwinds the tree into a message naming neither
   * the path nor the database.
   * @yields the teardown that releases the store handle.
   */
  * [Service.init](): Generator<() => void, void, void> {
    this.opened = openLedgerStore(this.config.directory)
    yield () => { this.opened = undefined }
  }

  /**
   * The opened store.
   * @returns the store this mount opened.
   *
   * **The reachable failure is at teardown, not at startup.** A consumer cannot
   * read this before the mount finishes — `inject` holds it until the service is
   * available — but the teardown yielded by `Service.init` clears the handle
   * SYNCHRONOUSLY, and a fiber unload runs every disposer concurrently. So a
   * consumer whose own disposer awaits anything before calling in finds the
   * handle already gone. Measured in `@deepseek-ai/dsh-lease-sqlite`, whose
   * identical wording sent a reader looking at startup for a shutdown fault
   * (BLOCKED-197).
   * @throws when the handle is absent: almost always because this mount has
   * already been unloaded, and only in principle because it has not yet opened.
   */
  private get store(): LedgerStore {
    if (this.opened === undefined) {
      throw new Error('ActionLedgerPlugin has no open database: this mount was already unloaded, or has not opened yet')
    }
    return this.opened
  }

  /**
   * Take responsibility for one external effect before it is sent.
   * @param request - the scope, key, arguments hash and epoch to reserve under.
   * @returns whether the caller may send, or why not.
   */
  reserve(request: ReserveRequest): ReserveDecision {
    return this.store.reserve(request)
  }

  /**
   * Record that the request left the harness.
   * @param scope - the reservation's owning principal.
   * @param key - the idempotency key.
   * @param epoch - the generation that holds the reservation.
   */
  markSent(scope: LedgerScope, key: string, epoch: LedgerEpoch): void {
    this.store.markSent(scope, key, epoch)
  }

  /**
   * Record the provider's receipt, the evidence the effect committed.
   * @param scope - the reservation's owning principal.
   * @param key - the idempotency key.
   * @param epoch - the generation that holds the reservation.
   * @param receiptDigest - the digest of what the provider returned.
   */
  confirm(scope: LedgerScope, key: string, epoch: LedgerEpoch, receiptDigest: ReceiptDigest): void {
    this.store.confirm(scope, key, epoch, receiptDigest)
  }

  /**
   * Record that retrying cannot determine the outcome.
   * @param scope - the reservation's owning principal.
   * @param key - the idempotency key.
   * @param epoch - the generation that holds the reservation.
   */
  markAmbiguous(scope: LedgerScope, key: string, epoch: LedgerEpoch): void {
    this.store.markAmbiguous(scope, key, epoch)
  }

  /**
   * The entry for one scoped key.
   * @param scope - the reservation's owning principal.
   * @param key - the idempotency key.
   * @returns the entry, or `undefined` when it was never reserved.
   */
  entry(scope: LedgerScope, key: string): LedgerEntry | undefined {
    return this.store.entry(scope, key)
  }
}
