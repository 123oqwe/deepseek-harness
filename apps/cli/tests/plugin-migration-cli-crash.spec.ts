/**
 * P1-10 acceptance[0] on the CLI path (BLOCKED-302 condition [0], BLOCKED-279):
 * `dsh plugin add` upgrading a plugin from version 1 to version 2 is killed at
 * a point the parent observes from outside, and after the operator runs the
 * same command again the plugin's code and data are at one version, and the
 * data is usable under it.
 *
 * Each scenario has its own `DSH_HOME` and a profile made with no bundles. The
 * plugin (`notes-plugin`, unit `notes`, as the product's own migration fixture
 * names them) is packed at both versions; version 2 declares a 1 → 2
 * migration whose module is test-owned plugin code that, when `A447_HOLD`
 * names a point, writes that point to `A447_MARK` and waits there to be
 * killed: on import (new code installed, transaction not started), in
 * `migrate`, or in `validate`. Two further points are read from the product's
 * own upgrade record (`plugin-upgrades/notes-plugin.json`) and are racy: after
 * the switch before the health check is recorded, and after the upgrade is
 * recorded as achieved. No product hook is added.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import StorageHub, { type KvFacet, type KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { upgradeRecordPath } from '../src/plugin-migration.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')

const PROFILE = 'a447'
const PLUGIN = 'notes-plugin'
/** Longest a restart waits for the killed command's upgrade lease (30 s in the product) to lapse. */
const LEASE_WAIT_MS = 45_000
/** Deadline for one `dsh plugin` run. */
const COMMAND_TIMEOUT_MS = 120_000

const MANIFEST_BASE = {
  manifestVersion: 2,
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '*' },
  dataStores: [{ domainName: 'notes', dataClassification: 'confidential' }],
}

/** The version-2 migration module: test-owned plugin code with three places it can be held. */
const MIGRATE_2 = [
  "import { writeFileSync } from 'node:fs'",
  "import { setTimeout as sleep } from 'node:timers/promises'",
  'async function hold(point) {',
  '  if (process.env.A447_HOLD !== point) return',
  '  writeFileSync(process.env.A447_MARK, point)',
  '  for (;;) await sleep(1000)',
  '}',
  "await hold('import')",
  "export const descriptor = { name: 'notes', version: 2, tables: ['notes'], hasGlobal: false }",
  'export async function migrate(content) {',
  "  await hold('migrate')",
  "  return { ...content, tables: { ...content.tables, notes: { ...content.tables.notes, b: { body: 'migrated' } } } }",
  '}',
  'export async function validate() {',
  "  await hold('validate')",
  '  return true',
  '}',
].join('\n')

/** The unit's content at version 1 and at version 2. */
const OLD_TABLES = { notes: { a: { body: 'original' } } }
const NEW_TABLES = { notes: { a: { body: 'original' }, b: { body: 'migrated' } } }

/** Where a scenario kills the upgrading command. */
type KillPoint = 'none' | 'import' | 'migrate' | 'validate' | 'switch' | 'achieved'

const KILL_POINTS: readonly KillPoint[] = ['none', 'import', 'migrate', 'validate', 'switch', 'achieved']

/** What one scenario left. */
interface Outcome {
  readonly killedBy: string | null
  /** What the parent saw when it killed, or `null` when it did not. */
  readonly observedAtKill: string | null
  readonly restartExit: number | null
  readonly restartStderr: string
  /** The installed code's version after the restart. */
  readonly codeVersion: string | null
  /** The version whose descriptor opens the unit and reads the whole expected content, or `null` when neither does. */
  readonly dataVersion: number | null
  readonly unitErrors: readonly string[]
}

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
    ? {
      ...MANIFEST_BASE,
      migrations: [{ fromVersion: 1, toVersion: 2, description: 'add b', module: './migrate-2.js', reversible: true, backup: 'snapshot' }],
    }
    : MANIFEST_BASE
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PLUGIN, version, type: 'module', dsh }, undefined, 2))
  if (withMigration) writeFileSync(join(dir, 'migrate-2.js'), `${MIGRATE_2}\n`)
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`)
  return join(root, `${PLUGIN}-${version}.tgz`)
}

/**
 * Run one body against the JSON backend mounted as the product mounts it.
 * @param home - the scenario's harness home.
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
 * The unit descriptor at one version.
 * @param version - the version.
 * @returns the descriptor.
 */
function notesAt(version: number): KvUnitDescriptor {
  return { name: 'notes', version, tables: ['notes'], hasGlobal: false }
}

/**
 * Open the unit under one version's descriptor and read it whole.
 * @param home - the scenario's harness home.
 * @param version - the version.
 * @returns the tables, or the error that stopped the open.
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
    return { error: `v${String(version)}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Start one `dsh plugin --profile a447 add <tarball>` run.
 * @param home - the scenario's harness home.
 * @param tarball - the tarball to add.
 * @param hold - the extra environment that holds the plugin's migration code, if any.
 * @returns the running process.
 */
