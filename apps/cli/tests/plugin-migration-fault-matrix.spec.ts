/**
 * Epic P1-10 Fault stage, consumer half: the boundaries where an upgrade's
 * CLI-side inputs are bad rather than its transaction.
 *
 * The transaction's own boundaries are
 * `packages/plugin/plugin-migrations/tests/rollback.e2e.spec.ts`. What lives
 * here is everything whose subject is `apps/cli/src/plugin-migration.ts`: the
 * module a plugin ships, the export an irreversible path owes, and the code
 * rollback that pairs with a failed data migration.
 *
 * Every refusal in this file is asserted BY NAME. "It did not upgrade" is the
 * one thing every one of these failures has in common, so a case that asserted
 * only that would pass under any of them and distinguish none.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { recoverInterruptedUpgrades, resolvePluginUpgrade, upgradeRecordPath } from '../src/plugin-migration.ts'
import type { MigrationFacet } from '@deepseek-ai/dsh-storage'

/** Materialize a profile holding one installed package with the given `dsh` field. */
async function installPackage(dshField: unknown, files: Record<string, string> = {}): Promise<string> {
  const profileDir = await mkdtemp(join(tmpdir(), 'dsh-migration-fault-'))
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

/** One declared step, whose module the cases replace. */
const MANIFEST = {
  manifestVersion: 2,
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '*' },
  dataStores: [{ domainName: 'notes', dataClassification: 'confidential' }],
  migrations: [
    { fromVersion: 1, toVersion: 2, description: 'only', module: './step-2.js', reversible: true, backup: 'snapshot' },
  ],
}

const DESCRIPTOR = 'export const descriptor = { name: "notes", version: 2, tables: ["notes"], hasGlobal: false }\n'
const MIGRATE = 'export const migrate = async content => content\n'

describe('P1-10 Fault — the module a plugin ships', () => {
  it('fault boundary 01 a migration module that THROWS on import is refused by name, not propagated', async () => {
    // A module can fail at import for reasons that have nothing to do with
    // migration — a missing transitive dependency, a syntax error under a
    // different Node version. The upgrade must name it as this plugin's
    // refusal, because the alternative is an unhandled rejection that says
    // nothing about which plugin, and stops every plugin after it.
    const profileDir = await installPackage(MANIFEST, {
      'step-2.js': 'throw new Error("this module explodes on import")\n',
    })

    const resolution = await resolvePluginUpgrade('notes-plugin', profileDir)

    expect(resolution).toMatchObject({ kind: 'refused', reason: 'unloadable-migration-module' })
  })

  it('fault boundary 02 a module exporting `descriptor` but no `migrate` is refused for the half it is missing', async () => {
    // Admitted as `ready` before this stage: the guard tested only
    // `descriptor` while its message claimed both, so the module failed later
    // as a TypeError inside the transaction — past the point that was supposed
    // to refuse it, with the plugin's data already snapshotted.
    const profileDir = await installPackage(MANIFEST, { 'step-2.js': DESCRIPTOR })

    const resolution = await resolvePluginUpgrade('notes-plugin', profileDir)

    expect(resolution).toMatchObject({ kind: 'refused', reason: 'missing-migrate-export' })
  })

  it('fault boundary 03 a module exporting NEITHER is refused the same way, so the guard is not special-cased to one field', async () => {
    // Control for 02: this one is refused today. If a mutation that reddens 02
    // reddens this too, the pair is not separating "checks both" from "checks
    // one", which is the whole distinction 02 exists to make.
    const profileDir = await installPackage(MANIFEST, { 'step-2.js': 'export const unrelated = 1\n' })

    const resolution = await resolvePluginUpgrade('notes-plugin', profileDir)

    expect(resolution).toMatchObject({ kind: 'refused', reason: 'missing-descriptor-export' })
  })

  it('fault boundary 04 a module exporting BOTH resolves, so the refusals above are not constant', async () => {
    // Control for 01, 02 and 03 together. Without it, a `resolvePluginUpgrade`
    // that refused everything would satisfy all three — the over-broad
    // mutation that a negative-only suite cannot tell from a correct guard.
    const profileDir = await installPackage(MANIFEST, { 'step-2.js': DESCRIPTOR + MIGRATE })

    const resolution = await resolvePluginUpgrade('notes-plugin', profileDir)

    expect(resolution).toMatchObject({ kind: 'ready' })
  })
})

/** A home holding one plugin's interrupted-upgrade record. */
async function homeWithRecord(plugin: string, record: unknown): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-migration-recover-'))
  const path = upgradeRecordPath(home, plugin)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(record), 'utf8')
  return home
}

const INTERRUPTED = {
  plugin: 'notes-plugin',
  from: '1',
  to: '2',
  pathDigest: 'digest',
  snapshotHandle: 'snap-1',
  previousHandle: 'previous-1',
}

/** A facet whose rollback either works or reports the target is gone. */
function recoveringFacet(gone: boolean): MigrationFacet {
  return {
    stampedVersion: async () => 1,
    digestUnit: async () => 'sha256-x',
    readSnapshot: async () => ({ version: 1, content: { global: null, tables: {} } }),
    exportUnit: async () => {},
    snapshotUnit: async () => ({ unit: 'notes', handle: 'snap-1' }),
    materializeMigrated: async () => ({ unit: 'notes', handle: 'migrated-1' }),
    switchIn: async () => ({ unit: 'notes', handle: 'previous-1' }),
    rollbackTo: async (previous: { readonly handle: string }) => {
      if (gone) throw new Error(`rollback target ${previous.handle} is gone`)
    },
    discard: async () => {},
  } as unknown as MigrationFacet
}

describe('P1-10 Fault — recovery runs BEFORE anything is installed', () => {
  it('fault boundary 13 a plugin that cannot be recovered stops the command by NAME, with nothing cleared', async () => {
    // Ruled deliberately: before pnpm runs, which plugins would move is not
    // known, so continuing past a half-swapped plugin risks installing new
    // code onto exactly the data acceptance[0] forbids being mismatched.
    // Refusing here costs nothing, because nothing has moved yet.
    const home = await homeWithRecord('notes-plugin', INTERRUPTED)
    const cleared: string[] = []

    const outcome = await recoverInterruptedUpgrades(
      home,
      ['notes-plugin'],
      recoveringFacet(true),
      async (plugin) => { cleared.push(plugin) },
    )

    expect(outcome).toMatchObject({ kind: 'unrecoverable', plugin: 'notes-plugin' })
    expect((outcome as { detail: string }).detail).toMatch(/rollback target previous-1 is gone/u)
    // The record is NOT cleared: it is the only thing that still says what was
    // half-done, and an operator repairing this needs it.
    expect(cleared).toEqual([])
  })

  it('fault boundary 14 a recovery that succeeds reports the plugin and lets the command continue', async () => {
    // Control for 13. Without it, a `recoverInterruptedUpgrades` mutated to
    // refuse everything would satisfy 13 and stop every install in the
    // product — the over-broad mutation a negative-only pair cannot catch.
    const home = await homeWithRecord('notes-plugin', INTERRUPTED)
    const cleared: string[] = []

    const outcome = await recoverInterruptedUpgrades(
      home,
      ['notes-plugin'],
      recoveringFacet(false),
      async (plugin) => { cleared.push(plugin) },
    )

    expect(outcome).toEqual({ kind: 'recovered', plugins: ['notes-plugin'] })
    expect(cleared).toEqual(['notes-plugin'])
  })
})
