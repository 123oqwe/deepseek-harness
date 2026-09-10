/**
 * P1-10 must[0]: the bridge from a plugin's own installed manifest and shipped
 * code to the upgrade's vocabulary.
 *
 * Driven through a real installed layout — a profile directory with packages
 * under `node_modules` — because the whole point of this seam is that the
 * declarations come from the package the user installed, not from a value a
 * caller passed in.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { declaredMigrationManifests, resolvePluginUpgrade } from '../src/plugin-migration.ts'

/** Materialize a profile holding one installed package with the given `dsh` field. */
async function installPackage(dshField: unknown, files: Record<string, string> = {}): Promise<string> {
  const profileDir = await mkdtemp(join(tmpdir(), 'dsh-migration-bridge-'))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'profile', dependencies: {} }), 'utf8')
  const packageDir = join(profileDir, 'node_modules', 'notes-plugin')
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: 'notes-plugin', version: '2.0.0', type: 'module', dsh: dshField }),
    'utf8',
  )
  for (const [name, source] of Object.entries(files)) {
    await writeFile(join(packageDir, name), source, 'utf8')
  }
  return profileDir
}

const MANIFEST = {
  manifestVersion: 2,
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '*' },
  dataStores: [{ domainName: 'notes', dataClassification: 'confidential' }],
  migrations: [
    { fromVersion: 2, toVersion: 3, description: 'second', module: './step-3.js', reversible: true, backup: 'snapshot' },
    { fromVersion: 1, toVersion: 2, description: 'first', module: './step-2.js', reversible: true, backup: 'snapshot' },
  ],
}

const CHANGE = [{ plugin: 'notes-plugin', from: '1.4.0', to: '2.0.0' }]

/** Two steps whose modules append a marker, so their ORDER is observable. */
const STEP_MODULES = {
  'step-2.js':
    'export const descriptor = { name: "notes", version: 2, tables: ["notes"], hasGlobal: false }\n'
    + 'export const migrate = async content => ({ ...content, tables: { notes: { ...content.tables.notes, two: true } } })\n',
  'step-3.js':
    'export const descriptor = { name: "notes", version: 3, tables: ["notes"], hasGlobal: false }\n'
    + 'export const migrate = async content => ({ ...content, tables: { notes: { ...content.tables.notes, three: true } } })\n',
}

const SEED = { global: null, tables: { notes: { a: { body: 'original' } } } }

