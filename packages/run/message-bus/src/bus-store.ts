/**
 * The message bus's own durable store: domain events, the outbox, and the
 * inbox claim, committed in one SQLite transaction (P4-06 must[0]).
 *
 * **Its own database, deliberately.** The reworded must[0] (C13) names one
 * `BEGIN IMMEDIATE` and excludes the storage KV seam, and neither existing
 * SQLite path fits: the KV seam is what the clause rules out, and
 * `session-query-sqlite` exists for session SEARCH with its schema version
 * owned by another package. Putting run-time message state under an owner that
 * did not choose it would make one package's migration another's problem.
 *
 * **The append-only run log is not part of the transaction.** P4-01's JSONL
 * append is the EFFECT of an outbox delivery — at-least-once, with the
 * consumer idempotent on `(messageId, epoch)` — while the durable write here
 * is the transaction that effect projects from. Folding the log into the
 * transaction would make a delivery's success a precondition of recording that
 * it was owed.
 *
 * **The inbox's three states exist for BLOCKED-088.** The rule that preceded
 * them treated `claimed` as terminal, which forbade `goal-round-driver`'s
 * deliberate restoration of a claimed message whose reservation had gone
 * stale — a turn that never ran and therefore produced no effect. Under
 * `claimed | consumed | released`, recovery sweeps an expired claim to
 * `released` and that restoration is an ordinary re-claim.
 *
 * Field names follow the CloudEvents attributes this epic owns
 * (`standards-ownership.json`): `id`, `source`, `type`, `time`, `subject`,
 * `datacontenttype`.
 *
 * @module @deepseek-ai/dsh-message-bus/bus-store
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** One arriving message, in CloudEvents attribute names plus this bus's epoch. */
export interface BusMessage {
  readonly id: string
  readonly source: string
  readonly type: string
  readonly time: string
  readonly subject?: string
  readonly datacontenttype?: string
  /** The delivery epoch; the same id at a different epoch is a different message. */
  readonly epoch: number
  readonly data: unknown
}

/** What an inbox row records about one message's claim. */
export type InboxState =
  /** A turn has taken responsibility and has not committed yet. */
  | 'claimed'
  /** The business effect ran and committed with its outbox rows. */
  | 'consumed'
  /** A claim expired without committing; the message may be claimed again. */
  | 'released'

/** One inbox row. */
export interface InboxRow {
  readonly messageId: string
  readonly epoch: number
  readonly claimedByTurn: number
  readonly state: InboxState
}

/** One row the outbox owes a peer. */
export interface OutboxRow {
  readonly target: string
  readonly payload: unknown
}

/** The store's handle. */
export interface BusStore {
  /** Take responsibility for a message on behalf of one turn. */
  claim: (message: BusMessage, turn: number) => void
  /** The inbox row for one `(id, epoch)`, or undefined when none exists. */
  inboxRow: (messageId: string, epoch: number) => InboxRow | undefined
  /** Every committed domain event, in commit order. */
  domainEvents: () => readonly BusMessage[]
  /** Every outbox row awaiting delivery. */
  outboxRows: () => readonly OutboxRow[]
  /** The dedup keys of consumed messages, which is the seen-set `classifyIntake` reads. */
  consumedKeys: () => ReadonlySet<string>
}

/** What one intake commits, all inside a single transaction. */
export interface IntakeCommit {
  readonly message: BusMessage
  readonly claimedByTurn: number
  readonly outbox: readonly OutboxRow[]
  /**
   * Test-only fault injection, naming WHERE to abort.
   *
   * Two points, not one: aborting only after the domain event would let a
   * plain sequential writer that stops at its first error impersonate a
   * transaction. Failing after the OUTBOX rows are written is what proves the
   * earlier statements are rolled back rather than merely never reached.
   */
  readonly failAt?: 'after-domain-event' | 'after-outbox'
}

/** How far back a claim must reach to count as expired. */
export interface RecoveryWindow {
  readonly expiredBefore: number
}


