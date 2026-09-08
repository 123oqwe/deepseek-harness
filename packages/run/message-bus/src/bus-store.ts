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
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { dedupKey } from '@deepseek-ai/dsh-intake-dedup'
import type { BusMessageId, DeliveryReceipt, MessageEpoch, OutboxRecord, OutboxState, TenantId } from './outbox.ts'

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
  /** The emitter the id is scoped to. */
  readonly source: string
  readonly messageId: string
  readonly epoch: number
  readonly claimedByTurn: number
  readonly state: InboxState
}

/**
 * One row the outbox owes a peer, as a caller submits it.
 *
 * The dispatch POLICY is supplied here — the tenant the message belongs to,
 * how urgent it is, and when it stops being worth sending — because only the
 * caller knows them. Everything the dispatcher then maintains (`state`,
 * `attempts`, `receipt`) is the store's to initialise and to advance, so a
 * caller cannot submit a row that claims to have already been sent.
 */
export interface OutboxRow {
  readonly target: string
  readonly payload: unknown
  readonly tenant: TenantId
  /** Higher dispatches first; equal priorities fall back to deadline. */
  readonly priority: number
  /** Epoch milliseconds after which the message is worthless to send. */
  readonly deadlineMs: number
}

/**
 * A stored outbox row: the delivery record the dispatcher decides against,
 * plus where it goes and what it carries.
 *
 * The record half is `OutboxRecord` verbatim rather than a copy of its fields.
 * Until §12.35, the store persisted `{target, payload}` and the decisions ran
 * over an `OutboxRecord` nothing persisted — so `attempts`, `deadlineMs`,
 * `state` and `receipt` had nowhere to live, and must[1]'s retry budget and
 * dead-lettering were true of a type and of no stored message.
 */
export interface StoredOutboxRow {
  readonly record: OutboxRecord
  readonly target: string
  readonly payload: unknown
}

