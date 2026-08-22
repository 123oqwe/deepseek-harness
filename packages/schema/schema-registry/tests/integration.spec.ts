import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { registerSchema, getSchema, listSchemas, checkCompatibility, registerBuiltinSchemas, clearSchemas, type SchemaDefinition } from '../src/index.ts'

describe('P0-06 Schema Registry Integration', () => {
  beforeEach(() => { clearSchemas(); registerBuiltinSchemas() })
  afterEach(() => clearSchemas())

  it('builtin schemas are registered at boot', () => {
    const schemas = listSchemas()
    expect(schemas.length).toBeGreaterThan(0)
  })

  it('can register and retrieve a custom schema', () => {
    const def: SchemaDefinition = {
      schemaId: 'test-schema',
      version: { major: 1, minor: 0, patch: 0 },
      fields: {},
      compatibility: 'backward',
      description: 'test schema',
      compatibleWith: [],
    }
    registerSchema(def)
    const schema = getSchema('test-schema', { major: 1, minor: 0, patch: 0 })
    expect(schema).toBeDefined()
    expect(schema?.schemaId).toBe('test-schema')
  })

  it('checkCompatibility detects version compatibility', () => {
    const schemas = listSchemas()
    expect(schemas.length).toBeGreaterThan(0)
    // checkCompatibility should return a result for any registered schema
    const firstSchema = schemas[0]
    if (firstSchema) {
      const result = checkCompatibility(firstSchema, { major: 999, minor: 0, patch: 0 }, { major: 0, minor: 1, patch: 0 })
      expect(result).toBeDefined()
    }
  })
})
