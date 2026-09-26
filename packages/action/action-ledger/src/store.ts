/**
 * The idempotency ledger's durable store (Epic P4-12, Provider stage).
 *
 * The Contract stage decides; this makes the decision survive a crash. That
 * distinction is the whole epic: a reservation that exists only in memory
 * proves nothing after the process that held it is gone, and the window this
 * ledger closes is exactly the one where the process dies.
 *
 * **The reservation is written BEFORE the request leaves, and the write is
 * synchronous.** A batched or deferred write would reopen the window it exists
 * to close: the request goes out, the process dies, and the row saying "we
 * sent this" was still in a buffer. `reserve` returns only once the row is
 * committed.
 *
 * **Its own SQLite database, following `dsh-message-bus`'s bus.sqlite.** The
 * reservation and the state transition after it must be one atomic step
 * against a store other processes are also using — `BEGIN IMMEDIATE` gives
 * that, and a KV seam or the session log does not.
 *
 * @module @deepseek-ai/dsh-action-ledger/store
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { decideReservation } from './index.ts'
import type { LedgerEntry, LedgerEpoch, LedgerGeneration, LedgerResolution, LedgerScope, LedgerState, ReceiptDigest, ReserveDecision, ReserveRequest } from './types.ts'

/** The store's handle. */
export interface LedgerStore {
  /**
   * Take responsibility for one external effect, durably, before it is sent.
   *
   * The read and the write are one transaction: two workers reserving the same
   * key concurrently cannot both be told they hold it.
   */
  reserve: (request: ReserveRequest) => ReserveDecision
  /** Record that the request left the harness; a retry after this must not send again. */
  markSent: (scope: LedgerScope, key: string, epoch: LedgerGeneration) => void
  /**
   * Record the provider's receipt, which is the evidence the effect committed.
   * With a `resolution`, the host user is confirming an `ambiguous` entry: the
   * move and the resolution are written in one transaction, and an entry that
   * is no longer `ambiguous` is refused.
   */
  confirm: (scope: LedgerScope, key: string, epoch: LedgerGeneration, receiptDigest: ReceiptDigest, resolution?: LedgerResolution) => void
  /** Record that the outcome cannot be determined by retrying; it goes to reconciliation. */
  markAmbiguous: (scope: LedgerScope, key: string, epoch: LedgerGeneration) => void
  /**
   * Record that the host user resolved an `ambiguous` entry as undone. The move
   * and the resolution are written in one transaction, and an entry that is no
   * longer `ambiguous` is refused.
   */
  markCompensated: (scope: LedgerScope, key: string, epoch: LedgerGeneration, resolution: LedgerResolution) => void
  /** The entry for one scoped key, or undefined when it has never been reserved. */
  entry: (scope: LedgerScope, key: string) => LedgerEntry | undefined
  /** The `ambiguous` entries of one scope, by key: what is waiting for reconciliation. */
  listAmbiguous: (scope: LedgerScope) => readonly LedgerEntry[]
}

/**
 * The on-disk format this module writes.
 *
 * Version 2 made `epoch` nullable, where NULL means the holder had no lease
 * generation (BLOCKED-221). A version 1 file spells that column NOT NULL, so an
 * unfenced reservation against one fails on a constraint deep inside a
 * transaction; the version check refuses the file up front instead, which is
 * the pre-release stance — reject an old format rather than migrate it.
 */
const SCHEMA_VERSION = 2

/** The schema this module owns; `action-ledger.sqlite` carries its own version. */
const SCHEMA = [
  // Contention must WAIT rather than fail: two workers reserving different
  // keys at the same moment are ordinary, and the loser of the write lock
  // should proceed a millisecond later, not error.
  'PRAGMA busy_timeout = 5000',
  'CREATE TABLE IF NOT EXISTS schema_version (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL)',
  `INSERT OR IGNORE INTO schema_version (singleton, version) VALUES (1, ${SCHEMA_VERSION})`,
  // `scope` is half the PRIMARY KEY, not a column beside it: an idempotency
  // key is unique per client, so two principals presenting one key are two
  // reservations. A single-column key would make the second a duplicate of the
  // first and tell its owner so (BLOCKED-142).
  //
  // `epoch` is NULLABLE, and NULL is not zero: it records a holder that had no
  // lease generation at all. Every comparison against it uses `IS` rather than
  // `=` so the absent generation matches itself and nothing else.
  'CREATE TABLE IF NOT EXISTS ledger (scope TEXT NOT NULL, key TEXT NOT NULL, arguments_hash TEXT NOT NULL, state TEXT NOT NULL, epoch INTEGER, receipt_digest TEXT, PRIMARY KEY (scope, key))',
  // The host user's resolutions of ambiguous entries (BLOCKED-311). A table of
  // its own rather than new ledger columns, so a version 2 file gains it here
  // without a migration, and a build that predates it reads the ledger as before.
  'CREATE TABLE IF NOT EXISTS resolution (scope TEXT NOT NULL, key TEXT NOT NULL, outcome TEXT NOT NULL, resolved_by TEXT NOT NULL, resolved_at INTEGER NOT NULL, PRIMARY KEY (scope, key))',
]

