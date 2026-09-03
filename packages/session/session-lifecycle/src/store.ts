/**
 * Provider-stage RED scaffold for Epic P6-07: the durable registry that turns
 * `./index.ts`, `./retention.ts` and `./delete.ts`'s pure Contract-stage
 * decisions into a service whose lifecycle records outlive the process that
 * made them.
 *
 * The Contract stage landed the decisions themselves — which records a
 * filtered page contains (`listSessions`), what an archive, soft delete or
 * legal hold produces (`archiveSession`, `softDeleteSession`,
 * `placeLegalHold`), whether an erase is authorized (`assertNoLegalHold`), and
 * what a deletion reaches (`propagateDeletion`, `hardErase`) — as pure
 * functions over a {@link SessionLifecycleRecord} array some caller already
 * held. Nothing at that stage produced that array and nothing persisted a
 * disposition change, so a soft delete, an archive, or a legal hold was a
 * value returned to a caller and then lost at process exit: acceptance[0]'s
 * stable pagination and acceptance[1]'s erase-blocking hold are both
 * unreachable from an in-memory array, because a restart is precisely the
 * event that destroys it. This module supplies the missing half — a
 * {@link SessionLifecycleStore} durability seam, a real file-backed store over
 * it, and a {@link SessionLifecycleService} that writes every accepted change
 * through and reconstructs the registry from it on the next boot.
 *
 * **Why this module lives here and not in `@deepseek-ai/dsh-session-persistence`.**
 * The registry declares this stage's deliverable at
 * `packages/session/session-persistence/src/index.ts`; that placement is
 * architecturally unrealizable, and the approved path patch
 * (`tests/first100/adjudication.json`, `P6-07-P-lifecycle-store`) moves it
 * here. A durable lifecycle registry must name {@link SessionLifecycleRecord}
 * and call the Contract stage's functions, and that import closes a real
 * project-reference cycle — `session-persistence` → `session-lifecycle` →
 * `workspace/workspace` → `session-persistence`, whose last two edges already
 * exist — which `tsc -b` reports as TS6202. No design inside the declared
 * scope avoids it: every P6-07 clause is an assertion about lifecycle
 * semantics (must[0]'s filters ARE `listSessions`, acceptance[1]'s hold IS
 * `assertNoLegalHold`, acceptance[2]'s propagation IS `propagateDeletion`), so
 * a record-type-generic store that cannot name a disposition observes none of
 * them. Placed here the store adds no dependency edge at all: this package
 * already references brand, principal, core/session, workspace and attachment,
 * which is everything a durable store of its own records needs.
 *
 * `./coordinator.ts` and `./revision.ts` in `session-persistence` remain
 * declared-but-unmodified. `PersistenceCoordinator`'s storage contract is
 * keyed on session identity and session-log structure — its records are
 * `SessionEvent`s under a `SessionHeader` gated by `SESSION_FORMAT_VERSION`,
 * serialized per-`SessionId` — and a retention disposition is not a
 * session-log event.
 *
 * @module @deepseek-ai/dsh-session-lifecycle/store
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import type { PrincipalId } from '@deepseek-ai/dsh-principal/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { listSessions } from './index.ts'
import type { SessionListPage, SessionListPageRequest } from './index.ts'
import { SOFT_DELETE_POLICY, hardErase, propagateDeletion } from './delete.ts'
import type { EraseResult, PropagationOutcome, SessionDependents } from './delete.ts'
import { archiveSession, assertNoLegalHold, placeLegalHold, softDeleteSession } from './retention.ts'
import type { SessionLifecycleRecord } from './retention.ts'

/**
 * The durability seam a {@link SessionLifecycleService} writes its records
 * through (acceptance[0]).
 *
 * Deliberately minimal — whole-record reads, whole-record writes, and a
 * removal — because a {@link SessionLifecycleRecord} is one immutable value
 * with no partial update a store would have to reconcile, so a store
 * implementation cannot drop or reorder a field the service did not itself
 * change. An implementation must be durable across a process restart: two
 * store instances constructed over the same underlying medium observe the same
 * records.
 */
export interface SessionLifecycleStore {
  /**
   * Read every lifecycle record this store has on record, in no guaranteed
   * order.
   * @returns every durably recorded {@link SessionLifecycleRecord}; empty on a medium
   * that has never been written to (a first boot), never a rejection.
   */
  loadAll(): Promise<readonly SessionLifecycleRecord[]>

  /**
   * Durably record `record` as the current state of the session with
   * `record.header.id`, replacing any earlier record of the same id. Returns
   * once the write is durable.
   * @param record - the complete lifecycle record to write.
   */
  put(record: SessionLifecycleRecord): Promise<void>

  /**
   * Durably destroy the record for `sessionId`, so no later
   * {@link SessionLifecycleStore.loadAll} returns it (acceptance[2]'s
   * irreversible, terminal erasure).
   * @param sessionId - the session whose record is destroyed; an absent id is a no-op.
   */
  remove(sessionId: SessionId): Promise<void>
}

