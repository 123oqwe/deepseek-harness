/**
 * The durable approval store on SQLite (Epic P2-07 Provider), and the plugin
 * that publishes it as `ctx.approvalStore`.
 *
 * One file holds every approval. Each move is one `BEGIN IMMEDIATE`
 * transaction: read the row, decide with the contract's
 * `applyApprovalTransition`, write the moved row where the revision is still
 * the one read. The write lock is held from the read to the commit, so two
 * processes deciding one approval are serialized and the second sees the
 * first's revision. This provider stores and serializes; it does not
 * re-decide a transition.
 * @module @deepseek-ai/dsh-approval-store/sqlite
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import z from '@deepseek-ai/schemastery'
import { applyApprovalTransition, effectiveApprovalState, newApprovalRecord, viewerMayAccess } from './transitions.ts'
import type {
  ApprovalDecision,
  ApprovalRecord,
  ApprovalRequestId,
  ApprovalRequestInput,
  ApprovalScope,
  ApprovalState,
  ApprovalStoreContract,
  ApprovalViewer,
  ApprovalWriteResult,
  PrincipalId,
  RunId,
  SessionId,
  TenantId,
} from './types.ts'

/** The schema this module owns; `approvals.sqlite` carries its own version, and a file at another version is refused. */
const SCHEMA_VERSION = 1

/** The store's file name inside its directory. */
const FILE = 'approvals.sqlite'

/** Where a write can be interrupted inside its transaction: after its INSERT or UPDATE, before COMMIT. */
export type ApprovalStoreFaultPoint = 'after-insert' | 'after-update'

/** How {@link openApprovalStore} opens the file. */
export interface ApprovalStoreOptions {
  /** How long a writer waits for another's write lock before failing. */
  readonly busyTimeoutMs: number
  /**
   * Test-only fault injection, called at each point inside a write's
   * transaction before COMMIT: a test throws from it to observe the rollback,
   * or kills its process to observe the state a restart finds (validation[0]).
   */
  readonly fault?: (point: ApprovalStoreFaultPoint) => void
}

/** An opened store: the contract, and the handle's close. */
export interface OpenedApprovalStore extends ApprovalStoreContract {
  /** Close the database handle; the store is unusable afterwards. */
  close(): void
}

/** One `approvals` row as SQLite returns it. */
interface ApprovalRow {
  id: string
  tenant: string
  actor: string
  scope_kind: 'turn' | 'run'
  session_id: string
  call_id: string | null
  run_id: string | null
  tool_name: string
  request_digest: string
  policy_version: string | null
  requested_at_ms: number
  deadline_ms: number
  state: ApprovalState
  revision: number
  decided_by: string | null
  decided_at_ms: number | null
  consumed_at_ms: number | null
}

/**
 * The statements every open runs; each tolerates an existing schema.
 * @param busyTimeoutMs - the write-lock wait.
 * @returns the statements in order.
 */
function schema(busyTimeoutMs: number): readonly string[] {
  return [
    `PRAGMA busy_timeout = ${String(busyTimeoutMs)}`,
    'CREATE TABLE IF NOT EXISTS schema_version (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version INTEGER NOT NULL)',
    `INSERT OR IGNORE INTO schema_version (singleton, version) VALUES (1, ${String(SCHEMA_VERSION)})`,
    'CREATE TABLE IF NOT EXISTS approvals ('
    + 'id TEXT PRIMARY KEY, tenant TEXT NOT NULL, actor TEXT NOT NULL, '
    + "scope_kind TEXT NOT NULL CHECK (scope_kind IN ('turn', 'run')), session_id TEXT NOT NULL, call_id TEXT, run_id TEXT, "
    + 'tool_name TEXT NOT NULL, request_digest TEXT NOT NULL, policy_version TEXT, requested_at_ms INTEGER NOT NULL, deadline_ms INTEGER NOT NULL, '
    + "state TEXT NOT NULL CHECK (state IN ('requested', 'approved', 'denied', 'expired', 'revoked', 'consumed')), revision INTEGER NOT NULL, "
    + 'decided_by TEXT, decided_at_ms INTEGER, consumed_at_ms INTEGER, '
    + "CHECK ((scope_kind = 'run') = (run_id IS NOT NULL)))",
    'CREATE INDEX IF NOT EXISTS approvals_pending ON approvals (tenant, state, deadline_ms)',
  ]
}

