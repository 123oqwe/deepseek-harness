/**
 * Vocabulary for the provider-neutral Memory capability seam (`ctx.memory`,
 * first100 registry P6-01): propose/query/get/revise/forget/export requests
 * and results, the `MemoryProvider` a backend implements, and the
 * `memory/access` durable session event. Deliberately silent on retrieval
 * mechanism (embedding similarity, graph traversal, keyword search, ...) —
 * `must[0]` forbids naming a vector-db or graph-db here; a provider picks its
 * own mechanism behind {@link MemoryProvider.query}.
 *
 * `MemoryRecordView` is a provisional, minimal projection sufficient for
 * Contract-stage conformance only. The canonical `MemoryRecord` (content
 * artifact/ref, kind, subject, source events, confidence, TTL, sensitivity,
 * status, supersedes/disputes relations) is first100 registry P6-02's job in
 * a later wave and supersedes this shape; this module must not anticipate it.
 * `MemoryProposeRequest`/`MemoryReviseRequest` are likewise silent on
 * evidence, TTL, and sensitivity policy — P6-03 owns proposal validation and
 * conflict/merge policy.
 * @module @deepseek-ai/dsh-memory/types
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Principal, TenantId } from '@deepseek-ai/dsh-principal'
import type {} from '@deepseek-ai/dsh-session/types'
import type { MemoryKind, MemoryProvenance, MemoryRelation, MemorySensitivity, MemoryStatus, MemorySubject } from './record.ts'

/** Stable identity of one durable memory record, unique within its tenant. */
export type MemoryRecordId = Branded<'MemoryRecordId'>

/**
 * Brand a string as a {@link MemoryRecordId}.
 * @param id - the raw id string, always minted by a provider from `propose()`, never supplied by a caller.
 * @returns the same string with the memory-record-id brand.
 */
export function MemoryRecordId(id: string): MemoryRecordId {
  return brandString<MemoryRecordId>(id)
}

/**
 * The read/write boundary a memory operation is confined to. `tenantId` is
 * mandatory — cross-tenant reads and writes are rejected by the seam, never
 * merely by provider convention. `sessionId`, when present, further narrows
 * to one session within the tenant.
 */
export interface MemoryScope {
  readonly tenantId: TenantId
  readonly sessionId?: string
  /**
   * The workspace a record belongs to; absent means the record predates
   * workspace scoping or was written by a caller that has no workspace.
   *
   * Present on every read a workspace-bound consumer makes, so one tenant's
   * workspaces do not share a pool: memory recalled in one project is content
   * that project's own sessions wrote.
   */
  readonly workspace?: WorkspaceMemoryScope
}

/**
 * Which workspace directory a record belongs to, as two values that answer
 * different questions.
 *
 * `identity` is what a record is MATCHED on, and it is the directory's
 * filesystem identity rather than its name: a directory replaced in place is a
 * different directory, and inheriting the memories of the one it displaced
 * would hand a new project's contents to whoever now owns that path.
 *
 * `canonicalPath` is kept beside it so a rebuilt workspace can be RECOGNIZED
 * rather than silently forgotten — same path, different identity is the shape
 * of a re-cloned repository, and a consumer that can see it can say so instead
 * of presenting an empty memory as though nothing was ever written.
 *
 * Held as opaque strings rather than as `@deepseek-ai/dsh-workspace`'s
 * `WorkspaceIdentity` so this package stays free of the workspace package:
 * the caller observes the identity and supplies it, exactly as
 * `@deepseek-ai/dsh-retry`'s `chargedRun` takes a caller-supplied lookup
 * rather than importing the agent registry.
 */
export interface WorkspaceMemoryScope {
  /** The directory's resolved path, for recognizing a rebuild — never for matching. */
  readonly canonicalPath: string
  /** The directory's filesystem identity; two records match only when these are equal. */
  readonly identity: string
}

/**
 * Caller-supplied bound on how much a read may return. Present on every read
 * request so a provider — whatever its retrieval mechanism — has a uniform
 * signal for how much to return; enforcement of the bound is the seam's job,
 * mirroring `WebSearchRequest.maxResults` (`@deepseek-ai/dsh-web`).
 */