/** The columns an entry is read from: its ledger row and, once resolved, its resolution. */
const ENTRY_SELECT = 'SELECT l.scope, l.key, l.arguments_hash, l.state, l.epoch, l.receipt_digest, r.outcome, r.resolved_by, r.resolved_at'
  + ' FROM ledger l LEFT JOIN resolution r ON r.scope = l.scope AND r.key = l.key'

/** One row of {@link ENTRY_SELECT}. */
interface EntryRow {
  scope: string
  key: string
  arguments_hash: string
  state: string
  epoch: number | null
  receipt_digest: string | null
  outcome: string | null
  resolved_by: string | null
  resolved_at: number | null
}

/**
 * The entry one row describes.
 * @param row - a row of {@link ENTRY_SELECT}.
 * @returns the entry, with its resolution when the host user resolved it.
 */
function entryOf(row: EntryRow): LedgerEntry {
  return {
    scope: row.scope as LedgerScope,
    key: row.key as LedgerEntry['key'],
    argumentsHash: row.arguments_hash as LedgerEntry['argumentsHash'],
    state: row.state as LedgerState,
    epoch: row.epoch === null ? 'unfenced' : row.epoch as LedgerEpoch,
    ...(row.receipt_digest === null ? {} : { receiptDigest: row.receipt_digest as ReceiptDigest }),
    ...(row.outcome === null ? {} : {
      resolution: {
        outcome: row.outcome as LedgerResolution['outcome'],
        resolvedBy: row.resolved_by as LedgerResolution['resolvedBy'],
        resolvedAt: row.resolved_at as number,
      },
    }),
  }
}

/**
 * Read one row.
 * @param db - the database.
 * @param scope - the principal the key belongs to.
 * @param key - the idempotency key.
 * @returns the entry, or undefined.
 */
function readEntry(db: DatabaseSync, scope: LedgerScope, key: string): LedgerEntry | undefined {
  const row = db.prepare(`${ENTRY_SELECT} WHERE l.scope = ? AND l.key = ?`).get(scope, key) as EntryRow | undefined
  return row === undefined ? undefined : entryOf(row)
}

/**
 * The column value for one generation: NULL for an unfenced holder.
 * @param epoch - the generation to store or match on.
 * @returns the integer generation, or null when the holder has none.
 */
function columnEpoch(epoch: LedgerGeneration): number | null {
  return epoch === 'unfenced' ? null : epoch
}

/**
 * Move one entry to a new state, refusing a caller the current epoch has
 * fenced out.
 *
 * The epoch is compared inside the same statement that writes, not read first
 * and checked after: a stalled worker that comes back between a read and a
 * write would otherwise overwrite the generation that replaced it.
 * @param db - the database.
 * @param scope - the principal the key belongs to.
 * @param key - the idempotency key.
 * @param epoch - the caller's generation, or `'unfenced'` when it holds no lease.
 * @param state - the state to move to.
 * @param receiptDigest - the receipt, for `confirmed`.
 * @param resolution - the host user's resolution, when this move reconciles an
 *   `ambiguous` entry: the entry must still be `ambiguous`, and the resolution is
 *   written in the same transaction as the move.
 */
