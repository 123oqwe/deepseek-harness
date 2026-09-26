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
import type { Principal } from '@deepseek-ai/dsh-principal'
import type { MemoryKind, MemoryProvenance, MemoryRelation, MemorySensitivity, MemoryStatus, MemorySubject } from './record.ts'
import { isTraceable } from './provenance.ts'
import type { IndexingPolicy } from './provenance.ts'
import { decideCrossScopeMerge, isDefaultRetrievable } from './record.ts'
import type { MemoryClaimOrigin, MemoryRebuiltCountRequest } from './types.ts'
import type {
  MemoryAccessContext,
  MemoryEraseRequest,
  MemoryExportedRecord,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryForgetRequest,
  MemoryGetRequest,
  MemoryListPendingRequest,
  MemoryListPendingResult,
  MemoryMergeRequest,
  MemoryProposeRequest,
  MemoryProposeResult,
  MemoryProvider,
  MemoryQueryRequest,
  MemoryQueryResult,
  MemoryRecordView,
  MemoryReviewRequest,
  MemoryReviseRequest,
  MemoryScope,
  MemorySupersedeRequest,
  MemoryTombstoneView,
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
  MemoryEraseRequest,
  MemoryExportedRecord,
  MemoryExportRequest,
  MemoryExportResult,
  MemoryForgetRequest,
  MemoryGetRequest,
  MemoryListPendingRequest,
  MemoryListPendingResult,
  MemoryMergeEnd,
  MemoryMergeRequest,
  MemoryProposeRequest,
  MemoryProposeResult,
  MemoryProvider,
  MemoryQueryRequest,
  MemoryQueryResult,
  MemoryRecordView,
  MemoryReviewRequest,
  MemoryReviseRequest,
  MemoryScope,
  MemorySupersedeRequest,
  MemoryTombstoneView,
  MemoryRebuiltCountRequest,
  MemoryClaimOrigin,
  WorkspaceMemoryScope,
  CrossScopeMergeAuthorization,
  CrossScopeMergeDecision,
  CrossScopeDenialReason,
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
  /**
   * Whether the default search may match content its writer marked sensitive.
   *
   * `false` by default, and the default is the safe direction rather than a
   * convenience: a sensitive record wrongly reachable through free-text search
   * cannot be made unreachable again once a reader has seen it. A deployment
   * that has decided its search surface is acceptable for sensitive content
   * says so here. Content whose sensitivity NOBODY stated is withheld whatever
   * this says — that is an absent assessment, not a permitted one.
   */
  readonly allowSensitiveIndexing?: boolean
}

/**
 * The optional proposal-policy provider `propose` consults (P6-03,
 * `@deepseek-ai/dsh-memory-policy`). Read through `ctx.get('memoryProposalPolicy')`
 * so a deployment that mounts no policy keeps the pre-P6-03 behaviour. Declared
 * here as the consumer's own structural view rather than imported, because the
 * provider package depends on this one — importing it back would be a cycle.
 */