/**
 * A row's scope.
 * @param row - the row SQLite returned.
 * @returns the turn or run the approval belongs to.
 */
function scopeOf(row: ApprovalRow): ApprovalScope {
  const sessionId = brandString<SessionId>(row.session_id)
  if (row.scope_kind === 'turn') return { kind: 'turn', sessionId, ...row.call_id === null ? {} : { callId: row.call_id } }
  // The table's CHECK ties a run scope to a non-NULL run_id, so no file this
  // module wrote reaches the throw.
  /* v8 ignore next */
  if (row.run_id === null) throw new Error(`approval store: run-scoped approval ${row.id} has no run id`)
  return { kind: 'run', runId: brandString<RunId>(row.run_id), sessionId }
}

/**
 * A row as the contract's record; a NULL column becomes an absent field.
 * @param row - the row SQLite returned.
 * @returns the record.
 */
function toRecord(row: ApprovalRow): ApprovalRecord {
  return {
    id: brandString<ApprovalRequestId>(row.id),
    tenant: brandString<TenantId>(row.tenant),
    actor: brandString<PrincipalId>(row.actor),
    scope: scopeOf(row),
    toolName: row.tool_name,
    requestDigest: row.request_digest,
    ...row.policy_version === null ? {} : { policyVersion: row.policy_version },
    requestedAtMs: row.requested_at_ms,
    deadlineMs: row.deadline_ms,
    state: row.state,
    revision: row.revision,
    ...row.decided_by === null ? {} : { decidedBy: brandString<PrincipalId>(row.decided_by) },
    ...row.decided_at_ms === null ? {} : { decidedAtMs: row.decided_at_ms },
    ...row.consumed_at_ms === null ? {} : { consumedAtMs: row.consumed_at_ms },
  }
}

/**
 * Open (creating if absent) the approval store under one directory.
 * @param directory - the directory holding `approvals.sqlite`; created when missing.
 * @param options - the write-lock wait and, in tests, the fault hook.
 * @returns the store, honouring the approval contract.
 * @throws when the file carries another schema version.
 */
export function openApprovalStore(directory: string, options: ApprovalStoreOptions): OpenedApprovalStore {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, FILE)
  const db = new DatabaseSync(path)
  for (const statement of schema(options.busyTimeoutMs)) db.exec(statement)
  // The seeding INSERT is `OR IGNORE`, so a file written at another version
  // keeps its own and is refused here rather than read with the wrong columns.
  const version = (db.prepare('SELECT version FROM schema_version WHERE singleton = 1').get() as { version: number }).version
  if (version !== SCHEMA_VERSION) {
    db.close()
    throw new Error(`approval store: ${path} is schema version ${String(version)}, not ${String(SCHEMA_VERSION)}; delete it to start a new store`)
  }

  const read = (id: ApprovalRequestId): ApprovalRecord | undefined => {
    const row = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalRow | undefined
    return row === undefined ? undefined : toRecord(row)
  }
  const transaction = <T>(body: () => T): T => {
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
  const move = (
    id: ApprovalRequestId,
    expectedRevision: number,
    to: ApprovalState,
    viewer: ApprovalViewer,
    nowMs: number,
  ): ApprovalWriteResult =>
    transaction(() => {
      const record = read(id)
      if (record === undefined) return { ok: false, conflict: 'not-found' }
      const result = applyApprovalTransition(record, expectedRevision, to, viewer, nowMs)
      if (!result.ok) return result
      const next = result.record
      // The revision in the WHERE clause repeats, at the storage level, the
      // check the contract just made inside the same write lock.
      db.prepare('UPDATE approvals SET state = ?, revision = ?, decided_by = ?, decided_at_ms = ?, consumed_at_ms = ? WHERE id = ? AND revision = ?')
        .run(next.state, next.revision, next.decidedBy ?? null, next.decidedAtMs ?? null, next.consumedAtMs ?? null, id, expectedRevision)
      options.fault?.('after-update')
      return result
    })

  return {
    request: (input: ApprovalRequestInput, nowMs: number): ApprovalRecord => transaction(() => {
      const record = newApprovalRecord(input, nowMs)
      db.prepare('INSERT INTO approvals (id, tenant, actor, scope_kind, session_id, call_id, run_id, tool_name, request_digest, '
        + 'policy_version, requested_at_ms, deadline_ms, state, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(record.id, record.tenant, record.actor, record.scope.kind, record.scope.sessionId,
          record.scope.kind === 'turn' ? record.scope.callId ?? null : null,
          record.scope.kind === 'run' ? record.scope.runId : null,
          record.toolName, record.requestDigest, record.policyVersion ?? null,
          record.requestedAtMs, record.deadlineMs, record.state, record.revision)
      options.fault?.('after-insert')
      return record
    }),
    decide: (id: ApprovalRequestId, expectedRevision: number, decision: ApprovalDecision, viewer: ApprovalViewer, nowMs: number) =>
      move(id, expectedRevision, decision, viewer, nowMs),
    revoke: (id, expectedRevision, viewer, nowMs) => move(id, expectedRevision, 'revoked', viewer, nowMs),
    consume: (id, expectedRevision, viewer, nowMs) => move(id, expectedRevision, 'consumed', viewer, nowMs),
    get: (id, viewer, nowMs) => {
      const record = read(id)
      if (record === undefined || !viewerMayAccess(record, viewer)) return undefined
      const state = effectiveApprovalState(record, nowMs)
      return state === record.state ? record : { ...record, state }
    },
    listPending: (viewer, nowMs) => (db.prepare("SELECT * FROM approvals WHERE tenant = ? AND state IN ('requested', 'approved') "
      + 'AND deadline_ms > ? ORDER BY requested_at_ms, id').all(viewer.tenant, nowMs) as unknown as ApprovalRow[]).map(toRecord),
    close: () => { db.close() },
  }
}

