/**
 * Clause coverage for Epic P6-02's canonical memory record.
 *
 * `../src/types.ts`'s module doc names this epic as the owner of the shape
 * that supersedes `MemoryRecordView`, so these cases exercise the canonical
 * record rather than that provisional projection.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  isDefaultRetrievable,
  recordConflict,
  validateRecord,
  type MemoryKind,
  type MemoryRecord,
  type MemorySubject,
  type SourceEventId,
} from '../src/record.ts'
import { admitToIndex, isTraceable, withProvenance } from '../src/provenance.ts'
import type { TenantId } from '@deepseek-ai/dsh-principal'
import type { MemoryRecordId, MemoryScope } from '../src/types.ts'

const SCOPE: MemoryScope = { tenantId: brandString<TenantId>('tenant-a') }

function record(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: brandString<MemoryRecordId>(id),
    content: { kind: 'inline', value: 'remembered' },
    kind: brandString<MemoryKind>('fact'),
    subject: brandString<MemorySubject>('user'),
    provenance: { kind: 'derived', sourceEvents: [brandString<SourceEventId>('evt-1')] },
    createdAt: '2026-09-01T00:00:00.000Z',
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: null,
    confidence: 0.9,
    scope: SCOPE,
    purpose: 'recall',
    sensitivity: 'normal',
    status: 'active',
    relations: [],
    ...overrides,
  }
}

describe('P6-02 must[0]: the record carries every fact the clause enumerates', () => {
  it('carries content, kind, subject, provenance, times, confidence, scope, purpose, sensitivity, status and relations', () => {
    // One exact key set rather than field-by-field: a record missing one of
    // these would otherwise satisfy every individual assertion.
    expect(Object.keys(record('m1')).sort()).toEqual([
      'confidence', 'content', 'createdAt', 'id', 'kind', 'provenance', 'purpose',
      'relations', 'scope', 'sensitivity', 'status', 'subject', 'validFrom', 'validUntil',
    ])
  })

  it('distinguishes inline content from a stored reference', () => {
    // Not one nullable field: "the content is empty" and "the content lives
    // elsewhere" are different states.
    expect(record('m1', { content: { kind: 'ref', artifactId: 'artifact-7' } }).content)
      .toEqual({ kind: 'ref', artifactId: 'artifact-7' })
  })

  it('treats an open-ended validity as an explicit null, not an absent field', () => {
    expect(record('m1').validUntil).toBeNull()
  })
})

describe('P6-02 acceptance[0]: every record traces to a source or is user-asserted', () => {
  it('refuses a derived record naming no source event', () => {
    expect(validateRecord(record('m1', { provenance: { kind: 'derived', sourceEvents: [] } })))
      .toMatchObject({ valid: false, reason: 'derived-without-source' })
  })

  it('accepts a user-asserted record, which names a responsible party instead', () => {
    const asserted = record('m1', { provenance: { kind: 'user-asserted', assertedBy: 'user-1' } })

    // The two are separate variants so an empty source list cannot be mistaken
    // for a deliberate assertion.
    expect(validateRecord(asserted)).toEqual({ valid: true })
    expect(isTraceable(asserted.provenance)).toBe(true)
  })

  it('does not treat an empty asserter as traceable', () => {
    expect(isTraceable({ kind: 'user-asserted', assertedBy: '' })).toBe(false)
  })

  it('validation[2]: a returned record carries its own provenance, not a caller-supplied one', () => {
    const source = record('m1')
    expect(withProvenance(source)).toEqual({ id: source.id, record: source, provenance: source.provenance })
  })
})

describe('P6-02 must[1]: a conflict records a relation and overwrites nothing', () => {
  it('supersedes: the winner gains a relation and the loser is marked, both surviving', () => {
    const winner = record('new')
    const loser = record('old')
    const result = recordConflict(winner, loser, 'supersedes')

    expect(result.winner.relations).toEqual([{ kind: 'supersedes', target: loser.id }])
    expect(result.loser.status).toBe('superseded')
    // Neither input is mutated: returning a pair is what makes the
    // no-overwrite rule checkable at the call site.
    expect(winner.relations).toEqual([])
    expect(loser.status).toBe('active')
  })

  it('disputes marks the loser disputed, not superseded', () => {
    // Not cosmetic: superseded means the new claim replaces the old, disputed
    // means both stand and the disagreement is unresolved.
    expect(recordConflict(record('new'), record('old'), 'disputes').loser.status).toBe('disputed')
  })

  it('refuses a relation pointing at the record itself', () => {
    expect(validateRecord(record('m1', { relations: [{ kind: 'supersedes', target: brandString<MemoryRecordId>('m1') }] })))
      .toMatchObject({ valid: false, reason: 'relation-targets-self' })
  })

  it('refuses a duplicated relation but allows two kinds toward one target', () => {
    const target = brandString<MemoryRecordId>('other')
    expect(validateRecord(record('m1', { relations: [{ kind: 'disputes', target }, { kind: 'disputes', target }] })))
      .toMatchObject({ valid: false, reason: 'duplicate-relation' })
    expect(validateRecord(record('m1', { relations: [{ kind: 'disputes', target }, { kind: 'supersedes', target }] })))
      .toEqual({ valid: true })
  })
})

describe('P6-02 acceptance[1]: expired and revoked records leave default retrieval', () => {
  it('retrieves an active, unexpired record', () => {
    expect(isDefaultRetrievable(record('m1'), '2026-09-02T00:00:00.000Z')).toBe(true)
  })

  it('withholds a record whose validity has passed, and keeps one at the boundary out too', () => {
    const expiring = record('m1', { validUntil: '2026-09-02T00:00:00.000Z' })

    expect(isDefaultRetrievable(expiring, '2026-09-01T23:59:59.999Z')).toBe(true)
    // At the instant validity ends the claim is no longer true, so the
    // boundary excludes rather than includes.
    expect(isDefaultRetrievable(expiring, '2026-09-02T00:00:00.000Z')).toBe(false)
  })

  it('withholds revoked, superseded and disputed records alike', () => {
    for (const status of ['revoked', 'superseded', 'disputed'] as const) {
      expect(isDefaultRetrievable(record('m1', { status }), '2026-09-02T00:00:00.000Z'), status).toBe(false)
    }
  })
})

describe('P6-02 must[2]: sensitive content stays out of an index unless policy allows', () => {
  it('withholds sensitive content by default', () => {
    // Default-deny: a sensitive record wrongly indexed cannot be un-indexed
    // once an embedding derived from it exists, while one wrongly withheld
    // costs only a retrieval.
    expect(admitToIndex(record('m1', { sensitivity: 'sensitive' }), { allowSensitive: false }))
      .toEqual({ indexable: false, reason: 'sensitive-not-permitted' })
  })

  it('admits sensitive content when the policy explicitly permits it', () => {
    expect(admitToIndex(record('m1', { sensitivity: 'sensitive' }), { allowSensitive: true }))
      .toEqual({ indexable: true })
  })

  it('admits normal content whatever the policy says', () => {
    for (const allowSensitive of [true, false]) {
      expect(admitToIndex(record('m1'), { allowSensitive })).toEqual({ indexable: true })
    }
  })
})

describe('P6-02 validation[1]: a malformed record is refused rather than stored', () => {
  it('refuses a confidence outside [0, 1], including NaN', () => {
    for (const confidence of [-0.1, 1.1, Number.NaN]) {
      expect(validateRecord(record('m1', { confidence })), String(confidence))
        .toMatchObject({ valid: false, reason: 'confidence-out-of-range' })
    }
  })

  it('accepts the exact bounds, so the range test is not off by one', () => {
    for (const confidence of [0, 1]) {
      expect(validateRecord(record('m1', { confidence })), String(confidence)).toEqual({ valid: true })
    }
  })

  it('refuses an inverted validity range but accepts an instantaneous one', () => {
    expect(validateRecord(record('m1', { validFrom: '2026-09-02T00:00:00.000Z', validUntil: '2026-09-01T00:00:00.000Z' })))
      .toMatchObject({ valid: false, reason: 'valid-range-inverted' })
    expect(validateRecord(record('m1', { validFrom: '2026-09-01T00:00:00.000Z', validUntil: '2026-09-01T00:00:00.000Z' })))
      .toEqual({ valid: true })
  })
})