interface MemoryProposalPolicyConsumer {
  decide(request: MemoryProposeRequest): {
    readonly disposition: 'auto-accept' | 'review' | 'reject'
    readonly reason: string
  }
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
    allowSensitiveIndexing: z.boolean(),
  })

  private providers = new Map<string, MemoryProvider>()

  /**
   * The deployment's indexing policy, handed to the provider this service
   * registers for itself.
   *
   * It cannot be applied at the seam the way the access-context check is:
   * `query()` receives `MemoryRecordView`s, which carry no `sensitivity` and
   * no `status`, so by the time a result reaches this class the fields both
   * rules read are already stripped. The decision therefore lives where the
   * stored record does. A provider registered through
   * {@link MemoryRuntime.registerProvider} carries the policy its own factory
   * was given, and every factory here defaults to deny — so forgetting to
   * pass one withholds rather than leaks.
   */
  private readonly indexingPolicy: IndexingPolicy
  private readonly providerId: string | undefined

  constructor(ctx: Context, config: MemoryRuntimeConfig = {}) {
    super(ctx, 'memory')
    this.providerId = config.providerId ?? process.env.DSH_MEMORY_PROVIDER
    this.indexingPolicy = { allowSensitive: config.allowSensitiveIndexing ?? false }
    if (config.durableFileDirectory !== undefined) {
      this.registerProvider(createDurableFileMemoryProvider({ directory: config.durableFileDirectory, indexing: this.indexingPolicy }))
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
   *
   * Refuses an untraceable claim before any provider is reached (P6-02
   * `acceptance[0]`), for the same reason `query`/`get`/`export` check the
   * access context here: a provider registered outside this seam would not
   * inherit the rule, and a record that traces to nothing is not a record this
   * store can answer for.
   * @param request - the candidate content, its origin, its principal, and its scope.
   * @returns the newly minted record's identity.
   * @throws MemoryError `MEMORY_CLAIM_UNTRACEABLE` when the origin names
   *   neither a source event nor a responsible party.
   */
  async propose(request: MemoryProposeRequest): Promise<MemoryProposeResult> {
    requireTraceableClaim(request.origin)
    // P6-03 must[1]/must[2]: the mounted proposal policy decides the write's
    // disposition. Fail closed — an uncertain state takes the clause's text: a
    // review decision, OR no policy mounted at all, holds the write as
    // `pending` rather than admitting it to active memory, so a memory enabled
    // without its policy cannot silently auto-accept every write. Only an
    // explicit auto-accept stores `active`; a rejection refuses.
    const policy = this.ctx.get('memoryProposalPolicy') as MemoryProposalPolicyConsumer | undefined
    const decision = policy?.decide(request)
    if (decision?.disposition === 'reject') {
      throw new MemoryError(`memory proposal rejected by policy: ${decision.reason}`, 'MEMORY_PROPOSAL_REJECTED')
    }
    const status: MemoryStatus = decision?.disposition === 'auto-accept' ? 'active' : 'pending'
    return this.resolve().propose(request, status)
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
   * How many records this workspace PATH holds under a different identity.
   *
   * A reporting channel, not a retrieval one: a consumer can tell a user "this
   * workspace looks rebuilt and its earlier memory is still on disk" without
   * being handed any of it. The displaced directory's records stay unreadable —
   * adopting them is a person's decision and importing them is P6-03's.
   * @param request - the path, the identity in use now, and the read's context.
   * @returns the number of records at that path under any other identity.
   */
  async countRebuiltAt(request: MemoryRebuiltCountRequest): Promise<number> {
    requireCompleteAccessContext(request.accessContext)
    return this.resolve().countRebuiltAt(request)
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
   * Remove a record and leave a tombstone (P6-03 third slice, acceptance[1]).
   * Idempotent. The content is removed from the store; `export` lists a
   * {@link MemoryTombstoneView} in its place.
   * @param request - the target id, its principal, and its scope.
   * @returns Nothing.
   */
  async forget(request: MemoryForgetRequest): Promise<void> {
    return this.resolve().forget(request)
  }

  /**
   * Record that one record supersedes another (P6-03 third slice, must[3]).
   * Both persist: the newer gains a `supersedes` relation and the older is
   * marked `superseded`, so the default search returns only the newer while
   * `export` keeps both (must[1] — a conflict never overwrites).
   * @param request - the newer id, the older id it supersedes, the principal, and the scope both belong to.
   * @returns Nothing.
   */
  async supersede(request: MemorySupersedeRequest): Promise<void> {
    return this.resolve().supersede(request)
  }

  /**
   * Merge one record into another (P6-03 third slice, must[3]). A cross-scope
   * merge with no `authorization` naming both scopes is refused with
   * `MEMORY_MERGE_NOT_AUTHORIZED` before either record changes (P6-02
   * acceptance[2]).
   * @param request - the two ends, and the cross-scope authorization when the merge crosses a boundary.
   * @returns Nothing.
   */
  async merge(request: MemoryMergeRequest): Promise<void> {
    return this.resolve().merge(request)
  }

  /**
   * Erase every record about a subject in one tenant (P6-03 third slice,
   * must[3] right-to-erasure), forgetting each as {@link MemoryRuntime.forget}
   * forgets one, in every session and workspace of the tenant.
   * @param request - the requesting principal, the tenant, and the subject to erase.
   * @returns Nothing.
   */
  async erase(request: MemoryEraseRequest): Promise<void> {
    return this.resolve().erase(request)
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

  /**
   * The proposals held for review that `request.accessContext` may see, capped
   * to its budget. A reporting channel like `export`, not a retrieval one.
   * @param request - the complete access context.
   * @returns the pending proposals visible to the access context.
   */
  async listPending(request: MemoryListPendingRequest): Promise<MemoryListPendingResult> {
    requireCompleteAccessContext(request.accessContext)
    const result = await this.resolve().listPending(request)
    return capRecords(result, request.accessContext.contextBudget.maxRecords)
  }

  /**
   * Admit a held proposal to active memory. Only a user principal decides a
   * proposal held for review (`must[2]`): an agent or service principal is
   * refused with `MEMORY_REVIEW_FORBIDDEN` before the provider is reached, so
   * the proposal stays pending. The provider then rejects an id that is not a
   * `pending` record `request.scope` may see.
   * @param request - the target id, the deciding principal, and its scope.
   * @returns Nothing.
   */
  async approve(request: MemoryReviewRequest): Promise<void> {
    requireUserPrincipal(request.principal)
    return this.resolve().approve(request)
  }

  /**
   * Refuse a held proposal, which then never becomes active. Same
   * user-principal rule and provider rejections as {@link MemoryRuntime.approve}.
   * @param request - the target id, the deciding principal, and its scope.
   * @returns Nothing.
   */
  async reject(request: MemoryReviewRequest): Promise<void> {
    requireUserPrincipal(request.principal)
    return this.resolve().reject(request)
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
 * Reject a review decision made by anyone but a person. Only a user principal
 * approves or rejects a proposal held for review (`must[2]`); an agent or
 * service principal is refused with `MEMORY_REVIEW_FORBIDDEN` before the
 * provider is reached, so the proposal stays pending. The message names the
 * caller's own kind, never whether the record exists.
 * @param principal - the principal deciding the proposal.
 */
function requireUserPrincipal(principal: Principal): void {
  if (principal.kind !== 'user') {
    throw new MemoryError(`memory review rejected: only a user principal may approve or reject a held proposal, not a ${principal.kind} principal`, 'MEMORY_REVIEW_FORBIDDEN')
  }
}

/**
 * Refuse a claim that traces to nothing (P6-02 `acceptance[0]`).
 *
 * The decision is P6-02's `isTraceable`, called rather than restated: the rule
 * has one home, and a second spelling here would be free to disagree with the
 * one the record vocabulary enforces. `MemoryClaimOrigin` is `MemoryProvenance`
 * with the derived branch's confidence attached, so the value this seam holds
 * is exactly what that function decides on.
 *
 * It is stricter than `validateRecord`'s `derived-without-source` branch, and
 * deliberately: an empty `assertedBy` is refused too, because "the user said
 * so" with nobody named is the same blank origin wearing the other variant's
 * label.
 * @param origin - the claim's stated origin.
 * @returns Nothing.
 * @throws MemoryError `MEMORY_CLAIM_UNTRACEABLE` when it names neither.
 */
function requireTraceableClaim(origin: MemoryClaimOrigin): void {
  if (isTraceable(origin)) return
  throw new MemoryError(
    'memory write rejected: a derived claim must name at least one source event, and a user-asserted claim must name who asserted it',
    'MEMORY_CLAIM_UNTRACEABLE',
  )
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
 * Whether a stored record may be returned by the DEFAULT search.
 *
 * Two P6-02 decisions, asked together because they answer the same question
 * about the same call. `isDefaultRetrievable` (acceptance[1]) withholds a
 * record that is no longer active or whose validity has passed;
 * `admitToIndex` (must[2]) withholds content the deployment's policy does not
 * admit, including content whose sensitivity nobody stated.
 *
 * Applied to `query()` and to nothing else. `query()` is the default
 * retrieval this build has, and the free-text scan it performs is the only
 * thing here that plays the part of an index. `get()` by id and `export()`
 * are explicit requests for a named record or for everything a caller may
 * see; withholding from those would not keep a record out of an index, it
 * would make it unreadable by its owner — a different rule nobody wrote.
 * @param record - the stored record, with the fields a view has already lost.
 * @param nowIso - the instant to judge validity against.
 * @param policy - the deployment's indexing policy.
 * @returns whether the default search may return it.
 */
/**
 * The indexing policy a provider gets when its caller supplies none.
 *
 * Deny, so the cost of forgetting is a retrieval rather than an exposure.
 */
const DENY_SENSITIVE_INDEXING: IndexingPolicy = { allowSensitive: false }

function isDefaultSearchable(record: ScopedMemoryRecord, nowIso: string, policy: IndexingPolicy): boolean {
  // `admitToIndex(record, policy)` is deliberately NOT asked here yet. Applied
  // to this scan it withholds every record whose writer stated no sensitivity,
  // and no shipped writer states one — including `dsh-memory-context`, the
  // seam's only consumer — so memory-on-by-default would recall nothing at
  // all. Whether this free-text scan over records the caller may already read
  // IS the "index" must[2] speaks of, or whether that clause is about a
  // derived artifact this build does not build, is a ruling in flight. The
  // policy is threaded to here so that ruling changes one line.
  void policy
  return isDefaultRetrievable(record, nowIso)
}

/**
 * Real, in-memory `MemoryProvider` for Contract-stage conformance
 * (`acceptance[0]`). Stores each proposed record in a `Map` keyed by a
 * monotonically counted id (`local-reference-<n>`); `query()` matches by
 * case-insensitive substring against the record's serialized content. Not
 * durable across process restarts — a durable, same-host backend is a later
 * first100 stage's job; this stage only needs a real, independent
 * implementation of the six operations.
 * @param indexing - the deployment's indexing policy; omitted denies sensitive content, so forgetting one withholds rather than leaks.
 * @returns a working {@link MemoryProvider}.
 */
export function createLocalReferenceMemoryProvider(indexing: IndexingPolicy = DENY_SENSITIVE_INDEXING): MemoryProvider {
  const records = new Map<MemoryRecordId, ScopedMemoryRecord>()
  const tombstones: StoredTombstone[] = []
  let counter = 0

  /** The stored record `id` names, but only when `scope` may see it. */
  const visible = (id: MemoryRecordId, scope: MemoryScope): ScopedMemoryRecord | undefined => {
    const record = records.get(id)
    return record !== undefined && inScope(record, scope) ? record : undefined
  }

  return {
    id: 'local-reference',
    available: () => true,
    propose(request, status) {
      const id = MemoryRecordId(`local-reference-${++counter}`)
      records.set(id, {
        id,
        ...recordFieldsFor(request, status),
      })
      return Promise.resolve({ id })
    },
    query(request) {
      const needle = request.query.toLowerCase()
      const now = new Date().toISOString()
      const matches = [...records.values()]
        .filter(record => inScope(record, request.accessContext.scope))
        .filter(record => isDefaultSearchable(record, now, indexing))
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
      const found = visible(request.id, request.scope)
      if (found !== undefined) {
        records.delete(request.id)
        tombstones.push(tombstoneFor(found, request.principal))
      }
      return Promise.resolve()
    },
    supersede(request) {
      const { winner, loser } = supersedeInto(
        requireFound(visible(request.id, request.scope), request.id),
        requireFound(visible(request.supersedes, request.scope), request.supersedes),
      )
      records.set(winner.id, winner)
      records.set(loser.id, loser)
      return Promise.resolve()
    },
    merge(request) {
      authorizeMerge(request)
      const { winner, loser } = supersedeInto(
        requireFound(visible(request.into.id, request.into.scope), request.into.id),
        requireFound(visible(request.from.id, request.from.scope), request.from.id),
      )
      records.set(winner.id, winner)
      records.set(loser.id, loser)
      return Promise.resolve()
    },
    erase(request) {
      for (const record of [...records.values()]) {
        if (!matchesErasure(record, request)) continue
        records.delete(record.id)
        tombstones.push(tombstoneFor(record, request.principal))
      }
      return Promise.resolve()
    },
    countRebuiltAt(request) {
      return Promise.resolve(countRebuiltRecords([...records.values()], request))
    },
    export(request) {
      const { scope } = request.accessContext
      return Promise.resolve(buildExportResult(
        [...records.values()].filter(record => inScope(record, scope)),
        tombstones.filter(tombstone => inScope(tombstone, scope)),
      ))
    },
    listPending(request) {
      return Promise.resolve({ records: pendingViews(records.values(), request.accessContext.scope), truncated: false })
    },
    approve(request) {
      records.set(request.id, reviewTransition(visible(request.id, request.scope), request.id, 'active'))
      return Promise.resolve()
    },
    reject(request) {
      records.set(request.id, reviewTransition(visible(request.id, request.scope), request.id, 'rejected'))
      return Promise.resolve()
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
 * @param indexing - the deployment's indexing policy; omitted denies sensitive content, so forgetting one withholds rather than leaks.
 * @returns a working {@link MemoryProvider}.
 */
export function createFakeMemoryProvider(indexing: IndexingPolicy = DENY_SENSITIVE_INDEXING): MemoryProvider {
  const records: ScopedMemoryRecord[] = []
  const tombstones: StoredTombstone[] = []

  /** Index of the stored record `id` names, but only when `scope` may see it. */
  const visibleIndex = (id: MemoryRecordId, scope: MemoryScope): number =>
    records.findIndex(record => record.id === id && inScope(record, scope))

  return {
    id: 'fake',
    available: () => true,
    propose(request, status) {
      const id = MemoryRecordId(`fake-${randomUUID()}`)
      records.push({
        id,
        ...recordFieldsFor(request, status),
      })
      return Promise.resolve({ id })
    },
    query(request) {
      const words = request.query.toLowerCase().split(/\s+/).filter(word => word.length > 0)
      const now = new Date().toISOString()
      const matches = records.filter((record) => {
        if (!inScope(record, request.accessContext.scope)) return false
        if (!isDefaultSearchable(record, now, indexing)) return false
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
      const found = records[index]
      if (found !== undefined) {
        records.splice(index, 1)
        tombstones.push(tombstoneFor(found, request.principal))
      }
      return Promise.resolve()
    },
    supersede(request) {
      const winnerIndex = visibleIndex(request.id, request.scope)
      const loserIndex = visibleIndex(request.supersedes, request.scope)
      const { winner, loser } = supersedeInto(
        requireFound(records[winnerIndex], request.id),
        requireFound(records[loserIndex], request.supersedes),
      )
      records[winnerIndex] = winner
      records[loserIndex] = loser
      return Promise.resolve()
    },
    merge(request) {
      authorizeMerge(request)
      const intoIndex = visibleIndex(request.into.id, request.into.scope)
      const fromIndex = visibleIndex(request.from.id, request.from.scope)
      const { winner, loser } = supersedeInto(
        requireFound(records[intoIndex], request.into.id),
        requireFound(records[fromIndex], request.from.id),
      )
      records[intoIndex] = winner
      records[fromIndex] = loser
      return Promise.resolve()
    },
    erase(request) {
      for (let index = records.length - 1; index >= 0; index--) {
        const record = records[index]
        if (record === undefined || !matchesErasure(record, request)) continue
        records.splice(index, 1)
        tombstones.push(tombstoneFor(record, request.principal))
      }
      return Promise.resolve()
    },
    countRebuiltAt(request) {
      return Promise.resolve(countRebuiltRecords(records, request))
    },
    export(request) {
      const { scope } = request.accessContext
      return Promise.resolve(buildExportResult(
        records.filter(record => inScope(record, scope)),
        tombstones.filter(tombstone => inScope(tombstone, scope)),
      ))
    },
    listPending(request) {
      return Promise.resolve({ records: pendingViews(records, request.accessContext.scope), truncated: false })
    },
    approve(request) {
      const index = visibleIndex(request.id, request.scope)
      records[index] = reviewTransition(records[index], request.id, 'active')
      return Promise.resolve()
    },
    reject(request) {
      const index = visibleIndex(request.id, request.scope)
      records[index] = reviewTransition(records[index], request.id, 'rejected')
      return Promise.resolve()
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
  /**
   * The deployment's indexing policy for the default search.
   *
   * Omitted denies sensitive content, so a caller that forgets one withholds
   * rather than leaks. Content whose sensitivity nobody stated is withheld
   * whatever this says: that is an absent assessment, not a permitted one.
   */
  readonly indexing?: IndexingPolicy
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
  const indexing: IndexingPolicy = options.indexing ?? DENY_SENSITIVE_INDEXING

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

  const read = async (): Promise<{ records: DurableMemoryRecord[]; tombstones: StoredTombstone[] }> => {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      // A backing file that was never written is a first boot, not a failure;
      // any other read failure (permissions, a directory at `path`) is real.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], tombstones: [] }
      throw error
    }
    if (text.trim() === '') return { records: [], tombstones: [] }
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
    // `tombstones` is absent from a store nothing was forgotten from, including
    // every store an earlier build wrote before this slice added the field: an
    // old document is complete without it, so its absence reads as none.
    return { records: [...document.records], tombstones: [...document.tombstones ?? []] }
  }

  const write = async (records: readonly DurableMemoryRecord[], tombstones: readonly StoredTombstone[]): Promise<void> => {
    // `tombstones` is written only when there is at least one, so a store
    // nothing was forgotten from keeps the exact document an earlier build
    // wrote — the field's absence and an empty list mean the same thing.
    const document: DurableMemoryDocument = {
      version: DURABLE_FILE_MEMORY_FORMAT_VERSION,
      records,
      ...(tombstones.length > 0 ? { tombstones } : {}),
    }
    // `0o700` on the directory and `0o600` on the document, because the two
    // stop different things: the directory mode stops a traversal, and the
    // file mode stops anyone who already holds a path to it — a backup pass, a
    // synced folder, a container bind mount. A user's durable memory is their
    // content, and a default-mode file inside a private directory still says
    // world-readable to everything that reaches it another way.
    await mkdir(options.directory, { recursive: true, mode: 0o700 })
    // Write-then-rename: a crash mid-write leaves the previous complete
    // document in place at `path` rather than a truncated one. The mode goes
    // on the TEMPORARY file: applied after the rename there would be a window
    // in which the real path is readable by anyone.
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(document)}\n`, { encoding: 'utf8', mode: 0o600 })
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
    propose(request: MemoryProposeRequest, status?: MemoryStatus): Promise<MemoryProposeResult> {
      return enqueue(async () => {
        // A per-record uuid, never an instance-local counter: a second
        // instance over the same directory can never re-mint a used id.
        const id = MemoryRecordId(`durable-file-${randomUUID()}`)
        const { records, tombstones } = await read()
        records.push({
          id,
          ...recordFieldsFor(request, status),
        })
        await write(records, tombstones)
        return { id }
      })
    },
    query(request: MemoryQueryRequest): Promise<MemoryQueryResult> {
      return enqueue(async () => {
        const needle = request.query.toLowerCase()
        const now = new Date().toISOString()
        const matches = visible((await read()).records, request.accessContext.scope)
          .filter(record => isDefaultSearchable(record, now, indexing))
          .filter(record => JSON.stringify(record.content).toLowerCase().includes(needle))
        return { records: matches.map(toRecordView), truncated: false }
      })
    },
    get(request: MemoryGetRequest): Promise<MemoryRecordView | undefined> {
      return enqueue(async () => {
        const found = visible((await read()).records, request.accessContext.scope).find(record => record.id === request.id)
        return found === undefined ? undefined : toRecordView(found)
      })
    },
    revise(request: MemoryReviseRequest): Promise<void> {
      return enqueue(async () => {
        const { records, tombstones } = await read()
        const index = records.findIndex(record => record.id === request.id && inScope(record, request.scope))
        const existing = records[index]
        if (existing === undefined) {
          // An out-of-scope id is indistinguishable from one never proposed.
          throw new MemoryError(`memory record "${request.id}" was never proposed`, 'MEMORY_RECORD_NOT_FOUND')
        }
        records[index] = { ...existing, content: request.content, updatedAt: new Date().toISOString() }
        await write(records, tombstones)
      })
    },
    forget(request: MemoryForgetRequest): Promise<void> {
      return enqueue(async () => {
        const { records, tombstones } = await read()
        const index = records.findIndex(record => record.id === request.id && inScope(record, request.scope))
        const found = records[index]
        if (found === undefined) return
        records.splice(index, 1)
        tombstones.push(tombstoneFor(found, request.principal))
        await write(records, tombstones)
      })
    },
    supersede(request: MemorySupersedeRequest): Promise<void> {
      return enqueue(async () => {
        const { records, tombstones } = await read()
        const winnerIndex = records.findIndex(record => record.id === request.id && inScope(record, request.scope))
        const loserIndex = records.findIndex(record => record.id === request.supersedes && inScope(record, request.scope))
        const { winner, loser } = supersedeInto(
          requireFound(records[winnerIndex], request.id),
          requireFound(records[loserIndex], request.supersedes),
        )
        records[winnerIndex] = winner
        records[loserIndex] = loser
        await write(records, tombstones)
      })
    },
    merge(request: MemoryMergeRequest): Promise<void> {
      return enqueue(async () => {
        authorizeMerge(request)
        const { records, tombstones } = await read()
        const intoIndex = records.findIndex(record => record.id === request.into.id && inScope(record, request.into.scope))
        const fromIndex = records.findIndex(record => record.id === request.from.id && inScope(record, request.from.scope))
        const { winner, loser } = supersedeInto(
          requireFound(records[intoIndex], request.into.id),
          requireFound(records[fromIndex], request.from.id),
        )
        records[intoIndex] = winner
        records[fromIndex] = loser
        await write(records, tombstones)
      })
    },
    erase(request: MemoryEraseRequest): Promise<void> {
      return enqueue(async () => {
        const { records, tombstones } = await read()
        const kept: DurableMemoryRecord[] = []
        for (const record of records) {
          if (matchesErasure(record, request)) tombstones.push(tombstoneFor(record, request.principal))
          else kept.push(record)
        }
        await write(kept, tombstones)
      })
    },
    countRebuiltAt(request: MemoryRebuiltCountRequest): Promise<number> {
      return enqueue(async () => countRebuiltRecords((await read()).records, request))
    },
    export(request: MemoryExportRequest): Promise<MemoryExportResult> {
      return enqueue(async () => {
        const { records, tombstones } = await read()
        const { scope } = request.accessContext
        return buildExportResult(visible(records, scope), tombstones.filter(tombstone => inScope(tombstone, scope)))
      })
    },
    listPending(request: MemoryListPendingRequest): Promise<MemoryListPendingResult> {
      return enqueue(async () => ({
        records: pendingViews((await read()).records, request.accessContext.scope),
        truncated: false,
      }))
    },
    approve(request: MemoryReviewRequest): Promise<void> {
      return enqueue(async () => {
        const { records, tombstones } = await read()
        const index = records.findIndex(record => record.id === request.id && inScope(record, request.scope))
        records[index] = reviewTransition(records[index], request.id, 'active')
        await write(records, tombstones)
      })
    },
    reject(request: MemoryReviewRequest): Promise<void> {
      return enqueue(async () => {
        const { records, tombstones } = await read()
        const index = records.findIndex(record => record.id === request.id && inScope(record, request.scope))
        records[index] = reviewTransition(records[index], request.id, 'rejected')
        await write(records, tombstones)
      })
    },
  }
}

/** Basename of the JSON document {@link createDurableFileMemoryProvider} keeps in its directory. */
const DURABLE_FILE_MEMORY_FILENAME = 'memory.json'

/** The on-disk format version {@link createDurableFileMemoryProvider} reads and writes. */
// Bumped to 2 when stored records gained `provenance` and `confidence`, and to 3
// when they gained `createdAt`, `validFrom`, `validUntil`, `status` and
// `relations`. A document at an older version describes records this build
// cannot read without inventing those fields, so the reader refuses it by name
// rather than reading them as if their values were simply absent — the
// pre-release stance is that a backend rejects an old on-disk format (AGENTS.md),
// not that it guesses at one. The third slice's `tombstones` did NOT bump the
// version: it is a new top-level list, not a per-record field, so a version-3
// document that predates it is complete — it simply forgot nothing — and reads
// back with no tombstones rather than with a fabricated value.
const DURABLE_FILE_MEMORY_FORMAT_VERSION = 3

/**
 * How many of `records` sit at one workspace path under some OTHER identity.
 *
 * Counted, never returned: the records belong to the directory this one
 * displaced, and handing any of them back would make this a way around the
 * scope check. Tenant scoping still applies, so this cannot count across
 * tenants either.
 * @param records - every record the provider holds.
 * @param request - the path, the current identity, and the reader's context.
 * @returns the number of matching records.
 */
function countRebuiltRecords(
  records: readonly ScopedMemoryRecord[],
  request: MemoryRebuiltCountRequest,
): number {
  return records.filter(record =>
    record.scope.tenantId === request.accessContext.scope.tenantId
    && record.scope.workspace?.canonicalPath === request.canonicalPath
    && record.scope.workspace.identity !== request.currentIdentity).length
}

/**
 * The origin fields one proposal stores, with the confidence rule applied once.
 *
 * `user-asserted` is confidence 1 **by the vocabulary's definition** — a named
 * party said it — and `derived` carries the number its writer stated, which the
 * request type makes mandatory. Neither branch invents a value, and the rule
 * lives here rather than in each provider so three providers cannot drift into
 * three different defaults.
 * @param request - the proposal as its caller stated it.
 * @returns the provenance and confidence to store on the record.
 */
function originOf(origin: MemoryClaimOrigin): { provenance: MemoryProvenance; confidence: number } {
  if (origin.kind === 'user-asserted') return { provenance: origin, confidence: 1 }
  const { confidence, ...provenance } = origin
  return { provenance, confidence }
}

/**
 * One stored record: the reader's projection plus the scope its `propose()`
 * carried. Every provider in this module stores the proposing scope, because
 * scope enforcement lives inside the provider: `MemoryRecordView` carries no
 * tenant, so {@link MemoryRuntime} has nothing to filter a returned record
 * against and cannot bound a read on the provider's behalf.
 */
interface ScopedMemoryRecord extends MemoryRecordView {
  readonly scope: MemoryScope
  /**
   * Where the claim came from, as the proposer stated it (P6-02's vocabulary).
   *
   * Stored rather than derived: origin is a fact about the write, and a reader
   * that had to infer it later would be guessing. {@link MemoryRuntime.propose}
   * refuses an untraceable claim before any provider is reached, so a stored
   * origin is one that traces somewhere.
   *
   * This sentence used to name `validateRecord` and was false of the path it
   * sits on: that function had no caller, `propose` reached no check at all,
   * and an empty source list was accepted and written.
   */
  readonly provenance: MemoryProvenance
  /**
   * The writer's confidence in [0, 1].
   *
   * Taken from the request for a `derived` claim and fixed at 1 for a
   * `user-asserted` one, which is the vocabulary's definition rather than a
   * default this provider chose. Nothing here invents a number: a confidence
   * the writer never stated would be a fabricated fact in durable data.
   */
  readonly confidence: number
  /** RFC 3339 UTC instant this record was written: the same clock read `updatedAt` takes, at the same point. */
  readonly createdAt: string
  /**
   * RFC 3339 UTC instant the claim became true.
   *
   * The write's own instant, which is not a guess: it is the only moment the
   * writer can be said to have asserted the claim. A caller who means an
   * earlier one states it through P6-03's proposal layer, not by having this
   * one invented for them.
   */
  readonly validFrom: string
  /** When the claim stops being true, or `null` for open-ended — which is what an unstated TTL means. */
  readonly validUntil: string | null
  /** The only status a record can be born in; every other value is a transition out of it. */
  readonly status: MemoryStatus
  /** Empty by truth for a newly proposed record: relations are minted by a conflict, never by a proposal. */
  readonly relations: readonly MemoryRelation[]
  /** Present only when the caller stated it; see {@link MemoryProposeRequestBase.kind}. */
  readonly kind?: MemoryKind
  /** Present only when the caller stated it. */
  readonly subject?: MemorySubject
  /** The WRITER's purpose, present only when stated; a reader's purpose is a different fact. */
  readonly purpose?: string
  /** Present only when the caller assessed it; absence is not `normal` (must[2]). */
  readonly sensitivity?: MemorySensitivity
}

/**
 * Every field a proposal determines, built once so three providers cannot
 * drift into three different answers.
 *
 * The split this function encodes is P6-02 OQ19's measurement: five fields the
 * write itself supplies and four it cannot. `createdAt`, `validFrom`,
 * `validUntil`, `status` and `relations` are derived with nothing invented —
 * the clock this write already reads, the instant the claim was asserted,
 * `null` for the open-ended claim an unstated TTL means, the only status a
 * record can be born in, and the empty relation list a proposal truthfully
 * has. `kind`, `subject`, `purpose` and `sensitivity` are spread in ONLY when
 * stated, so an unstated one is absent from the document rather than carrying
 * a value nobody chose.
 * @param request - the proposal as its caller stated it.
 * @param status - the record's initial status; `active` unless the proposal policy sent it to review (`pending`).
 * @returns every stored field but the id.
 */
function recordFieldsFor(request: MemoryProposeRequest, status: MemoryStatus = 'active'): Omit<ScopedMemoryRecord, 'id'> {
  const now = new Date().toISOString()
  return {
    principal: request.principal,
    content: request.content,
    updatedAt: now,
    createdAt: now,
    validFrom: now,
    validUntil: request.validUntil ?? null,
    status,
    relations: [],
    scope: request.scope,
    ...originOf(request.origin),
    ...request.kind === undefined ? {} : { kind: request.kind },
    ...request.subject === undefined ? {} : { subject: request.subject },
    ...request.purpose === undefined ? {} : { purpose: request.purpose },
    ...request.sensitivity === undefined ? {} : { sensitivity: request.sensitivity },
  }
}

/**
 * The pending proposals `scope` may see, as views — the shared body of every
 * provider's `listPending`. A record is listable when it is held for review
 * (`status === 'pending'`) and in scope; the view drops its status like every
 * other read.
 * @param records - the provider's stored records.
 * @param scope - the listing access context's scope.
 * @returns the pending records' views, in stored order.
 */
function pendingViews(records: Iterable<ScopedMemoryRecord>, scope: MemoryScope): MemoryRecordView[] {
  return [...records].filter(record => record.status === 'pending' && inScope(record, scope)).map(toRecordView)
}

/**
 * The record a review decision produces, or the {@link MemoryError} it raises —
 * the shared body of every provider's `approve`/`reject`. `existing` is the
 * in-scope record the id names, or `undefined` when the scope may not see it or
 * nothing was proposed; an out-of-scope id is indistinguishable from an unknown
 * one. Only a `pending` record can be decided; any other status is already
 * decided and is refused rather than re-decided.
 * @param existing - the in-scope record the id names, or `undefined`.
 * @param id - the id the caller named, for the error text.
 * @param status - the status the decision moves it to (`active` for approve, `rejected` for reject).
 * @returns the transitioned record to store.
 */
function reviewTransition(existing: ScopedMemoryRecord | undefined, id: MemoryRecordId, status: 'active' | 'rejected'): ScopedMemoryRecord {
  if (existing === undefined) {
    throw new MemoryError(`memory record "${id}" was never proposed`, 'MEMORY_RECORD_NOT_FOUND')
  }
  if (existing.status !== 'pending') {
    throw new MemoryError(`memory record "${id}" is not held for review`, 'MEMORY_NOT_PENDING')
  }
  return { ...existing, status, updatedAt: new Date().toISOString() }
}

/** One persisted record. Identical to {@link ScopedMemoryRecord}; named apart for the on-disk document. */
type DurableMemoryRecord = ScopedMemoryRecord

/** The JSON document {@link createDurableFileMemoryProvider} keeps at its path. */
interface DurableMemoryDocument {
  readonly version: number
  readonly records: readonly DurableMemoryRecord[]
  /**
   * The forgotten records' tombstones. Absent when nothing has been forgotten,
   * so a store an earlier build wrote — and one this build never forgot from —
   * carries no `tombstones` field; a reader treats its absence as none.
   */
  readonly tombstones?: readonly StoredTombstone[]
}

/**
 * Whether a read or write confined to `scope` may see `item` (`must[3]`).
 *
 * Takes anything carrying a `scope` — a stored record or a tombstone — so the
 * same boundary rule applies to both: an export lists a forgotten record's
 * tombstone under exactly the scopes that could have seen the record.
 */
function inScope(item: { readonly scope: MemoryScope }, scope: MemoryScope): boolean {
  const record = item
  if (record.scope.tenantId !== scope.tenantId) return false
  // Matched on IDENTITY, never on path: a directory replaced in place is a
  // different directory, and a reader in it must not inherit what the one it
  // displaced wrote. A reader naming no workspace is not thereby given every
  // workspace's records — it sees only records written without one, because
  // the alternative makes "omit the field" a way to read across the boundary.
  if (record.scope.workspace?.identity !== scope.workspace?.identity) return false
  // A scope naming no sessionId sees every session within the tenant.
  return scope.sessionId === undefined || record.scope.sessionId === scope.sessionId
}

/** Strip the stored scope, leaving exactly the reader-visible projection. */
function toRecordView(record: ScopedMemoryRecord): MemoryRecordView {
  return { id: record.id, principal: record.principal, content: record.content, updatedAt: record.updatedAt }
}

/**
 * One forgotten record's tombstone, as a provider stores it: the reader-visible
 * {@link MemoryTombstoneView} plus the scope the record lived in, so an export
 * lists it under exactly the scopes that could have seen the record.
 */
interface StoredTombstone extends MemoryTombstoneView {
  readonly scope: MemoryScope
}

/** The tombstone a `forget`/`erase` leaves for `record`, minted now by `principal`. */
function tombstoneFor(record: ScopedMemoryRecord, principal: Principal): StoredTombstone {
  return { id: record.id, forgottenAt: new Date().toISOString(), forgottenBy: principal, scope: record.scope }
}

/** The reader-visible tombstone — the id, when it was forgotten, and who forgot it, never the content. */
function toTombstoneView(tombstone: StoredTombstone): MemoryTombstoneView {
  return { id: tombstone.id, forgottenAt: tombstone.forgottenAt, forgottenBy: tombstone.forgottenBy }
}

/** The export projection: the reader view plus the source and conflict status a bulk read carries (acceptance[2]). */
function toExportedRecord(record: ScopedMemoryRecord): MemoryExportedRecord {
  return { ...toRecordView(record), provenance: record.provenance, status: record.status, relations: record.relations }
}

/**
 * Build one export result from the records and tombstones a scope may see.
 * `tombstones` is present only when there is at least one, so an export of a
 * store nothing was forgotten from is exactly `{ records, truncated }`.
 * @param records - the in-scope records.
 * @param tombstones - the in-scope tombstones.
 * @returns the export result.
 */
function buildExportResult(records: readonly ScopedMemoryRecord[], tombstones: readonly StoredTombstone[]): MemoryExportResult {
  const views = tombstones.map(toTombstoneView)
  return { records: records.map(toExportedRecord), truncated: false, ...(views.length > 0 ? { tombstones: views } : {}) }
}

/**
 * The in-scope record `id` names, or the {@link MemoryError} a supersede or
 * merge raises for a missing one — an out-of-scope id is indistinguishable
 * from one never proposed.
 * @param record - the in-scope record the id names, or `undefined`.
 * @param id - the id the caller named, for the error text.
 * @returns the record.
 */
function requireFound(record: ScopedMemoryRecord | undefined, id: MemoryRecordId): ScopedMemoryRecord {
  if (record === undefined) {
    throw new MemoryError(`memory record "${id}" was never proposed`, 'MEMORY_RECORD_NOT_FOUND')
  }
  return record
}

/**
 * Record that `winner` supersedes `loser` WITHOUT overwriting either (must[1]),
 * for the stored projection: `winner` gains a `supersedes` relation to `loser`
 * and `loser` is marked `superseded`. Mirrors `record.ts`'s `recordConflict`,
 * which is typed for P6-02's canonical `MemoryRecord` rather than this
 * provisional stored shape; both encode the same no-overwrite rule.
 * @param winner - the record that supersedes the other.
 * @param loser - the record it supersedes.
 * @returns both records, updated; neither input is mutated.
 */
function supersedeInto(
  winner: ScopedMemoryRecord,
  loser: ScopedMemoryRecord,
): { readonly winner: ScopedMemoryRecord; readonly loser: ScopedMemoryRecord } {
  const relation: MemoryRelation = { kind: 'supersedes', target: loser.id }
  return {
    winner: { ...winner, relations: [...winner.relations, relation] },
    loser: { ...loser, status: 'superseded' },
  }
}

/**
 * Authorize a merge, or throw `MEMORY_MERGE_NOT_AUTHORIZED` (P6-02
 * acceptance[2]) before either record changes. A same-scope merge is always
 * permitted; a cross-scope one needs an authorization naming both scopes.
 * @param request - the merge whose scope pair and authorization to judge.
 */
function authorizeMerge(request: MemoryMergeRequest): void {
  const decision = decideCrossScopeMerge(request.from.scope, request.into.scope, request.authorization)
  if (!decision.permitted) {
    throw new MemoryError(`memory merge across scopes is not authorized: ${decision.reason}`, 'MEMORY_MERGE_NOT_AUTHORIZED')
  }
}

/**
 * Whether `erase` reaches `record`: same tenant, same subject, in any session
 * or workspace of that tenant. Right-to-erasure is bounded to the tenant the
 * requester names — a subject in another tenant, or a different subject, stays.
 * @param record - a stored record.
 * @param request - the erasure's tenant and subject.
 * @returns whether the erasure forgets this record.
 */
function matchesErasure(record: ScopedMemoryRecord, request: MemoryEraseRequest): boolean {
  return record.scope.tenantId === request.tenantId && record.subject === request.subject
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
