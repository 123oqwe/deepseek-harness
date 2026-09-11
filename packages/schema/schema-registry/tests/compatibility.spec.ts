import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    expect(() => { registerSchema(id, version, identityMigration) }).toThrow(SchemaRegistryError)
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
    expect(() => {
      evolveSchema(id, [{ field: 'oldField', kind: 'breaking', reason: 'removed' }], { major: 2, minor: 1 }, identityMigration)
    }).toThrow(SchemaRegistryError)
    expect(getSchema(id)?.version).toEqual({ major: 1, minor: 3 })
  })

  it('rejects an additive change set that does not increase minor', () => {
    const id = freshId('additive-no-increase')
    registerSchema(id, { major: 1, minor: 1 }, identityMigration)
    expect(() => {
      evolveSchema(id, [{ field: 'newField', kind: 'additive', reason: 'x' }], { major: 1, minor: 1 }, identityMigration)
    }).toThrow(SchemaRegistryError)
    expect(getSchema(id)?.version).toEqual({ major: 1, minor: 1 })
    expect(getSchema(id)?.history).toEqual([{ major: 1, minor: 1 }])
  })

  it('rejects a breaking change set that only bumps minor', () => {
    const id = freshId('breaking-wrong-bump')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    expect(() => {
      evolveSchema(id, [{ field: 'oldField', kind: 'breaking', reason: 'removed' }], { major: 1, minor: 1 }, identityMigration)
    }).toThrow(SchemaRegistryError)
  })

  it('rejects a breaking change set that skips a major version', () => {
    const id = freshId('breaking-skip')
    registerSchema(id, { major: 1, minor: 0 }, identityMigration)
    expect(() => {
      evolveSchema(id, [{ field: 'oldField', kind: 'breaking', reason: 'removed' }], { major: 3, minor: 0 }, identityMigration)
    }).toThrow(SchemaRegistryError)
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

// ---------------------------------------------------------------------------
// Standards-vocabulary backfill (delegate notes 41–42): one case per standard
// this epic owns by assignment, naming the vocabulary and asserting the shape
// this tree actually takes. No behaviour is added.
// ---------------------------------------------------------------------------

describe('P0-06 standards vocabulary: JSON Schema 2020-12 as the interchange dialect', () => {
  it('publishes every spec schema in the JSON Schema 2020-12 dialect, declared rather than assumed', () => {
    // The dialect is a property of the published artifact, so the assertion
    // reads the artifacts. Three is the whole set today; a fourth added
    // without `$schema` reddens here rather than being discovered by a reader
    // outside TypeScript, which is who the dialect is FOR.
    const published = ['action-manifest', 'capability-manifest', 'task-profile']
    for (const name of published) {
      const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'spec', `${name}.schema.json`)
      const schema = JSON.parse(readFileSync(path, 'utf8')) as { $schema?: string }
      expect(schema.$schema, `${name}.schema.json`).toBe('https://json-schema.org/draft/2020-12/schema')
    }
  })
})

describe('P0-06 standards vocabulary: what this registry takes from Confluent BACKWARD/FORWARD/FULL[_TRANSITIVE]', () => {
  it('maps Confluent BACKWARD/FORWARD/FULL onto a major-only rule: FULL within a major, incompatible across one', () => {
    // **The vocabulary is mapped, not adopted verbatim, and the mapping is the
    // point of this case.** Confluent grades a schema change into four named
    // levels; this registry asks one question — does the encountered MAJOR
    // match the registered one. Within a major, a reader accepts any minor in
    // either direction, which is Confluent's FULL; across a major it refuses,
    // which is none of the four. There is no `_TRANSITIVE` notion at all,
    // because nothing here reasons over a chain of past versions.
    const id = freshId('confluent-mapping')
    registerSchema(id, { major: 2, minor: 3 }, identityMigration)

    // A LOWER minor: an old writer's payload, read by this build.
    expect(negotiateSchema(id, { major: 2, minor: 0 }).compatible).toBe(true)
    // A HIGHER minor: a newer writer's payload, read by this build. Both
    // directions pass, which is why the level within a major is FULL and not
    // BACKWARD or FORWARD alone.
    expect(negotiateSchema(id, { major: 2, minor: 9 }).compatible).toBe(true)
    // A different major is refused, and the refusal names both versions rather
    // than a level name this registry does not use.
    const across = negotiateSchema(id, { major: 3, minor: 0 })
    expect(across.compatible).toBe(false)
    if (across.compatible) throw new Error('expected a refusal')
    expect(across.error.code).toBe('SCHEMA_MAJOR_MISMATCH')
    // The refusal carries BOTH versions, so a reader learns what it holds and
    // what it met rather than a level name this registry does not use.
    expect(across.error.encounteredVersion).toStrictEqual({ major: 3, minor: 0 })
    expect(across.error.registeredVersion).toStrictEqual({ major: 2, minor: 3 })
  })
})