/**
 * Each store's database handle, module-private so a caller holding a
 * `BusStore` cannot reach the connection and run statements outside a
 * transaction. Same shape the trust kernel uses for its anchors.
 */
const CONNECTIONS = new WeakMap<BusStore, DatabaseSync>()

/** The schema this module owns; `bus.sqlite` carries its own version. */
const SCHEMA = [
  // Contention must WAIT, not fail. Without a busy timeout, a second consumer
  // arriving while another holds the write lock fails immediately, and the
  // clause's `BEGIN IMMEDIATE` buys nothing: measured, DEFERRED's read-to-write
  // upgrade throws `database is locked` at once because waiting there would
  // deadlock, while IMMEDIATE takes the lock up front and the timeout applies.
  'PRAGMA busy_timeout = 5000',
  'CREATE TABLE IF NOT EXISTS schema_version (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL)',
  'INSERT OR IGNORE INTO schema_version (singleton, version) VALUES (1, 1)',
  'CREATE TABLE IF NOT EXISTS domain_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, epoch INTEGER NOT NULL, source TEXT NOT NULL, type TEXT NOT NULL, time TEXT NOT NULL, subject TEXT, datacontenttype TEXT, data TEXT NOT NULL, digest TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, epoch INTEGER NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS inbox (message_id TEXT NOT NULL, epoch INTEGER NOT NULL, claimed_by_turn INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY (message_id, epoch))',
]

/** The dedup key for one message, which is its identity across retries. */
const keyOf = (messageId: string, epoch: number): string => `${messageId}:${String(epoch)}`

/**
 * The connection for a store, or a refusal naming the misuse.
 * @param store - the store handle.
 * @returns its database.
 */
function connectionOf(store: BusStore): DatabaseSync {
  const db = CONNECTIONS.get(store)
  if (db === undefined) throw new Error('bus store: this handle was not produced by openBusStore')
  return db
}

/**
 * Read one inbox row.
 * @param db - the database.
 * @param messageId - the message id.
 * @param epoch - the delivery epoch.
 * @returns the row, or undefined.
 */
function readInbox(db: DatabaseSync, messageId: string, epoch: number): InboxRow | undefined {
  const row = db.prepare('SELECT message_id, epoch, claimed_by_turn, state FROM inbox WHERE message_id = ? AND epoch = ?')
    .get(messageId, epoch) as { message_id: string; epoch: number; claimed_by_turn: number; state: string } | undefined
  if (row === undefined) return undefined
  return { messageId: row.message_id, epoch: row.epoch, claimedByTurn: row.claimed_by_turn, state: row.state as InboxState }
}

/**
 * Take responsibility for a message, refusing one already consumed.
 * @param db - the database.
 * @param message - the arriving message.
 * @param turn - the claiming turn.
 */
function claimRow(db: DatabaseSync, message: BusMessage, turn: number): void {
  const existing = readInbox(db, message.id, message.epoch)
  // A consumed message has already had its effect. Re-claiming it is the
  // double-effect this epic's dedup exists to prevent, so it is refused rather
  // than overwritten -- whereas `released` is precisely the state a stale
  // claim is swept to so it CAN be claimed again (BLOCKED-088).
  if (existing?.state === 'consumed') {
    throw new Error(`bus store: ${keyOf(message.id, message.epoch)} is already consumed and cannot be claimed again`)
  }
  db.prepare(
    'INSERT INTO inbox (message_id, epoch, claimed_by_turn, state) VALUES (?, ?, ?, \'claimed\')'
    + ' ON CONFLICT (message_id, epoch) DO UPDATE SET claimed_by_turn = excluded.claimed_by_turn, state = \'claimed\'',
  ).run(message.id, message.epoch, turn)
}

/**
 * Open (creating if absent) the bus store for one profile or run directory.
 * @param directory - the directory holding `bus.sqlite`.
 * @returns the store handle.
 */