export interface MemoryContextBudget {
  /** Upper bound on returned records; the seam truncates to it. */
  readonly maxRecords?: number
  /** Upper bound on estimated token cost of returned content. */
  readonly maxTokens?: number
}

/**
 * The four dimensions `must[3]` requires on every memory read: who is
 * reading (`principal`), why (`purpose`), within what boundary (`scope`),
 * and under what size bound (`contextBudget`). Carried by `query`, `get`, and
 * `export` — the seam rejects a read whose access context is incomplete.
 */
export interface MemoryAccessContext {
  readonly principal: Principal
  /** Open string naming why this read is happening (e.g. `'recall'`, `'consolidation'`); no fixed taxonomy at Contract stage. */
  readonly purpose: string
  readonly scope: MemoryScope
  readonly contextBudget: MemoryContextBudget
}

/**
 * A candidate write. `propose` is the ONLY mutation entry point a model-facing
 * caller has — there is no separate `write`/`set`/`put` verb, so a durable
 * memory record can never originate outside this path (`acceptance[1]`).
 * Evidence, TTL, and sensitivity classification are P6-03's proposal-policy
 * layer, not this request.
 */
export interface MemoryProposeRequestBase {
  readonly principal: Principal
  readonly scope: MemoryScope
  /** Opaque candidate content; the canonical structured shape is P6-02's job. */
  readonly content: unknown
  /**
   * When the claim stops being true, as its WRITER states it.
   *
   * RFC 3339 UTC for a bounded claim, or `null` for one the writer states is
   * open-ended ("no expiry"). Both are STATED. Omitting `validUntil` is NOT the
   * same as `null`: an omitted TTL is unstated, and P6-03's proposal policy
   * (`must[0]`) holds a proposal that leaves it out for review rather than
   * treating silence as a chosen "never". On the stored record `null` means
   * open-ended.
   */
  readonly validUntil?: string | null
  /**
   * What kind of memory this is, when the caller knows.
   *
   * Optional because nothing on this path can derive it. A `kind` nobody chose
   * would be a fabricated fact in durable data, so an unstated one is absent
   * from the record rather than defaulted (P6-02 OQ19/OQ20).
   */
  readonly kind?: MemoryKind
  /** Who or what the claim is about, when the caller knows. Absent, never guessed — see {@link MemoryProposeRequestBase.kind}. */
  readonly subject?: MemorySubject
  /**
   * Why this record may be read, as its WRITER states it.
   *
   * A different fact from `MemoryAccessContext.purpose`, which is a reader's.
   * Filling this from the first reader's purpose would record that reader's
   * intent as the record's own, so an unstated write-purpose stays absent.
   */
  readonly purpose?: string
  /**
   * Whether the content is sensitive, when the caller has assessed it.
   *
   * The one optional field whose invented default would have a DIRECTION: a
   * record wrongly marked `normal` is one an index admits. Absence is
   * therefore not "normal" — a reader that must decide treats an unstated
   * sensitivity as not indexable (must[2]).
   */
  readonly sensitivity?: MemorySensitivity
}

/**
 * Where one proposed claim came from, and how sure its writer is.
 *
 * P6-02's `MemoryProvenance` vocabulary with the writer's confidence attached
 * to the branch that needs it, rather than a second origin spelling: `derived`
 * carries the events it was read from AND the confidence only its writer knows,
 * while `user-asserted` names a responsible party and is confidence 1 **by the
 * vocabulary's definition** — a person said it.
 *
 * Carried as one discriminated value so the type enforces the rule: there is no
 * way to state an inferred claim without its confidence, and no way to attach a
 * confidence to an asserted one. A provider defaulting a missing number instead
 * would write a confidence nobody stated into durable data.
 */
export type MemoryClaimOrigin =
  | (Extract<MemoryProvenance, { kind: 'derived' }> & {
    /** The writer's confidence in [0, 1]; required, because only the writer knows it. */
    readonly confidence: number
  })
  | Extract<MemoryProvenance, { kind: 'user-asserted' }>

