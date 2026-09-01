import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import {
  SchemaCompatibilityError,
  SchemaRegistryError,
  evolveSchema,
  getSchema,
  identityMigration,
  listSchemas,
  negotiateSchema,
  registerSchema,
  type SchemaId,
} from '@deepseek-ai/dsh-schema-registry'

function freshId(label: string): SchemaId {
  return brandString<SchemaId>(`compatibility-spec:${label}:${Math.random().toString(36).slice(2)}`)
}

describe('bootstrap registrations', () => {
  it('registers every known session-event payload type at 1.0', () => {
    for (const type of KNOWN_SESSION_EVENT_TYPES) {
      const entry = getSchema(brandString<SchemaId>(`session-event:${type}`))
      expect(entry?.version).toEqual({ major: 1, minor: 0 })
    }
  })

  it('registers the named SDK protocol wire types at 1.0', () => {
    const entry = getSchema(brandString<SchemaId>('sdk-protocol:InitializeParams'))
    expect(entry?.version).toEqual({ major: 1, minor: 0 })
  })

  it('exposes at least every bootstrapped schema through listSchemas()', () => {
    const ids = new Set(listSchemas().map(entry => entry.schemaId))
    expect(ids.size).toBeGreaterThanOrEqual(KNOWN_SESSION_EVENT_TYPES.size)
  })
})

describe('registerSchema', () => {
  it('registers a schema at its declared first version with the given migration', () => {
    const id = freshId('first')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    expect(getSchema(id)).toEqual({
      schemaId: id,
      version: { major: 1, minor: 0 },
      migrate: identityMigration,
      history: [{ major: 1, minor: 0 }],
    })
  })

  it('rejects a duplicate registration under the same schemaId, never silently replacing it', () => {
    const id = freshId('dup')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    let thrown: unknown
    try {
      registerSchema(id, { major: 2, minor: 0 }, identityMigration)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SchemaRegistryError)
    expect((thrown as SchemaRegistryError).code).toBe('SCHEMA_ALREADY_REGISTERED')
    // The first registration must still be exactly what it was — never lost or replaced.
    expect(getSchema(id)?.version).toEqual({ major: 1, minor: 0 })
  })

  it.each([
    { major: 0, minor: 0 },
    { major: 1, minor: -1 },
    { major: 1.5, minor: 0 },
  ])('rejects an invalid first version %j', (version) => {
    const id = freshId('invalid-version')
    expect(() => registerSchema(id, version, identityMigration)).toThrowError(SchemaRegistryError)
    expect(getSchema(id)).toBeUndefined()
  })
})

