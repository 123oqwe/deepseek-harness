/**
 * Provenance on every returned record, and the sensitive-field rule
 * (Epic P6-02 must[2], acceptance[0], validation[2]).
 *
 * Two obligations meet here and they pull in opposite directions. A query
 * result must always carry where its record came from, so a caller can judge
 * it. And a sensitive record must not reach an embedding or an index unless
 * policy allows it. Both are about what leaves the store, which is why they
 * are decided in one place rather than by each retrieval path separately.
 *
 * @module @deepseek-ai/dsh-memory/provenance
 */

import type { MemoryProvenance, MemoryRecord } from './record.ts'
import type { MemoryRecordId } from './types.ts'

/**
 * A record as a reader receives it: never without its provenance
 * (validation[2]).
 *
 * `provenance` is required, not optional. An optional field would let a
 * retrieval path return records with it absent and still typecheck, and the
 * clause's whole point is that no such path may exist.
 */
export interface ProvenancedRecord {
  readonly id: MemoryRecordId
  readonly record: MemoryRecord
  readonly provenance: MemoryProvenance
}

/**
 * Attach provenance to a record for return to a reader.
 *
 * Reads it from the record rather than accepting it as a parameter, so a
 * caller cannot pair a record with someone else's provenance — by
 * construction rather than by convention.
 * @param record - the record being returned.
 * @returns the record with its own provenance attached.
 */
export function withProvenance(record: MemoryRecord): ProvenancedRecord {
  return { id: record.id, record, provenance: record.provenance }
}

/** Whether a deployment permits indexing sensitive content. */
export interface IndexingPolicy {
  readonly allowSensitive: boolean
}

/** Why a record was withheld from an index. */
export type IndexDenialReason = 'sensitive-not-permitted'

/** The outcome of deciding whether one record may be indexed. */
export type IndexAdmission =
  | { readonly indexable: true }
  | { readonly indexable: false; readonly reason: IndexDenialReason }

/**
 * Decide whether a record's content may enter an embedding or index
 * (must[2]).
 *
 * Default-deny for sensitive content: the policy must say yes, and a policy
 * that says nothing withholds. The asymmetry is deliberate — a sensitive
 * record wrongly indexed cannot be un-indexed once an embedding derived from
 * it has been written, while one wrongly withheld costs a retrieval.
 * @param record - the record under consideration.
 * @param policy - the deployment's indexing policy.
 * @returns whether the content may be indexed.
 */
export function admitToIndex(record: MemoryRecord, policy: IndexingPolicy): IndexAdmission {
  if (record.sensitivity === 'sensitive' && !policy.allowSensitive) {
    return { indexable: false, reason: 'sensitive-not-permitted' }
  }
  return { indexable: true }
}

/**
 * Whether a record traces to something, as acceptance[0] requires.
 *
 * True for a derived record naming at least one source event, and for one
 * explicitly marked user-asserted. False otherwise — which `validateRecord`
 * already refuses, so this is a reader-side restatement rather than a second
 * gate.
 * @param provenance - the provenance to test.
 * @returns whether the origin is accounted for.
 */
export function isTraceable(provenance: MemoryProvenance): boolean {
  if (provenance.kind === 'user-asserted') return provenance.assertedBy.length > 0
  return provenance.sourceEvents.length > 0
}