/**
 * A real file-backed {@link SessionLifecycleStore}: one JSON document at
 * `path` holding every lifecycle record by session id, rewritten in full on
 * each write. Durable across a process restart — a second store constructed
 * over the same `path` reads back exactly the records the first one wrote,
 * every brand and optional field included.
 * @param path - filesystem path of the store's document; a path that does not exist
 * yet is a first boot, not an error, and is created on the first write.
 * @returns a store over `path`.
 */
export function createFileSessionLifecycleStore(path: string): SessionLifecycleStore {
  /**
   * Every read and write of `path` is chained onto this promise, so a write
   * never interleaves its read-modify-write with another one and loses a
   * record.
   */
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const read = async (): Promise<SessionLifecycleRecord[]> => {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      // A store file that was never written is a first boot, not a failure;
      // any other read failure (permissions, a directory at `path`) is real.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (text.trim() === '') return []
    const document = JSON.parse(text) as SessionLifecycleStoreDocument
    if (document.version !== SESSION_LIFECYCLE_STORE_FORMAT_VERSION) {
      throw new Error(
        `unsupported session lifecycle store format version ${String(document.version)} at ${path}, expected ${SESSION_LIFECYCLE_STORE_FORMAT_VERSION}`,
      )
    }
    return [...document.records]
  }

  const write = async (records: readonly SessionLifecycleRecord[]): Promise<void> => {
    const document: SessionLifecycleStoreDocument = { version: SESSION_LIFECYCLE_STORE_FORMAT_VERSION, records }
    // Write-then-rename: a crash mid-write leaves the previous complete
    // document in place at `path` rather than a truncated one.
    const temporaryPath = `${path}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(document)}\n`, 'utf8')
    await rename(temporaryPath, path)
  }

  return {
    loadAll: () => enqueue(read),
    put: (record: SessionLifecycleRecord) =>
      enqueue(async () => {
        const records = await read()
        // Replace in place so a record keeps its original position in the
        // document across every later write.
        const index = records.findIndex(existing => existing.header.id === record.header.id)
        if (index === -1) records.push(record)
        else records[index] = record
        await write(records)
      }),
    remove: (sessionId: SessionId) =>
      enqueue(async () => {
        const records = await read()
        await write(records.filter(existing => existing.header.id !== sessionId))
      }),
  }
}

/** The on-disk format version {@link createFileSessionLifecycleStore} reads and writes. */
const SESSION_LIFECYCLE_STORE_FORMAT_VERSION = 1

/** The JSON document {@link createFileSessionLifecycleStore} keeps at its path. */
interface SessionLifecycleStoreDocument {
  readonly version: number
  readonly records: readonly SessionLifecycleRecord[]
}

/** The result of a soft delete: the durably recorded record and what the deletion reached. */
export interface SoftDeleteOutcome {
  readonly record: SessionLifecycleRecord
  readonly propagation: PropagationOutcome
}

/**
 * Epic P6-07's durable session-lifecycle registry: the owner of every
 * session's retention record (must[1]) and the only surface through which a
 * disposition change becomes durable (acceptance[0]/acceptance[1]).
 *
 * Every decision is delegated to this package's Contract-stage functions —
 * this class adds durability and registry lookup, never a second, divergent
 * decision table. In particular it never re-derives a filter, a sort order, a
 * legal-hold check, or a propagation policy of its own.
 */
export class SessionLifecycleService {
  /**
   * @param store - the durability seam every accepted change is written through.
   * @param records - the registry this service starts from, keyed by session id;
   * {@link SessionLifecycleService.restore} supplies the reconstructed contents of `store`.
   */
  private constructor(
    private readonly store: SessionLifecycleStore,
    private readonly records: Map<SessionId, SessionLifecycleRecord>,
  ) {}

  /**
   * acceptance[0]'s restart entry point: build a service whose registry is
   * reconstructed entirely from `store`'s durable contents. This is the only
   * way to obtain a service — a fresh process has no in-memory registry to
   * start from, so there is no constructor path that could silently begin with
   * an empty one while durable records sit unlisted in the store.
   * @param store - the durable store to reconstruct the registry from.
   * @returns a service registering exactly the records `store` holds.
   */
  static async restore(store: SessionLifecycleStore): Promise<SessionLifecycleService> {
    const records = new Map<SessionId, SessionLifecycleRecord>()
    for (const record of await store.loadAll()) records.set(record.header.id, record)
    return new SessionLifecycleService(store, records)
  }

  /**
   * must[0]'s admission entry point: durably admit `record` into this
   * registry, so a later restart lists it.
   * @param record - the lifecycle record to register; rejects when its session id is already registered.
   * @returns the durably recorded {@link SessionLifecycleRecord}.
   */
  async register(record: SessionLifecycleRecord): Promise<SessionLifecycleRecord> {
    if (this.records.has(record.header.id)) {
      throw new Error(`session '${String(record.header.id)}' is already registered`)
    }
    await this.store.put(record)
    this.records.set(record.header.id, record)
    return record
  }

  /**
   * must[0]/acceptance[0]'s listing entry point: `./index.ts`'s
   * `listSessions` applied to this service's durably reconstructed registry,
   * so a page walk after a restart visits every stored record exactly once.
   * @param request - filters, page size, and continuation cursor.
   * @returns one page of matching records plus a continuation cursor, absent on the final page.
   */
  list(request: SessionListPageRequest): SessionListPage {
    return listSessions([...this.records.values()], request)
  }

