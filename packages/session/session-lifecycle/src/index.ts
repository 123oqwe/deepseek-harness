/**
 * Epic P6-07's session-lifecycle listing and
 * corrupted-log partial recovery: must[0]'s tenant/workspace/status/time
 * filters and cursor-paginated listing (acceptance[0]'s no-omission/
 * no-duplication pagination guarantee), and acceptance[3]'s
 * minimal-recoverable-range-plus-evidence corrupted-log read. Also the
 * package's public barrel, re-exporting `./retention.ts`'s taxonomy
 * (must[1]/acceptance[1]) and `./delete.ts`'s propagation surface
 * (must[2]/acceptance[2]).
 *
 * **Grounding: `SessionLifecycleCursor` is package-local, not a reuse of
 * `@deepseek-ai/dsh-session-query`'s `SessionSearchCursor`.** That brand's
 * opaque encoding is owned by full-text-search result pagination (ranked
 * hits, provider-side query state) — a different pagination stream from this
 * epic's tenant/workspace/status/time-filtered listing, which has no
 * relevance ranking at all and paginates over a stable sort key instead
 * (see `listSessions`'s doc comment). Reusing the same brand for both would
 * let a caller pass a session-search cursor into `listSessions` (or vice
 * versa) without a type error, even though the two encodings are never
 * interchangeable — exactly the kind of confusable-brand mistake this
 * repository's branded-type convention exists to prevent. `session-query`'s
 * `cursor.ts` is unchanged: its existing shape (an opaque branded string
 * with a single mint function) informs this package-local mint.
 *
 * @module @deepseek-ai/dsh-session-lifecycle
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionDisposition, SessionLifecycleRecord } from './retention.ts'

export * from './retention.ts'
export * from './delete.ts'

/**
 * Opaque continuation token for `listSessions` (must[0]/acceptance[0]). See
 * this module's top-of-file grounding note for why this is package-local
 * rather than a reuse of `@deepseek-ai/dsh-session-query`'s `SessionSearchCursor`.
 */
export type SessionLifecycleCursor = Branded<'SessionLifecycleCursor'>

/**
 * Brand a string as a {@link SessionLifecycleCursor}.
 * @param value - provider-produced opaque continuation value, from a prior page's `nextCursor` only.
 * @returns the same string with the session-lifecycle-cursor brand.
 */
export function SessionLifecycleCursor(value: string): SessionLifecycleCursor {
  return brandString<SessionLifecycleCursor>(value)
}

/**
 * must[0]'s closed set of filter clauses `listSessions` ANDs together,
 * mirroring `@deepseek-ai/dsh-session-query`'s `kind`-discriminated filter
 * idiom (`SessionResultFilter`). `'status'` filters by
 * {@link SessionDisposition}'s `kind` discriminant — legal hold is
 * deliberately not a filterable status value here, since it is an
 * independent marker, not a disposition (see `./retention.ts`'s top-of-file
 * grounding note).
 */
export type SessionLifecycleFilter =
  | { readonly kind: 'tenant'; readonly values: readonly TenantId[] }
  | { readonly kind: 'workspace'; readonly values: readonly WorkspaceId[] }
  | { readonly kind: 'status'; readonly values: readonly SessionDisposition['kind'][] }
  | { readonly kind: 'time'; readonly from?: number; readonly to?: number }

/** acceptance[0]'s cursor-paginated listing request. */
export interface SessionListPageRequest {
  /** Clauses ANDed together; an absent or empty array admits every record. */
  readonly filters?: readonly SessionLifecycleFilter[]
  /** Maximum records in this page. */
  readonly limit?: number
  /** Opaque continuation cursor, from a prior page's `nextCursor` only. */
  readonly cursor?: SessionLifecycleCursor
}

/** acceptance[0]'s one page of listing results. */
export interface SessionListPage {
  readonly items: readonly SessionLifecycleRecord[]
  /** Opaque continuation cursor, absent on the final page. */
  readonly nextCursor?: SessionLifecycleCursor
}

/** `listSessions`'s total order sort key: `(header.createdAt, header.id)` ascending, ties broken by id. */
interface SortKey {
  readonly createdAt: number
  readonly id: string
}

function sortKeyOf(record: SessionLifecycleRecord): SortKey {
  return { createdAt: record.header.createdAt, id: String(record.header.id) }
}

