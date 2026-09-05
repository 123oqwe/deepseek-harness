/**
 * Service Definition for the provider-neutral Memory capability seam
 * (`ctx.memory`, first100 registry P6-01): a duplicate-id-rejecting provider
 * registry plus provider-selecting execution for
 * propose/query/get/revise/forget/export. Mirrors `WebRuntime`
 * (`@deepseek-ai/dsh-web`): at execution time a configured provider must
 * exist and be usable; without one, exactly one usable provider is required,
 * so selection never depends on registration order (`must[1]`, provider
 * replaceability). `propose` is the package's only mutation entry point —
 * there is no `write`/`set`/`put` verb — so a durable record can never
 * originate outside it (`acceptance[1]`).
 *
 * Wiring a live `ctx.memory` call to a durable session log (so the
 * `memory/access` event `./types.ts` declares has a real emitter) is first100
 * registry P6-01's Usage stage, not this Contract stage: this module stays
 * session-agnostic, matching `WebRuntime`, which likewise performs no session
 * logging itself.
 * @module @deepseek-ai/dsh-memory
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  MemoryAccessContext,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryForgetRequest,
  MemoryGetRequest,
  MemoryProposeRequest,
  MemoryProposeResult,
  MemoryProvider,
  MemoryQueryRequest,
  MemoryQueryResult,
  MemoryRecordView,
  MemoryReviseRequest,
  MemoryScope,
} from './types.ts'
import { MemoryError, MemoryRecordId } from './types.ts'

export {
  MemoryError,
  MemoryRecordId,
} from './types.ts'
export type {
  MemoryAccessContext,
  MemoryAccessEvent,
  MemoryContextBudget,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryForgetRequest,
  MemoryGetRequest,
  MemoryProposeRequest,
  MemoryProposeResult,
  MemoryProvider,
  MemoryQueryRequest,
  MemoryQueryResult,
  MemoryRecordView,
  MemoryReviseRequest,
  MemoryScope,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection {
  /** The configured provider id, if any. */
  readonly configuredId?: string
  /** Providers currently registered. */
  readonly providers: ReadonlyMap<string, MemoryProvider>
}

/**
 * Config for the memory seam. `providerId` pins which provider wins; omitted
 * = auto-select when exactly one registered provider is usable. An
 * operational override must feed this same field rather than introduce a
 * hidden priority chain.
 */
export interface MemoryRuntimeConfig {
  /** Explicit provider id. Omitted = auto-select when exactly one usable. */
  readonly providerId?: string
  /**
   * Directory for a self-registered {@link createDurableFileMemoryProvider}.
   * Omitted = register nothing, leaving every provider to arrive through
   * {@link MemoryRuntime.registerProvider}. This is the only route by which a
   * composition gets a usable provider from `cordis.yml` alone: the service
   * registers none on its own, so a profile that mounts it without either
   * route fails every call with `MEMORY_PROVIDER_UNAVAILABLE`.
   */
  readonly durableFileDirectory?: string
}

/**
 * The memory access service. Registered as `ctx.memory` (one instance per
 * context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `MEMORY_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `MEMORY_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `MEMORY_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `MEMORY_PROVIDER_UNAVAILABLE`.
 */
export class MemoryRuntime extends Service {
  /** Provider selection config. `$DSH_MEMORY_PROVIDER` is equivalent to `providerId`, not a hidden priority chain. */
  static Config: z<MemoryRuntimeConfig> = z.object({
    providerId: z.string(),
    durableFileDirectory: z.string(),
  })

  private providers = new Map<string, MemoryProvider>()
  private readonly providerId: string | undefined

  constructor(ctx: Context, config: MemoryRuntimeConfig = {}) {
    super(ctx, 'memory')
    this.providerId = config.providerId ?? process.env.DSH_MEMORY_PROVIDER
    if (config.durableFileDirectory !== undefined) {
      this.registerProvider(createDurableFileMemoryProvider({ directory: config.durableFileDirectory }))
    }
  }