  /**
   * must[1]'s durable archive transition: `./retention.ts`'s `archiveSession`
   * written through the store. Archiving triggers no propagation — it is not a
   * deletion.
   * @param sessionId - the registered session to archive; rejects when unregistered.
   * @param archivedBy - the principal performing the archive.
   * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this archive is stamped with.
   * @returns the durably recorded archived record.
   */
  async archive(sessionId: SessionId, archivedBy: PrincipalId, occurredAt: number): Promise<SessionLifecycleRecord> {
    return this.commit(archiveSession(this.registered(sessionId), archivedBy, occurredAt))
  }

  /**
   * must[1]/must[2]'s durable soft-delete transition: `./retention.ts`'s
   * `softDeleteSession` written through the store, plus `./delete.ts`'s
   * `propagateDeletion` under `SOFT_DELETE_POLICY` — the query index only,
   * leaving the reversible deletion's dependents intact.
   * @param sessionId - the registered session to soft-delete; rejects when unregistered.
   * @param deletedBy - the principal performing the soft delete.
   * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this soft delete is stamped with.
   * @param dependents - the session's dependent-store inventory to propagate against.
   * @returns the durably recorded soft-deleted record and the targets the deletion reached.
   */
  async softDelete(
    sessionId: SessionId,
    deletedBy: PrincipalId,
    occurredAt: number,
    dependents: SessionDependents,
  ): Promise<SoftDeleteOutcome> {
    const record = await this.commit(softDeleteSession(this.registered(sessionId), deletedBy, occurredAt))
    return { record, propagation: propagateDeletion(dependents, SOFT_DELETE_POLICY) }
  }

  /**
   * must[1]/acceptance[1]'s durable legal-hold placement: `./retention.ts`'s
   * `placeLegalHold` written through the store, so the preservation obligation
   * outlives the process that placed it and still gates a later erase. The
   * record's {@link SessionDisposition} is carried through unchanged.
   * @param sessionId - the registered session to place under hold; rejects when unregistered.
   * @param heldBy - the principal placing the hold.
   * @param reason - human-readable justification, never empty.
   * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this hold is stamped with.
   * @returns the durably recorded held record.
   */
  async placeHold(
    sessionId: SessionId,
    heldBy: PrincipalId,
    reason: string,
    occurredAt: number,
  ): Promise<SessionLifecycleRecord> {
    return this.commit(placeLegalHold(this.registered(sessionId), heldBy, reason, occurredAt))
  }

  /**
   * acceptance[1]/acceptance[2]'s durable hard-erase entry point:
   * `./retention.ts`'s `assertNoLegalHold` then `./delete.ts`'s `hardErase`,
   * and only on success the record's durable removal. A session under legal
   * hold rejects with `LegalHoldBlocksErasureError` having written nothing, so
   * a refused erase leaves the durable record exactly as it was rather than
   * partially destroying it.
   * @param sessionId - the registered session to erase; rejects when unregistered.
   * @param dependents - the session's dependent-store inventory to propagate the erase against.
   * @param occurredAt - non-negative safe-integer Unix epoch milliseconds this erase is stamped with.
   * @returns the complete {@link EraseResult}, including `HARD_ERASE_POLICY`'s full propagation outcome.
   */
  async erase(sessionId: SessionId, dependents: SessionDependents, occurredAt: number): Promise<EraseResult> {
    const record = this.registered(sessionId)
    // Throws LegalHoldBlocksErasureError before anything is written or
    // removed, so a refused erase leaves the durable record untouched.
    const proof = assertNoLegalHold(record)
    const result = hardErase(record, dependents, proof, occurredAt)
    await this.store.remove(sessionId)
    this.records.delete(sessionId)
    return result
  }

  /**
   * Look one registered lifecycle record up by session identity.
   * @param sessionId - the session to look up.
   * @returns the registered {@link SessionLifecycleRecord}, or `undefined` when this
   * service registers no such session.
   */
  get(sessionId: SessionId): SessionLifecycleRecord | undefined {
    return this.records.get(sessionId)
  }

  /**
   * Durably record `record` as the current state of its session and publish it
   * to this registry — the single write-through path every disposition change
   * takes, so no transition can update the registry without reaching the store.
   * @param record - the Contract-stage function's already-decided result.
   * @returns the same `record`, once it is durable.
   */
  private async commit(record: SessionLifecycleRecord): Promise<SessionLifecycleRecord> {
    await this.store.put(record)
    this.records.set(record.header.id, record)
    return record
  }

  /**
   * The registered record for `sessionId`, for the paths that have no decision
   * to return for a session this service does not know at all.
   * @param sessionId - the session to look up.
   * @returns the registered {@link SessionLifecycleRecord}; throws when unregistered.
   */
  private registered(sessionId: SessionId): SessionLifecycleRecord {
    const record = this.records.get(sessionId)
    if (record === undefined) throw new Error(`session '${String(sessionId)}' is not registered`)
    return record
  }
}