/** Where this mount keeps its approvals. */
export interface Config {
  /** Directory holding `approvals.sqlite`; deployment-varying, so the profile row names it. */
  directory: string
  /** How long a writer waits for another's write lock. */
  busyTimeoutMs: number
}

/**
 * The mounted durable approval store, published as `ctx.approvalStore`.
 * Implements the contract and forwards, so a consumer holds exactly what the
 * contract describes and never learns that SQLite is behind it.
 */
export default class ApprovalStoreSqlitePlugin extends Service implements ApprovalStoreContract {
  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config = z.object({
    directory: z.string().required(),
    busyTimeoutMs: z.natural().default(5000),
  }) as z<Config>

  private opened: OpenedApprovalStore | undefined

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.approvalStore`.
   * @param config - the validated configuration.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'approvalStore')
  }

  /**
   * Open the database at mount, in `Service.init` so a failure to create the
   * directory or open the file names the path rather than unwinding the
   * service's construction.
   * @yields the teardown that closes the handle.
   */
  * [Service.init](): Generator<() => void, void, void> {
    this.opened = openApprovalStore(this.config.directory, { busyTimeoutMs: this.config.busyTimeoutMs })
    yield () => {
      this.store.close()
      this.opened = undefined
    }
  }

  /**
   * The opened store.
   * @returns the store this mount opened.
   * @throws when the mount is not active: before it opened or after its teardown.
   */
  private get store(): OpenedApprovalStore {
    if (this.opened === undefined) throw new Error('approval store: the mount is not active')
    return this.opened
  }

  /** @inheritdoc */
  request(input: ApprovalRequestInput, nowMs: number): ApprovalRecord {
    return this.store.request(input, nowMs)
  }

  /** @inheritdoc */
  decide(
    id: ApprovalRequestId,
    expectedRevision: number,
    decision: ApprovalDecision,
    viewer: ApprovalViewer,
    nowMs: number,
  ): ApprovalWriteResult {
    return this.store.decide(id, expectedRevision, decision, viewer, nowMs)
  }

  /** @inheritdoc */
  revoke(id: ApprovalRequestId, expectedRevision: number, viewer: ApprovalViewer, nowMs: number): ApprovalWriteResult {
    return this.store.revoke(id, expectedRevision, viewer, nowMs)
  }

  /** @inheritdoc */
  consume(id: ApprovalRequestId, expectedRevision: number, viewer: ApprovalViewer, nowMs: number): ApprovalWriteResult {
    return this.store.consume(id, expectedRevision, viewer, nowMs)
  }

  /** @inheritdoc */
  get(id: ApprovalRequestId, viewer: ApprovalViewer, nowMs: number): ApprovalRecord | undefined {
    return this.store.get(id, viewer, nowMs)
  }

  /** @inheritdoc */
  listPending(viewer: ApprovalViewer, nowMs: number): readonly ApprovalRecord[] {
    return this.store.listPending(viewer, nowMs)
  }
}