function addCommand(home: string, tarball: string, hold: Readonly<Record<string, string>> = {}) {
  return execa(process.execPath, ['--import', 'tsx/esm', binScript, 'plugin', '--profile', PROFILE, 'add', tarball], {
    cwd: repoRoot,
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ...hold },
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  })
}

/**
 * The product's upgrade record for the plugin, when one is on disk.
 * @param home - the scenario's harness home.
 * @returns its fields, or `undefined`.
 */
function upgradeRecord(home: string): { readonly previousHandle?: unknown; readonly upgradedTo?: unknown } | undefined {
  const path = upgradeRecordPath(home, PLUGIN)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { readonly previousHandle?: unknown; readonly upgradedTo?: unknown }
  } catch {
    // The record is replaced atomically; a read that races the rename reads it next time.
    return undefined
  }
}

/**
 * Whether the parent should kill now, and what it saw.
 * @param point - the scenario's kill point.
 * @param home - the scenario's harness home.
 * @param mark - the plugin code's mark file.
 * @returns a description of what was seen, or `undefined` to keep waiting.
 */
function killCondition(point: KillPoint, home: string, mark: string): string | undefined {
  if (point === 'none') return undefined
  if (point === 'import' || point === 'migrate' || point === 'validate') {
    return existsSync(mark) && readFileSync(mark, 'utf8') === point ? `plugin code held at ${point}` : undefined
  }
  const record = upgradeRecord(home)
  if (record === undefined) return undefined
  if (point === 'switch') {
    return record.previousHandle !== undefined && record.upgradedTo === undefined ? `record: ${JSON.stringify(record)}` : undefined
  }
  return record.upgradedTo === undefined ? undefined : `record: ${JSON.stringify(record)}`
}

/**
 * Install version 1, seed its data, upgrade to version 2 killing at the point,
 * restart by running the same command again, and read code and data.
 * @param point - the kill point.
 * @param home - the scenario's harness home.
 * @param tarballs - the packed versions.
 * @param tarballs.v1 - version 1.
 * @param tarballs.v2 - version 2.
 * @returns what the scenario left.
 */
async function run(point: KillPoint, home: string, tarballs: { readonly v1: string; readonly v2: string }): Promise<Outcome> {
  const profileDir = resolveProfileDir(PROFILE, home)
  initProfile(profileDir, [])
  const installed = await addCommand(home, tarballs.v1)
  if (installed.exitCode !== 0) throw new Error(`installing version 1 failed: ${installed.stderr.slice(-800)}`)
  await withJsonBackend(home, async (kv) => {
    const unit = await kv.open(notesAt(1))
    try {
      await unit.putRecord('notes', 'a', { body: 'original' })
    } finally {
      await unit.close()
    }
  })

  const mark = join(home, 'a447-mark')
  const racy = point === 'switch' || point === 'achieved'
  const upgrade = addCommand(home, tarballs.v2, point === 'none' || racy ? {} : { A447_HOLD: point, A447_MARK: mark })
  const exit = { done: false }
  void upgrade.finally(() => { exit.done = true })
  let observedAtKill: string | null = null
  while (!exit.done) {
    const seen = killCondition(point, home, mark)
    if (seen !== undefined) {
      observedAtKill = seen
      upgrade.kill('SIGKILL')
      break
    }
    await delay(racy ? 2 : 50)
  }
  const upgraded = await upgrade

  const deadline = Date.now() + LEASE_WAIT_MS
  let restarted = await addCommand(home, tarballs.v2)
  while (restarted.exitCode !== 0 && restarted.stderr.includes('is upgrading plugins') && Date.now() < deadline) {
    await delay(2_000)
    restarted = await addCommand(home, tarballs.v2)
  }

  const codeManifest = join(profileDir, 'node_modules', PLUGIN, 'package.json')
  const readings = [await readNotes(home, 1), await readNotes(home, 2)]
  const whole = [OLD_TABLES, NEW_TABLES]
  const opened = readings.flatMap((reading, index) =>
    'tables' in reading && JSON.stringify(reading.tables) === JSON.stringify(whole[index]) ? [index + 1] : [])
  return {
    killedBy: upgraded.signal ?? null,
    observedAtKill,
    restartExit: restarted.exitCode ?? null,
    restartStderr: restarted.stderr.slice(-800),
    codeVersion: existsSync(codeManifest) ? (JSON.parse(readFileSync(codeManifest, 'utf8')) as { version?: string }).version ?? null : null,
    dataVersion: opened.length === 1 ? opened[0] ?? null : null,
    unitErrors: readings.flatMap(reading => 'error' in reading ? [reading.error] : []),
  }
}

