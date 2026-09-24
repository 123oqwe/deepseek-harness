/**
 * P0-06 acceptance[2] at the registry's own surface: the identity migration
 * the census accepts is the identity, and the census can tell an undeclared
 * non-identity migration from a declared one.
 *
 * The evolved schema is third-party input (no shipped caller evolves a
 * schema), registered in a fresh module instance of the registry so the
 * shipped registrations of this process are not touched. The forward
 * migration the reverse is checked against is read back from the registry,
 * not taken from this file.
 */

import { describe, expect, it, vi } from 'vitest'
import { identityMigration, type SchemaId, type SchemaMigration } from '@deepseek-ai/dsh-schema-registry'
import { offenders, type DeclaredMigration } from './p0-06-registry-census.ts'

const SYNTHETIC = 'p0-06-synthetic:rename' as SchemaId

/** Version 1 of the synthetic schema names the field `name`; version 2 renames it `title`. */
const rename: SchemaMigration = (payload) => {
  const { name, ...rest } = payload as { name: unknown }
  return { ...rest, title: name }
}
const unrename: SchemaMigration = (payload) => {
  const { title, ...rest } = payload as { title: unknown }
  return { ...rest, name: title }
}

/**
 * A fresh registry with the synthetic schema registered at 1.0 and evolved to 2.0 by `rename`.
 * @returns that registry module.
 */
async function registryWithEvolvedSchema(): Promise<typeof import('@deepseek-ai/dsh-schema-registry')> {
  vi.resetModules()
  const registry = await import('@deepseek-ai/dsh-schema-registry')
  registry.registerSchema(SYNTHETIC, { major: 1, minor: 0 }, registry.identityMigration)
  registry.evolveSchema(SYNTHETIC, [{ field: 'name', kind: 'breaking', reason: 'renamed to title' }], { major: 2, minor: 0 }, rename)
  return registry
}

describe('P0-06 acceptance[2]: the registry census and the identity migration it accepts', () => {
  it('identityMigration returns every payload unchanged, so it is its own reverse', () => {
    const payloads: unknown[] = [{ a: 1 }, [1, 2], { nested: { list: [{ deep: true }] } }, null, 42, 'text']
    for (const payload of payloads) {
      expect(identityMigration(payload)).toBe(payload)
      expect(identityMigration(identityMigration(payload))).toBe(payload)
    }
  })

  it('the census flags an evolved schema whose non-identity migration declares no reverse or irreversibility case', async () => {
    const registry = await registryWithEvolvedSchema()
    const synthetic = registry.listSchemas().filter(entry => String(entry.schemaId).startsWith('p0-06-synthetic:'))
    expect(offenders(synthetic, registry.identityMigration, {})).toEqual([SYNTHETIC])
  })

  it('the census accepts an evolved schema once its declared reverse round-trips the migration the registry holds', async () => {
    const registry = await registryWithEvolvedSchema()
    const synthetic = registry.listSchemas().filter(entry => String(entry.schemaId).startsWith('p0-06-synthetic:'))
    const declared: Record<string, DeclaredMigration> = { [SYNTHETIC]: { reverse: unrename } }
    expect(offenders(synthetic, registry.identityMigration, declared)).toEqual([])

    const forward = registry.getSchema(SYNTHETIC)?.migrate
    if (forward === undefined) throw new Error('the evolved schema is not registered')
    for (const payload of [{ name: 'a' }, { name: 'b', kept: [1, 2] }]) {
      expect(forward(payload)).toEqual({ ...payload, name: undefined, title: payload.name })
      expect(unrename(forward(payload))).toEqual(payload)
    }
  })
})
