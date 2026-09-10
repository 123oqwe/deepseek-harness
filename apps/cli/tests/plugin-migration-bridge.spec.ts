/**
 * P1-10 must[0]: the bridge from a plugin's own installed manifest to the
 * upgrade's vocabulary.
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

import { declaredMigrationManifests, upgradeLookups } from '../src/plugin-migration.ts'

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
    { fromVersion: 2, toVersion: 3, description: 'second', module: './step-3.js' },
    { fromVersion: 1, toVersion: 2, description: 'first', module: './step-2.js' },
  ],
}

const CHANGE = [{ plugin: 'notes-plugin', from: '1.4.0', to: '2.0.0' }]

const STEP_MODULES = {
  'step-2.js': 'export default async records => [...records, "two"]\n',
  'step-3.js': 'export default async records => [...records, "three"]\n',
}

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

  it('gives no manifest to a plugin that declares no migrations', async () => {
    const profileDir = await installPackage({ ...MANIFEST, migrations: [] })

    // Different from "declared some and shipped no module": there is nothing
    // to run, so the upgrade says nothing about this plugin at all.
    expect(declaredMigrationManifests(CHANGE, profileDir).has('notes-plugin')).toBe(false)
  })

  it('derives the unit from the declared data store', async () => {
    const profileDir = await installPackage(MANIFEST)

    expect(upgradeLookups(profileDir).unitFor('notes-plugin'))
      .toEqual({ name: 'notes', version: 3, tables: ['notes'], hasGlobal: false })
  })

  it('gives no unit to a plugin declaring more than one store', async () => {
    const profileDir = await installPackage({
      ...MANIFEST,
      dataStores: [
        { domainName: 'notes', dataClassification: 'confidential' },
        { domainName: 'drafts', dataClassification: 'confidential' },
      ],
    })

    // Choosing one would migrate an arbitrary half of the plugin's data.
    expect(upgradeLookups(profileDir).unitFor('notes-plugin')).toBeUndefined()
  })

  it('runs the shipped modules in declared-version order, not manifest order', async () => {
    const profileDir = await installPackage(MANIFEST, STEP_MODULES)

    const steps = await upgradeLookups(profileDir).stepsFor('notes-plugin')

    // The manifest lists 2->3 first; the chain must still run 1->2 first, or
    // the records reach a version through a conversion declared for another.
    expect(await steps?.(['start'])).toEqual(['start', 'two', 'three'])
  })

  it('refuses the whole chain when one declared step ships no module', async () => {
    const profileDir = await installPackage({
      ...MANIFEST,
      migrations: [
        { fromVersion: 1, toVersion: 2, description: 'first', module: './step-2.js' },
        { fromVersion: 2, toVersion: 3, description: 'second' },
      ],
    }, STEP_MODULES)

    // A partial chain would leave the records between two versions with no
    // declaration describing where they are.
    expect(await upgradeLookups(profileDir).stepsFor('notes-plugin')).toBeUndefined()
  })

  it('refuses to load steps from a package whose declaration would be denied at mount', async () => {
    const profileDir = await installPackage({ bundle: { patch: './cordis.patch.yml' } }, STEP_MODULES)

    // A legacy-untrusted package is excluded from a production boot; running
    // its migration module here would execute the very code that admission
    // refuses to mount.
    expect(await upgradeLookups(profileDir).stepsFor('notes-plugin')).toBeUndefined()
    expect(upgradeLookups(profileDir).unitFor('notes-plugin')).toBeUndefined()
  })
})