function compareSortKeys(a: SortKey, b: SortKey): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Whether `record`'s sort key comes strictly after `position` in `listSessions`'s total order. */
function isAfterPosition(record: SessionLifecycleRecord, position: SortKey): boolean {
  return compareSortKeys(sortKeyOf(record), position) > 0
}

function encodeCursor(position: SortKey): SessionLifecycleCursor {
  return SessionLifecycleCursor(JSON.stringify(position))
}

function decodeCursor(cursor: SessionLifecycleCursor): SortKey {
  return JSON.parse(cursor) as SortKey
}

function matchesFilter(record: SessionLifecycleRecord, filter: SessionLifecycleFilter): boolean {
  switch (filter.kind) {
    case 'tenant':
      return filter.values.includes(record.tenantId)
    case 'workspace':
      return record.workspaceId !== undefined && filter.values.includes(record.workspaceId)
    case 'status':
      return filter.values.includes(record.disposition.kind)
    case 'time':
      return (filter.from === undefined || record.header.createdAt >= filter.from)
        && (filter.to === undefined || record.header.createdAt <= filter.to)
  }
}

/**
 * must[0]/acceptance[0]'s listing entry point: apply `request.filters`
 * (ANDed) to `records`, then return one page of at most `request.limit`
 * results. A pure function over an already-loaded record set — no I/O — a
 * later Provider-stage caller supplies `records` from real durable storage.
 *
 * Pages over a fixed, deterministic total order — `(header.createdAt,
 * header.id)` ascending, ties broken by id — so that walking every page from
 * an absent `cursor` to an absent `nextCursor` visits every record in
 * `records` exactly once regardless of page size (acceptance[0]'s
 * no-omission/no-duplication guarantee): the cursor encodes a position in
 * this fixed order, never an offset that could be invalidated by a
 * concurrent insert/delete of an earlier record.
 * @param records - the complete candidate set to filter and page over.
 * @param request - filters, page size, and continuation cursor.
 * @returns one page of matching records plus a continuation cursor, absent on the final page.
 */
export function listSessions(records: readonly SessionLifecycleRecord[], request: SessionListPageRequest): SessionListPage {
  const filters = request.filters ?? []
  const matched = records.filter(record => filters.every(filter => matchesFilter(record, filter)))
  matched.sort((a, b) => compareSortKeys(sortKeyOf(a), sortKeyOf(b)))

  const startIndex = request.cursor === undefined
    ? 0
    : (() => {
      const position = decodeCursor(request.cursor)
      const index = matched.findIndex(record => isAfterPosition(record, position))
      return index === -1 ? matched.length : index
    })()

  const endIndex = request.limit === undefined ? matched.length : Math.min(startIndex + request.limit, matched.length)
  const items = matched.slice(startIndex, endIndex)
  const lastItem = items.at(-1)
  const nextCursor = endIndex < matched.length && lastItem !== undefined ? encodeCursor(sortKeyOf(lastItem)) : undefined

  return { items, ...nextCursor === undefined ? {} : { nextCursor } }
}

/**
 * must[0]'s outcome of projecting a real session corpus into lifecycle
 * records: the records `listSessions` can page over, plus the corpus sessions
 * that produced none.
 */
export interface LifecycleProjection {
  /** One record per projected session, in the input order of the corpus records. */
  readonly records: readonly SessionLifecycleRecord[]
  /**
   * Corpus sessions that carry no durable lifecycle record and whose
   * {@link SessionRecord.tenantId} the corpus could not observe, so no
   * tenant-scoped record could be built for them without inventing an owner.
   * These are omitted from `records` rather than defaulted, and a caller that
   * needs them listed must first make their identity observable (register a
   * lifecycle record, or attach an identity to the session).
   */
  readonly unattributed: readonly SessionId[]
}

/**
 * must[0]'s corpus join: turn `@deepseek-ai/dsh-session-query`'s real
 * live-preferred session corpus into the {@link SessionLifecycleRecord} array
 * `listSessions` pages over, so a filtered listing runs against the sessions a
 * harness actually has rather than an array a caller assembled by hand.
 *
 * A session that `registered` already knows keeps its durable record verbatim
 * — its disposition and any {@link LegalHold} are the authoritative facts, and
 * a corpus observation never overwrites them, so a soft-deleted or held
 * session cannot be projected back to `active` by being seen in the corpus. A
 * session `registered` does not know is projected as `active`: it exists and
 * no retention decision was ever recorded for it. A session that is neither
 * registered nor tenant-attributable is reported in
 * {@link LifecycleProjection.unattributed} and yields no record.
 * @param records - the corpus records to project, in the order the listing returned them.
 * @param registered - durable lifecycle records by session id, from a {@link SessionLifecycleRecord} registry.
 * @returns the projected records in input order, plus the ids no record could be built for.
 */