/** A candidate write, carrying where its claim came from. */
export interface MemoryProposeRequest extends MemoryProposeRequestBase {
  readonly origin: MemoryClaimOrigin
}

/** Result of a successful `propose()`: the newly minted record's identity. */
export interface MemoryProposeResult {
  readonly id: MemoryRecordId
}

/** A free-text read request; the seam names no retrieval mechanism (`must[0]`). */
export interface MemoryQueryRequest {
  readonly accessContext: MemoryAccessContext
  readonly query: string
}

/** One record as returned to a reader — see this module's top-of-file note on scope. */
export interface MemoryRecordView {
  readonly id: MemoryRecordId
  readonly principal: Principal
  readonly content: unknown
  /** RFC 3339 UTC timestamp of the record's most recent write. */
  readonly updatedAt: string
}

/** Result of `query()`. `truncated` is set when the seam cut `records[]` down to `contextBudget.maxRecords`. */
export interface MemoryQueryResult {
  readonly records: readonly MemoryRecordView[]
  readonly truncated: boolean
}

/** Fetch one record by id. */
export interface MemoryGetRequest {
  readonly accessContext: MemoryAccessContext
  readonly id: MemoryRecordId
}

/** Update the content of an existing record. Rejected when `id` was never returned by a prior `propose()` (`acceptance[1]`). */
export interface MemoryReviseRequest {
  readonly principal: Principal
  readonly scope: MemoryScope
  readonly id: MemoryRecordId
  readonly content: unknown
}

/** Remove a record. Idempotent: forgetting an already-forgotten or unknown id does not throw. */
export interface MemoryForgetRequest {
  readonly principal: Principal
  readonly scope: MemoryScope
  readonly id: MemoryRecordId
}

/** Bulk-read every record currently visible to `accessContext`. */
export interface MemoryExportRequest {
  readonly accessContext: MemoryAccessContext
}

/**
 * One record as `export` returns it (P6-03 third slice, acceptance[2]).
 *
 * The reader-visible {@link MemoryRecordView} plus the source and conflict
 * status a bulk read carries: `provenance` (where the claim came from),
 * `status` (`active`, `superseded`, `disputed`, ...), and the `relations` a
 * supersede or merge recorded. `query`/`get` keep the bare view — a search hit
 * or a fetch by id answers "what does this record say", while an export answers
 * "what is in this store and how does it stand".
 *
 * The three are OPTIONAL, because a `MemoryProvider` is not forced to supply
 * them: a provider that returns only the bare {@link MemoryRecordView} (a
 * third-party backend, or a test stub) still satisfies `export`, and the
 * providers this package ships fill all three from the stored record. A reader
 * that needs them treats an absent field as unknown rather than as a fabricated
 * `active`/empty/user-asserted default the provider never stated.
 */
export interface MemoryExportedRecord extends MemoryRecordView {
  readonly provenance?: MemoryProvenance
  readonly status?: MemoryStatus
  readonly relations?: readonly MemoryRelation[]
}

/**
 * A forgotten record's marker in `export` (P6-03 third slice, acceptance[1]).
 *
 * `forget` and `erase` remove the record's content from the store and leave
 * this in its place: the id, when it was forgotten, and who forgot it — and
 * NONE of the content, so the tombstone is a compliant record of the erasure
 * rather than a copy of what was erased.
 */
export interface MemoryTombstoneView {
  readonly id: MemoryRecordId
  /** RFC 3339 UTC instant the record was forgotten. */
  readonly forgottenAt: string
  /** The principal that forgot it. */
  readonly forgottenBy: Principal
}

/**
 * Result of `export()`. `truncated` mirrors {@link MemoryQueryResult.truncated}.
 * `tombstones` lists the forgotten records the access context may see, and is
 * present only when there is at least one — an export of a store nothing was
 * forgotten from carries no `tombstones` field.
 */
export interface MemoryExportResult {
  readonly records: readonly MemoryExportedRecord[]
  readonly truncated: boolean
  readonly tombstones?: readonly MemoryTombstoneView[]
}