/** The store's handle. */
export interface BusStore {
  /** Take responsibility for a message on behalf of one turn. */
  claim: (message: BusMessage, turn: number) => void
  /** The inbox row for one `(source, id, epoch)`, or undefined when none exists. */
  inboxRow: (source: string, messageId: string, epoch: number) => InboxRow | undefined
  /** Every committed domain event, in commit order. */
  domainEvents: () => readonly BusMessage[]
  /** Every stored outbox row, in commit order. */
  outboxRows: () => readonly StoredOutboxRow[]
  /**
   * Persist one record's advanced state, which is what `dispatchOnce` calls
   * through its `persist` dependency after each pass.
   * @param record - the record as the dispatch decision left it.
   */
  persistOutbox: (record: OutboxRecord) => void
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

/**
 * The on-disk format this module writes.
 *
 * Bumped to 2 when every `OutboxRecord` field became a column (§12.35). A
 * version-1 file has an outbox table without them, and the pre-release stance
 * is that a backend REFUSES an old format rather than migrating it — but the
 * refusal has to exist to be a refusal: the version row was written and never
 * read, so a stale file would have failed later with a SQL error naming a
 * missing column rather than the format.
 */
const SCHEMA_VERSION = 2

/** The schema this module owns; `bus.sqlite` carries its own version. */
const SCHEMA = [
  // Contention must WAIT, not fail. Without a busy timeout, a second consumer
  // arriving while another holds the write lock fails immediately, and the
  // clause's `BEGIN IMMEDIATE` buys nothing: measured, DEFERRED's read-to-write
  // upgrade throws `database is locked` at once because waiting there would
  // deadlock, while IMMEDIATE takes the lock up front and the timeout applies.
  'PRAGMA busy_timeout = 5000',
  'CREATE TABLE IF NOT EXISTS schema_version (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL)',
  `INSERT OR IGNORE INTO schema_version (singleton, version) VALUES (1, ${String(SCHEMA_VERSION)})`,
  'CREATE TABLE IF NOT EXISTS domain_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, epoch INTEGER NOT NULL, source TEXT NOT NULL, type TEXT NOT NULL, time TEXT NOT NULL, subject TEXT, datacontenttype TEXT, data TEXT NOT NULL, digest TEXT NOT NULL)',
  // Every `OutboxRecord` field is a column. A row the dispatcher can decide
  // about must carry its own state, budget and deadline; while those lived
  // only in the type, a restarted dispatcher rebuilt them from nothing and the
  // retry budget bounded nothing (§12.35).
  'CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, epoch INTEGER NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL, tenant TEXT NOT NULL, state TEXT NOT NULL, priority INTEGER NOT NULL, deadline_ms INTEGER NOT NULL, attempts INTEGER NOT NULL, receipt TEXT)',
  // `source` is part of the PRIMARY KEY, not a passenger column: a message id
  // is unique only within its sender, so two senders emitting the same id at
  // the same epoch are two messages and must occupy two rows (BLOCKED-140).
  'CREATE TABLE IF NOT EXISTS inbox (source TEXT NOT NULL, message_id TEXT NOT NULL, epoch INTEGER NOT NULL, claimed_by_turn INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY (source, message_id, epoch))',
]

/**
 * The dedup key for one message, which is its identity across retries.
 *
 * Delegates to the shared rule rather than deriving the key again. It did
 * derive it again — as `${messageId}:${epoch}` — and BLOCKED-138 measured what
 * that cost: `consumedKeys()` answered in a format `classifyDedup` never
 * produces, so a message the store had already consumed classified as a first
 * arrival, silently, with every test on both sides still green. The omitted
 * length prefix also made `('a:1', 2)` and `('a', '1:2')` the same key.
 * @param source - the emitter this id is scoped to.
 * @param messageId - the message id.
 * @param epoch - the sender generation.
 * @returns the key the dedup rule computes for this triple.
 */
const keyOf = (source: string, messageId: string, epoch: number): string => dedupKey({ source, id: messageId, epoch })

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
 * @param source - the emitter the id is scoped to.
 * @param messageId - the message id.
 * @param epoch - the delivery epoch.
 * @returns the row, or undefined.
 */
function readInbox(db: DatabaseSync, source: string, messageId: string, epoch: number): InboxRow | undefined {
  const row = db
    .prepare('SELECT source, message_id, epoch, claimed_by_turn, state FROM inbox WHERE source = ? AND message_id = ? AND epoch = ?')
    .get(source, messageId, epoch) as
      { source: string; message_id: string; epoch: number; claimed_by_turn: number; state: string } | undefined
  if (row === undefined) return undefined
  return {
    source: row.source,
    messageId: row.message_id,
    epoch: row.epoch,
    claimedByTurn: row.claimed_by_turn,
    state: row.state as InboxState,
  }
}

/**
 * Take responsibility for a message, refusing one already consumed.
 * @param db - the database.
 * @param message - the arriving message.
 * @param turn - the claiming turn.
 */
function claimRow(db: DatabaseSync, message: BusMessage, turn: number): void {
  const existing = readInbox(db, message.source, message.id, message.epoch)
  // A consumed message has already had its effect. Re-claiming it is the
  // double-effect this epic's dedup exists to prevent, so it is refused rather
  // than overwritten -- whereas `released` is precisely the state a stale
  // claim is swept to so it CAN be claimed again (BLOCKED-088).
  if (existing?.state === 'consumed') {
    throw new Error(`bus store: ${keyOf(message.source, message.id, message.epoch)} is already consumed and cannot be claimed again`)
  }
  db.prepare(
    'INSERT INTO inbox (source, message_id, epoch, claimed_by_turn, state) VALUES (?, ?, ?, ?, \'claimed\')'
    + ' ON CONFLICT (source, message_id, epoch) DO UPDATE SET claimed_by_turn = excluded.claimed_by_turn, state = \'claimed\'',
  ).run(message.source, message.id, message.epoch, turn)
}

/**
 * Open (creating if absent) the bus store for one profile or run directory.
 * @param directory - the directory holding `bus.sqlite`.
 * @returns the store handle.
 */
export function openBusStore(directory: string): BusStore {
  // Created, not assumed: a profile points this at a path under the session
  // storage root, and on a fresh install nothing has made it yet. The lease
  // and taskboard stores both do this; without it the first boot of a
  // composition that mounts the bus fails with `unable to open database file`,
  // which names neither the directory nor the reason.
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'bus.sqlite')
  const db = new DatabaseSync(path)
  for (const statement of SCHEMA) db.exec(statement)
  // Read back rather than assumed: `INSERT OR IGNORE` leaves an existing row
  // alone, so a file written by an older format keeps its own version and this
  // is where that is noticed. Refused, never migrated — the pre-release stance
  // is that a backend rejects an old on-disk format, and a silent migration
  // would rewrite messages nobody has delivered.
  const found = (db.prepare('SELECT version FROM schema_version WHERE singleton = 1').get() as { version: number } | undefined)?.version
  if (found !== SCHEMA_VERSION) {
    throw new Error(
      `bus store at ${path} is format version ${String(found ?? 'unknown')}, and this build writes ${String(SCHEMA_VERSION)}; `
      + 'the outbox gained its dispatch columns in version 2, so an older file cannot be read. Remove it to start a fresh bus.',
    )
  }
  const store: BusStore = {
    claim: (message, turn) => { claimRow(db, message, turn) },
    inboxRow: (source, messageId, epoch) => readInbox(db, source, messageId, epoch),
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
    outboxRows: () => (db.prepare('SELECT message_id, epoch, target, payload, tenant, state, priority, deadline_ms, attempts, receipt FROM outbox ORDER BY seq').all() as Record<string, string | number | null>[])
      .map(row => ({
        record: {
          id: String(row.message_id) as BusMessageId,
          epoch: Number(row.epoch) as MessageEpoch,
          tenant: String(row.tenant) as TenantId,
          state: String(row.state) as OutboxState,
          priority: Number(row.priority),
          deadlineMs: Number(row.deadline_ms),
          attempts: Number(row.attempts),
          receipt: row.receipt === null ? null : JSON.parse(String(row.receipt)) as DeliveryReceipt,
        },
        target: String(row.target),
        payload: JSON.parse(String(row.payload)) as unknown,
      })),
    persistOutbox: (record) => {
      // Keyed on `(message_id, epoch)`, which is the record's identity: a
      // message id is unique only within its sender generation, and keying on
      // the id alone would let one epoch's dispatch overwrite another's.
      db.prepare('UPDATE outbox SET state = ?, attempts = ?, receipt = ? WHERE message_id = ? AND epoch = ?')
        .run(record.state, record.attempts, record.receipt === null ? null : JSON.stringify(record.receipt), record.id, record.epoch)
    },
    consumedKeys: () => new Set((db.prepare("SELECT source, message_id, epoch FROM inbox WHERE state = 'consumed'").all() as { source: string; message_id: string; epoch: number }[])
      .map(row => keyOf(row.source, row.message_id, row.epoch))),
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
      // `pending`, no attempts, no receipt: the store owns the delivery state
      // from here, so a caller cannot commit a row that claims to have been
      // sent already.
      db.prepare('INSERT INTO outbox (message_id, epoch, target, payload, tenant, state, priority, deadline_ms, attempts, receipt) VALUES (?, ?, ?, ?, ?, \'pending\', ?, ?, 0, NULL)')
        .run(message.id, message.epoch, row.target, JSON.stringify(row.payload), row.tenant, row.priority, row.deadlineMs)
    }
    if (commit.failAt === 'after-outbox') {
      throw new Error('bus store: injected failure after the outbox rows, before the inbox transition')
    }
    db.prepare("UPDATE inbox SET state = 'consumed' WHERE source = ? AND message_id = ? AND epoch = ?").run(message.source, message.id, message.epoch)
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
