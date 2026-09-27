/**
 * A-540 · P1-10 (BLOCKED-302) acceptance[1] and acceptance[2] on the shipped
 * `dsh plugin add` upgrade path, driven end-to-end through the real CLI
 * (`apps/cli/src/bin.ts` → `runUnderLease` → `migrateChangedPlugins`) against a
 * real JSON storage medium — not a unit call to `reconcileUpgrade`, whose only
 * definition has no shipped caller today.
 *
 * acceptance[1] (data digest and schema version reconcilable): the shipped
 * upgrade flow must reconcile every plugin that carries a completed upgrade
 * record, including the plugin whose medium is already at the target schema
 * (the `stamped === unit.version` skip). A medium whose data digest no longer
 * matches the record — the data was changed between upgrades and this upgrade
 * does not migrate it — must be surfaced or refused. Today nothing on the
 * shipped path reconciles, so the tampered case passes silently; the
 * `reconciles` case is RED until B-667 wires the reconcile in. The control (a
 * package-version bump whose medium still matches its record) stays GREEN and
 * must stay GREEN after B-667 — it guards against a wiring that compares the
 * package version (`change.to`) instead of the schema version.
 *
 * acceptance[2] (a failed upgrade does not change already-approved
 * permissions): the plugin lock's `grantedCapabilities` (`plugins.lock.json`)
 * is the install-time approved-capability record. A data migration that fails
 * makes `dsh plugin add` roll the code back and return before it ever writes
 * the lock, so the approved set is left byte-for-byte intact. The one-line
 * sensitivity mutation (make the failed branch write the lock) is recorded in
 * the A-540 predictions; it turns this case RED.
 * @module tests/first100/fixtures/P1-10.reconcile.composition
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import StorageHub, { type KvFacet, type KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')

const PROFILE = 'p1-10-reconcile'
const PLUGIN = 'notes-plugin'
const LOCK_FILENAME = 'plugins.lock.json'
const COMMAND_TIMEOUT_MS = 120_000
/** The approved capability seeded into the lock before a failed upgrade (acceptance[2]). */
const SEEDED_CAPABILITY = 'p1-10-approved-cap'

const MANIFEST_BASE = {
  manifestVersion: 2,
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '*' },
  dataStores: [{ domainName: 'notes', dataClassification: 'confidential' }],
}

/** One declared migration path plus the test-owned module that performs it. */
interface MigrationSpec {
  readonly fromVersion: number
  readonly toVersion: number
  /** `true` if the migration's `validate` succeeds, `false` to fail the upgrade at validation. */
  readonly validates: boolean
}

/** The migration module body for one step: migrate adds a field, validate returns the spec's verdict. */
function migrationModule(spec: MigrationSpec): string {
  return [
    `export const descriptor = { name: 'notes', version: ${spec.toVersion}, tables: ['notes'], hasGlobal: false }`,
    'export async function migrate(content) {',
    `  return { ...content, tables: { ...content.tables, notes: { ...content.tables.notes, v${spec.toVersion}: { body: 'to-${spec.toVersion}' } } } }`,
    '}',
    `export async function validate() { return ${spec.validates ? 'true' : 'false'} }`,
    '',
  ].join('\n')
}

/**
 * Pack the plugin at one package version, declaring the given migration steps.
 * @param root - a directory for the package sources and the tarball.
 * @param version - the package version (independent of the data's schema version).
 * @param migrations - the declared migration steps, in order.
 * @returns the tarball's path.
 */
