/**
 * A-604 (P1-10 blind 1-2, for B-711a): on the factory `dsh plugin` path with the
 * real JSON backend, when a plugin's data is already at an intermediate schema
 * version, an upgrade must run ONLY the remaining migration steps — it must not
 * re-run a step already applied, and the steps it plans must be the steps it runs.
 * Today the upgrade re-runs the already-applied step — RED.
 *
 * `notes-plugin` (unit `notes`) is packed at v1 (no migration), v2 (a 1→2
 * migration), and v3 (both 1→2 and 2→3). Each migration module appends its step
 * id to `$DSH_HOME/a604-steps.log` when it runs. v1 is installed and its data
 * seeded; `add v2` runs 1→2 (the log gets `1-2` once; data now at v2); then
 * `add v3` upgrades v2→v3, which must run ONLY 2→3. The step log is read back: a
 * second `1-2` entry is the already-applied step being re-run.
 *
 * Each run is its own `DSH_HOME` and a profile with no bundles. No product hook is
 * added. §21.4: the fix (B-711a) is not read.
 * @module tests/first100/fixtures/P1-10.plugin-upgrade-no-rerun.composition
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

const PROFILE = 'a604'
const PLUGIN = 'notes-plugin'
const STEPS_LOG = 'a604-steps.log'
const COMMAND_TIMEOUT_MS = 120_000

const MANIFEST_BASE = {
  manifestVersion: 2,
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '*' },
  dataStores: [{ domainName: 'notes', dataClassification: 'confidential' }],
}

/** A migration module that records the step it ran and advances the unit's version. */
function migrateModule(from: number, to: number): string {
  return [
    "import { appendFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    `export const descriptor = { name: 'notes', version: ${to}, tables: ['notes'], hasGlobal: false }`,
    'export async function migrate(content) {',
    `  appendFileSync(join(process.env.DSH_HOME, '${STEPS_LOG}'), '${from}-${to}\\n')`,
    `  return { ...content, tables: { ...content.tables, notes: { ...content.tables.notes, ['v${to}']: { body: 'at-${to}' } } } }`,
    '}',
    'export async function validate() { return true }',
  ].join('\n')
}

/**
 * Pack the plugin at one version with the migrations up to it.
 * @param root - a directory for the package sources.
 * @param version - the package version.
 * @param migrations - the migration steps (from→to) this version declares.
 * @returns the tarball's path.
 */
function pack(root: string, version: string, migrations: readonly { from: number; to: number }[]): string {
  const dir = join(root, `src-${version}`)
  mkdirSync(dir, { recursive: true })
  const dsh = migrations.length === 0
    ? MANIFEST_BASE
    : {
      ...MANIFEST_BASE,
      migrations: migrations.map(step => ({
        fromVersion: step.from, toVersion: step.to, description: `${step.from}->${step.to}`,
        module: `./migrate-${step.from}-${step.to}.js`, reversible: true, backup: 'snapshot',
      })),
    }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PLUGIN, version, type: 'module', dsh }, undefined, 2))
  for (const step of migrations) writeFileSync(join(dir, `migrate-${step.from}-${step.to}.js`), `${migrateModule(step.from, step.to)}\n`)
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed: ${packed.stderr}`)
  return join(root, `${PLUGIN}-${version}.tgz`)
}

/** The unit descriptor at version 1. */
function notesAtV1(): KvUnitDescriptor {
  return { name: 'notes', version: 1, tables: ['notes'], hasGlobal: false }
}

/**
 * Seed the version-1 unit's data through the JSON backend.
 * @param home - the harness home.
 */
async function seedV1(home: string): Promise<void> {
  const ctx = new Context()
  await ctx.plugin(StorageHub)
  await ctx.plugin(storageJson, { root: join(home, 'storages') })
  try {
    const kv: KvFacet | undefined = ctx.storage.backend.get('json').kv
    if (kv === undefined) throw new Error('the JSON backend offers no KV facet')
    const unit = await kv.open(notesAtV1())
    try {
      await unit.putRecord('notes', 'a', { body: 'original' })
    } finally {
      await unit.close()
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

/** Run one `dsh plugin --profile a604 add <tarball>`. */
function addCommand(home: string, tarball: string) {
  return execa(process.execPath, ['--import', 'tsx/esm', binScript, 'plugin', '--profile', PROFILE, 'add', tarball], {
    cwd: repoRoot,
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  })
}

/** The step ids in the run's step log, in order. */
function stepsLog(home: string): string[] {
  const path = join(home, STEPS_LOG)
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(line => line !== '') : []
}

/** What the scenario left. */
interface Outcome {
  readonly v2Exit: number | null
  readonly v3Exit: number | null
  readonly v3Stderr: string
  /** The step ids run across both upgrades, in order. */
  readonly steps: readonly string[]
}

const roots: string[] = []
let outcome: Outcome | undefined
let setupError: string | undefined

beforeAll(async () => {
  try {
    const packRoot = await mkdtemp(join(tmpdir(), 'p1-10-norerun-pack-'))
    roots.push(packRoot)
    const v1 = pack(packRoot, '1.0.0', [])
    const v2 = pack(packRoot, '2.0.0', [{ from: 1, to: 2 }])
    const v3 = pack(packRoot, '3.0.0', [{ from: 1, to: 2 }, { from: 2, to: 3 }])
    const home = await mkdtemp(join(tmpdir(), 'p1-10-norerun-home-'))
    roots.push(home)
    initProfile(resolveProfileDir(PROFILE, home), [])

    const installed = await addCommand(home, v1)
    if (installed.exitCode !== 0) throw new Error(`installing version 1 failed: ${installed.stderr.slice(-800)}`)
    await seedV1(home)
    const v2Run = await addCommand(home, v2)
    const v3Run = await addCommand(home, v3)
    outcome = {
      v2Exit: v2Run.exitCode ?? null,
      v3Exit: v3Run.exitCode ?? null,
      v3Stderr: v3Run.stderr.slice(-800),
      steps: stepsLog(home),
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

describe('P1-10 (A-604, B-711a red first): upgrading data already at an intermediate version runs only the remaining migration step, not an already-applied one', () => {
  it('the v2->v3 upgrade runs only step 2-3 and does not re-run the already-applied step 1-2', () => {
    const result = outcomeOf()
    const context = JSON.stringify(result)
    // Guard: the v2 install applied 1-2 and the v3 upgrade reached 2-3, so there
    // is an already-applied step and the scenario ran (a false here means it was
    // not set up — e.g. an install/upgrade failed — not a silent pass).
    expect({ has12: result.steps.includes('1-2'), has23: result.steps.includes('2-3') }, context)
      .toEqual({ has12: true, has23: true })
    // The steps actually run are exactly 1-2 (at the v2 install) then 2-3 (at the
    // v3 upgrade): the already-applied 1-2 is NOT re-run, and planned == actual.
    // RED today: the v3 upgrade re-runs 1-2, so the log reads ['1-2','1-2','2-3'].
    expect([...result.steps], context).toEqual(['1-2', '2-3'])
  })
})