  /**
   * Register a memory provider. Throws {@link MemoryError}
   * `MEMORY_DUPLICATE_PROVIDER` if its id is already registered. Returns a
   * disposer; disposed with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: MemoryProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new MemoryError(`a memory provider with id "${provider.id}" is already registered`, 'MEMORY_DUPLICATE_PROVIDER')
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'memory.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Submit a candidate write. The only mutation entry point this seam
   * exposes (`acceptance[1]`).
   * @param request - the candidate content, its principal, and its scope.
   * @returns the newly minted record's identity.
   */
  async propose(request: MemoryProposeRequest): Promise<MemoryProposeResult> {
    return this.resolve().propose(request)
  }

  /**
   * Run a free-text read through the selected provider, capped to
   * `request.accessContext.contextBudget.maxRecords`.
   * @param request - the query and its complete access context.
   * @returns matching records, capped to the caller's budget.
   */
  async query(request: MemoryQueryRequest): Promise<MemoryQueryResult> {
    requireCompleteAccessContext(request.accessContext)
    const result = await this.resolve().query(request)
    return capRecords(result, request.accessContext.contextBudget.maxRecords)
  }

  /**
   * Fetch one record by id.
   * @param request - the record id and its complete access context.
   * @returns the record, or `undefined` when no such record is visible to the access context.
   */
  async get(request: MemoryGetRequest): Promise<MemoryRecordView | undefined> {
    requireCompleteAccessContext(request.accessContext)
    return this.resolve().get(request)
  }

  /**
   * Update an existing record's content. Rejected when `request.id` was
   * never returned by a prior `propose()` (`acceptance[1]`).
   * @param request - the target id, its new content, its principal, and its scope.
   * @returns Nothing.
   */
  async revise(request: MemoryReviseRequest): Promise<void> {
    return this.resolve().revise(request)
  }

  /**
   * Remove a record. Idempotent.
   * @param request - the target id, its principal, and its scope.
   * @returns Nothing.
   */
  async forget(request: MemoryForgetRequest): Promise<void> {
    return this.resolve().forget(request)
  }

  /**
   * Bulk-read every record visible to `request.accessContext`, capped to
   * `contextBudget.maxRecords`.
   * @param request - the complete access context.
   * @returns every visible record, capped to the caller's budget.
   */
  async export(request: MemoryExportRequest): Promise<MemoryExportResult> {
    requireCompleteAccessContext(request.accessContext)
    const result = await this.resolve().export(request)
    return capRecords(result, request.accessContext.contextBudget.maxRecords)
  }

  /** Resolve the selected provider per this class's selection semantics. */
  private resolve(): MemoryProvider {
    return resolveProvider({
      providers: this.providers,
      ...this.providerId !== undefined ? { configuredId: this.providerId } : {},
    })
  }
}