function pack(root: string, version: string, migrations: readonly MigrationSpec[]): string {
  const dir = join(root, `src-${version}`)
  mkdirSync(dir, { recursive: true })
  const dsh = migrations.length === 0
    ? MANIFEST_BASE
    : {
      ...MANIFEST_BASE,
      migrations: migrations.map(spec => ({
        fromVersion: spec.fromVersion,
        toVersion: spec.toVersion,
        description: `to ${spec.toVersion}`,
        module: `./migrate-${spec.fromVersion}-${spec.toVersion}.js`,
        reversible: true,
        backup: 'snapshot',
      })),
    }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PLUGIN, version, type: 'module', dsh }, undefined, 2))
  for (const spec of migrations) writeFileSync(join(dir, `migrate-${spec.fromVersion}-${spec.toVersion}.js`), migrationModule(spec))
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`)
  return join(root, `${PLUGIN}-${version}.tgz`)
}

/** Run `dsh plugin --profile <PROFILE> add <tarball>` through the real CLI. */
function addCommand(home: string, tarball: string) {
  return execa(process.execPath, ['--import', 'tsx/esm', binScript, 'plugin', '--profile', PROFILE, 'add', tarball], {
    cwd: repoRoot,
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  })
}

/** Mount the JSON backend the way the product mounts it and run one body against its KV facet. */
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

/** The notes unit descriptor at one schema version. */
function notesAt(version: number): KvUnitDescriptor {
  return { name: 'notes', version, tables: ['notes'], hasGlobal: false }
}

/** Write one record into the notes unit at the given schema version. */
async function putNote(home: string, version: number, key: string, body: string): Promise<void> {
  await withJsonBackend(home, async (kv) => {
    const unit = await kv.open(notesAt(version))
    try {
      await unit.putRecord('notes', key, { body })
    } finally {
      await unit.close()
    }
  })
}

/** The plugin lock's entry for `PLUGIN`, or `undefined`. */
interface LockEntry { readonly name: string; readonly grantedCapabilities?: readonly string[] }
interface LockFile { readonly lockfileVersion: number; entries: LockEntry[]; readonly loadOrder: readonly string[] }

function readLock(profileDir: string): LockFile {
  return JSON.parse(readFileSync(join(profileDir, LOCK_FILENAME), 'utf8')) as LockFile
}

/** What the acceptance[2] failed-upgrade scenario left for the assertions. */
interface Report {
  readonly failedExit: number | null
  readonly grantedBefore: readonly string[] | undefined
  readonly grantedAfter: readonly string[] | undefined
}

const roots: string[] = []
let cleanReport: { exit: number | null; stderr: string }
let tamperedReport: { exit: number | null; stderr: string }
let acc2Report: Report
const failures: string[] = []

/**
 * Install v1, seed the medium at schema 1, upgrade to v2 (migrates to schema 2
 * and writes the completed upgrade record), optionally change the medium's
 * data, then bump the package to v2.1 whose schema is still 2 (the
 * `stamped === unit.version` skip). Returns the v2.1 run's exit and stderr.
 */
async function reconcileScenario(home: string, tarballs: { v1: string; v2: string; v21: string }, tamper: boolean): Promise<{ exit: number | null; stderr: string }> {
  const profileDir = resolveProfileDir(PROFILE, home)
  initProfile(profileDir, [])
  const installed = await addCommand(home, tarballs.v1)
  if (installed.exitCode !== 0) throw new Error(`install v1 failed: ${installed.stderr.slice(-800)}`)
  await putNote(home, 1, 'a', 'original')
  const upgraded = await addCommand(home, tarballs.v2)
  if (upgraded.exitCode !== 0) throw new Error(`upgrade to v2 failed: ${upgraded.stderr.slice(-800)}`)
  if (tamper) await putNote(home, 2, 'a', 'tampered-after-the-recorded-upgrade')
  const bumped = await addCommand(home, tarballs.v21)
  return { exit: bumped.exitCode ?? null, stderr: bumped.stderr.slice(-1200) }
}

/**
 * Install v1, seed the medium and an approved capability into the lock, then
 * upgrade to a version whose 1→2 migration fails validation. Returns the lock's
 * `grantedCapabilities` before and after and the failed run's exit.
 */
async function failedUpgradeScenario(home: string, tarballs: { v1: string; vFail: string }): Promise<Report> {
  const profileDir = resolveProfileDir(PROFILE, home)
  initProfile(profileDir, [])
  const installed = await addCommand(home, tarballs.v1)
  if (installed.exitCode !== 0) throw new Error(`install v1 failed: ${installed.stderr.slice(-800)}`)
  await putNote(home, 1, 'a', 'original')
  const lock = readLock(profileDir)
  const entry = lock.entries.find(candidate => candidate.name === PLUGIN)
  if (entry === undefined) throw new Error(`no lock entry for ${PLUGIN} after install: ${JSON.stringify(lock)}`)
  const seeded: LockEntry = { ...entry, grantedCapabilities: [SEEDED_CAPABILITY] }
  lock.entries = lock.entries.map(candidate => candidate.name === PLUGIN ? seeded : candidate)
  writeFileSync(join(profileDir, LOCK_FILENAME), JSON.stringify(lock, undefined, 2))
  const grantedBefore = readLock(profileDir).entries.find(candidate => candidate.name === PLUGIN)?.grantedCapabilities
  const failed = await addCommand(home, tarballs.vFail)
  const grantedAfter = readLock(profileDir).entries.find(candidate => candidate.name === PLUGIN)?.grantedCapabilities
  return { failedExit: failed.exitCode ?? null, grantedBefore, grantedAfter }
}

beforeAll(async () => {
  const packRoot = await mkdtemp(join(tmpdir(), 'p1-10-reconcile-pack-'))
  roots.push(packRoot)
  const v1 = pack(packRoot, '1.0.0', [])
  const v2 = pack(packRoot, '2.0.0', [{ fromVersion: 1, toVersion: 2, validates: true }])
  const v21 = pack(packRoot, '2.1.0', [{ fromVersion: 1, toVersion: 2, validates: true }])
  const vFail = pack(packRoot, '2.5.0', [{ fromVersion: 1, toVersion: 2, validates: false }])
  const homes = await Promise.all(['clean', 'tampered', 'acc2'].map(async (label) => {
    const home = await mkdtemp(join(tmpdir(), `p1-10-reconcile-${label}-`))
    roots.push(home)
    return home
  }))
  const [cleanHome, tamperedHome, acc2Home] = homes as [string, string, string]
  const results = await Promise.allSettled([
    reconcileScenario(cleanHome, { v1, v2, v21 }, false),
    reconcileScenario(tamperedHome, { v1, v2, v21 }, true),
    failedUpgradeScenario(acc2Home, { v1, vFail }),
  ])
  const [clean, tampered, acc2] = results
  if (clean.status === 'fulfilled') cleanReport = clean.value; else failures.push(`clean: ${String(clean.reason)}`)
  if (tampered.status === 'fulfilled') tamperedReport = tampered.value; else failures.push(`tampered: ${String(tampered.reason)}`)
  if (acc2.status === 'fulfilled') acc2Report = acc2.value; else failures.push(`acc2: ${String(acc2.reason)}`)
}, 6 * COMMAND_TIMEOUT_MS + 60_000)

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

/** Whether a run surfaced or refused the plugin as unreconciled. */
function surfacedUnreconciled(report: { exit: number | null; stderr: string }): boolean {
  return report.exit !== 0 || /does not reconcile|does not match/i.test(report.stderr)
}

describe('A-540 P1-10 acceptance[1]: the shipped upgrade flow reconciles a completed upgrade record against the medium', () => {
  it('a package-version bump whose data still matches its recorded upgrade reconciles cleanly (control — stays green after B-667)', () => {
    if (failures.length > 0) throw new Error(failures.join('; '))
    expect(cleanReport.exit, cleanReport.stderr).toBe(0)
    expect(surfacedUnreconciled(cleanReport), cleanReport.stderr).toBe(false)
  })

  it('a package-version bump whose data was changed after the recorded upgrade (schema unchanged, so it is not migrated) is surfaced or refused — RED until B-667 wires the reconcile into the shipped upgrade flow', () => {
    if (failures.length > 0) throw new Error(failures.join('; '))
    expect(surfacedUnreconciled(tamperedReport), `exit ${String(tamperedReport.exit)}; stderr:\n${tamperedReport.stderr}`).toBe(true)
  })
})

describe('A-540 P1-10 acceptance[2]: a failed upgrade leaves the lock\'s approved capabilities unchanged', () => {
  it('a data migration that fails validation rolls the code back and leaves grantedCapabilities byte-for-byte intact', () => {
    if (failures.length > 0) throw new Error(failures.join('; '))
    expect(acc2Report.failedExit, 'the upgrade must genuinely fail for this to test the failed path').not.toBe(0)
    expect(acc2Report.grantedBefore).toEqual([SEEDED_CAPABILITY])
    expect(acc2Report.grantedAfter, 'a failed upgrade must not rewrite the approved-capability record').toEqual([SEEDED_CAPABILITY])
  })
})