/**
 * Record that `id` supersedes `supersedes` (P6-03 third slice, must[3]).
 *
 * Both records persist: the newer (`id`) gains a `supersedes` relation to the
 * older (`supersedes`), and the older is marked `superseded` so the default
 * search stops returning it while export keeps both (must[1] — a conflict never
 * overwrites). Both ids must be records `scope` may see.
 */
export interface MemorySupersedeRequest {
  readonly principal: Principal
  readonly scope: MemoryScope
  /** The newer record, which supersedes the other. */
  readonly id: MemoryRecordId
  /** The older record it supersedes. */
  readonly supersedes: MemoryRecordId
}

/** One end of a merge: the record to move and the scope it belongs to. */
export interface MemoryMergeEnd {
  readonly scope: MemoryScope
  readonly id: MemoryRecordId
}

/**
 * Merge `from` into `into` (P6-03 third slice, must[3]).
 *
 * `into` (the survivor) gains a relation to `from` (the merged), which is
 * marked so the default search returns only the survivor while export keeps
 * both. A merge that stays within one scope needs no authorization; one that
 * crosses scopes needs an `authorization` naming both, and without it is
 * refused with `MEMORY_MERGE_NOT_AUTHORIZED` before either record changes
 * (P6-02 acceptance[2]).
 */
export interface MemoryMergeRequest {
  readonly principal: Principal
  readonly from: MemoryMergeEnd
  readonly into: MemoryMergeEnd
  readonly authorization?: CrossScopeMergeAuthorization
}

/**
 * Erase every record about `subject` in `tenantId` (P6-03 third slice,
 * must[3] right-to-erasure).
 *
 * Forgets each matching record as `forget` forgets one — content removed, a
 * tombstone left — in every session and workspace of the tenant. Records about
 * another subject, or in another tenant, are untouched: the erasure is bounded
 * to the tenant the requester names.
 */
export interface MemoryEraseRequest {
  readonly principal: Principal
  readonly tenantId: TenantId
  readonly subject: MemorySubject
}

/** Name one proposal held for review, as `forget` names a record (P6-03 second slice). */
export interface MemoryReviewRequest {
  readonly principal: Principal
  readonly scope: MemoryScope
  readonly id: MemoryRecordId
}

/** List the proposals held for review that `accessContext` may see (P6-03 second slice). */
export interface MemoryListPendingRequest {
  readonly accessContext: MemoryAccessContext
}

/** Result of `listPending()`. `truncated` mirrors {@link MemoryQueryResult.truncated}. */
export interface MemoryListPendingResult {
  readonly records: readonly MemoryRecordView[]
  readonly truncated: boolean
}

/**
 * A memory-capable backend. Registered with `ctx.memory.registerProvider`.
 * `id` is a stable string, unique within the registry. Every method's
 * request/result vocabulary is defined above and is provider-neutral: an
 * implementation is free to use embeddings, a graph store, plain-text
 * matching, or anything else behind `query`.
 */
