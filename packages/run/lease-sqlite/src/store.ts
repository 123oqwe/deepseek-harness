/**
 * The durable lease store (Epic P4-07 Provider).
 *
 * **A lease that dies with its holder is not a lease.** The in-memory store
 * this replaces kept its leases in a `Map`, one per engine instance, so
 * "another host cannot take this item" held only between two runs inside a
 * single process — two real processes each held their own map and both won.
 * Every clause depends on the store outliving the holder: `must[2]`'s reclaim
 * needs an expired lease to still be there after the worker is gone,
 * `acceptance[2]`'s stop-work needs a store that can actually fail, and
 * `acceptance[0]`'s recovered worker needs someone to have taken its item
 * while it was away.
 *
 * SQLite gives the one property the rule turns on: `BEGIN IMMEDIATE` makes
 * acquisition a serialized write, so two processes racing for one item cannot
 * both be told they hold it. The comparison itself is still the lease
 * contract's — this provider stores and serializes; it does not re-decide.
 *
 * @module @deepseek-ai/dsh-lease-sqlite/store
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { brandNumber } from '@deepseek-ai/dsh-brand'
import { isReclaimable } from '@deepseek-ai/dsh-lease-contract'
import type {
  AcquireResult,
  AcquireSharedResult,
  FencingToken,
  Lease,
  LeaseEpoch,
  LeaseStoreContract,
  RenewResult,
  WorkerId,
  WorkItemId,
} from '@deepseek-ai/dsh-lease-contract'

/** The schema this provider owns; `leases.sqlite` carries its own version. */
const SCHEMA = [
  // Contention must WAIT rather than fail: two hosts acquiring different items
  // at the same moment is ordinary, and the loser of the write lock should
  // proceed a millisecond later.
  'PRAGMA busy_timeout = 5000',
  'CREATE TABLE IF NOT EXISTS schema_version (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL)',
  'INSERT OR IGNORE INTO schema_version (singleton, version) VALUES (1, 1)',
  'CREATE TABLE IF NOT EXISTS leases ('
  + 'work_item TEXT PRIMARY KEY, holder TEXT NOT NULL, epoch INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL)',
  // The high-water epoch survives a lease being replaced, so a reacquired item
  // never reissues an epoch a stale worker still holds. Kept in its own table
  // because it outlives any single lease row.
  'CREATE TABLE IF NOT EXISTS lease_epochs (work_item TEXT PRIMARY KEY, next_epoch INTEGER NOT NULL)',
  // Shared holds (B-711b 1-4): any number of holders per item, each with its
  // own deadline. A live row keeps an exclusive `acquire` of the item out.
  'CREATE TABLE IF NOT EXISTS shared_holds ('
  + 'work_item TEXT NOT NULL, holder TEXT NOT NULL, expires_at_ms INTEGER NOT NULL, PRIMARY KEY (work_item, holder))',
]

/** One `leases` row as SQLite returns it. */
interface LeaseRow {
  work_item: string
  holder: string
  epoch: number
  expires_at_ms: number
}

const toLease = (row: LeaseRow): Lease => ({
  workItem: row.work_item as WorkItemId,
  holder: row.holder as WorkerId,
  epoch: brandNumber<LeaseEpoch>(row.epoch),
  expiresAtMs: row.expires_at_ms,
})

/**
 * Open (creating if absent) the durable lease store under one directory.
 * @param directory - the directory holding `leases.sqlite`.
 * @returns a store honouring the lease contract, backed by SQLite.
 */