const roots: string[] = []
const outcomes = new Map<KillPoint, Outcome>()
const failures = new Map<KillPoint, string>()

beforeAll(async () => {
  const packRoot = await mkdtemp(join(tmpdir(), 'p1-10-cli-crash-pack-'))
  roots.push(packRoot)
  const tarballs = { v1: pack(packRoot, '1.0.0', false), v2: pack(packRoot, '2.0.0', true) }
  // Concurrent, each in its own home, so the campaign waits out one lease rather than five.
  await Promise.all(KILL_POINTS.map(async (point) => {
    const home = await mkdtemp(join(tmpdir(), `p1-10-cli-crash-${point}-`))
    roots.push(home)
    try {
      outcomes.set(point, await run(point, home, tarballs))
    } catch (error: unknown) {
      failures.set(point, error instanceof Error ? error.message : String(error))
    }
  }))
}, 2 * COMMAND_TIMEOUT_MS + LEASE_WAIT_MS + 60_000)

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

/**
 * One scenario's outcome, or the reason there is none.
 * @param point - the kill point.
 * @returns the outcome.
 */
function outcomeOf(point: KillPoint): Outcome {
  const outcome = outcomes.get(point)
  if (outcome === undefined) throw new Error(failures.get(point) ?? `no outcome for ${point}`)
  return outcome
}

/**
 * The code version as the unit version it ships.
 * @param outcome - one scenario's outcome.
 * @returns 1 or 2, or `null` for anything else.
 */
function codeAt(outcome: Outcome): number | null {
  if (outcome.codeVersion === '1.0.0') return 1
  if (outcome.codeVersion === '2.0.0') return 2
  return null
}

/**
 * Assert the code and the data are at one version after the restart, and the data opens whole under it.
 * @param point - the kill point.
 */
function expectOneVersion(point: KillPoint): void {
  const outcome = outcomeOf(point)
  const context = JSON.stringify(outcome)
  expect(outcome.dataVersion, context).not.toBeNull()
  expect({ code: codeAt(outcome), data: outcome.dataVersion }, context).toEqual({ code: outcome.dataVersion, data: outcome.dataVersion })
}

/**
 * Assert the plugin code was held at the point and the command died by SIGKILL there.
 * @param point - the kill point.
 */
function expectKilledAt(point: KillPoint): void {
  const outcome = outcomeOf(point)
  expect([outcome.killedBy, outcome.observedAtKill], JSON.stringify(outcome)).toEqual(['SIGKILL', `plugin code held at ${point}`])
}

/**
 * Record, on the running case's `task.meta` for diagnostics only (A-453, no
 * assertion), the stage the parent actually killed the upgrade at and the two
 * versions the restart left. For the two race points ('switch', 'achieved') —
 * whose kill lands in a narrow window the assertion does not require to be hit —
 * it also records whether this run hit that window.
 * @param meta - the running case's `task.meta`.
 * @param point - the kill point the case exercises.
 */
function recordKill(meta: object, point: KillPoint): void {
  const outcome = outcomeOf(point)
  Object.assign(meta, {
    killedAt: outcome.observedAtKill,
    codeVersion: outcome.codeVersion,
    dataVersion: outcome.dataVersion,
    ...(point === 'switch' || point === 'achieved'
      ? { hitWindow: outcome.observedAtKill === `plugin code held at ${point}` }
      : {}),
  })
}

describe('P1-10 acceptance[0] on the CLI path: after a killed dsh plugin upgrade and a rerun, code and data are at one version', () => {
  it('control: an upgrade that is not killed leaves version 2 code and version 2 data, readable', ({ task }) => {
    recordKill(task.meta, 'none')
    const outcome = outcomeOf('none')
    expect({ code: codeAt(outcome), data: outcome.dataVersion }, JSON.stringify(outcome)).toEqual({ code: 2, data: 2 })
  })

  it('killed once the new code is installed and before the transaction starts, the rerun leaves code and data at one version', ({ task }) => {
    recordKill(task.meta, 'import')
    expectKilledAt('import')
    expectOneVersion('import')
  })

  it('killed in the plugin migrate step, the rerun leaves code and data at one version', ({ task }) => {
    recordKill(task.meta, 'migrate')
    expectKilledAt('migrate')
    expectOneVersion('migrate')
  })

  it('killed in the plugin validate step, the rerun leaves code and data at one version', ({ task }) => {
    recordKill(task.meta, 'validate')
    expectKilledAt('validate')
    expectOneVersion('validate')
  })

  it('killed once the switch is recorded and before the health check is, the rerun leaves code and data at one version', ({ task }) => {
    recordKill(task.meta, 'switch')
    expectOneVersion('switch')
  })

  it('killed once the upgrade is recorded as achieved, the rerun leaves code and data at one version', ({ task }) => {
    recordKill(task.meta, 'achieved')
    expectOneVersion('achieved')
  })
})
