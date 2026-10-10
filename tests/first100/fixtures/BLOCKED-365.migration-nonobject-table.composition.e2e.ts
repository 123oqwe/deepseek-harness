/**
 * BLOCKED-365 red first: a plugin migration that hands back a table that is not
 * a plain object must not be written as data. Today the JSON backend's
 * migration writer (`writeDocument`, packages/storage/storage-json/src/index.ts)
 * builds every table with `Object.entries(records)`, so a string table is
 * written as an object of its characters, stamped at the new version, and
 * passes the health check and every later open: the plugin's data is silently
 * replaced. Ruled fix (lane A): the writer refuses such a table, so the upgrade
 * fails in its migrate phase and rolls back.
 *
 * Driven through the shipped `dsh plugin add` (the source CLI) over a real JSON
 * backend, with the harness of the P1-10 healthcheck-rollback evidence: each
 * scenario has its own `DSH_HOME`, installs `notes-plugin` at version 1 (no
 * migration), seeds its unit, then adds version 2, whose 1 → 2 migration
 * returns the scenario's tables. N1's migration returns `notes` as a string;
 * N2's (the control) returns a valid object table, so a refusal in N1 is about
 * the table's shape, not about migrating at all.
 *
 * Red first for lane A's fix (§17), written on S5′ 9f06a87ee3 before the fix
 * existed.
 * @module tests/first100/fixtures/BLOCKED-365.migration-nonobject-table.composition
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import StorageHub, { type KvFacet, type KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')

const PROFILE = 'b365'
const PLUGIN = 'notes-plugin'
/** Deadline for one `dsh plugin` run. */
const COMMAND_TIMEOUT_MS = 120_000

const MANIFEST_BASE = {
  manifestVersion: 2,
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '*' },
  dataStores: [{ domainName: 'notes', dataClassification: 'confidential' }],
}

/** The unit's content at version 1. */
const OLD_TABLES = { notes: { a: { body: 'original' } } }

/** The control migration's result: a valid object table with one field added. */
const NEW_TABLES = { notes: { a: { body: 'original', migrated: true } } }

/**
 * The version-2 migration module returning `tablesSource` (a JavaScript expression) as its tables.
 * @param tablesSource - the expression the module returns as `tables`.
 * @returns the module source.
 */
function migrationModule(tablesSource: string): string {
  return [
    "export const descriptor = { name: 'notes', version: 2, tables: ['notes'], hasGlobal: false }",
    'export async function migrate(content) {',
    `  return { ...content, tables: ${tablesSource} }`,
    '}',
    'export async function validate() {',
    '  return true',
    '}',
  ].join('\n')
}

/**
 * Pack the plugin at one version.
 * @param root - a directory for the package sources.
 * @param version - the package version.
 * @param migration - the 1 → 2 migration module's source, or none at version 1.
 * @returns the tarball's path.
 */