function transition(
  db: DatabaseSync,
  scope: LedgerScope,
  key: string,
  epoch: LedgerGeneration,
  state: LedgerState,
  receiptDigest?: ReceiptDigest,
  resolution?: LedgerResolution,
): void {
  if (resolution === undefined) {
    move(db, scope, key, epoch, state, receiptDigest ?? null, '')
    return
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    move(db, scope, key, epoch, state, receiptDigest ?? null, ' AND state = \'ambiguous\'')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * The one UPDATE behind every transition.
 * @param db - the database.
 * @param scope - the principal the key belongs to.
 * @param key - the idempotency key.
 * @param epoch - the caller's generation, or `'unfenced'` when it holds no lease.
 * @param state - the state to move to.
 * @param receiptDigest - the receipt, or null.
 * @param condition - an extra WHERE clause; a resolve moves only an `ambiguous` entry.
 */
function move(
  db: DatabaseSync,
  scope: LedgerScope,
  key: string,
  epoch: LedgerGeneration,
  state: LedgerState,
  receiptDigest: ReceiptDigest | null,
  condition: string,
): void {
  // `epoch IS ?`, not `epoch = ?`: an unfenced holder's generation is SQL NULL,
  // and `NULL = NULL` is false, so `=` would refuse every write by the very
  // caller that holds the reservation.
  const changed = db
    .prepare(`UPDATE ledger SET state = ?, receipt_digest = ? WHERE scope = ? AND key = ? AND epoch IS ?${condition}`)
    .run(state, receiptDigest, scope, key, columnEpoch(epoch)).changes
  if (changed === 0) {
    const current = readEntry(db, scope, key)
    throw new Error(current === undefined
      ? `action ledger: ${key} has no reservation to move to ${state}`
      : current.epoch !== epoch
        ? `action ledger: ${key} is held by epoch ${String(current.epoch)}, not ${String(epoch)}`
        : `action ledger: ${key} is ${current.state}, not ambiguous, so it cannot be resolved`)
  }
}

/**
 * Open (creating if absent) the ledger store for one run or profile directory.
 * @param directory - the directory holding `action-ledger.sqlite`.
 * @returns the store handle.
 */
export function openLedgerStore(directory: string): LedgerStore {
  // The directory is derived from the profile's storage root, which may not
  // exist on a first run. SQLite reports a missing parent as "unable to open
  // database file", which reads as corruption rather than as a path nobody
  // created — and, mounted through the Loader, surfaces only as the whole
  // plugin tree failing to load (BLOCKED-148 measured that detour once).
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'action-ledger.sqlite'))
  for (const statement of SCHEMA) db.exec(statement)
  // The seeding INSERT is `OR IGNORE`, so a file written by an older build
  // keeps its own version and is refused here rather than failing later on a
  // NOT NULL constraint inside a reservation's transaction.
  const version = (db.prepare('SELECT version FROM schema_version WHERE singleton = 1').get() as { version: number }).version
  if (version !== SCHEMA_VERSION) {
    db.close()
    throw new Error(`action ledger: ${join(directory, 'action-ledger.sqlite')} is schema version ${String(version)}, not ${String(SCHEMA_VERSION)}; delete it to start a new ledger`)
  }
  // The connection is a closure variable, not a property and not a WeakMap
  // entry keyed by the handle. A first draft copied `dsh-message-bus`'s
  // WeakMap-plus-guard, and the case written to prove the guard fires showed
  // that HERE it cannot: every operation is a closure over this `db`, so no
  // call passes a caller-supplied handle and the refusal is unreachable.
  //
  // That is a difference between the two packages, not a defect in the other
  // one: `dsh-message-bus` exports `commitIntake(store, ...)` and
  // `recoverStaleClaims(store, ...)` as module-level functions taking the
  // handle as a parameter, so a forged object really does reach its
  // `connectionOf` and really is refused. Copying the mechanism without the
  // shape that makes it load-bearing would have left a check that cannot fail.
  const store: LedgerStore = {
    reserve: (request) => {
      // One transaction around the read AND the write. Deciding outside it
      // would let two workers read "no entry", both decide `reserved`, and
      // both send -- the duplicate this ledger exists to prevent, produced by
      // the ledger itself.
      db.exec('BEGIN IMMEDIATE')
      try {
        const decision = decideReservation(request, readEntry(db, request.scope, request.key))
        if (decision.action === 'reserved') {
          db.prepare('INSERT INTO ledger (scope, key, arguments_hash, state, epoch) VALUES (?, ?, ?, ?, ?)'
            + ' ON CONFLICT (scope, key) DO UPDATE SET epoch = excluded.epoch')
            .run(
              decision.entry.scope,
              decision.entry.key,
              decision.entry.argumentsHash,
              decision.entry.state,
              columnEpoch(decision.entry.epoch),
            )
        }
        db.exec('COMMIT')
        return decision
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    markSent: (scope, key, epoch) => { transition(db, scope, key, epoch, 'sent') },
    confirm: (scope, key, epoch, receiptDigest, resolution) => { transition(db, scope, key, epoch, 'confirmed', receiptDigest, resolution) },
    markAmbiguous: (scope, key, epoch) => { transition(db, scope, key, epoch, 'ambiguous') },
    markCompensated: (scope, key, epoch, resolution) => { transition(db, scope, key, epoch, 'compensated', undefined, resolution) },
    entry: (scope, key) => readEntry(db, scope, key),
    listAmbiguous: scope => (db.prepare(`${ENTRY_SELECT} WHERE l.scope = ? AND l.state = 'ambiguous' ORDER BY l.key`).all(scope) as unknown as EntryRow[])
      .map(entryOf),
  }
  return store
}
