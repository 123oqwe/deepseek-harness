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
export interface MemoryProposeRequest {
  readonly principal: Principal
  readonly scope: MemoryScope
  /** Opaque candidate content; the canonical structured shape is P6-02's job. */
  readonly content: unknown
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

/** Result of `export()`. `truncated` mirrors {@link MemoryQueryResult.truncated}. */
export interface MemoryExportResult {
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
  propose(request: MemoryProposeRequest): Promise<MemoryProposeResult>
  query(request: MemoryQueryRequest): Promise<MemoryQueryResult>
  get(request: MemoryGetRequest): Promise<MemoryRecordView | undefined>
  revise(request: MemoryReviseRequest): Promise<void>
  forget(request: MemoryForgetRequest): Promise<void>
  export(request: MemoryExportRequest): Promise<MemoryExportResult>
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
  }
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