describe('P1-10 must[0]: reading a plugin\'s declared migrations from its installed package', () => {
  it('takes the schema version from the declarations, never from the package version', async () => {
    const profileDir = await installPackage(MANIFEST)

    const manifest = declaredMigrationManifests(CHANGE, profileDir).get('notes-plugin')

    // The package moved 1.4.0 -> 2.0.0 and the schema 1 -> 3: passing the
    // package version as a schema version would plan a path between versions
    // no manifest declares.
    expect(manifest?.current).toBe('3')
    expect(manifest?.migrations.map(step => `${step.from}->${step.to}`)).toEqual(['2->3', '1->2'])
  })

  it('carries each step\'s DECLARED reversibility, so must[2] can be reached', async () => {
    const profileDir = await installPackage({
      ...MANIFEST,
      migrations: [
        { fromVersion: 1, toVersion: 2, description: 'lossy', module: './step-2.js', reversible: false, backup: 'none' },
      ],
    })

    const manifest = declaredMigrationManifests(CHANGE, profileDir).get('notes-plugin')

    // A defaulted `reversible: true` here would make the operator's
    // confirmation unreachable in exactly the case it exists for.
    expect(manifest?.migrations[0]).toMatchObject({ reversible: false, backup: { kind: 'none' } })
  })

  it('gives no manifest to a plugin that declares no migrations', async () => {
    const profileDir = await installPackage({ ...MANIFEST, migrations: [] })

    expect(declaredMigrationManifests(CHANGE, profileDir).has('notes-plugin')).toBe(false)
    expect(await resolvePluginUpgrade('notes-plugin', profileDir)).toEqual({ kind: 'none' })
  })

  it('takes the unit from the module\'s own descriptor, not from the manifest', async () => {
    const profileDir = await installPackage(MANIFEST, STEP_MODULES)

    const resolution = await resolvePluginUpgrade('notes-plugin', profileDir)

    // The descriptor is the value the plugin itself passes to kv.open; a unit
    // assembled here from a domain name would be a guess at tables, global
    // slot and layout.
    expect(resolution).toMatchObject({
      kind: 'ready',
      unit: { name: 'notes', version: 3, tables: ['notes'], hasGlobal: false },
    })
  })

  it('runs the shipped modules in declared-version order, not manifest order', async () => {
    const profileDir = await installPackage(MANIFEST, STEP_MODULES)

    const resolution = await resolvePluginUpgrade('notes-plugin', profileDir)
    if (resolution.kind !== 'ready') throw new Error(`expected ready, got ${resolution.kind}`)

    // The manifest lists 2->3 first; the chain must still run 1->2 first, or
    // content reaches a version through a conversion declared for another.
    expect(await resolution.migrate(SEED)).toEqual({
      global: null,
      tables: { notes: { a: { body: 'original' }, two: true, three: true } },
    })
  })

  it('refuses by NAME when a declared step ships no module', async () => {
    const profileDir = await installPackage({
      ...MANIFEST,
      migrations: [
        { fromVersion: 1, toVersion: 2, description: 'first', module: './step-2.js', reversible: true, backup: 'snapshot' },
        { fromVersion: 2, toVersion: 3, description: 'second' },
      ],
    }, STEP_MODULES)

    // A partial chain would leave the content between two versions with no
    // declaration describing where it is.
    expect(await resolvePluginUpgrade('notes-plugin', profileDir))
      .toMatchObject({ kind: 'refused', reason: 'missing-migration-module' })
  })

  it('refuses by NAME when the plugin declares more than one data store', async () => {
    const profileDir = await installPackage({
      ...MANIFEST,
      dataStores: [
        { domainName: 'notes', dataClassification: 'confidential' },
        { domainName: 'drafts', dataClassification: 'confidential' },
      ],
    }, STEP_MODULES)

    // Silently skipping would let the new code meet the old data at the next
    // boot, with nothing pointing back at the install that caused it.
    expect(await resolvePluginUpgrade('notes-plugin', profileDir))
      .toMatchObject({ kind: 'refused', reason: 'multiple-data-stores' })
  })

  it('refuses by NAME when the exported descriptor disagrees with the declarations', async () => {
    const profileDir = await installPackage(MANIFEST, {
      ...STEP_MODULES,
      'step-3.js': 'export const descriptor = { name: "notes", version: 9, tables: ["notes"], hasGlobal: false }\n'
        + 'export const migrate = async content => content\n',
    })

    // The declarations reach 3 and the module claims 9: one of the two is
    // wrong, and migrating to either would stamp a version nothing agreed on.
    expect(await resolvePluginUpgrade('notes-plugin', profileDir))
      .toMatchObject({ kind: 'refused', reason: 'descriptor-version-mismatch' })
  })

  it('refuses by NAME when a module exports no descriptor', async () => {
    const profileDir = await installPackage(MANIFEST, {
      ...STEP_MODULES,
      'step-3.js': 'export const migrate = async content => content\n',
    })

    expect(await resolvePluginUpgrade('notes-plugin', profileDir))
      .toMatchObject({ kind: 'refused', reason: 'missing-descriptor-export' })
  })

  it('refuses to load steps from a package whose declaration would be denied at mount', async () => {
    const profileDir = await installPackage({ bundle: { patch: './cordis.patch.yml' } }, STEP_MODULES)

    // A legacy-untrusted package is excluded from a production boot; running
    // its migration module here would execute the very code admission refuses
    // to mount.
    expect(await resolvePluginUpgrade('notes-plugin', profileDir))
      .toMatchObject({ kind: 'refused', reason: 'unreadable-manifest' })
  })

  it('offers the module\'s optional validate to the transaction', async () => {
    const profileDir = await installPackage(MANIFEST, {
      ...STEP_MODULES,
      'step-3.js': 'export const descriptor = { name: "notes", version: 3, tables: ["notes"], hasGlobal: false }\n'
        + 'export const migrate = async content => content\n'
        + 'export const validate = async content => Object.keys(content.tables.notes).length > 0\n',
    })

    const resolution = await resolvePluginUpgrade('notes-plugin', profileDir)
    if (resolution.kind !== 'ready') throw new Error(`expected ready, got ${resolution.kind}`)

    expect(await resolution.validate?.(SEED)).toBe(true)
    expect(await resolution.validate?.({ global: null, tables: { notes: {} } })).toBe(false)
  })
})
