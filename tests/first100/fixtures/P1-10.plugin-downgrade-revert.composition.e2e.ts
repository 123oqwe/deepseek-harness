/**
 * A-609 sub-case ① (P1-10 1-3, green evidence): a package DOWNGRADE whose data
 * version cannot be reached is refused, and the install is REVERTED — the
 * profile's lockfile goes back to the version installed before the downgrade,
 * not left at the downgraded one. acceptance[1]'s refuse-and-revoke.
 *
 * `notes-plugin` v1 (no migration) is installed and its data seeded; v2 declares
 * a REVERSIBLE, valid 1 → 2 migration, so the upgrade to v2 succeeds and the data
 * reaches v2. Then v1 is installed again (a downgrade): `migrateChangedPlugins`
 * plans from the stamped data version (2) to the v1 manifest's current (1), finds
 * no migration from 2, and `runUpgrade` refuses at freeze (`unreachable`). The
 * CLI's `outcomes.failed` branch then runs `rollbackCode`, which restores the
 * profile's `package.json` + `pnpm-lock.yaml` to what they were before this
 * install — i.e. v2 — so the install is reverted.
 *
 * The lockfile bytes captured after the v1→v2 upgrade and after the refused
 * downgrade are compared: equal means the install reverted to v2. Green evidence
 * on the shipped path; a NON-revert (lock left at v1) would be the real defect
 * the delegate flagged (reported, not asserted green). Each run is its own
 * `DSH_HOME`. §21.4 does not apply (existing behaviour, no paired fix).
 * @module tests/first100/fixtures/P1-10.plugin-downgrade-revert.composition
 */

import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const PROFILE = 'a609d'
const PLUGIN = 'notes-plugin'
const COMMAND_TIMEOUT_MS = 120_000

const MANIFEST_BASE = {
  manifestVersion: 2,
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '*' },
  dataStores: [{ domainName: 'notes', dataClassification: 'confidential' }],
}

/** v2's 1 → 2 migration: REVERSIBLE and VALID (keeps `notes` an object), so the upgrade to v2 succeeds. */
const MIGRATE_2_REVERSIBLE = [
  "export const descriptor = { name: 'notes', version: 2, tables: ['notes'], hasGlobal: false }",
  'export async function migrate(content) {',
  '  return { ...content, tables: { ...content.tables, notes: { ...(content.tables?.notes ?? {}), v2: true } } }',
  '}',
  'export async function validate() {',
  '  return true',
  '}',
].join('\n')

/** Pack the plugin at one version; v2 carries the reversible migration. */
function pack(root: string, version: string, withMigration: boolean): string {
  const dir = join(root, `src-${version}`)
  mkdirSync(dir, { recursive: true })
  const dsh = withMigration
    ? { ...MANIFEST_BASE, migrations: [{ fromVersion: 1, toVersion: 2, description: 'reversible notes change', module: './migrate-2.js', reversible: true, backup: 'snapshot' }] }
    : MANIFEST_BASE
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PLUGIN, version, type: 'module', dsh }, undefined, 2))
  if (withMigration) writeFileSync(join(dir, 'migrate-2.js'), `${MIGRATE_2_REVERSIBLE}\n`)
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`)
  return join(root, `${PLUGIN}-${version}.tgz`)
}

/** The unit descriptor at version 1. */
function notesAtV1(): KvUnitDescriptor {
  return { name: 'notes', version: 1, tables: ['notes'], hasGlobal: false }
}

/** Run one body against the JSON backend mounted as the product mounts it. */
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

/** Run one `dsh plugin --profile a609d add <tarball>`. */
function addCommand(home: string, tarball: string) {
  return execa(process.execPath, ['--import', 'tsx/esm', binScript, 'plugin', '--profile', PROFILE, 'add', tarball], {
    cwd: repoRoot,
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  })
}

/** What the downgrade scenario observed. */
interface DowngradeOutcome {
  readonly upgradeExit: number | null
  readonly downgradeExit: number | null
  readonly downgradeText: string
  /** The profile lockfile bytes after the v1→v2 upgrade (v2's lock). */
  readonly lockAfterUpgrade: string | null
  /** The profile lockfile bytes after the refused downgrade — equal to the above iff the install reverted. */
  readonly lockAfterDowngrade: string | null
}

const roots: string[] = []
let outcome: DowngradeOutcome | undefined
let setupError: string | undefined

beforeAll(async () => {
  try {
    const packRoot = await mkdtemp(join(tmpdir(), 'p1-10-down-pack-'))
    roots.push(packRoot)
    const v1 = pack(packRoot, '1.0.0', false)
    const v2 = pack(packRoot, '2.0.0', true)
    const home = await mkdtemp(join(tmpdir(), 'p1-10-down-home-'))
    roots.push(home)
    const profileDir = resolveProfileDir(PROFILE, home)
    initProfile(profileDir, [])
    const lockPath = join(profileDir, 'pnpm-lock.yaml')
    const readLock = (): string | null => existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null

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
    const lockAfterUpgrade = readLock()
    const downgrade = await addCommand(home, v1)
    const lockAfterDowngrade = readLock()

    outcome = {
      upgradeExit: upgrade.exitCode ?? null,
      downgradeExit: downgrade.exitCode ?? null,
      downgradeText: `${downgrade.stderr}\n${downgrade.stdout}`.slice(-1000),
      lockAfterUpgrade,
      lockAfterDowngrade,
    }
  } catch (error: unknown) {
    setupError = error instanceof Error ? error.message : String(error)
  }
}, 4 * COMMAND_TIMEOUT_MS)

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

describe('P1-10 1-3 (A-609 ①, green evidence): a refused downgrade reverts the install to the version before it', () => {
  it('the downgrade is refused and the profile lockfile reverts to the pre-downgrade (v2) bytes', () => {
    if (outcome === undefined) throw new Error(setupError ?? 'no outcome')
    const result = outcome
    const context = JSON.stringify({ ...result, lockAfterUpgrade: result.lockAfterUpgrade === null ? null : '<bytes>', lockAfterDowngrade: result.lockAfterDowngrade === null ? null : '<bytes>' })
    // Guard: the v1→v2 upgrade succeeded (so the data is at v2 and a captured v2
    // lockfile exists to compare against). A failure here means the recipe did
    // not reach the downgrade, not that the subject passed.
    expect({ upgradeExit: result.upgradeExit, haveLock: result.lockAfterUpgrade !== null }, context)
      .toEqual({ upgradeExit: 0, haveLock: true })
    // The downgrade is refused: it cannot migrate the v2 data down to v1.
    expect(result.downgradeExit, context).toBe(1)
    expect(result.downgradeText, context).toMatch(/freeze|unreachable/u)
    // acceptance[1]: the refused downgrade is REVOKED — the install reverts, so
    // the profile lockfile is back to its pre-downgrade (v2) bytes, not left at
    // the downgraded v1. A non-revert here is the real defect, reported not
    // asserted green.
    expect(result.lockAfterDowngrade, context).toBe(result.lockAfterUpgrade)
  })
})