describe('evolveSchema — must[2]/must[3] version-bump enforcement', () => {
  it('accepts an additive-only change set that bumps only minor', () => {
    const id = freshId('additive')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    evolveSchema(
      id,
      [{ field: 'newField', kind: 'additive', reason: 'optional field, ignorable-safe' }],
      { major: 1, minor: 1 },
      identityMigration,
    )
    expect(getSchema(id)?.version).toEqual({ major: 1, minor: 1 })
    expect(getSchema(id)?.history).toEqual([{ major: 1, minor: 0 }, { major: 1, minor: 1 }])
  })

  it('rejects an additive-only change set that bumps major', () => {
    const id = freshId('additive-wrong-bump')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    let thrown: unknown
    try {
      evolveSchema(id, [{ field: 'newField', kind: 'additive', reason: 'x' }], { major: 2, minor: 0 }, identityMigration)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SchemaRegistryError)
    expect((thrown as SchemaRegistryError).code).toBe('SCHEMA_BUMP_MISMATCH')
    expect(getSchema(id)?.version).toEqual({ major: 1, minor: 0 })
  })

  it('accepts a breaking change set that bumps major by exactly 1 and resets minor to 0', () => {
    const id = freshId('breaking')
    registerSchema(id, { major: 1, minor: 3 }, identityMigration)
    const migrate = (payload: unknown): unknown => ({ ...(payload as object), renamedField: undefined })
    evolveSchema(
      id,
      [{ field: 'oldField', kind: 'breaking', reason: 'renamed to renamedField' }],
      { major: 2, minor: 0 },
      migrate,
    )
    expect(getSchema(id)?.version).toEqual({ major: 2, minor: 0 })
    expect(getSchema(id)?.migrate).toBe(migrate)
    expect(getSchema(id)?.history).toEqual([{ major: 1, minor: 3 }, { major: 2, minor: 0 }])
  })

  it('rejects a breaking change set that bumps major but does not reset minor to 0', () => {
    const id = freshId('breaking-nonzero-minor')
    registerSchema(id, { major: 1, minor: 3 }, identityMigration)
    expect(() =>
      evolveSchema(id, [{ field: 'oldField', kind: 'breaking', reason: 'removed' }], { major: 2, minor: 1 }, identityMigration),
    ).toThrowError(SchemaRegistryError)
    expect(getSchema(id)?.version).toEqual({ major: 1, minor: 3 })
  })

  it('rejects an additive change set that does not increase minor', () => {
    const id = freshId('additive-no-increase')
    registerSchema(id, { major: 1, minor: 1 }, identityMigration)
    expect(() =>
      evolveSchema(id, [{ field: 'newField', kind: 'additive', reason: 'x' }], { major: 1, minor: 1 }, identityMigration),
    ).toThrowError(SchemaRegistryError)
    expect(getSchema(id)?.version).toEqual({ major: 1, minor: 1 })
    expect(getSchema(id)?.history).toEqual([{ major: 1, minor: 1 }])
  })

  it('rejects a breaking change set that only bumps minor', () => {
    const id = freshId('breaking-wrong-bump')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    expect(() =>
      evolveSchema(id, [{ field: 'oldField', kind: 'breaking', reason: 'removed' }], { major: 1, minor: 1 }, identityMigration),
    ).toThrowError(SchemaRegistryError)
  })

  it('rejects a breaking change set that skips a major version', () => {
    const id = freshId('breaking-skip')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    expect(() =>
      evolveSchema(id, [{ field: 'oldField', kind: 'breaking', reason: 'removed' }], { major: 3, minor: 0 }, identityMigration),
    ).toThrowError(SchemaRegistryError)
  })

  it('rejects evolution declaring no changes', () => {
    const id = freshId('no-changes')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    let thrown: unknown
    try {
      evolveSchema(id, [], { major: 1, minor: 1 }, identityMigration)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SchemaRegistryError)
    expect((thrown as SchemaRegistryError).code).toBe('SCHEMA_NO_CHANGES')
  })

  it('rejects evolving a schema that was never registered', () => {
    const id = freshId('unregistered')
    let thrown: unknown
    try {
      evolveSchema(id, [{ field: 'x', kind: 'additive', reason: 'x' }], { major: 1, minor: 1 }, identityMigration)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SchemaRegistryError)
    expect((thrown as SchemaRegistryError).code).toBe('SCHEMA_UNKNOWN')
  })
})

describe('negotiateSchema — machine-readable compatibility result', () => {
  it('reports compatible for an encountered version sharing the registered major, regardless of minor', () => {
    const id = freshId('negotiate-same-major')
    registerSchema(id, { major: 1, minor: 4 }, identityMigration)
    const olderMinor = negotiateSchema(id, { major: 1, minor: 0 })
    const newerMinor = negotiateSchema(id, { major: 1, minor: 9 })
    expect(olderMinor).toEqual({ compatible: true, registeredVersion: { major: 1, minor: 4 } })
    expect(newerMinor).toEqual({ compatible: true, registeredVersion: { major: 1, minor: 4 } })
  })

  it('returns a structured SchemaCompatibilityError, never a bare string, for a major mismatch', () => {
    const id = freshId('negotiate-major-mismatch')
    registerSchema(id, { major: 2, minor: 0 }, identityMigration)
    const result = negotiateSchema(id, { major: 1, minor: 0 })
    expect(result.compatible).toBe(false)
    if (result.compatible) throw new Error('unreachable')
    expect(result.error).toBeInstanceOf(SchemaCompatibilityError)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error.code).toBe('SCHEMA_MAJOR_MISMATCH')
    expect(result.error.schemaId).toBe(id)
    expect(result.error.encounteredVersion).toEqual({ major: 1, minor: 0 })
    expect(result.error.registeredVersion).toEqual({ major: 2, minor: 0 })
    expect(typeof result.error.message).toBe('string')
    expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('returns a structured SchemaCompatibilityError for an unregistered schemaId, never silently accepting it', () => {
    const id = freshId('negotiate-unknown')
    const result = negotiateSchema(id, { major: 1, minor: 0 })
    expect(result.compatible).toBe(false)
    if (result.compatible) throw new Error('unreachable')
    expect(result.error).toBeInstanceOf(SchemaCompatibilityError)
    expect(result.error.code).toBe('SCHEMA_UNKNOWN')
    expect(result.error.registeredVersion).toBeUndefined()
  })
})