/** Resolve the selected provider or throw the matching {@link MemoryError}. */
function resolveProvider(selection: Selection): MemoryProvider {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new MemoryError(`configured memory provider "${configuredId}" is not registered`, 'MEMORY_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new MemoryError(`configured memory provider "${configuredId}" is registered but unavailable`, 'MEMORY_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new MemoryError('no usable memory provider is registered', 'MEMORY_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new MemoryError(`multiple usable memory providers are registered (${ids}); configure one explicitly`, 'MEMORY_PROVIDER_AMBIGUOUS')
  }
  return single
}

/**
 * Reject a read whose {@link MemoryAccessContext} is missing any of the four
 * dimensions `must[3]` requires (`principal`, `purpose`, `scope`,
 * `contextBudget`) — enforced once here so `query`/`get`/`export` share
 * identical scoping regardless of which provider is selected.
 */
function requireCompleteAccessContext(accessContext: MemoryAccessContext): void {
  // A caller can violate MemoryAccessContext's required fields at runtime
  // (this function's whole job); widen the local view so the checks below are
  // not flagged as statically-impossible against the non-optional interface.
  const candidate: Partial<MemoryAccessContext> = accessContext
  if (!candidate.principal || !candidate.purpose || !candidate.scope || !candidate.contextBudget) {
    throw new MemoryError('memory read rejected: access context is missing principal, purpose, scope, or contextBudget', 'MEMORY_ACCESS_CONTEXT_REQUIRED')
  }
}

/**
 * Enforce `maxRecords` on a read result: truncate `records[]` and flag it. A
 * budget below zero bounds the read to nothing rather than to a count taken
 * from the end: `slice(0, negative)` counts back from the array's end, so an
 * unclamped negative budget returned every record but the last while still
 * reporting `truncated: true` — a flag asserting a bound that had not been
 * applied, over a result whose size depended on the budget's magnitude.
 */
function capRecords<T extends { records: readonly MemoryRecordView[]; truncated: boolean }>(result: T, maxRecords: number | undefined): T {
  if (maxRecords === undefined) return result
  const limit = Math.max(0, maxRecords)
  if (result.records.length <= limit) return result
  return { ...result, records: result.records.slice(0, limit), truncated: true }
}

/**
 * Real, in-memory `MemoryProvider` for Contract-stage conformance
 * (`acceptance[0]`). Stores each proposed record in a `Map` keyed by a
 * monotonically counted id (`local-reference-<n>`); `query()` matches by
 * case-insensitive substring against the record's serialized content. Not
 * durable across process restarts — a durable, same-host backend is a later
 * first100 stage's job; this stage only needs a real, independent
 * implementation of the six operations.
 * @returns a working {@link MemoryProvider}.
 */
export function createLocalReferenceMemoryProvider(): MemoryProvider {
  const records = new Map<MemoryRecordId, ScopedMemoryRecord>()
  let counter = 0

  /** The stored record `id` names, but only when `scope` may see it. */
  const visible = (id: MemoryRecordId, scope: MemoryScope): ScopedMemoryRecord | undefined => {
    const record = records.get(id)
    return record !== undefined && inScope(record, scope) ? record : undefined
  }

  return {
    id: 'local-reference',
    available: () => true,
    propose(request) {
      const id = MemoryRecordId(`local-reference-${++counter}`)
      records.set(id, {
        id, principal: request.principal, content: request.content, updatedAt: new Date().toISOString(), scope: request.scope,
      })
      return Promise.resolve({ id })
    },
    query(request) {
      const needle = request.query.toLowerCase()
      const matches = [...records.values()]
        .filter(record => inScope(record, request.accessContext.scope))
        .filter(record => JSON.stringify(record.content).toLowerCase().includes(needle))
      return Promise.resolve({ records: matches.map(toRecordView), truncated: false })
    },
    get(request) {
      const found = visible(request.id, request.accessContext.scope)
      return Promise.resolve(found === undefined ? undefined : toRecordView(found))
    },
    revise(request) {
      const existing = visible(request.id, request.scope)
      if (existing === undefined) {
        // An out-of-scope id is indistinguishable from one never proposed.
        throw new MemoryError(`memory record "${request.id}" was never proposed`, 'MEMORY_RECORD_NOT_FOUND')
      }
      records.set(request.id, { ...existing, content: request.content, updatedAt: new Date().toISOString() })
      return Promise.resolve()
    },
    forget(request) {
      if (visible(request.id, request.scope) !== undefined) records.delete(request.id)
      return Promise.resolve()
    },
    export(request) {
      const matches = [...records.values()].filter(record => inScope(record, request.accessContext.scope))
      return Promise.resolve({ records: matches.map(toRecordView), truncated: false })
    },
  }
}

/**
 * A second, independently-implemented in-memory `MemoryProvider`
 * (`acceptance[0]`'s "at least ... and a fake provider"). A distinct `id`
 * from {@link createLocalReferenceMemoryProvider} lets both register on the
 * same runtime without a duplicate-id conflict, exercising real
 * replaceability (`must[1]`). Stores records in an array under
 * randomly-generated ids and matches `query()` by whitespace-tokenized word
 * overlap — a deliberately different data structure, id scheme, and matching
 * algorithm from {@link createLocalReferenceMemoryProvider}, so the
 * conformance sweep exercises two genuinely distinct implementations, not
 * one aliased twice.
 * @returns a working {@link MemoryProvider}.
 */
export function createFakeMemoryProvider(): MemoryProvider {
  const records: ScopedMemoryRecord[] = []

  /** Index of the stored record `id` names, but only when `scope` may see it. */
  const visibleIndex = (id: MemoryRecordId, scope: MemoryScope): number =>
    records.findIndex(record => record.id === id && inScope(record, scope))

  return {
    id: 'fake',
    available: () => true,
    propose(request) {
      const id = MemoryRecordId(`fake-${randomUUID()}`)
      records.push({
        id, principal: request.principal, content: request.content, updatedAt: new Date().toISOString(), scope: request.scope,
      })
      return Promise.resolve({ id })
    },
    query(request) {
      const words = request.query.toLowerCase().split(/\s+/).filter(word => word.length > 0)
      const matches = records.filter((record) => {
        if (!inScope(record, request.accessContext.scope)) return false
        const haystack = JSON.stringify(record.content).toLowerCase()
        return words.some(word => haystack.includes(word))
      })
      return Promise.resolve({ records: matches.map(toRecordView), truncated: false })
    },
    get(request) {
      const index = visibleIndex(request.id, request.accessContext.scope)
      const found = records[index]
      return Promise.resolve(index === -1 || found === undefined ? undefined : toRecordView(found))
    },
    revise(request) {
      const index = visibleIndex(request.id, request.scope)
      const existing = records[index]
      if (existing === undefined) {
        // An out-of-scope id is indistinguishable from one never proposed.
        throw new MemoryError(`memory record "${request.id}" was never proposed`, 'MEMORY_RECORD_NOT_FOUND')
      }
      records[index] = { ...existing, content: request.content, updatedAt: new Date().toISOString() }
      return Promise.resolve()
    },
    forget(request) {
      const index = visibleIndex(request.id, request.scope)
      if (index !== -1) records.splice(index, 1)
      return Promise.resolve()
    },
    export(request) {
      const matches = records.filter(record => inScope(record, request.accessContext.scope))
      return Promise.resolve({ records: matches.map(toRecordView), truncated: false })
    },
  }
}

/**
 * Options for {@link createDurableFileMemoryProvider}.
 */
export interface DurableFileMemoryProviderOptions {
  /**
   * Directory holding this provider's backing file. Two provider instances
   * constructed over the same directory share one record set and share no
   * in-memory value; the directory is created on first write if absent.
   */
  readonly directory: string
}

/**
 * Durable, same-host `MemoryProvider` backed by a JSON file under
 * `options.directory` — the Provider-stage counterpart to the Contract-stage
 * in-memory providers, which lose every record at process exit. Memory is by
 * definition cross-session and long-lived, so a provider that cannot outlive
 * the process cannot serve the seam's purpose.
 *
 * Durability is per-directory, not per-instance: a provider constructed later
 * over the same `directory` reads back every record an earlier instance
 * proposed or revised, and does not read back one an earlier instance forgot.
 * Instances hold no shared in-memory state, so cross-instance visibility
 * comes from the file alone.
 *
 * Record ids are `durable-file-<uuid>` — minted per record, never per
 * instance-local counter, so a second instance over the same directory can
 * never re-mint an id the first one already used.
 *
 * Scoping (`must[3]`): each record persists the `MemoryScope` its `propose()`
 * carried. A read (`query`/`get`/`export`) sees a record only when the read's
 * `accessContext.scope.tenantId` equals the record's `tenantId`; when the
 * read's scope also names a `sessionId`, the record's `sessionId` must equal
 * it, and a read whose scope names no `sessionId` sees every session within
 * the tenant. `revise()`/`forget()` apply the same scope filter, so an
 * out-of-scope id is indistinguishable from one that was never proposed.
 *
 * `query()` matches by case-insensitive substring over the record's
 * JSON-serialized content — a mechanism choice private to this provider, as
 * `must[0]` requires the seam itself to name none.
 * @param options - the backing directory for this provider's records.
 * @returns a durable {@link MemoryProvider} whose id is `durable-file`.
 */
export function createDurableFileMemoryProvider(options: DurableFileMemoryProviderOptions): MemoryProvider {
  const path = join(options.directory, DURABLE_FILE_MEMORY_FILENAME)

  /**
   * Every read and write of `path` is chained onto this promise, so a mutation
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

  const read = async (): Promise<DurableMemoryRecord[]> => {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      // A backing file that was never written is a first boot, not a failure;
      // any other read failure (permissions, a directory at `path`) is real.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (text.trim() === '') return []
    let document: DurableMemoryDocument
    try {
      document = JSON.parse(text) as DurableMemoryDocument
    } catch (error) {
      // A damaged document is the same failure class as an unrecognized
      // version below, and is reported the same way: a MemoryError naming the
      // file, not the parser's own error, whose message text varies with the
      // V8 version and names nothing a caller can route on.
      throw new MemoryError(`durable memory store at ${path} is corrupt and could not be parsed`, 'MEMORY_CORRUPT_STORE', { cause: error })
    }
    if (document.version !== DURABLE_FILE_MEMORY_FORMAT_VERSION) {
      throw new MemoryError(
        `unsupported durable memory format version ${String(document.version)} at ${path}, expected ${DURABLE_FILE_MEMORY_FORMAT_VERSION}`,
        'MEMORY_UNSUPPORTED_FORMAT_VERSION',
      )
    }
    return [...document.records]
  }

  const write = async (records: readonly DurableMemoryRecord[]): Promise<void> => {
    const document: DurableMemoryDocument = { version: DURABLE_FILE_MEMORY_FORMAT_VERSION, records }
    await mkdir(options.directory, { recursive: true })
    // Write-then-rename: a crash mid-write leaves the previous complete
    // document in place at `path` rather than a truncated one.
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(document)}\n`, 'utf8')
    await rename(temporaryPath, path)
  }

  /** The records `scope` may see, in the order they were proposed. */
  const visible = (records: readonly DurableMemoryRecord[], scope: MemoryScope): DurableMemoryRecord[] =>
    records.filter(record => inScope(record, scope))

  return {
    id: 'durable-file',
    // Usable wherever the process can write to the local filesystem; the
    // directory is created on first write, so nothing is checked here (a
    // stat() would be a network-free but still needless I/O round trip on a
    // call the seam makes for every operation).
    available: () => true,
    propose(request: MemoryProposeRequest): Promise<MemoryProposeResult> {
      return enqueue(async () => {
        // A per-record uuid, never an instance-local counter: a second
        // instance over the same directory can never re-mint a used id.
        const id = MemoryRecordId(`durable-file-${randomUUID()}`)
        const records = await read()
        records.push({
          id,
          principal: request.principal,
          content: request.content,
          updatedAt: new Date().toISOString(),
          scope: request.scope,
        })
        await write(records)
        return { id }
      })
    },
    query(request: MemoryQueryRequest): Promise<MemoryQueryResult> {
      return enqueue(async () => {
        const needle = request.query.toLowerCase()
        const matches = visible(await read(), request.accessContext.scope)
          .filter(record => JSON.stringify(record.content).toLowerCase().includes(needle))
        return { records: matches.map(toRecordView), truncated: false }
      })
    },
    get(request: MemoryGetRequest): Promise<MemoryRecordView | undefined> {
      return enqueue(async () => {
        const found = visible(await read(), request.accessContext.scope).find(record => record.id === request.id)
        return found === undefined ? undefined : toRecordView(found)
      })
    },
    revise(request: MemoryReviseRequest): Promise<void> {
      return enqueue(async () => {
        const records = await read()
        const index = records.findIndex(record => record.id === request.id && inScope(record, request.scope))
        const existing = records[index]
        if (existing === undefined) {
          // An out-of-scope id is indistinguishable from one never proposed.
          throw new MemoryError(`memory record "${request.id}" was never proposed`, 'MEMORY_RECORD_NOT_FOUND')
        }
        records[index] = { ...existing, content: request.content, updatedAt: new Date().toISOString() }
        await write(records)
      })
    },
    forget(request: MemoryForgetRequest): Promise<void> {
      return enqueue(async () => {
        const records = await read()
        const index = records.findIndex(record => record.id === request.id && inScope(record, request.scope))
        if (index === -1) return
        records.splice(index, 1)
        await write(records)
      })
    },
    export(request: MemoryExportRequest): Promise<MemoryExportResult> {
      return enqueue(async () => ({
        records: visible(await read(), request.accessContext.scope).map(toRecordView),
        truncated: false,
      }))
    },
  }
}

/** Basename of the JSON document {@link createDurableFileMemoryProvider} keeps in its directory. */
const DURABLE_FILE_MEMORY_FILENAME = 'memory.json'

/** The on-disk format version {@link createDurableFileMemoryProvider} reads and writes. */
const DURABLE_FILE_MEMORY_FORMAT_VERSION = 1

/**
 * One stored record: the reader's projection plus the scope its `propose()`
 * carried. Every provider in this module stores the proposing scope, because
 * scope enforcement lives inside the provider: `MemoryRecordView` carries no
 * tenant, so {@link MemoryRuntime} has nothing to filter a returned record
 * against and cannot bound a read on the provider's behalf.
 */
interface ScopedMemoryRecord extends MemoryRecordView {
  readonly scope: MemoryScope
}

/** One persisted record. Identical to {@link ScopedMemoryRecord}; named apart for the on-disk document. */
type DurableMemoryRecord = ScopedMemoryRecord

/** The JSON document {@link createDurableFileMemoryProvider} keeps at its path. */
interface DurableMemoryDocument {
  readonly version: number
  readonly records: readonly DurableMemoryRecord[]
}

/** Whether a read or write confined to `scope` may see `record` (`must[3]`). */
function inScope(record: ScopedMemoryRecord, scope: MemoryScope): boolean {
  if (record.scope.tenantId !== scope.tenantId) return false
  // A scope naming no sessionId sees every session within the tenant.
  return scope.sessionId === undefined || record.scope.sessionId === scope.sessionId
}

/** Strip the stored scope, leaving exactly the reader-visible projection. */
function toRecordView(record: ScopedMemoryRecord): MemoryRecordView {
  return { id: record.id, principal: record.principal, content: record.content, updatedAt: record.updatedAt }
}

export default MemoryRuntime
export {
  decideCrossScopeMerge,
  isDefaultRetrievable,
  recordConflict,
  validateRecord,
} from './record.ts'
export type {
  MemoryContent,
  MemoryKind,
  MemoryProvenance,
  MemoryRecord,
  MemoryRelation,
  MemoryRelationKind,
  MemorySensitivity,
  MemoryStatus,
  MemorySubject,
  RecordDefectReason,
  RecordValidation,
  SourceEventId,
} from './record.ts'
export { admitToIndex, isTraceable, withProvenance } from './provenance.ts'
export type { IndexAdmission, IndexDenialReason, IndexingPolicy, ProvenancedRecord } from './provenance.ts'
