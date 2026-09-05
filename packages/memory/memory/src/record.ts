/**
 * The canonical durable memory record (Epic P6-02).
 *
 * `./types.ts`'s `MemoryRecordView` is a provisional projection its own module
 * doc names as superseded by this shape. This module is that supersession: it
 * carries every fact must[0] enumerates, so a record can answer where it came
 * from, when it is true, how far it may travel, and whether it should still be
 * retrieved — without a reader consulting anything else.
 *
 * **Conflicts never overwrite.** A record that contradicts an earlier one
 * records a *relation* to it and both persist (must[1]). Overwriting would
 * destroy the only evidence that the disagreement happened, and a memory
 * system that silently loses its own corrections cannot be audited.
 *
 * @module @deepseek-ai/dsh-memory/record
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MemoryRecordId, MemoryScope } from './types.ts'

/** A session event a record was derived from. */
export type SourceEventId = Branded<'SourceEventId'>

/** What kind of thing a record holds; open, since taxonomy is not this epic's. */
export type MemoryKind = Branded<'MemoryKind'>

/** Who or what the record is about, distinct from who wrote it. */
export type MemorySubject = Branded<'MemorySubject'>

/**
 * Where a record's content lives.
 *
 * Inline content and a reference are separate variants rather than one
 * optional field, because "the content is empty" and "the content is stored
 * elsewhere" are different states and a single nullable field cannot tell
 * them apart.
 */
export type MemoryContent =
  | { readonly kind: 'inline'; readonly value: unknown }
  | { readonly kind: 'ref'; readonly artifactId: string }

/**
 * How a record came to exist (acceptance[0]).
 *
 * A record must trace to at least one source event OR be explicitly marked
 * user-asserted. The two are separate variants for the same reason: an empty
 * source list and a deliberate user assertion would otherwise be
 * indistinguishable, and "nobody recorded where this came from" would read as
 * "the user said so".
 */
export type MemoryProvenance =
  | { readonly kind: 'derived'; readonly sourceEvents: readonly SourceEventId[] }
  | { readonly kind: 'user-asserted'; readonly assertedBy: string }

/** Whether a record may leave its scope or enter an index (must[2]). */
export type MemorySensitivity = 'normal' | 'sensitive'

/** Whether a record is still eligible for default retrieval (acceptance[1]). */
export type MemoryStatus = 'active' | 'superseded' | 'disputed' | 'revoked'

/** How one record relates to another it disagrees with (must[1]). */
export type MemoryRelationKind = 'supersedes' | 'disputes'

/** One directed relation between two records. */
export interface MemoryRelation {
  readonly kind: MemoryRelationKind
  readonly target: MemoryRecordId
}

/**
 * The canonical durable record.
 *
 * Every field must[0] names is required. `validUntil` is nullable rather than
 * optional because "never expires" is a decision a writer makes, and an absent
 * field cannot be told apart from one nobody thought about.
 */
export interface MemoryRecord {
  readonly id: MemoryRecordId
  readonly content: MemoryContent
  readonly kind: MemoryKind
  readonly subject: MemorySubject
  readonly provenance: MemoryProvenance
  /** RFC 3339 UTC instant the record was written. */
  readonly createdAt: string
  /** RFC 3339 UTC instant the record's claim became true. */
  readonly validFrom: string
  /** RFC 3339 UTC instant the claim stops being true, or `null` for open-ended. */
  readonly validUntil: string | null
  /** Writer's confidence in [0, 1]. */
  readonly confidence: number
  readonly scope: MemoryScope
  /** Why this record may be read; mirrors `MemoryAccessContext.purpose`. */
  readonly purpose: string
  readonly sensitivity: MemorySensitivity
  readonly status: MemoryStatus
  readonly relations: readonly MemoryRelation[]
}

/** Why a record was rejected as malformed. */
export type RecordDefectReason =
  | 'confidence-out-of-range'
  | 'valid-range-inverted'
  | 'derived-without-source'
  | 'relation-targets-self'
  | 'duplicate-relation'

/** The outcome of validating one record. */
export type RecordValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: RecordDefectReason; readonly detail: string }

/**
 * Validate one record's internal consistency.
 *
 * Every check here is about the record alone. Whether its relations point at
 * records that exist, and whether a merge across scopes was authorized, are
 * questions about a STORE and cannot be answered from one value.
 * @param record - the record to validate.
 * @returns valid, or the first defect found.
 */
export function validateRecord(record: MemoryRecord): RecordValidation {
  if (!(record.confidence >= 0 && record.confidence <= 1)) {
    // Written as a range test rather than `< 0 || > 1` so NaN is refused too:
    // every comparison with NaN is false, and a NaN confidence would otherwise
    // pass both bounds and then sort unpredictably wherever it is ranked.
    return { valid: false, reason: 'confidence-out-of-range', detail: String(record.confidence) }
  }
  if (record.validUntil !== null && record.validUntil < record.validFrom) {
    return { valid: false, reason: 'valid-range-inverted', detail: `${record.validFrom} .. ${record.validUntil}` }
  }
  if (record.provenance.kind === 'derived' && record.provenance.sourceEvents.length === 0) {
    // acceptance[0]: a derived record with no sources traces to nothing. It
    // must declare itself user-asserted instead, which names a responsible
    // party rather than leaving the origin blank.
    return { valid: false, reason: 'derived-without-source', detail: record.id }
  }
  const seen = new Set<string>()
  for (const relation of record.relations) {
    if (relation.target === record.id) {
      return { valid: false, reason: 'relation-targets-self', detail: relation.kind }
    }
    const key = `${relation.kind}:${relation.target}`
    if (seen.has(key)) return { valid: false, reason: 'duplicate-relation', detail: key }
    seen.add(key)
  }
  return { valid: true }
}

/**
 * Record a conflict WITHOUT overwriting the earlier record (must[1]).
 *
 * Returns both records: the winner carrying a new relation, and the loser with
 * its status changed. Returning a pair rather than mutating is what makes the
 * no-overwrite rule checkable — a caller that persisted only the winner would
 * be visibly discarding a value this function handed it.
 *
 * `supersedes` marks the earlier record `superseded`; `disputes` marks it
 * `disputed`. The difference is not cosmetic: superseded means the new record
 * replaces the old claim, while disputed means both claims stand and the
 * disagreement is unresolved. Only the first is a correction.
 * @param winner - the newer record.
 * @param loser - the record it conflicts with.
 * @param kind - whether the winner supersedes or merely disputes the loser.
 * @returns both records, updated; neither input is mutated.
 */
export function recordConflict(
  winner: MemoryRecord,
  loser: MemoryRecord,
  kind: MemoryRelationKind,
): { readonly winner: MemoryRecord; readonly loser: MemoryRecord } {
  return {
    winner: { ...winner, relations: [...winner.relations, { kind, target: loser.id }] },
    loser: { ...loser, status: kind === 'supersedes' ? 'superseded' : 'disputed' },
  }
}

/**
 * Whether a record is eligible for DEFAULT retrieval (acceptance[1]).
 *
 * Expired and non-active records are excluded. `disputed` is excluded too,
 * which is the judgement worth stating: a disputed record's claim is not
 * known to be false, but returning it by default would present a contested
 * fact as settled, and a caller that wants it can ask for it explicitly.
 * @param record - the record to test.
 * @param nowIso - the current RFC 3339 UTC instant.
 * @returns whether a default retrieval may return this record.
 */
export function isDefaultRetrievable(record: MemoryRecord, nowIso: string): boolean {
  if (record.status !== 'active') return false
  if (record.validUntil !== null && record.validUntil <= nowIso) return false
  return true
}
