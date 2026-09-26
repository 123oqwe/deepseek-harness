/**
 * P1-10 acceptance[0], data half (BLOCKED-302 condition [0], BLOCKED-279): a
 * process killed at each phase of a plugin's data upgrade, then restarted into
 * the product's recovery, leaves the plugin's unit wholly at the old version or
 * wholly at the new one, and usable.
 *
 * Each scenario has its own `DSH_HOME`. The unit is seeded at version 1
 * through the JSON backend; `./fixtures/plugin-migration-crash-child.ts`
 * upgrades it to version 2 inside the product's `withUpgradeEnvironment` and
 * SIGKILLs itself as the named phase completes; the restart runs
 * `recoverInterruptedUpgrades` under the same environment, as `dsh plugin`
 * does before it installs anything, waiting for the dead child's upgrade lease
 * to lapse as a real restart would; then the unit is opened under each
 * version's descriptor. The single layout reads a unit only at the version
 * stamped on it, so exactly one of the two opens.
 *
 * The plugin and its unit are named as in the product's own migration fixture
 * (`plugin-migration-bridge.spec.ts`): the package `notes-plugin`, the unit
 * `notes`. A control crashes at the switch with the two names equal.
 */

import { execa } from 'execa'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { UPGRADE_PHASES, type UpgradePhase } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import StorageHub, { type KvFacet, type KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  recoverInterruptedUpgrades,
  type RecoveryOutcome,
  upgradeRecordPath,
  withUpgradeEnvironment,
} from '../src/plugin-migration.ts'

