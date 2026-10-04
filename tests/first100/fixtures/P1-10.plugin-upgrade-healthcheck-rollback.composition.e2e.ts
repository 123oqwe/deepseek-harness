/**
 * A-596 (P1-10 blind 1-1, for B-711a): on the factory `dsh plugin` path with the
 * real JSON backend, an upgrade that FAILS its health check rolls back, and a
 * later `dsh plugin` run must leave the plugin's current data intact and must not
 * report the plugin unrecoverable. Today the second run deletes the current data
 * and reports `unrecoverable` — RED.
 *
 * `notes-plugin` (unit `notes`) is packed at version 1 (no migration) and version
 * 2 (a 1 → 2 migration). Version 1 is installed and its data seeded; then version
 * 2's upgrade runs. The version-2 migration's `migrate` stores a `notes` table
 * whose value is a string, which its own `validate` accepts but which the hub's
 * reopen (the transaction's health check, apps/cli/src/plugin-migration.ts:389 →
 * `openUnit`, which @deepseek-ai/dsh-storage-json rejects as "table is not an
 * object", format.ts:83) refuses — so the switch rolls back (`failedAt:
 * 'health-check'`, transaction.ts:238). A second `dsh plugin add` of version 2 is
 * then run, and the version-1 data is read back and the run's output inspected.
 *
 * Each run is its own `DSH_HOME` and a profile with no bundles. No product hook is
 * added. §21.4: the fix (B-711a) is not read.
 * @module tests/first100/fixtures/P1-10.plugin-upgrade-healthcheck-rollback.composition
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

const PROFILE = 'a596'
const PLUGIN = 'notes-plugin'
/** Deadline for one `dsh plugin` run. */
const COMMAND_TIMEOUT_MS = 120_000

const MANIFEST_BASE = {
  manifestVersion: 2,
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '*' },
  dataStores: [{ domainName: 'notes', dataClassification: 'confidential' }],
}

/**
 * The version-2 migration module: it stores a `notes` table whose value is a
 * STRING. Its own `validate` accepts the migrated content, but the hub's reopen
 * (the transaction's health check) rejects "table is not an object", so the
 * upgrade fails its health check and rolls back.
 */
const MIGRATE_2 = [
  "export const descriptor = { name: 'notes', version: 2, tables: ['notes'], hasGlobal: false }",
  'export async function migrate(content) {',
  "  return { ...content, tables: { ...content.tables, notes: 'corrupt-not-an-object' } }",
  '}',
  'export async function validate() {',
  '  return true',
  '}',
].join('\n')

/** The unit's content at version 1. */
const OLD_TABLES = { notes: { a: { body: 'original' } } }

/**
 * Pack the plugin at one version.
 * @param root - a directory for the package sources.
 * @param version - the package version.
 * @param withMigration - whether this version declares the 1 → 2 migration.
 * @returns the tarball's path.
 */
