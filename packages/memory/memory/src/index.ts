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
  })

  private providers = new Map<string, MemoryProvider>()
  private readonly providerId: string | undefined

  constructor(ctx: Context, config: MemoryRuntimeConfig = {}) {
    super(ctx, 'memory')
    this.providerId = config.providerId ?? process.env.DSH_MEMORY_PROVIDER
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

/** Enforce `maxRecords` on a read result: truncate `records[]` and flag it. */
function capRecords<T extends { records: readonly MemoryRecordView[]; truncated: boolean }>(result: T, maxRecords: number | undefined): T {
  if (maxRecords === undefined || result.records.length <= maxRecords) return result
  return { ...result, records: result.records.slice(0, maxRecords), truncated: true }
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
  const records = new Map<MemoryRecordId, MemoryRecordView>()
  let counter = 0

  return {
    id: 'local-reference',
    available: () => true,
    propose(request) {
      const id = MemoryRecordId(`local-reference-${++counter}`)
      records.set(id, { id, principal: request.principal, content: request.content, updatedAt: new Date().toISOString() })
      return Promise.resolve({ id })
    },
    query(request) {
      const needle = request.query.toLowerCase()
      const matches = [...records.values()].filter(record => JSON.stringify(record.content).toLowerCase().includes(needle))
      return Promise.resolve({ records: matches, truncated: false })
    },
    get(request) {
      return Promise.resolve(records.get(request.id))
    },
    revise(request) {
      const existing = records.get(request.id)
      if (existing === undefined) {
        throw new MemoryError(`memory record "${request.id}" was never proposed`, 'MEMORY_RECORD_NOT_FOUND')
      }
      records.set(request.id, { ...existing, content: request.content, updatedAt: new Date().toISOString() })
      return Promise.resolve()
    },
    forget(request) {
      records.delete(request.id)
      return Promise.resolve()
    },
    export() {
      return Promise.resolve({ records: [...records.values()], truncated: false })
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
  const records: MemoryRecordView[] = []

  return {
    id: 'fake',
    available: () => true,
    propose(request) {
      const id = MemoryRecordId(`fake-${randomUUID()}`)
      records.push({ id, principal: request.principal, content: request.content, updatedAt: new Date().toISOString() })
      return Promise.resolve({ id })
    },
    query(request) {
      const words = request.query.toLowerCase().split(/\s+/).filter(word => word.length > 0)
      const matches = records.filter((record) => {
        const haystack = JSON.stringify(record.content).toLowerCase()
        return words.some(word => haystack.includes(word))
      })
      return Promise.resolve({ records: matches, truncated: false })
    },
    get(request) {
      return Promise.resolve(records.find(record => record.id === request.id))
    },
    revise(request) {
      const existing = records.find(record => record.id === request.id)
      if (existing === undefined) {
        throw new MemoryError(`memory record "${request.id}" was never proposed`, 'MEMORY_RECORD_NOT_FOUND')
      }
      records[records.indexOf(existing)] = { ...existing, content: request.content, updatedAt: new Date().toISOString() }
      return Promise.resolve()
    },
    forget(request) {
      const index = records.findIndex(record => record.id === request.id)
      if (index !== -1) records.splice(index, 1)
      return Promise.resolve()
    },
    export() {
      return Promise.resolve({ records: [...records], truncated: false })
    },
  }
}

export default MemoryRuntime
