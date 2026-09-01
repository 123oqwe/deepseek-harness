import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  evolveSchema,
  getSchema,
  identityMigration,
  registerSchema,
  type SchemaId,
} from '@deepseek-ai/dsh-schema-registry'
import * as migrateModule from '../src/migrate.ts'
import {
  mergeNameFields,
  renameFiredAtToOccurredAt,
  renameOccurredAtToFiredAt,
  type AgentTimestampV2,
  type ContactNameV2,
  type LegacyAgentTimestampV1,
  type LegacyContactNameV1,
} from '../src/migrate.ts'

function freshId(label: string): SchemaId {
  return brandString<SchemaId>(`migration-spec:${label}:${Math.random().toString(36).slice(2)}`)
}

describe('renameFiredAtToOccurredAt / renameOccurredAtToFiredAt -- bidirectional (reversible) migration', () => {
  it('exercises the real registry: evolveSchema accepts the breaking rename and stores the forward migration', () => {
    const id = freshId('rename')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    evolveSchema(
      id,
      [{ field: 'firedAt', kind: 'breaking', reason: 'renamed to occurredAt (illustrative example)' }],
      { major: 2, minor: 0 },
      renameFiredAtToOccurredAt,
    )
    const entry = getSchema(id)
    expect(entry?.version).toEqual({ major: 2, minor: 0 })
    expect(entry?.migrate).toBe(renameFiredAtToOccurredAt)
  })

  it('renames firedAt to occurredAt, carrying the value across unchanged', () => {
    const migrated = renameFiredAtToOccurredAt({ firedAt: '2026-01-01T00:00:00.000Z' }) as AgentTimestampV2
    expect(migrated).toEqual({ occurredAt: '2026-01-01T00:00:00.000Z' })
  })

  it.each<LegacyAgentTimestampV1>([
    { firedAt: '2026-01-01T00:00:00.000Z' },
    { firedAt: '2026-08-31T12:34:56.789Z', turn: 3, step: 1 },
  ])('round-trips forward then backward without loss: %j', (original) => {
    const migrated = renameFiredAtToOccurredAt(original) as AgentTimestampV2
    const restored = renameOccurredAtToFiredAt(migrated)
    expect(restored).toEqual(original)
  })

  it.each<AgentTimestampV2>([
    { occurredAt: '2026-01-01T00:00:00.000Z' },
    { occurredAt: '2026-08-31T12:34:56.789Z', turn: 3, step: 1 },
  ])('round-trips backward then forward without loss: %j', (original) => {
    const migrated = renameOccurredAtToFiredAt(original)
    const restored = renameFiredAtToOccurredAt(migrated) as AgentTimestampV2
    expect(restored).toEqual(original)
  })
})

describe('mergeNameFields -- irreversible (lossy) migration', () => {
  it('exercises the real registry: evolveSchema accepts the breaking merge and stores the forward migration', () => {
    const id = freshId('merge')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    evolveSchema(
      id,
      [
        { field: 'firstName', kind: 'breaking', reason: 'merged into fullName (illustrative example)' },
        { field: 'lastName', kind: 'breaking', reason: 'merged into fullName (illustrative example)' },
      ],
      { major: 2, minor: 0 },
      mergeNameFields,
    )
    const entry = getSchema(id)
    expect(entry?.version).toEqual({ major: 2, minor: 0 })
    expect(entry?.migrate).toBe(mergeNameFields)
  })

  it('merges firstName and lastName into a single space-separated fullName', () => {
    const migrated = mergeNameFields({ firstName: 'Ada', lastName: 'Lovelace' }) as ContactNameV2
    expect(migrated).toEqual({ fullName: 'Ada Lovelace' })
  })

  it('a naive reverse (splitting fullName on the first space) does not recover the original data for an ambiguous name -- proof of genuine information loss', () => {
    // "Mary Ann" is a two-word given name; splitting the merged string on
    // its first space misattributes "Ann" to the family name. This is why
    // no reverse migration is provided for this merge: the split point is
    // not recoverable from the merged string alone.
    const original: LegacyContactNameV1 = { firstName: 'Mary Ann', lastName: 'Smith' }
    const migrated = mergeNameFields(original) as ContactNameV2
    expect(migrated.fullName).toBe('Mary Ann Smith')

    const firstSpace = migrated.fullName.indexOf(' ')
    const naiveReversed: LegacyContactNameV1 = {
      firstName: migrated.fullName.slice(0, firstSpace),
      lastName: migrated.fullName.slice(firstSpace + 1),
    }
    expect(naiveReversed).toEqual({ firstName: 'Mary', lastName: 'Ann Smith' })
    expect(naiveReversed).not.toEqual(original)
  })

  it('exports no reverse migration function for the name merge -- explicit acknowledgment of irreversibility, not a silent absence', () => {
    const reverseCandidates = Object.keys(migrateModule)
      .filter(name => /contactName|fullName|mergeName/i.test(name))
      .filter(name => /revers|split|unmerge|restore/i.test(name))
    expect(reverseCandidates).toEqual([])
  })
})
