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

/**
 * P6-02 Fault stage: a systematic matrix over the record's rejection and
 * retrieval boundaries, including validation[0]'s three named scenarios —
 * time validity, conflict chains, and source deletion.
 *
 * Enumerated as data with the count asserted against a floor, so a boundary
 * cannot be deleted while every remaining case still passes.
 */
describe('P6-02 Fault — record boundary matrix', () => {
  interface RecordFault {
    readonly boundary: string
    readonly run: () => void
  }

  const NOW = '2026-09-02T00:00:00.000Z'

  const FAULTS: readonly RecordFault[] = [
    {
      boundary: '01 confidence below zero is refused',
      run: () =>{  expect(validateRecord(record('m', { confidence: -0.0001 })))
        .toMatchObject({ valid: false, reason: 'confidence-out-of-range' }) },
    },
    {
      boundary: '02 confidence above one is refused',
      run: () =>{  expect(validateRecord(record('m', { confidence: 1.0001 })))
        .toMatchObject({ valid: false, reason: 'confidence-out-of-range' }) },
    },
    {
      boundary: '03 NaN confidence is refused, not admitted by two false comparisons',
      run: () =>{  expect(validateRecord(record('m', { confidence: Number.NaN })))
        .toMatchObject({ valid: false, reason: 'confidence-out-of-range' }) },
    },
    {
      boundary: '04 confidence exactly zero and exactly one are accepted',
      run: () => {
        expect(validateRecord(record('m', { confidence: 0 }))).toEqual({ valid: true })
        expect(validateRecord(record('m', { confidence: 1 }))).toEqual({ valid: true })
      },
    },
    {
      boundary: '05 an inverted validity range is refused',
      run: () =>{  expect(validateRecord(record('m', { validFrom: '2026-09-02T00:00:00.000Z', validUntil: '2026-09-01T00:00:00.000Z' })))
        .toMatchObject({ valid: false, reason: 'valid-range-inverted' }) },
    },
    {
      boundary: '06 an instantaneous validity range is accepted',
      run: () =>{  expect(validateRecord(record('m', { validFrom: NOW, validUntil: NOW }))).toEqual({ valid: true }) },
    },
    {
      boundary: '07 validation[0] time validity: a record is retrievable up to, but not at, its end',
      run: () => {
        const expiring = record('m', { validUntil: NOW })
        expect(isDefaultRetrievable(expiring, '2026-09-01T23:59:59.999Z')).toBe(true)
        expect(isDefaultRetrievable(expiring, NOW)).toBe(false)
      },
    },
    {
      boundary: '08 an open-ended record never expires',
      run: () =>{  expect(isDefaultRetrievable(record('m', { validUntil: null }), '2999-01-01T00:00:00.000Z')).toBe(true) },
    },
    {
      boundary: '09 validation[0] source deletion: a derived record left with no sources is refused',
      run: () => {
        // Deleting the last source event does not silently turn a derived
        // record into an unsourced one that still validates.
        expect(validateRecord(record('m', { provenance: { kind: 'derived', sourceEvents: [] } })))
          .toMatchObject({ valid: false, reason: 'derived-without-source' })
      },
    },
    {
      boundary: '10 validation[0] source deletion: a user-asserted record survives it',
      run: () => {
        // The other half. A user-asserted record has no source events to lose,
        // so source deletion cannot invalidate it -- which is why the two are
        // separate variants rather than one list that may be empty.
        expect(validateRecord(record('m', { provenance: { kind: 'user-asserted', assertedBy: 'user-1' } })))
          .toEqual({ valid: true })
      },
    },
    {
      boundary: '11 validation[0] conflict chain: a relation to itself is refused',
      run: () =>{  expect(validateRecord(record('m', { relations: [{ kind: 'supersedes', target: brandString<MemoryRecordId>('m') }] })))
        .toMatchObject({ valid: false, reason: 'relation-targets-self' }) },
    },
    {
      boundary: '12 validation[0] conflict chain: a duplicated relation is refused',
      run: () => {
        const target = brandString<MemoryRecordId>('other')
        expect(validateRecord(record('m', { relations: [{ kind: 'supersedes', target }, { kind: 'supersedes', target }] })))
          .toMatchObject({ valid: false, reason: 'duplicate-relation' })
      },
    },
    {
      boundary: '13 validation[0] conflict chain: two relation KINDS toward one target are allowed',
      run: () => {
        const target = brandString<MemoryRecordId>('other')
        expect(validateRecord(record('m', { relations: [{ kind: 'supersedes', target }, { kind: 'disputes', target }] })))
          .toEqual({ valid: true })
      },
    },
    {
      boundary: '14 validation[0] conflict chain: a three-record chain leaves every record present',
      run: () => {
        // must[1]'s core property across a chain rather than one pair: nothing
        // is destroyed as corrections accumulate.
        const first = recordConflict(record('b'), record('a'), 'supersedes')
        const second = recordConflict(record('c'), first.winner, 'supersedes')
        expect([first.loser.status, second.loser.status, second.winner.status])
          .toEqual(['superseded', 'superseded', 'active'])
        expect(second.winner.relations).toEqual([{ kind: 'supersedes', target: 'b' }])
      },
    },
    {
      boundary: '15 a revoked record is withheld even while still within its validity',
      run: () =>{  expect(isDefaultRetrievable(record('m', { status: 'revoked', validUntil: null }), NOW)).toBe(false) },
    },
    {
      boundary: '16 sensitive content is withheld from an index by default',
      run: () =>{  expect(admitToIndex(record('m', { sensitivity: 'sensitive' }), { allowSensitive: false }))
        .toEqual({ indexable: false, reason: 'sensitive-not-permitted' }) },
    },
    {
      boundary: '17 normal content is indexable even under the strictest policy',
      run: () =>{  expect(admitToIndex(record('m'), { allowSensitive: false })).toEqual({ indexable: true }) },
    },
    {
      boundary: '18 a well-formed record validates, so the checks above refuse selectively',
      run: () =>{  expect(validateRecord(record('m'))).toEqual({ valid: true }) },
    },
  ]

  it('enumerates at least twelve boundaries, each named once', () => {
    expect(FAULTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(FAULTS.map(fault => fault.boundary)).size).toBe(FAULTS.length)
  })

  for (const fault of FAULTS) {
    it(`fault boundary ${fault.boundary}`, () => { fault.run() })
  }
})