export function openBusStore(directory: string): BusStore {
  const db = new DatabaseSync(join(directory, 'bus.sqlite'))
  for (const statement of SCHEMA) db.exec(statement)
  const store: BusStore = {
    claim: (message, turn) => { claimRow(db, message, turn) },
    inboxRow: (messageId, epoch) => readInbox(db, messageId, epoch),
    domainEvents: () => (db.prepare('SELECT message_id, epoch, source, type, time, subject, datacontenttype, data FROM domain_events ORDER BY seq').all() as Record<string, string | number | null>[])
      .map(row => ({
        id: String(row.message_id),
        source: String(row.source),
        type: String(row.type),
        time: String(row.time),
        ...row.subject === null ? {} : { subject: String(row.subject) },
        ...row.datacontenttype === null ? {} : { datacontenttype: String(row.datacontenttype) },
        epoch: Number(row.epoch),
        data: JSON.parse(String(row.data)) as unknown,
      })),
    outboxRows: () => (db.prepare('SELECT target, payload FROM outbox ORDER BY seq').all() as { target: string; payload: string }[])
      .map(row => ({ target: row.target, payload: JSON.parse(row.payload) as unknown })),
    consumedKeys: () => new Set((db.prepare("SELECT message_id, epoch FROM inbox WHERE state = 'consumed'").all() as { message_id: string; epoch: number }[])
      .map(row => keyOf(row.message_id, row.epoch))),
  }
  CONNECTIONS.set(store, db)
  return store
}

/**
 * Commit a domain event, its outbox rows and the inbox transition to
 * `consumed`, in one `BEGIN IMMEDIATE` transaction.
 * @param store - the store handle.
 * @param commit - the message, the claiming turn, and the rows it owes.
 */
export function commitIntake(store: BusStore, commit: IntakeCommit): void {
  const db = connectionOf(store)
  const { message } = commit
  const payload = JSON.stringify(message.data)
  // BEGIN IMMEDIATE, not a deferred BEGIN: the write lock is taken at the
  // start, so two consumers racing for the same message fail fast on the lock
  // rather than at COMMIT after both believed they had it.
  db.exec('BEGIN IMMEDIATE')
  try {
    claimRow(db, message, commit.claimedByTurn)
    db.prepare('INSERT INTO domain_events (message_id, epoch, source, type, time, subject, datacontenttype, data, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(message.id, message.epoch, message.source, message.type, message.time,
        message.subject ?? null, message.datacontenttype ?? null, payload,
        createHash('sha256').update(payload, 'utf8').digest('hex'))
    if (commit.failAt === 'after-domain-event') {
      throw new Error('bus store: injected failure after the domain event, before the outbox rows')
    }
    for (const row of commit.outbox) {
      db.prepare('INSERT INTO outbox (message_id, epoch, target, payload) VALUES (?, ?, ?, ?)')
        .run(message.id, message.epoch, row.target, JSON.stringify(row.payload))
    }
    if (commit.failAt === 'after-outbox') {
      throw new Error('bus store: injected failure after the outbox rows, before the inbox transition')
    }
    db.prepare("UPDATE inbox SET state = 'consumed' WHERE message_id = ? AND epoch = ?").run(message.id, message.epoch)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Sweep claims older than the window to `released`, so a turn that never ran
 * does not hold a message forever.
 * @param store - the store handle.
 * @param window - the expiry boundary.
 * @returns how many rows were released.
 */
export function recoverStaleClaims(store: BusStore, window: RecoveryWindow): number {
  const db = connectionOf(store)
  // Only `claimed` rows are swept. A `consumed` row is settled and a
  // `released` one is already available, so touching either would either undo
  // an effect or churn state that is already correct.
  const result = db.prepare("UPDATE inbox SET state = 'released' WHERE state = 'claimed' AND claimed_by_turn < ?")
    .run(window.expiredBefore)
  return Number(result.changes)
}