function pack(root: string, version: string, migration: string | undefined): string {
  const dir = join(root, `src-${version}`)
  mkdirSync(dir, { recursive: true })
  const dsh = migration === undefined
    ? MANIFEST_BASE
    : { ...MANIFEST_BASE, migrations: [{ fromVersion: 1, toVersion: 2, description: 'reshape notes', module: './migrate-2.js', reversible: true, backup: 'snapshot' }] }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PLUGIN, version, type: 'module', dsh }, undefined, 2))
  if (migration !== undefined) writeFileSync(join(dir, 'migrate-2.js'), `${migration}\n`)
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`)
  return join(root, `${PLUGIN}-${version}.tgz`)
}

/**
 * The unit descriptor at one version.
 * @param version - the schema version.
 * @returns the descriptor.
 */
function notesAt(version: number): KvUnitDescriptor {
  return { name: 'notes', version, tables: ['notes'], hasGlobal: false }
}

/**
 * Run one body against the JSON backend mounted as the product mounts it.
 * @param home - the harness home.
 * @param body - receives the backend's KV facet.
 * @returns the body's value.
 */
async function withJsonBackend<T>(home: string, body: (kv: KvFacet) => Promise<T>): Promise<T> {
  const ctx = new Context()
  await ctx.plugin(StorageHub)
  await ctx.plugin(storageJson, { root: join(home, 'storages') })
  try {
    const kv = ctx.storage.backend.get('json').kv
    if (kv === undefined) throw new Error('the JSON backend offers no KV facet')
    return await body(kv)
  } finally {
    await ctx.fiber.dispose()
  }
}

/**
 * Read the unit whole at one version, or the error that stopped the open.
 * @param home - the harness home.
 * @param version - the schema version to open at.
 * @returns the tables, or the error message.
 */
async function readNotes(home: string, version: number): Promise<{ readonly tables: unknown } | { readonly error: string }> {
  try {
    return await withJsonBackend<{ readonly tables: unknown }>(home, async (kv) => {
      const unit = await kv.open(notesAt(version))
      try {
        return { tables: (await unit.loadAll()).tables }
      } finally {
        await unit.close()
      }
    })
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Run one `dsh plugin --profile b365 add <tarball>`.
 * @param home - the harness home.
 * @param tarball - the package to add.
 * @returns the finished process.
 */
function addCommand(home: string, tarball: string) {
  return execa(process.execPath, ['--import', 'tsx/esm', binScript, 'plugin', '--profile', PROFILE, 'add', tarball], {
    cwd: repoRoot,
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  })
}

/** What one scenario left. */
interface Scenario {
  readonly upgradeExit: number | null
  readonly upgradeText: string
  readonly atV1: { readonly tables: unknown } | { readonly error: string }
  readonly atV2: { readonly tables: unknown } | { readonly error: string }
}

const roots: string[] = []
const scenarios = new Map<string, Scenario>()
let setupError: string | undefined

/**
 * Install version 1, seed its unit, add version 2 with `migration`, then read the unit at both versions.
 * @param name - the scenario's key.
 * @param migration - the version-2 migration module's source.
 */
async function runScenario(name: string, migration: string): Promise<void> {
  const packRoot = await mkdtemp(join(tmpdir(), `b365-${name}-pack-`))
  roots.push(packRoot)
  const v1 = pack(packRoot, '1.0.0', undefined)
  const v2 = pack(packRoot, '2.0.0', migration)
  const home = await mkdtemp(join(tmpdir(), `b365-${name}-home-`))
  roots.push(home)
  initProfile(resolveProfileDir(PROFILE, home), [])

  const installed = await addCommand(home, v1)
  if (installed.exitCode !== 0) throw new Error(`${name}: installing version 1 failed: ${installed.stderr.slice(-800)}`)
  await withJsonBackend(home, async (kv) => {
    const unit = await kv.open(notesAt(1))
    try {
      await unit.putRecord('notes', 'a', { body: 'original' })
    } finally {
      await unit.close()
    }
  })

  const upgrade = await addCommand(home, v2)
  scenarios.set(name, {
    upgradeExit: upgrade.exitCode ?? null,
    upgradeText: `${upgrade.stderr}\n${upgrade.stdout}`.slice(-1200),
    atV1: await readNotes(home, 1),
    atV2: await readNotes(home, 2),
  })
}

beforeAll(async () => {
  try {
    await runScenario('string-table', migrationModule(`{ ...content.tables, notes: 'not-a-table' }`))
    await runScenario('object-table', migrationModule(JSON.stringify(NEW_TABLES)))
  } catch (error: unknown) {
    setupError = error instanceof Error ? error.message : String(error)
  }
}, 6 * COMMAND_TIMEOUT_MS)

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

/**
 * One scenario's outcome, or the reason there is none.
 * @param name - the scenario's key.
 * @returns the outcome.
 */
function scenario(name: string): Scenario {
  const found = scenarios.get(name)
  if (found === undefined) throw new Error(setupError ?? `no outcome for ${name}`)
  return found
}

describe('BLOCKED-365: a migration that returns a table that is not a plain object is refused, not written as data', () => {
  it('a string table: the upgrade is not completed and the version-1 data stays whole (today the string is written as an object of its characters — RED)', () => {
    const result = scenario('string-table')
    const context = JSON.stringify(result)
    expect(result.atV1, context).toEqual({ tables: OLD_TABLES })
    const reportedFailure = result.upgradeExit !== 0 || new RegExp(`${PLUGIN}[^\\n]*(fail|refus|cannot)`, 'iu').test(result.upgradeText)
    expect(reportedFailure, context).toBe(true)
  })

  it('control: a valid object table upgrades, and the unit holds the migrated table at version 2', () => {
    const result = scenario('object-table')
    const context = JSON.stringify(result)
    expect(result.upgradeExit, context).toBe(0)
    expect(result.atV2, context).toEqual({ tables: NEW_TABLES })
  })
})