function pack(root: string, version: string, withMigration: boolean): string {
  const dir = join(root, `src-${version}`)
  mkdirSync(dir, { recursive: true })
  const dsh = withMigration
    ? { ...MANIFEST_BASE, migrations: [{ fromVersion: 1, toVersion: 2, description: 'corrupt notes', module: './migrate-2.js', reversible: true, backup: 'snapshot' }] }
    : MANIFEST_BASE
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PLUGIN, version, type: 'module', dsh }, undefined, 2))
  if (withMigration) writeFileSync(join(dir, 'migrate-2.js'), `${MIGRATE_2}\n`)
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`)
  return join(root, `${PLUGIN}-${version}.tgz`)
}

/** The unit descriptor at version 1. */
function notesAtV1(): KvUnitDescriptor {
  return { name: 'notes', version: 1, tables: ['notes'], hasGlobal: false }
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

/** Read the version-1 unit whole, or the error that stopped the open. */
async function readNotesV1(home: string): Promise<{ readonly tables: unknown } | { readonly error: string }> {
  try {
    return await withJsonBackend<{ readonly tables: unknown }>(home, async (kv) => {
      const unit = await kv.open(notesAtV1())
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

/** Run one `dsh plugin --profile a596 add <tarball>`. */
function addCommand(home: string, tarball: string) {
  return execa(process.execPath, ['--import', 'tsx/esm', binScript, 'plugin', '--profile', PROFILE, 'add', tarball], {
    cwd: repoRoot,
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  })
}

/** What the scenario left. */
interface Outcome {
  readonly upgradeExit: number | null
  readonly upgradeStderr: string
  /** Whether the upgrade failed specifically at the health check (the scenario this case needs). */
  readonly upgradeHealthCheckFailed: boolean
  readonly rerunExit: number | null
  readonly rerunStderr: string
  /** Whether the version-1 data is intact and whole after the rerun. */
  readonly dataIntact: boolean
  /** Whether the rerun reported the plugin unrecoverable. */
  readonly rerunUnrecoverable: boolean
  readonly dataError: string | null
}

const roots: string[] = []
let outcome: Outcome | undefined
let setupError: string | undefined

beforeAll(async () => {
  try {
    const packRoot = await mkdtemp(join(tmpdir(), 'p1-10-hc-pack-'))
    roots.push(packRoot)
    const v1 = pack(packRoot, '1.0.0', false)
    const v2 = pack(packRoot, '2.0.0', true)
    const home = await mkdtemp(join(tmpdir(), 'p1-10-hc-home-'))
    roots.push(home)
    initProfile(resolveProfileDir(PROFILE, home), [])

    const installed = await addCommand(home, v1)
    if (installed.exitCode !== 0) throw new Error(`installing version 1 failed: ${installed.stderr.slice(-800)}`)
    await withJsonBackend(home, async (kv) => {
      const unit = await kv.open(notesAtV1())
      try {
        await unit.putRecord('notes', 'a', { body: 'original' })
      } finally {
        await unit.close()
      }
    })

    const upgrade = await addCommand(home, v2)
    const rerun = await addCommand(home, v2)
    const reading = await readNotesV1(home)
    const rerunText = `${rerun.stderr}\n${rerun.stdout}`
    outcome = {
      upgradeExit: upgrade.exitCode ?? null,
      upgradeStderr: upgrade.stderr.slice(-800),
      upgradeHealthCheckFailed: /failed at health-check/iu.test(`${upgrade.stderr}\n${upgrade.stdout}`),
      rerunExit: rerun.exitCode ?? null,
      rerunStderr: rerun.stderr.slice(-800),
      dataIntact: 'tables' in reading && JSON.stringify(reading.tables) === JSON.stringify(OLD_TABLES),
      rerunUnrecoverable: /unrecoverable|could not be recovered/iu.test(rerunText),
      dataError: 'error' in reading ? reading.error : null,
    }
  } catch (error: unknown) {
    setupError = error instanceof Error ? error.message : String(error)
  }
}, 4 * COMMAND_TIMEOUT_MS)

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

/** The scenario's outcome, or the reason there is none. */
function outcomeOf(): Outcome {
  if (outcome === undefined) throw new Error(setupError ?? 'no outcome')
  return outcome
}

describe('P1-10 (A-596, B-711a red first): a health-check-failed upgrade rolls back, and a later dsh plugin run keeps the data and does not report unrecoverable', () => {
  it('after the rerun, the version-1 data is intact and the run did not report the plugin unrecoverable', () => {
    const result = outcomeOf()
    const context = JSON.stringify(result)
    // Guard: the upgrade actually failed AT THE HEALTH CHECK (so the rollback
    // under test happened); a false here means the migrate recipe did not reach
    // that phase and the case must be adjusted, not a silent pass.
    expect(result.upgradeHealthCheckFailed, context).toBe(true)
    // The current (version-1) data survives the rolled-back upgrade and the
    // following run. RED today: the second run deletes it.
    expect(result.dataIntact, context).toBe(true)
    // The following run recovers cleanly. RED today: it reports unrecoverable.
    expect(result.rerunUnrecoverable, context).toBe(false)
  })
})