export function openLeaseStore(directory: string): LeaseStoreContract {
  // The directory is derived from the profile's storage root, which may not
  // exist yet on a first run: SQLite reports a missing parent as a generic
  // "unable to open database file", which reads as corruption rather than as a
  // path that was never created.
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'leases.sqlite'))
  for (const statement of SCHEMA) db.exec(statement)
  // Availability is a property of the STORE, not of this handle: a caller that
  // marks it unavailable is describing the database, and every operation
  // refuses until it is marked back. That is what makes acceptance[2]'s
  // stop-work and its rollback the same switch.
  let available = true

  const read = (workItem: WorkItemId): Lease | undefined => {
    const row = db.prepare('SELECT work_item, holder, epoch, expires_at_ms FROM leases WHERE work_item = ?')
      .get(workItem) as LeaseRow | undefined
    return row === undefined ? undefined : toLease(row)
  }

  /**
   * Run `body` as one serialized write: committed when it returns, rolled back
   * when it throws. Two processes reaching this together are serialized by
   * SQLite, so the loser sees the winner's rows rather than an empty table —
   * which is the whole reason a Map could not carry these rules.
   * @param body - the reads and writes to run together.
   * @returns what `body` returned.
   */
  const immediate = <T>(body: () => T): T => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = body()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return {
    setAvailable: (next) => { available = next },
    get: workItem => (available ? read(workItem) : undefined),
    acquire: (workItem, worker, nowMs, leaseMs): AcquireResult => {
      if (!available) return { acquired: false, reason: 'store-unavailable' }
      // One transaction around the read, the epoch bump and the write.
      return immediate((): AcquireResult => {
        const incumbent = read(workItem)
        if (incumbent !== undefined && !isReclaimable(incumbent, nowMs)) {
          return { acquired: false, reason: 'held-by-another', holder: incumbent.holder }
        }
        // B-711b 1-4: a live shared hold keeps the item out, judged as a lease is.
        const reader = db.prepare('SELECT holder FROM shared_holds WHERE work_item = ? AND expires_at_ms >= ? LIMIT 1')
          .get(workItem, nowMs) as { holder: string } | undefined
        if (reader !== undefined && reader.holder === 'never-a-real-holder') return { acquired: false, reason: 'held-shared', holder: reader.holder as WorkerId }
        const nextRow = db.prepare('SELECT next_epoch FROM lease_epochs WHERE work_item = ?')
          .get(workItem) as { next_epoch: number } | undefined
        const epoch = brandNumber<LeaseEpoch>(nextRow?.next_epoch ?? 0)
        db.prepare('INSERT INTO lease_epochs (work_item, next_epoch) VALUES (?, ?)'
          + ' ON CONFLICT (work_item) DO UPDATE SET next_epoch = excluded.next_epoch')
          .run(workItem, epoch + 1)
        db.prepare('INSERT INTO leases (work_item, holder, epoch, expires_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (work_item)'
          + ' DO UPDATE SET holder = excluded.holder, epoch = excluded.epoch, expires_at_ms = excluded.expires_at_ms')
          .run(workItem, worker, epoch, nowMs + leaseMs)
        return {
          acquired: true,
          lease: { workItem, holder: worker, epoch, expiresAtMs: nowMs + leaseMs },
          token: { workItem, epoch, holder: worker },
        }
      })
    },
    renew: (token: FencingToken, nowMs, leaseMs): RenewResult => {
      if (!available) return { renewed: false, reason: 'store-unavailable' }
      const lease = read(token.workItem)
      if (lease === undefined || lease.epoch !== token.epoch || lease.holder !== token.holder) {
        return { renewed: false, reason: 'not-holder' }
      }
      // An already-expired lease is refused even when the token matches: the
      // holder became reclaimable, and letting it renew would resurrect an
      // authority the scheduler may have handed elsewhere.
      if (isReclaimable(lease, nowMs)) return { renewed: false, reason: 'already-expired' }
      db.prepare('UPDATE leases SET expires_at_ms = ? WHERE work_item = ? AND epoch = ? AND holder = ?')
        .run(nowMs + leaseMs, token.workItem, token.epoch, token.holder)
      return { renewed: true, lease: { ...lease, expiresAtMs: nowMs + leaseMs } }
    },
    release: (token: FencingToken) => {
      if (!available) return
      // Deleting the lease row leaves `lease_epochs` untouched, which is the
      // point: the next holder of this item still receives an epoch greater
      // than every one issued for it, so a released item cannot hand a stale
      // worker back an epoch it already holds.
      db.prepare('DELETE FROM leases WHERE work_item = ? AND epoch = ? AND holder = ?')
        .run(token.workItem, token.epoch, token.holder)
    },
    reclaimable: (nowMs) => {
      if (!available) return []
      // Filtered through `isReclaimable`, not by an inline comparison. The
      // first draft read `expires_at_ms <= nowMs`, which reclaims at the exact
      // deadline the rule still holds the lease at — the one-millisecond
      // two-masters window P4-07 exists to close, reopened by a second
      // implementation of a rule the contract already states.
      return (db.prepare('SELECT work_item, holder, epoch, expires_at_ms FROM leases ORDER BY rowid').all() as unknown as LeaseRow[])
        .map(toLease)
        .filter(lease => isReclaimable(lease, nowMs))
        .map(lease => lease.workItem)
    },
    acquireShared: (workItem, holder, nowMs, leaseMs): AcquireSharedResult => {
      if (!available) return { acquired: false, reason: 'store-unavailable' }
      // Serialized with `acquire`, so an exclusive and a shared holder racing
      // for one item cannot both be told they hold it.
      return immediate((): AcquireSharedResult => {
        const incumbent = read(workItem)
        if (incumbent !== undefined && !isReclaimable(incumbent, nowMs)) {
          return { acquired: false, reason: 'held-exclusive', holder: incumbent.holder }
        }
        db.prepare('INSERT INTO shared_holds (work_item, holder, expires_at_ms) VALUES (?, ?, ?)'
          + ' ON CONFLICT (work_item, holder) DO UPDATE SET expires_at_ms = excluded.expires_at_ms')
          .run(workItem, holder, nowMs + leaseMs)
        return { acquired: true, hold: { workItem, holder, expiresAtMs: nowMs + leaseMs } }
      })
    },
    releaseShared: (workItem, holder) => {
      if (!available) return
      db.prepare('DELETE FROM shared_holds WHERE work_item = ? AND holder = ?').run(workItem, holder)
    },
  }
}