const child = fileURLToPath(new URL('./fixtures/plugin-migration-crash-child.ts', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Longest a restart waits for the dead child's upgrade lease (30 s in the product) to lapse. */
const LEASE_WAIT_MS = 45_000
/** Deadline for one crashing child. */
const CHILD_TIMEOUT_MS = 60_000

/** The unit's content at version 1 and at version 2. */
const OLD_TABLES = { notes: { a: { body: 'original' } } }
const NEW_TABLES = { notes: { a: { body: 'original' }, b: { body: 'migrated' } } }

/** One crash scenario. */
interface Scenario {
  readonly key: string
  readonly phase: UpgradePhase
  readonly plugin: string
  readonly unit: string
}

const SCENARIOS: readonly Scenario[] = [
  ...UPGRADE_PHASES.map(phase => ({ key: phase, phase, plugin: 'notes-plugin', unit: 'notes' })),
  { key: 'switch, plugin and unit named alike', phase: 'switch', plugin: 'notes', unit: 'notes' },
]

/** What opening the unit under one descriptor gave. */
type UnitReading =
  | { readonly opened: true; readonly tables: Record<string, Record<string, unknown>> }
  | { readonly opened: false; readonly error: string }

/** What one scenario left. */
interface Outcome {
  readonly childSignal: string | null
  readonly childStderr: string
  readonly recovery: RecoveryOutcome
  readonly v1: UnitReading
  readonly v2: UnitReading
}

/**
 * The unit descriptor at one version.
 * @param name - the unit name.
 * @param version - the version.
 * @returns the descriptor.
 */
function descriptor(name: string, version: number): KvUnitDescriptor {
  return { name, version, tables: ['notes'], hasGlobal: false }
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
 * Open the unit under one descriptor and read it whole.
 * @param home - the scenario's harness home.
 * @param unit - the descriptor.
 * @returns the tables, or why it did not open.
 */
async function readUnit(home: string, unit: KvUnitDescriptor): Promise<UnitReading> {
  try {
    return await withJsonBackend<UnitReading>(home, async (kv) => {
      const opened = await kv.open(unit)
      try {
        return { opened: true, tables: (await opened.loadAll()).tables }
      } finally {
        await opened.close()
      }
    })
  } catch (error: unknown) {
    return { opened: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Restart into the product's recovery, as `dsh plugin` runs it before it installs anything.
 * @param home - the scenario's harness home.
 * @param plugin - the plugin to recover.
 * @returns what the recovery pass reported.
 */
async function recoverAfterRestart(home: string, plugin: string): Promise<RecoveryOutcome> {
  const deadline = Date.now() + LEASE_WAIT_MS
  for (;;) {
    const attempt = await withUpgradeEnvironment(home, { resolve: () => Promise.resolve({ kind: 'none' as const }) }, environment =>
      recoverInterruptedUpgrades(home, [plugin], environment.migration, async (name) => {
        await rm(upgradeRecordPath(home, name), { force: true })
      }))
    if (attempt.held) return attempt.value
    if (Date.now() > deadline) throw new Error(`the restart never took the upgrade lease: ${attempt.refusal}`)
    await delay(1_000)
  }
}

/**
 * Seed, crash, restart and read one scenario.
 * @param scenario - the scenario.
 * @param home - its harness home.
 * @returns what it left.
 */
async function run(scenario: Scenario, home: string): Promise<Outcome> {
  await withJsonBackend(home, async (kv) => {
    const unit = await kv.open(descriptor(scenario.unit, 1))
    try {
      await unit.putRecord('notes', 'a', { body: 'original' })
    } finally {
      await unit.close()
    }
  })
  const crashed = await execa(process.execPath, ['--import', 'tsx/esm', child, home, scenario.plugin, scenario.unit, scenario.phase], {
    env: { TSX_TSCONFIG_PATH: repoTsconfig },
    timeout: CHILD_TIMEOUT_MS,
    reject: false,
  })
  const recovery = await recoverAfterRestart(home, scenario.plugin)
  return {
    childSignal: crashed.signal ?? null,
    childStderr: crashed.stderr.slice(-800),
    recovery,
    v1: await readUnit(home, descriptor(scenario.unit, 1)),
    v2: await readUnit(home, descriptor(scenario.unit, 2)),
  }
}

/**
 * Which whole version the unit holds: `old` when only version 1 opens and
 * holds the old tables, `new` when only version 2 opens and holds the new
 * ones, `mixed` otherwise.
 * @param outcome - what the scenario left.
 * @returns the verdict.
 */
function holds(outcome: Outcome): 'old' | 'new' | 'mixed' {
  const { v1, v2 } = outcome
  if (v1.opened && !v2.opened && JSON.stringify(v1.tables) === JSON.stringify(OLD_TABLES)) return 'old'
  if (v2.opened && !v1.opened && JSON.stringify(v2.tables) === JSON.stringify(NEW_TABLES)) return 'new'
  return 'mixed'
}

const homes: string[] = []
const outcomes = new Map<string, Outcome>()
const failures = new Map<string, string>()

beforeAll(async () => {
  // Concurrent, each in its own home, so the whole campaign waits out one lease rather than seven.
  await Promise.all(SCENARIOS.map(async (scenario) => {
    const home = await mkdtemp(join(tmpdir(), 'p1-10-crash-'))
    homes.push(home)
    try {
      outcomes.set(scenario.key, await run(scenario, home))
    } catch (error: unknown) {
      failures.set(scenario.key, error instanceof Error ? error.message : String(error))
    }
  }))
}, LEASE_WAIT_MS + CHILD_TIMEOUT_MS + 30_000)

afterAll(async () => {
  for (const home of homes) await rm(home, { recursive: true, force: true })
})

/**
 * Assert one scenario died by SIGKILL, recovered, and holds the expected whole version.
 * @param key - the scenario key.
 * @param expected - the version recovery must leave.
 */
function expectWhole(key: string, expected: 'old' | 'new'): void {
  const outcome = outcomes.get(key)
  if (outcome === undefined) throw new Error(failures.get(key) ?? `no outcome for ${key}`)
  const context = JSON.stringify(outcome)
  expect(outcome.childSignal, context).toBe('SIGKILL')
  expect(outcome.recovery.kind, context).toBe('recovered')
  expect(holds(outcome), context).toBe(expected)
}

describe('P1-10 acceptance[0]: a crash at any phase of a data upgrade, then a restart into recovery, leaves one whole version', () => {
  it('covers every phase the transaction declares', () => {
    expect(SCENARIOS.filter(scenario => scenario.plugin !== scenario.unit).map(scenario => scenario.phase)).toEqual([...UPGRADE_PHASES])
  })

  it('a crash at freeze leaves the old version whole and usable', () => { expectWhole('freeze', 'old') })
  it('a crash at snapshot leaves the old version whole and usable', () => { expectWhole('snapshot', 'old') })
  it('a crash at quarantine leaves the old version whole and usable', () => { expectWhole('quarantine', 'old') })
  it('a crash at validate leaves the old version whole and usable', () => { expectWhole('validate', 'old') })
  it('a crash at switch, before the health check confirmed the new data, leaves the old version whole and usable', () => {
    expectWhole('switch', 'old')
  })
  it('a crash at health-check, once the upgrade is recorded as achieved, leaves the new version whole and usable', () => {
    expectWhole('health-check', 'new')
  })
  it('control: a crash at switch with the plugin and its unit named alike leaves the old version whole and usable', () => {
    expectWhole('switch, plugin and unit named alike', 'old')
  })
})