export interface MemoryProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /**
   * Store a candidate write and return its minted id. `status` is the record's
   * initial status the service decided from the proposal policy; omitted means
   * `active` (the pre-P6-03 behaviour). A `pending` record is stored but not
   * `active`, so it is withheld from retrieval until a reviewer approves it.
   */
  propose(request: MemoryProposeRequest, status?: MemoryStatus): Promise<MemoryProposeResult>
  query(request: MemoryQueryRequest): Promise<MemoryQueryResult>
  get(request: MemoryGetRequest): Promise<MemoryRecordView | undefined>
  revise(request: MemoryReviseRequest): Promise<void>
  /**
   * Remove a record and leave a tombstone (P6-03 third slice, acceptance[1]).
   * The content is removed from the store — a later reader, a second instance
   * over the same store, the default search and `export` no longer return it —
   * and `export` lists a {@link MemoryTombstoneView} in its place. Idempotent:
   * an out-of-scope or unknown id changes nothing.
   */
  forget(request: MemoryForgetRequest): Promise<void>
  /**
   * Record that one record supersedes another (P6-03 third slice, must[3]).
   * Both records must be in `request.scope`; an out-of-scope or unknown id
   * raises `MEMORY_RECORD_NOT_FOUND`.
   */
  supersede(request: MemorySupersedeRequest): Promise<void>
  /**
   * Merge one record into another (P6-03 third slice, must[3]). A cross-scope
   * merge without an `authorization` naming both scopes raises
   * `MEMORY_MERGE_NOT_AUTHORIZED` before either record changes; a missing
   * endpoint raises `MEMORY_RECORD_NOT_FOUND`.
   */
  merge(request: MemoryMergeRequest): Promise<void>
  /**
   * Forget every record about `request.subject` in `request.tenantId`, in every
   * session and workspace of that tenant (P6-03 third slice, must[3]
   * right-to-erasure). Each is removed and tombstoned as {@link MemoryProvider.forget}
   * removes one.
   */
  erase(request: MemoryEraseRequest): Promise<void>
  export(request: MemoryExportRequest): Promise<MemoryExportResult>
  /**
   * The proposals held for review (`pending`) that `request.accessContext` may
   * see; scoped like `query`. The write path holds a proposal when the policy
   * sends it to review (`must[1]`/`must[2]`) or finds it incomplete (`must[0]`).
   */
  listPending(request: MemoryListPendingRequest): Promise<MemoryListPendingResult>
  /**
   * Admit a held (`pending`) proposal to active memory. Rejected when `id` is
   * not a `pending` record `request.scope` may see: an out-of-scope or unknown
   * id raises `MEMORY_RECORD_NOT_FOUND`, an already-decided one `MEMORY_NOT_PENDING`.
   */
  approve(request: MemoryReviewRequest): Promise<void>
  /**
   * Refuse a held (`pending`) proposal, which then never becomes active. Same
   * rejections as {@link MemoryProvider.approve}.
   */
  reject(request: MemoryReviewRequest): Promise<void>
  /**
   * How many records this workspace PATH holds under a different filesystem
   * identity — a directory rebuilt in place, most often a re-cloned repository.
   *
   * The only read in this seam that deliberately crosses the workspace
   * boundary, and it is a REPORTING channel rather than a retrieval one: it
   * returns a count and nothing else, so a caller can say "this workspace looks
   * rebuilt; its earlier memory is still on disk" without being handed a single
   * record's content or id. Records belonging to the displaced directory stay
   * unreadable, which is the boundary {@link MemoryScope.workspace} exists to
   * draw — adopting them is a decision for a person, and importing them is
   * P6-03's.
   *
   * A caller that could read them would make this a way around the scope
   * check, which is why the return type is a number and not a record list.
   * @param request - the path to look under, the identity to exclude, and the
   *   access context the read happens within.
   * @returns the number of records at that path under any other identity.
   */
  countRebuiltAt(request: MemoryRebuiltCountRequest): Promise<number>
}

/** A count of records left by a previous occupant of one workspace path. */
export interface MemoryRebuiltCountRequest {
  readonly accessContext: MemoryAccessContext
  /** The resolved directory path to look under. */
  readonly canonicalPath: string
  /** The identity in use NOW; records carrying it are the caller's own and are not counted. */
  readonly currentIdentity: string
}

/**
 * Typed memory error with a machine-routable, open-string `code` and chained
 * `cause`. Consumers must tolerate provider-specific codes. Shared codes
 * cover unavailable/missing/unusable/ambiguous/duplicate providers, an
 * incomplete access context, and an id that was never returned by `propose()`.
 */
export class MemoryError extends HarnessError {}

/**
 * The durable, log-only event recorded for each memory operation
 * (`must[0]`'s "events" half). A closed discriminated union on `operation`;
 * `query`/`get`/`export` carry the complete {@link MemoryAccessContext} so the
 * read-scoping invariant (`must[3]`, enforced by `../invariant.ts`) is
 * reconstructable from the log alone, never only from in-memory state.
 */
