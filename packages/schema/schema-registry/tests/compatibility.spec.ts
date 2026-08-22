import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerSchema,
  getSchema,
  getLatestVersion,
  listSchemas,
  listSchemaVersions,
  checkCompatibility,
  negotiateSchema,
  registerBuiltinSchemas,
  clearSchemas,
  SchemaCompatibilityError,
} from '../src/index.ts'
import {
  registerMigration,
  migrate,
  clearMigrations,
  compareVersions,
} from '../src/migrate.ts'

describe('P0-06 Schema Registry', () => {
  beforeEach(() => {
    clearSchemas()
    clearMigrations()
  })

  afterEach(() => {
    clearSchemas()
    clearMigrations()
  })

  describe('schema registration', () => {
    it('registers and retrieves a schema', () => {
      registerSchema({
        schemaId: 'test-schema',
        version: { major: 1, minor: 0 },
        compatibility: 'backward',
        description: 'Test schema',
      })
      const def = getSchema('test-schema', { major: 1, minor: 0 })
      expect(def).toBeDefined()
      expect(def!.schemaId).toBe('test-schema')
      expect(def!.version.major).toBe(1)
      expect(def!.version.minor).toBe(0)
    })

    it('rejects duplicate registration of same version', () => {
      registerSchema({
        schemaId: 'test-schema',
        version: { major: 1, minor: 0 },
        compatibility: 'backward',
        description: 'Test schema',
      })
      expect(() => registerSchema({
        schemaId: 'test-schema',
        version: { major: 1, minor: 0 },
        compatibility: 'backward',
        description: 'Duplicate',
      })).toThrow('already registered')
    })

    it('supports multiple versions of same schema', () => {
      registerSchema({ schemaId: 'multi', version: { major: 1, minor: 0 }, compatibility: 'backward', description: 'v1.0' })
      registerSchema({ schemaId: 'multi', version: { major: 1, minor: 1 }, compatibility: 'backward', description: 'v1.1' })
      registerSchema({ schemaId: 'multi', version: { major: 2, minor: 0 }, compatibility: 'none', description: 'v2.0' })
      const versions = listSchemaVersions('multi')
      expect(versions).toHaveLength(3)
      expect(compareVersions(versions[0], { major: 1, minor: 0 })).toBe(0)
      expect(compareVersions(versions[2], { major: 2, minor: 0 })).toBe(0)
      const latest = getLatestVersion('multi')
      expect(latest!.major).toBe(2)
      expect(latest!.minor).toBe(0)
    })

    it('lists all registered schemas', () => {
      registerSchema({ schemaId: 'a', version: { major: 1, minor: 0 }, compatibility: 'backward', description: 'a' })
      registerSchema({ schemaId: 'b', version: { major: 1, minor: 0 }, compatibility: 'full', description: 'b' })
      expect(listSchemas()).toContain('a')
      expect(listSchemas()).toContain('b')
    })
  })

  describe('compatibility checking', () => {
    it('same version is always compatible', () => {
      registerSchema({ schemaId: 'test', version: { major: 1, minor: 0 }, compatibility: 'backward', description: 'test' })
      const result = checkCompatibility('test', { major: 1, minor: 0 }, { major: 1, minor: 0 })
      expect(result.compatible).toBe(true)
    })

    it('backward compatible within same major', () => {
      registerSchema({ schemaId: 'test', version: { major: 1, minor: 0 }, compatibility: 'backward', description: 'v1.0' })
      registerSchema({ schemaId: 'test', version: { major: 1, minor: 1 }, compatibility: 'backward', description: 'v1.1' })
      const result = checkCompatibility('test', { major: 1, minor: 0 }, { major: 1, minor: 1 })
      expect(result.compatible).toBe(true)
    })

    it('major version change is breaking', () => {
      registerSchema({ schemaId: 'test', version: { major: 1, minor: 0 }, compatibility: 'backward', description: 'v1.0' })
      registerSchema({ schemaId: 'test', version: { major: 2, minor: 0 }, compatibility: 'none', description: 'v2.0' })
      const result = checkCompatibility('test', { major: 1, minor: 0 }, { major: 2, minor: 0 })
      expect(result.compatible).toBe(false)
      expect(result.breakingChanges).toBeDefined()
    })

    it('unregistered schema version is incompatible', () => {
      const result = checkCompatibility('unknown', { major: 1, minor: 0 }, { major: 1, minor: 1 })
      expect(result.compatible).toBe(false)
      expect(result.reason).toContain('not registered')
    })
  })

  describe('schema negotiation', () => {
    it('agrees on exact version match', () => {
      registerSchema({ schemaId: 'proto', version: { major: 1, minor: 0 }, compatibility: 'backward', description: 'protocol' })
      registerSchema({ schemaId: 'proto', version: { major: 1, minor: 1 }, compatibility: 'backward', description: 'v1.1' })
      const result = negotiateSchema('proto', { major: 1, minor: 0 }, [{ major: 1, minor: 0 }, { major: 1, minor: 1 }])
      expect(result.agreed).toBe(true)
      expect(result.agreedVersion!.major).toBe(1)
      expect(result.agreedVersion!.minor).toBe(0)
    })

    it('agrees on backward compatible version', () => {
      registerSchema({ schemaId: 'proto', version: { major: 1, minor: 0 }, compatibility: 'backward', description: 'v1.0' })
      registerSchema({ schemaId: 'proto', version: { major: 1, minor: 1 }, compatibility: 'backward', description: 'v1.1' })
      const result = negotiateSchema('proto', { major: 1, minor: 0 }, [{ major: 1, minor: 1 }])
      expect(result.agreed).toBe(true)
    })

    it('fails when no compatible version exists', () => {
      registerSchema({ schemaId: 'proto', version: { major: 1, minor: 0 }, compatibility: 'backward', description: 'v1.0' })
      registerSchema({ schemaId: 'proto', version: { major: 2, minor: 0 }, compatibility: 'none', description: 'v2.0' })
      const result = negotiateSchema('proto', { major: 1, minor: 0 }, [{ major: 2, minor: 0 }])
      expect(result.agreed).toBe(false)
      expect(result.reason).toContain('no compatible')
    })
  })

  describe('migrations', () => {
    it('registers and applies forward migration', () => {
      registerMigration({
        schemaId: 'test',
        from: { major: 1, minor: 0 },
        to: { major: 1, minor: 1 },
        migrate: (data: { a: number }) => ({ ...data, b: 'new' }),
        reversible: true,
        reverse: (data: { a: number; b: string }) => { const { b: _b, ...rest } = data; return rest },
      })
      const result = migrate('test', { major: 1, minor: 0 }, { major: 1, minor: 1 }, { a: 1 })
      expect(result).toEqual({ a: 1, b: 'new' })
    })

    it('applies reverse migration for backward', () => {
      registerMigration({
        schemaId: 'test',
        from: { major: 1, minor: 0 },
        to: { major: 1, minor: 1 },
        migrate: (data: { a: number }) => ({ ...data, b: 'new' }),
        reversible: true,
        reverse: (data: { a: number; b: string }) => { const { b: _b, ...rest } = data; return rest },
      })
      const result = migrate('test', { major: 1, minor: 1 }, { major: 1, minor: 0 }, { a: 1, b: 'new' })
      expect(result).toEqual({ a: 1 })
    })

    it('rejects irreversible migration in backward direction', () => {
      registerMigration({
        schemaId: 'test',
        from: { major: 1, minor: 0 },
        to: { major: 1, minor: 1 },
        migrate: (data: { a: number }) => ({ b: data.a }),
        reversible: false,
      })
      expect(() => migrate('test', { major: 1, minor: 1 }, { major: 1, minor: 0 }, { b: 1 })).toThrow('not reversible')
    })

    it('chains multiple migrations', () => {
      registerMigration({
        schemaId: 'test',
        from: { major: 1, minor: 0 },
        to: { major: 1, minor: 1 },
        migrate: (data: { a: number }) => ({ ...data, b: 'v1.1' }),
        reversible: true,
        reverse: (data: { a: number; b: string }) => { const { b: _b, ...rest } = data; return rest },
      })
      registerMigration({
        schemaId: 'test',
        from: { major: 1, minor: 1 },
        to: { major: 1, minor: 2 },
        migrate: (data: { a: number; b: string }) => ({ ...data, c: 'v1.2' }),
        reversible: true,
        reverse: (data: { a: number; b: string; c: string }) => { const { c: _c, ...rest } = data; return rest },
      })
      const result = migrate('test', { major: 1, minor: 0 }, { major: 1, minor: 2 }, { a: 1 })
      expect(result).toEqual({ a: 1, b: 'v1.1', c: 'v1.2' })
    })
  })

  describe('builtin schemas', () => {
    it('registers built-in schemas at boot', () => {
      registerBuiltinSchemas()
      expect(listSchemas()).toContain('session-event')
      expect(listSchemas()).toContain('sdk-protocol')
      expect(listSchemas()).toContain('plugin-manifest')
      expect(listSchemas()).toContain('settings')
    })

    it('session-event schema has version 0.1', () => {
      registerBuiltinSchemas()
      const latest = getLatestVersion('session-event')
      expect(latest!.major).toBe(0)
      expect(latest!.minor).toBe(1)
    })
  })

  describe('SchemaCompatibilityError', () => {
    it('constructs with correct fields', () => {
      const err = new SchemaCompatibilityError(
        'test',
        { major: 1, minor: 0 },
        { major: 2, minor: 0 },
        'breaking change',
      )
      expect(err.schemaId).toBe('test')
      expect(err.expectedVersion.major).toBe(1)
      expect(err.actualVersion.major).toBe(2)
      expect(err.message).toContain('test')
      expect(err.message).toContain('v1.0')
      expect(err.message).toContain('v2.0')
    })
  })
})
