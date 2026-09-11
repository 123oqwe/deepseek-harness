/**
 * The Cordis plugin that publishes the durable bus store as a service
 * (Epic P4-06 Provider).
 *
 * Without it every consumer calls `openBusStore` and thereby decides for its
 * callers where the bus lives — and that directory is what makes the bus a
 * shared one at all: two hosts hand messages to each other only when a profile
 * pointed them at the same `bus.sqlite`. Mounting it once and letting consumers
 * inject it moves the decision to the profile, which is the same argument the
 * lease store and the taskboard were mounted under.
 *
 * The dispatcher is deliberately NOT here. `dispatchOnce` runs one pass and
 * needs a schedule and a transport; a plugin that owned those would be
 * answering "when does the bus deliver" and "over what", which are separate
 * decisions from "where does it live".
 *
 * @module @deepseek-ai/dsh-message-bus/plugin
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { commitIntake, openBusStore, recoverStaleClaims } from './bus-store.ts'
import { commitMemoryIntake, openMemoryBusStore, recoverMemoryStaleClaims } from './memory-store.ts'
import type { BusMessage, BusStore, InboxRow, IntakeCommit, RecoveryWindow, StoredOutboxRow } from './bus-store.ts'
import type { OutboxRecord } from './outbox.ts'

/** Where this mount keeps its messages. */
export interface Config {
  /**
   * Directory holding `bus.sqlite`, or absent for an in-memory bus.
   *
   * Deployment-varying, and it decides whether the bus connects anything: two
   * hosts exchanging messages need one directory, while a single-process
   * composition needs none at all. Only the profile knows which arrangement it
   * is in.
   *
   * **Absent means in-memory, not "no bus".** A composition that mounts this
   * plugin has consumers depending on a bus being there — settlement commits
   * before it delivers — so the choice is between a durable bus and a
   * process-local one, never between a bus and nothing. The same split
   * `@deepseek-ai/dsh-lease` makes against `@deepseek-ai/dsh-lease-sqlite`.
   */
  directory?: string
}

/**
 * The mounted durable bus, published as `ctx.messageBus`.
 *
 * Implements the store contract itself and forwards, so a consumer injecting
 * the service holds exactly what the contract describes and never learns that
 * SQLite is behind it. The two module-level operations that take a store —
 * committing an intake and sweeping stale claims — are methods here for the
 * same reason: a consumer that had to import them alongside the service would
 * be holding the storage choice again.
 */
export default class MessageBusPlugin extends Service implements BusStore {
  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config = z.object({
    directory: z.string(),
  })

  private opened: BusStore | undefined

  /** Which pair of module operations this mount's store belongs to. */
  private durable = false

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.messageBus`.
   * @param config - the validated configuration, naming the directory the bus lives in.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'messageBus')
  }

  /**
   * Open the database at mount.
   *
   * In `Service.init` rather than the constructor, for the reason
   * `@deepseek-ai/dsh-lease-sqlite` records: creating the directory and opening
   * SQLite are the steps that fail on a real deployment, and a constructor that
   * throws during service construction unwinds the tree into `cannot create
   * effect on inactive context` — a message naming neither the path nor the
   * database. A refused FORMAT surfaces here for the same reason: the store
   * rejects a file an older build wrote, and that refusal has to name itself.
   * @yields the teardown that releases the store handle.
   */
  * [Service.init](): Generator<() => void, void, void> {
    this.durable = this.config.directory !== undefined
    this.opened = this.durable ? openBusStore(this.config.directory as string) : openMemoryBusStore()
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
  private get store(): BusStore {
    if (this.opened === undefined) {
      throw new Error('MessageBusPlugin has no open database: this mount was already unloaded, or has not opened yet')
    }
    return this.opened
  }

  /**
   * Take responsibility for a message on behalf of one turn.
   * @param message - the arriving message.
   * @param turn - the turn claiming it.
   */
  claim(message: BusMessage, turn: number): void {
    this.store.claim(message, turn)
  }

  /**
   * The inbox row for one `(source, id, epoch)`.
   * @param source - the emitter the id is scoped to.
   * @param messageId - the message id.
   * @param epoch - the sender generation.
   * @returns the row, or `undefined` when this bus holds none.
   */
  inboxRow(source: string, messageId: string, epoch: number): InboxRow | undefined {
    return this.store.inboxRow(source, messageId, epoch)
  }

  /**
   * Every committed domain event, in commit order.
   * @returns the events.
   */
  domainEvents(): readonly BusMessage[] {
    return this.store.domainEvents()
  }

  /**
   * Every stored outbox row, in commit order.
   * @returns the rows, each carrying its delivery record.
   */
  outboxRows(): readonly StoredOutboxRow[] {
    return this.store.outboxRows()
  }

  /**
   * Persist one record's advanced state after a dispatch pass.
   * @param record - the record as the dispatch decision left it.
   */
  persistOutbox(record: OutboxRecord): void {
    this.store.persistOutbox(record)
  }

  /**
   * The dedup keys of consumed messages, which is the durable seen-set.
   * @returns the keys.
   */
  consumedKeys(): ReadonlySet<string> {
    return this.store.consumedKeys()
  }

  /**
   * Commit a domain event, its outbox rows and the inbox transition, in one
   * transaction (must[0]).
   * @param commit - the message, the claiming turn, and the rows it owes.
   */
  commitIntake(commit: IntakeCommit): void {
    // Dispatched on the store this mount opened rather than on a method the
    // contract carries: the transaction is the STORE's property — one
    // `BEGIN IMMEDIATE` for SQLite, one synchronous block in memory — and a
    // contract method would invite a third implementation of the same commit.
    if (this.durable) commitIntake(this.store, commit)
    else commitMemoryIntake(this.store, commit)
  }

  /**
   * Sweep claims older than the window, so a turn that never ran does not hold
   * a message forever (must[2]).
   * @param window - the expiry boundary.
   * @returns how many rows were released.
   */
  recoverStaleClaims(window: RecoveryWindow): number {
    return this.durable ? recoverStaleClaims(this.store, window) : recoverMemoryStaleClaims(this.store, window)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    messageBus: MessageBusPlugin
  }
}