export type MemoryAccessEvent =
  | { readonly operation: 'propose'; readonly principal: Principal; readonly id: MemoryRecordId }
  | { readonly operation: 'query'; readonly accessContext: MemoryAccessContext; readonly resultCount: number; readonly truncated: boolean }
  | { readonly operation: 'get'; readonly accessContext: MemoryAccessContext; readonly id: MemoryRecordId; readonly found: boolean }
  | { readonly operation: 'revise'; readonly principal: Principal; readonly id: MemoryRecordId }
  | { readonly operation: 'forget'; readonly principal: Principal; readonly id: MemoryRecordId }
  | { readonly operation: 'export'; readonly accessContext: MemoryAccessContext; readonly resultCount: number }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records one operation performed through the Memory seam (`ctx.memory`).
     * Log-only: it does not participate in message reconstruction. The
     * payload is a {@link MemoryAccessEvent}, discriminated on `operation` —
     * `query`/`get`/`export` carry the complete {@link MemoryAccessContext}
     * (`principal`, `purpose`, `scope`, `contextBudget`) plus how much the
     * read returned, while `propose`/`revise`/`forget` carry the acting
     * principal and the record id. A read whose result reached a model
     * request is always accompanied by this event, so memory content the
     * model saw stays reconstructable from the log alone (first100 registry
     * P6-01 validation[3]).
     */
    'memory/access': MemoryAccessEvent
    /**
     * Records that this session's workspace PATH holds memory written under a
     * different filesystem identity — the shape of a re-cloned or rebuilt
     * directory. Log-only, and **not model-visible**: it reports a fact about
     * storage, not content the model may read.
     *
     * Emitted once per session, on the first recall that actually happens, and
     * only when the count is above zero: a session whose workspace was never
     * displaced must not announce a rebuild. The payload carries the count and
     * the path and **never a record's content or id** — those belong to the
     * directory this one displaced, and reading them is the boundary
     * {@link MemoryScope.workspace} draws.
     *
     * This event is `MemoryProvider.countRebuiltAt`'s only consumer. Without
     * it that method would be a reporting channel nothing reports through,
     * which is the built-and-unread shape this program keeps finding.
     */
    'memory/workspace-rebuilt': MemoryWorkspaceRebuiltEvent
  }
}

/**
 * One session's notice that its workspace path holds earlier memory under a
 * different identity.
 *
 * A count and a path, deliberately: enough for a consumer to say the earlier
 * memory is still on disk, and not enough to read any of it.
 */
export interface MemoryWorkspaceRebuiltEvent {
  /** The resolved directory path both identities share. */
  readonly canonicalPath: string
  /** How many records the displaced directory left; always above zero when this is emitted. */
  readonly count: number
}

/**
 * Why a cross-scope merge was refused (Epic P6-02 acceptance[2]).
 *
 * A merge that stays inside one scope needs no authorization. One that
 * crosses scopes moves a record out of the boundary it was written under, so
 * it must be asked for by name — never inferred from the fact that two
 * records happen to be mergeable.
 */
export type CrossScopeDenialReason =
  /** The merge crosses tenants and no explicit authorization accompanied it. */
  | 'cross-tenant-not-authorized'
  /** The merge crosses sessions within a tenant, unauthorized. */
  | 'cross-session-not-authorized'
  /** Authorization was supplied, but for a different scope pair than the one attempted. */
  | 'authorization-scope-mismatch'

/**
 * A caller's explicit request to merge across a scope boundary.
 *
 * Names BOTH endpoints. An authorization naming only a destination would
 * authorize a merge from anywhere into it, which is the widening the clause
 * exists to prevent.
 */
export interface CrossScopeMergeAuthorization {
  readonly from: MemoryScope
  readonly into: MemoryScope
  /** Who authorized it, for the audit record. */
  readonly authorizedBy: string
}

/** The outcome of deciding one merge. */
export type CrossScopeMergeDecision =
  | { readonly permitted: true; readonly crossesScope: boolean }
  | { readonly permitted: false; readonly reason: CrossScopeDenialReason }