export function projectLifecycleRecords(
  records: readonly SessionRecord[],
  registered: ReadonlyMap<SessionId, SessionLifecycleRecord>,
): LifecycleProjection {
  const projected: SessionLifecycleRecord[] = []
  const unattributed: SessionId[] = []
  for (const record of records) {
    const durable = registered.get(record.header.id)
    if (durable !== undefined) {
      // The durable record's disposition and hold are the authoritative facts.
      // A corpus observation says only that the session exists, which can
      // never promote a soft-deleted or held session back to `active`.
      projected.push(durable)
      continue
    }
    if (record.tenantId === undefined) {
      unattributed.push(record.header.id)
      continue
    }
    projected.push({
      header: record.header,
      tenantId: record.tenantId,
      ...record.workspaceId === undefined ? {} : { workspaceId: record.workspaceId },
      disposition: { kind: 'active' },
    })
  }
  return { records: projected, unattributed }
}

/**
 * acceptance[3]'s per-line parse outcome when reading a session's raw
 * durable log: either a successfully parsed {@link SessionEvent}, or the
 * exact line and reason parsing failed.
 */
export type RawSessionLogLine =
  | { readonly ok: true; readonly event: SessionEvent }
  | { readonly ok: false; readonly lineNumber: number; readonly raw: string; readonly parseError: string }

/**
 * acceptance[3]'s evidence for why a log read stopped short of the log's
 * end: the exact line and reason, never a summary that could paper over
 * which line was actually unreadable.
 */
export interface CorruptedLogEvidence {
  readonly lineNumber: number
  readonly raw: string
  readonly parseError: string
}

/**
 * acceptance[3]'s corrupted-log read outcome. `'partial'`/`'none'` always
 * carry {@link CorruptedLogEvidence} naming the exact failure — this type
 * has no variant that silently drops or fabricates events past the first
 * unparseable line.
 */
export type SessionLogReadResult =
  | { readonly recoverable: 'full'; readonly events: readonly SessionEvent[] }
  | { readonly recoverable: 'partial'; readonly events: readonly SessionEvent[]; readonly recoveredThroughSeq: SessionSeq; readonly evidence: CorruptedLogEvidence }
  | { readonly recoverable: 'none'; readonly evidence: CorruptedLogEvidence }

/**
 * acceptance[3]'s corrupted-log read entry point: read `lines` in order,
 * stopping at the first `ok: false` entry. Returns exactly the contiguous
 * `ok: true` prefix before that point as the recovered range — never a line
 * after it, even one that is individually well-formed, since a corrupted
 * intermediate record can invalidate how later records must be interpreted
 * (mirrors `packages/core/session/src/repair.ts`'s "preserve only a fully
 * written prefix" philosophy for a distinct failure mode: an unparseable
 * record anywhere in the log, not an interrupted tail write). Returns
 * `'full'` only when every line parses; `'none'` when the very first line
 * fails, leaving no recoverable prefix at all.
 * @param sessionId - the session whose raw log is being read.
 * @param lines - the raw log lines in on-disk order, already attempted-parsed by the caller.
 * @returns the minimal recoverable range plus evidence, per this function's doc comment; never a fabricated full recovery.
 */
export function readSessionLogWithRepair(sessionId: SessionId, lines: readonly RawSessionLogLine[]): SessionLogReadResult {
  void sessionId
  const events: SessionEvent[] = []
  for (const line of lines) {
    if (!line.ok) {
      const evidence: CorruptedLogEvidence = { lineNumber: line.lineNumber, raw: line.raw, parseError: line.parseError }
      const lastEvent = events.at(-1)
      if (lastEvent === undefined) {
        return { recoverable: 'none', evidence }
      }
      return { recoverable: 'partial', events, recoveredThroughSeq: lastEvent.seq, evidence }
    }
    events.push(line.event)
  }
  return { recoverable: 'full', events }
}
