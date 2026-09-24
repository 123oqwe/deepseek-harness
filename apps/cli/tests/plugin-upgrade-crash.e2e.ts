/**
 * Epic P1-10 acceptance[0], [1] and [2] on real `dsh` processes: a plugin
 * upgrade is SIGKILLed at every phase `runUpgrade` declares, inside the
 * plugin's own migrate and validate steps, and between the two renames of the
 * atomic switch; then `dsh` starts again on the same profile, and the cases
 * read what the product left on disk.
 *
 * The input is a third-party plugin, `notes-plugin` 1.0.0 -> 2.0.0
 * (`./fixtures/p1-10-notes-plugin/`), installed with `dsh plugin --profile
 * p1-10 add file:<dir>` and pnpm, into the default profile composition
 * (`@deepseek-ai/dsh-base` plus the plugin's own bundle). No shipped plugin
 * declares migrations or a data store, so nothing in the shipped product
 * reaches this path on its own.
 *
 * Kills come from the plugin's own steps (`P1_10_PLUGIN_KILL`) or from the
 * crash hook `./fixtures/p1-10-crash/register.mjs`, which only fills the
 * `onPhase` the transaction declares for this purpose, answers the health
 * check false for K4, and kills before the second rename of `switchIn`.
 * "Died by SIGKILL" means `signal === 'SIGKILL'` and not `timedOut`, so the
 * guard deadline's own SIGKILL never counts.
 *
 * "Restart" is the next start of `dsh` on the same profile from either
 * entry, and every kill point is restarted from both, each in its own home:
 * `dsh plugin --profile p1-10 root`, and the harness start `dsh --profile
 * p1-10`, where the plugin's row opens its unit. Before either, the case
 * waits out the upgrade lease the killed process held, as the shipped 30 s
 * lease allows.
 *
 * Every observation is made once in `beforeAll`, and the cases only read
 * them: `vitest.e2e.config.ts`'s `retry: 2` re-runs a case body and never
 * `beforeAll`.
 */

import { existsSync } from 'node:fs'
import { cp, mkdtemp, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CapabilityTokenService } from '@deepseek-ai/dsh-capability-token'
import type { CapabilityName, CapabilityTokenNonce, PrincipalId, TenantId } from '@deepseek-ai/dsh-capability-token'
import { openFileCapabilityTokenStore } from '@deepseek-ai/dsh-capability-token-file/store'
import type { WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import { openLeaseStore } from '@deepseek-ai/dsh-lease-sqlite'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { UPGRADE_PHASES } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { UpgradeRecord } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import StorageHub from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, MigrationFacet } from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { readUpgradeRecord, UPGRADE_WORK_ITEM } from '../src/plugin-migration.ts'

const DSH_BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const TSCONFIG = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const PLUGIN_VERSIONS = fileURLToPath(new URL('./fixtures/p1-10-notes-plugin/', import.meta.url))
const CRASH_HOOK = new URL('./fixtures/p1-10-crash/register.mjs', import.meta.url).href

const PROFILE = 'p1-10'
const PLUGIN = 'notes-plugin'
/** The plugin's unit, as both versions' descriptors name it, and its one table. */
const UNIT = 'notes'
const TABLE = 'notes'
const UPGRADE_LEASE = brandString<WorkItemId>(UPGRADE_WORK_ITEM)

/** How long one `dsh` child may run before its guard deadline SIGKILLs it; a harness start boots all of dsh-base from source. */
const CHILD_TIMEOUT_MS = 240_000
/**
 * The whole campaign: 23 homes, at most `POOL_WIDTH` at a time, 20 of them
 * waiting out a 30 s lease and 9 of them booting the harness. About 1,600 s
 * of home time, so roughly 5-8 min at this width; the ceiling leaves room for
 * a contended runner.
 */
const CAMPAIGN_TIMEOUT_MS = 1_500_000
const POOL_WIDTH = 6
/** The margin past the killed process's lease expiry before the next start (the lane-branch acp.e2e.ts precedent). */
const EXPIRY_MARGIN_MS = 1_000
/**
 * A bound on that wait: the upgrade lease runs 30 s from its last renewal
 * (plugin-migration.ts:75), so a longer wait means the row is not that lease.
 */
const MAX_LEASE_WAIT_MS = 45_000

/** The phases this campaign kills after, written out rather than read from the product (A1 compares them). */
const CAMPAIGN_PHASES = ['freeze', 'snapshot', 'quarantine', 'validate', 'switch', 'health-check'] as const
type CampaignPhase = typeof CAMPAIGN_PHASES[number]

/** Which halves of its record an upgrade left (transaction.ts `UpgradeRecord`). */
type RecordHalves = 'none' | 'intent' | 'snapshot' | 'switched' | 'completed'

/** The record and live stamp an upgrade killed at one point leaves. */
interface LeftAtKill {
  readonly record: RecordHalves
  readonly stamp: number | undefined
}

/** Read from `runUpgrade` (transaction.ts:170-245): where each phase's `onPhase` fires relative to its writes. */
const LEFT_AT_KILL: Readonly<Record<CampaignPhase, LeftAtKill>> = {
  'freeze': { record: 'none', stamp: 1 },
  'snapshot': { record: 'snapshot', stamp: 1 },
  'quarantine': { record: 'snapshot', stamp: 1 },
  'validate': { record: 'snapshot', stamp: 1 },
  'switch': { record: 'switched', stamp: 2 },
  'health-check': { record: 'completed', stamp: 2 },
}
/** A kill inside the plugin's migrate or validate step: after the snapshot record, before any switch. */
const LEFT_IN_PLUGIN_STEP: LeftAtKill = { record: 'snapshot', stamp: 1 }
/**
 * A kill between the two renames of `switchIn`: the record still holds only
 * the snapshot half (transaction.ts:225 runs after `switchIn` returns), and
 * with the live file moved aside (storage-json index.ts:140) there is no stamp.
 */
const LEFT_INSIDE_SWITCH: LeftAtKill = { record: 'snapshot', stamp: undefined }

/** Where a kill lands: after a named phase, inside one of the plugin's own steps, or inside `switchIn`. */
type KillPoint = CampaignPhase | 'migrate' | 'validator' | 'inside-switch'

/** One kill point: the instrument that lands it, how titles name it, what it leaves, and the version a restart owes. */
interface KillPointSpec {
  readonly point: KillPoint
  /** `P1_10_*` instrument variables for the upgrade child. */
  readonly upgradeEnv: Readonly<Record<string, string>>
  /** Whether the upgrade child imports the crash hook. */
  readonly hooked: boolean
  readonly where: string
  readonly left: LeftAtKill
  /**
   * The version a restart owes: the new one only once the health check had
   * passed (transaction.ts:264-267), the old one otherwise. Absent where the
   * direction is the product fix's to choose, so only "one version" is asserted.
   */
  readonly owed?: 'old' | 'new'
}

const KILL_POINTS: readonly KillPointSpec[] = [
  ...CAMPAIGN_PHASES.map((phase): KillPointSpec => ({
    point: phase,
    upgradeEnv: { P1_10_KILL_AT: phase },
    hooked: true,
    where: `killed after the ${phase} phase`,
    left: LEFT_AT_KILL[phase],
    owed: phase === 'health-check' ? 'new' : 'old',
  })),
  {
    point: 'migrate',
    upgradeEnv: { P1_10_PLUGIN_KILL: 'migrate' },
    hooked: false,
    where: 'killed inside the plugin\'s own migrate step',
    left: LEFT_IN_PLUGIN_STEP,
    owed: 'old',
  },
  {
    point: 'validator',
    upgradeEnv: { P1_10_PLUGIN_KILL: 'validate' },
    hooked: false,
    where: 'killed inside the plugin\'s own validator',
    left: LEFT_IN_PLUGIN_STEP,
    owed: 'old',
  },
  {
    point: 'inside-switch',
    upgradeEnv: { P1_10_KILL_AT: 'inside-switch' },
    hooked: true,
    where: 'killed between the two renames of the atomic switch',
    left: LEFT_INSIDE_SWITCH,
  },
]

/** Every home the campaign runs, one per key: each kill point once per restart entry, plus the controls. */
type RunKey = KillPoint | `harness-${KillPoint}` | 'C1' | 'C2' | 'K1' | 'K3' | 'K4'

/** What is done to one home, and in what order. */
interface RunSpec {
  readonly key: RunKey
  /** `P1_10_*` instrument variables for the upgrade child. */
  readonly upgradeEnv: Readonly<Record<string, string>>
  /** Whether the upgrade child imports the crash hook. */
  readonly hooked: boolean
  /** What changes the stored data between the killed upgrade and the next start. */
  readonly tamper?: 'records' | 'stamp'
  /** Which start follows the upgrade: `dsh plugin --profile p1-10 root`, or the harness start. */
  readonly next: 'plugin' | 'harness'
  /** After the next start: write one record as the new code would, then run `dsh plugin` once more. */
  readonly writeThenRunAgain?: boolean
}

/** The harness homes first: they run longest, and the pool starts them in this order. */
const RUN_SPECS: readonly RunSpec[] = [
  ...KILL_POINTS.map((kill): RunSpec => ({
    key: `harness-${kill.point}`,
    upgradeEnv: kill.upgradeEnv,
    hooked: kill.hooked,
    next: 'harness',
  })),
  ...KILL_POINTS.map((kill): RunSpec => ({ key: kill.point, upgradeEnv: kill.upgradeEnv, hooked: kill.hooked, next: 'plugin' })),
  { key: 'C1', upgradeEnv: { P1_10_KILL_AT: 'health-check' }, hooked: true, tamper: 'records', next: 'plugin' },
  { key: 'C2', upgradeEnv: { P1_10_KILL_AT: 'health-check' }, hooked: true, tamper: 'stamp', next: 'plugin' },
  { key: 'K1', upgradeEnv: {}, hooked: false, next: 'plugin', writeThenRunAgain: true },
  { key: 'K3', upgradeEnv: { P1_10_PLUGIN_REFUSE: '1' }, hooked: false, next: 'plugin' },
  { key: 'K4', upgradeEnv: { P1_10_HEALTH: 'fail' }, hooked: true, next: 'plugin' },
]

/** The homes acceptance[2] compares, and how their titles name what happened to them. */
const PERMISSION_RUNS: readonly (readonly [RunKey, string])[] = [
  ...CAMPAIGN_PHASES.map(phase => [phase, `a kill after the ${phase} phase`] as const),
  ['migrate', 'a kill inside the plugin\'s own migrate step'],
  ['validator', 'a kill inside the plugin\'s own validator'],
  ['inside-switch', 'a kill between the two renames of the atomic switch'],
  ['K3', 'an upgrade the plugin\'s validator refused'],
  ['K4', 'an upgrade whose health check failed'],
]

/** What one home holds for the plugin, read back from what the product wrote. */
interface Holding {
  /** `version` of the installed `node_modules/notes-plugin/package.json`. */
  readonly code: string | undefined
  /** The unit's version stamp, read through the storage-json migration facet. */
  readonly stamp: number | undefined
  /** Whether the installed code's descriptor opens the unit through the storage hub. */
  readonly opened: boolean
  /** The `notes` records that open read; absent when it did not open. */
  readonly rows?: unknown
}

/** The old version whole: 1.0.0 code, data stamped 1, which that code opens, holding only the seeded record. */
const OLD: Holding = { code: '1.0.0', stamp: 1, opened: true, rows: { n1: { body: 'original' } } }
/** The new version whole: 2.0.0 code, data stamped 2, which that code opens, holding the record step-2.js adds. */
const NEW: Holding = { code: '2.0.0', stamp: 2, opened: true, rows: { n1: { body: 'original' }, n2: { body: 'migrated' } } }

/** How one `dsh` child ended. */
interface ChildOutcome {
  readonly exitCode: number | undefined
  readonly signal: string | undefined
  readonly timedOut: boolean
  readonly stderr: string
}

/** Digests of what acceptance[2] compares in one home. */
interface HomeDigests {
  /** `<home>/capability-tokens`, the token store `dsh-base` mounts (packages/bundle/base/cordis.patch.yml:617-622). */
  readonly tokens: string
  /** Everything under the home except the paths the upgrade itself writes. */
  readonly rest: string
}

/** What the notes-plugin row wrote from inside the harness. */
interface HarnessReport {
  readonly code?: string
  readonly stamp?: number
  readonly opened?: boolean
  readonly rows?: unknown
  readonly error?: string
}

/** Everything the cases read about one home, recorded once. */
interface RunObservation {
  readonly before: Holding
  /** Signed tokens in the capability-token store before the upgrade; 0 where none were seeded. */
  readonly tokensSeeded: number
  readonly digestsBefore: HomeDigests
  readonly upgrade: ChildOutcome
  /** Read after the upgrade child ended and before anything else touched the home. */
  readonly atKill: LeftAtKill & { readonly storages: readonly string[] }
  /** Whether the upgrade lease had expired, or was released, when the next start began. */
  readonly leaseExpiredAtNext: boolean
  readonly installBeforeNext: Readonly<Record<string, string | undefined>>
  readonly next: ChildOutcome
  readonly installAfterNext: Readonly<Record<string, string | undefined>>
  readonly after: Holding
  readonly storagesAfter: readonly string[]
  readonly digestsAfter: HomeDigests
  readonly report?: HarnessReport
  readonly again?: ChildOutcome
}

type RunResult = { readonly observed: RunObservation } | { readonly failure: string }

/** Directories under the home the upgrade itself writes (plugin-migration.ts:214, :229, :260-266). */
const UPGRADE_HOME_PATHS = new Set(['leases', 'storages', 'plugin-upgrades'])
/**
 * What the upgrade itself writes in the profile: pnpm's manifest, lockfile and
 * install tree (plugin-migration.ts:603-604) and the plugin lock
 * (plugin.ts:121). Nothing else under `profiles/` is left out.
 */
const UPGRADE_PROFILE_PATHS = new Set(
  ['package.json', 'pnpm-lock.yaml', 'plugins.lock.json', 'node_modules'].map(path => `profiles/${PROFILE}/${path}`),
)
/** The profile files an install changes, compared across a start that must install nothing. */
const INSTALL_STATE_FILES = ['package.json', 'pnpm-lock.yaml', 'plugins.lock.json', `node_modules/${PLUGIN}/package.json`]

/**
 * The bundle patch both staged versions carry. Written at staging rather than
 * checked in: its row names the package by its installed name, which resolves
 * from the profile's own `node_modules`, while `verify-cordis-config` holds
 * configs under apps/cli/tests to apps/cli's dependencies
 * (scripts/verify-cordis-config.ts:249-254).
 */
const BUNDLE_PATCH = ['- insert:', `    - id: ${PLUGIN}`, `      name: ${PLUGIN}`, ''].join('\n')

/** The unit's identity alone: `stampedVersion` reads `name` and `layout` (storage-json index.ts:88-96). */
const UNIT_ONLY: KvUnitDescriptor = { name: UNIT, version: 0, tables: [], hasGlobal: false }

const roots: string[] = []
let probeLoads = 0

/**
 * A file's text, or `undefined` when it does not exist.
 * @param path - the file to read.
 * @returns its contents, or `undefined` on ENOENT; any other failure throws.
 */
async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Run one `dsh` child from source, as the launcher's `src` mode does.
 * @param root - the run's directory, used as the child's cwd and for its pnpm store.
 * @param home - the child's `DSH_HOME`.
 * @param args - the `dsh` arguments.
 * @param options - whether to import the crash hook, and extra environment.
 * @returns how the child ended.
 */
async function runDsh(
  root: string,
  home: string,
  args: readonly string[],
  options: { readonly hooked?: boolean; readonly env?: Readonly<Record<string, string>> } = {},
): Promise<ChildOutcome> {
  const launch = resolveExampleLaunch({
    srcBin: DSH_BIN,
    mode: 'src',
    tsconfigPath: TSCONFIG,
    sourceImport: 'tsx/esm',
    configArgs: args,
    env: { DSH_HOME: home, npm_config_store_dir: join(root, 'pnpm-store'), ...options.env },
  })
  // `src` mode's argv is `--import <tsx> <bin> <args>` (loader-smoke/src/index.ts:118-127); the hook
  // goes right after tsx, so it registers after tsx's hooks.
  const argv = options.hooked === true
    ? [...launch.args.slice(0, 2), '--import', CRASH_HOOK, ...launch.args.slice(2)]
    : launch.args
  const result = await execa(launch.command, argv, {
    cwd: root,
    env: launch.env,
    input: '',
    reject: false,
    timeout: CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  return { exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, stderr: result.stderr }
}

/**
 * One child's end, for a failure message.
 * @param outcome - the child's end.
 * @returns exit code, signal and the tail of stderr.
 */
function outcomeText(outcome: ChildOutcome): string {
  return `exit ${String(outcome.exitCode)}, signal ${String(outcome.signal)}, timedOut ${String(outcome.timedOut)}\n${outcome.stderr.slice(-4_000)}`
}

/**
 * Whether the child died by SIGKILL that its guard deadline did not send.
 * @param outcome - the child's end.
 * @returns true for a kill by the instrument or the plugin.
 */
function diedBySigkill(outcome: ChildOutcome): boolean {
  return outcome.signal === 'SIGKILL' && !outcome.timedOut
}

/**
 * Mount the storage hub and the JSON backend over one home's storage root, as
 * `withUpgradeEnvironment` does (plugin-migration.ts:227-229), for `body`.
 * @param home - the home whose `storages` directory to mount.
 * @param body - receives the backend's kv and migration facets.
 * @returns what `body` returns.
 */
async function withJsonBackend<T>(home: string, body: (kv: KvFacet, migration: MigrationFacet) => Promise<T>): Promise<T> {
  const ctx = new Context()
  await ctx.plugin(StorageHub)
  await ctx.plugin(storageJson, { root: join(home, 'storages') })
  try {
    const backend = ctx.storage.backend.get('json')
    if (backend.kv === undefined || backend.migration === undefined) {
      throw new Error('the json backend serves no kv or migration facet')
    }
    return await body(backend.kv, backend.migration)
  } finally {
    await ctx.fiber.dispose()
  }
}

/**
 * The installed plugin package's directory in one home's profile.
 * @param home - the home.
 * @returns `<home>/profiles/p1-10/node_modules/notes-plugin`.
 */
function installedDir(home: string): string {
  return join(home, 'profiles', PROFILE, 'node_modules', PLUGIN)
}

/**
 * The descriptor the installed code opens its unit with. A version that
 * declares migrations answers with its last step module's `descriptor`, the
 * unit the product migrates and health-checks (plugin-migration.ts:802-844,
 * :372); a version that declares none answers with its own `descriptor.js`,
 * which its row opens. Each load carries a fresh query, so a later version
 * installed at the same path is never served from the module cache.
 * @param home - the home whose installed package to read.
 * @returns the descriptor.
 */
async function installedDescriptor(home: string): Promise<KvUnitDescriptor> {
  const dir = installedDir(home)
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
    readonly dsh?: { readonly migrations?: readonly { readonly module?: string }[] }
  }
  const modulePath = manifest.dsh?.migrations?.at(-1)?.module ?? './descriptor.js'
  probeLoads += 1
  const url = `${pathToFileURL(join(dir, modulePath)).href}?probe=${String(probeLoads)}`
  const loaded = await import(/* @vite-ignore */ url) as { readonly descriptor: KvUnitDescriptor }
  return loaded.descriptor
}

/**
 * Open the unit with `descriptor` and read its `notes` table, as the product's
 * health check does (plugin-migration.ts:241-259).
 * @param kv - the backend's kv facet.
 * @param descriptor - the descriptor to open with.
 * @returns whether it opened, and the records it read.
 */
async function openAndRead(kv: KvFacet, descriptor: KvUnitDescriptor): Promise<{ readonly opened: boolean; readonly rows?: unknown }> {
  let unit: KvUnit
  try {
    unit = await kv.open(descriptor)
  } catch {
    // A refused open is itself the observation: the installed code cannot open the stored data.
    return { opened: false }
  }
  try {
    return { opened: true, rows: (await unit.loadAll()).tables[TABLE] }
  } finally {
    await unit.close()
  }
}

/**
 * Read what one home holds: installed code, stamp, and whether that code opens that data.
 * @param home - the home.
 * @returns the holding.
 */
async function readHolding(home: string): Promise<Holding> {
  const manifest = await readTextIfPresent(join(installedDir(home), 'package.json'))
  const code = manifest === undefined ? undefined : (JSON.parse(manifest) as { readonly version?: string }).version
  const descriptor = manifest === undefined ? undefined : await installedDescriptor(home)
  return withJsonBackend(home, async (kv, migration) => ({
    code,
    stamp: await migration.stampedVersion(descriptor ?? UNIT_ONLY),
    ...descriptor === undefined ? { opened: false } : await openAndRead(kv, descriptor),
  }))
}

/**
 * Write one record through the storage hub with the installed code's descriptor.
 * @param home - the home.
 * @param key - the record key in the `notes` table.
 * @param value - the record.
 */
async function writeRecord(home: string, key: string, value: unknown): Promise<void> {
  const descriptor = await installedDescriptor(home)
  await withJsonBackend(home, async (kv) => {
    const unit = await kv.open(descriptor)
    try {
      await unit.putRecord(TABLE, key, value)
    } finally {
      await unit.close()
    }
  })
}

/**
 * Rewrite the live unit's `unit.version` stamp, leaving `global` and `tables`
 * as they are, so its content digest (storage-json index.ts:97-104) does not move.
 * @param home - the home.
 * @param version - the stamp to write.
 */
async function restampLiveUnit(home: string, version: number): Promise<void> {
  const path = join(home, 'storages', `${UNIT}.json`)
  const document = JSON.parse(await readFile(path, 'utf8')) as { readonly unit: Readonly<Record<string, unknown>> }
  await writeFile(path, `${JSON.stringify({ ...document, unit: { ...document.unit, version } }, null, 2)}\n`, 'utf8')
}

/**
 * Seed one signed capability token through the token library's own issue path.
 * @param home - the home whose `capability-tokens` directory holds the store.
 */
async function seedCapabilityToken(home: string): Promise<void> {
  const kernel = createTrustKernel()
  const tokens = await CapabilityTokenService.restore(
    openFileCapabilityTokenStore(join(home, 'capability-tokens')),
    kernel.signatureRoots,
  )
  await tokens.issue({
    subject: brandString<PrincipalId>('p1-10-operator'),
    tenant: brandString<TenantId>('local'),
    capability: brandString<CapabilityName>('tool'),
    // `TOOL_CAPABILITY_VERB` (packages/core/tools/src/index.ts:600).
    verbs: ['call'],
    resources: ['read_file'],
    constraints: {},
    expiresAt: Date.now() + 3_600_000,
  }, brandString<CapabilityTokenNonce>(randomBytes(16).toString('hex')))
}

/**
 * Which halves of its record an upgrade left.
 * @param record - the record, or `undefined` when there is none.
 * @returns the halves present.
 */
function halvesOf(record: UpgradeRecord | undefined): RecordHalves {
  if (record === undefined) return 'none'
  if (record.upgradedTo !== undefined && record.dataDigest !== undefined) return 'completed'
  if (record.previousHandle !== undefined) return 'switched'
  if (record.snapshotHandle !== undefined) return 'snapshot'
  return 'intent'
}

/**
 * The entries of one home's storage root.
 * @param home - the home.
 * @returns the sorted names, or none when the root does not exist.
 */
async function listStorages(home: string): Promise<readonly string[]> {
  const dir = join(home, 'storages')
  return existsSync(dir) ? (await readdir(dir)).sort() : []
}

/**
 * A digest of a directory tree: every path, directory, link target and file content, in name order.
 * @param root - the tree's root; a missing root digests as empty.
 * @param excluded - paths, relative to `root` with `/`, left out with everything under them.
 * @returns the hex digest.
 */
async function treeDigest(root: string, excluded: (path: string) => boolean): Promise<string> {
  const digest = createHash('sha256')
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(join(root, relative), { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (excluded(path)) continue
      if (entry.isDirectory()) {
        digest.update(`dir ${path}\n`)
        await walk(path)
      } else if (entry.isSymbolicLink()) {
        digest.update(`link ${path} ${await readlink(join(root, path))}\n`)
      } else {
        digest.update(`file ${path} ${createHash('sha256').update(await readFile(join(root, path))).digest('hex')}\n`)
      }
    }
  }
  if (existsSync(root)) await walk('')
  return digest.digest('hex')
}

/** The digest `treeDigest` gives a directory holding nothing. */
const EMPTY_TREE_DIGEST = createHash('sha256').digest('hex')

/**
 * Digest what acceptance[2] compares in one home.
 * @param home - the home.
 * @returns the token store's digest and the rest of the home's.
 */
async function homeDigests(home: string): Promise<HomeDigests> {
  return {
    tokens: await treeDigest(join(home, 'capability-tokens'), () => false),
    rest: await treeDigest(home, path => UPGRADE_HOME_PATHS.has(path) || UPGRADE_PROFILE_PATHS.has(path)),
  }
}

/**
 * The profile files an install changes, as text.
 * @param home - the home.
 * @returns each file's text, `undefined` where it does not exist.
 */
async function profileInstallState(home: string): Promise<Readonly<Record<string, string | undefined>>> {
  const dir = join(home, 'profiles', PROFILE)
  return Object.fromEntries(await Promise.all(
    INSTALL_STATE_FILES.map(async file => [file, await readTextIfPresent(join(dir, file))] as const),
  ))
}

/**
 * Wait until the upgrade lease the killed process held has expired, reading
 * the row as it left it.
 * @param home - the home whose lease store to read.
 * @returns whether the row had expired, or was gone, when the wait ended.
 */
async function waitOutUpgradeLease(home: string): Promise<boolean> {
  const leases = openLeaseStore(join(home, 'leases'))
  const held = leases.get(UPGRADE_LEASE)
  if (held !== undefined) {
    const waitMs = held.expiresAtMs - Date.now() + EXPIRY_MARGIN_MS
    if (waitMs > MAX_LEASE_WAIT_MS) {
      throw new Error(`the upgrade lease expires in ${String(waitMs)} ms, longer than the shipped lease allows`)
    }
    if (waitMs > 0) await sleep(waitMs)
  }
  const current = leases.get(UPGRADE_LEASE)
  return current === undefined || current.expiresAtMs < Date.now()
}

/**
 * The holding the notes-plugin row reported from inside the harness.
 * @param report - the report, or `undefined` when the row wrote none.
 * @returns the holding it describes.
 */
function holdingFromReport(report: HarnessReport | undefined): Holding {
  return { code: report?.code, stamp: report?.stamp, opened: report?.opened === true, rows: report?.rows }
}

/**
 * Copy both plugin versions out of the repository and give each its bundle patch.
 * @param root - where to stage them.
 * @returns the staged directories.
 */
async function stagePluginVersions(root: string): Promise<{ readonly v1: string; readonly v2: string }> {
  const staged = { v1: join(root, 'v1'), v2: join(root, 'v2') }
  for (const [version, dir] of Object.entries(staged)) {
    await cp(join(PLUGIN_VERSIONS, version), dir, { recursive: true })
    await writeFile(join(dir, 'cordis.patch.yml'), BUNDLE_PATCH, 'utf8')
  }
  return staged
}

/**
 * Run one home through install, seed, upgrade, the next start, and the reads.
 * @param spec - what to do to the home.
 * @param versions - the staged plugin versions.
 * @returns everything the cases read about it.
 */
async function runHome(spec: RunSpec, versions: { readonly v1: string; readonly v2: string }): Promise<RunObservation> {
  const root = await mkdtemp(join(tmpdir(), `dsh-p1-10-${spec.key}-`))
  roots.push(root)
  const home = join(root, 'home')
  const plugin = (...args: string[]): readonly string[] => ['plugin', '--profile', PROFILE, ...args]

  const installed = await runDsh(root, home, plugin('add', `file:${versions.v1}`))
  if (installed.exitCode !== 0) throw new Error(`installing ${PLUGIN} 1.0.0 failed: ${outcomeText(installed)}`)
  if (spec.next === 'plugin') await seedCapabilityToken(home)
  await writeRecord(home, 'n1', { body: 'original' })
  const before = await readHolding(home)
  const tokensSeeded = (await openFileCapabilityTokenStore(join(home, 'capability-tokens')).load()).tokens.length
  const digestsBefore = await homeDigests(home)

  const upgrade = await runDsh(root, home, plugin('add', `file:${versions.v2}`), { hooked: spec.hooked, env: spec.upgradeEnv })
  const atKill = {
    record: halvesOf(await readUpgradeRecord(home, PLUGIN)),
    stamp: (await readHolding(home)).stamp,
    storages: await listStorages(home),
  }
  if (spec.tamper === 'records') await writeRecord(home, 'n3', { body: 'written after the upgrade' })
  if (spec.tamper === 'stamp') await restampLiveUnit(home, 1)

  const leaseExpiredAtNext = await waitOutUpgradeLease(home)
  const installBeforeNext = await profileInstallState(home)
  const reportPath = join(root, 'harness-report.json')
  const next = spec.next === 'plugin'
    ? await runDsh(root, home, plugin('root'))
    : await runDsh(root, home, ['--profile', PROFILE], {
      env: {
        DSH_AGENTS_HOME: join(root, 'agents'),
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
        P1_10_HARNESS_REPORT: reportPath,
      },
    })
  const installAfterNext = await profileInstallState(home)
  const reportText = spec.next === 'harness' ? await readTextIfPresent(reportPath) : undefined
  const report = reportText === undefined ? undefined : JSON.parse(reportText) as HarnessReport
  const after = spec.next === 'harness' ? holdingFromReport(report) : await readHolding(home)
  const storagesAfter = await listStorages(home)
  const digestsAfter = await homeDigests(home)

  let again: ChildOutcome | undefined
  if (spec.writeThenRunAgain === true) {
    await writeRecord(home, 'n3', { body: 'written after the upgrade' })
    again = await runDsh(root, home, plugin('root'))
  }
  return {
    before,
    tokensSeeded,
    digestsBefore,
    upgrade,
    atKill,
    leaseExpiredAtNext,
    installBeforeNext,
    next,
    installAfterNext,
    after,
    storagesAfter,
    digestsAfter,
    ...report === undefined ? {} : { report },
    ...again === undefined ? {} : { again },
  }
}

/**
 * Run `tasks` with at most `width` in flight.
 * @param tasks - the tasks, each started once.
 * @param width - the most that run at the same time.
 * @returns their results, in task order.
 */
async function inPool<T>(tasks: readonly (() => Promise<T>)[], width: number): Promise<T[]> {
  const results: T[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next
      next += 1
      results[index] = await tasks[index]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, worker))
  return results
}

describe.skipIf(process.platform === 'win32')('P1-10 plugin upgrade crash campaign (no key required)', () => {
  let campaign: ReadonlyMap<RunKey, RunResult> | undefined

  const run = (key: RunKey): RunObservation => {
    const result = campaign?.get(key)
    if (result === undefined) throw new Error(`beforeAll recorded no run for ${key}`)
    if ('failure' in result) throw new Error(`the ${key} run did not complete: ${result.failure}`)
    return result.observed
  }

  const expectKilled = (observed: RunObservation, left: LeftAtKill): void => {
    expect(
      { killed: diedBySigkill(observed.upgrade), record: observed.atKill.record, stamp: observed.atKill.stamp },
      outcomeText(observed.upgrade),
    ).toEqual({ killed: true, ...left })
  }

  beforeAll(async () => {
    const stage = await mkdtemp(join(tmpdir(), 'dsh-p1-10-versions-'))
    roots.push(stage)
    const versions = await stagePluginVersions(stage)
    const results = await inPool(RUN_SPECS.map(spec => async (): Promise<RunResult> => {
      try {
        return { observed: await runHome(spec, versions) }
      } catch (error) {
        return { failure: error instanceof Error ? error.stack ?? error.message : String(error) }
      }
    }), POOL_WIDTH)
    campaign = new Map<RunKey, RunResult>(RUN_SPECS.map((spec, index) => [spec.key, results[index]!] as const))
  }, CAMPAIGN_TIMEOUT_MS)

  afterAll(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  describe('acceptance[0]: dsh plugin SIGKILLed during an upgrade, then run again', () => {
    it('the campaign kills after every phase runUpgrade declares, and no other', () => {
      expect([...CAMPAIGN_PHASES]).toEqual([...UPGRADE_PHASES])
    })

    for (const phase of CAMPAIGN_PHASES) {
      it(`killed after the ${phase} phase: the process died by SIGKILL and left the record that phase writes`, () => {
        expectKilled(run(phase), LEFT_AT_KILL[phase])
      })
    }

    for (const phase of CAMPAIGN_PHASES) {
      it(`killed after the ${phase} phase, then run again: the installed code and the stored data are one version, and that code opens its data`, () => {
        const observed = run(phase)
        expectKilled(observed, LEFT_AT_KILL[phase])
        expect(observed.leaseExpiredAtNext, outcomeText(observed.next)).toBe(true)
        expect([OLD, NEW], outcomeText(observed.next)).toContainEqual(observed.after)
      })
    }

    for (const phase of CAMPAIGN_PHASES) {
      it(`killed after the ${phase} phase, then run again: the version left is the old one unless the health check had passed`, () => {
        const observed = run(phase)
        expectKilled(observed, LEFT_AT_KILL[phase])
        expect(observed.leaseExpiredAtNext, outcomeText(observed.next)).toBe(true)
        expect(observed.after, outcomeText(observed.next)).toEqual(phase === 'health-check' ? NEW : OLD)
      })
    }

    it('killed inside the plugin\'s own migrate step, then run again: the installed code and the stored data are one version, and that code opens its data', () => {
      const observed = run('migrate')
      expectKilled(observed, LEFT_IN_PLUGIN_STEP)
      expect(observed.leaseExpiredAtNext, outcomeText(observed.next)).toBe(true)
      expect([OLD, NEW], outcomeText(observed.next)).toContainEqual(observed.after)
    })

    it('killed inside the plugin\'s own validator, then run again: the installed code and the stored data are one version, and that code opens its data', () => {
      const observed = run('validator')
      expectKilled(observed, LEFT_IN_PLUGIN_STEP)
      expect(observed.leaseExpiredAtNext, outcomeText(observed.next)).toBe(true)
      expect([OLD, NEW], outcomeText(observed.next)).toContainEqual(observed.after)
    })

    it('killed after the switch phase, then run again: the replaced data is back in the plugin\'s own unit, not in a unit named after the package', () => {
      const observed = run('switch')
      expectKilled(observed, LEFT_AT_KILL.switch)
      expect({
        stamp: observed.after.stamp,
        namedAfterPackage: observed.storagesAfter.filter(name => name.startsWith(PLUGIN)),
      }).toEqual({ stamp: 1, namedAfterPackage: [] })
    })

    it('killed between the two renames of the atomic switch: the process died by SIGKILL with the live unit moved aside and the migrated copy not yet in its place', () => {
      const observed = run('inside-switch')
      const { storages } = observed.atKill
      expect({
        killed: diedBySigkill(observed.upgrade),
        record: observed.atKill.record,
        live: storages.includes(`${UNIT}.json`),
        movedAside: storages.filter(name => /^notes\.previous-\d+\.json$/u.test(name)).length,
        migratedCopy: storages.filter(name => /^notes\.migrated-2-\d+$/u.test(name)).length,
      }, outcomeText(observed.upgrade)).toEqual({ killed: true, record: 'snapshot', live: false, movedAside: 1, migratedCopy: 1 })
    })

    it('killed between the two renames of the atomic switch, then run again: the installed code and the stored data are one version, and that code opens its data', () => {
      const observed = run('inside-switch')
      expect({ killed: diedBySigkill(observed.upgrade), record: observed.atKill.record }, outcomeText(observed.upgrade))
        .toEqual({ killed: true, record: 'snapshot' })
      expect(observed.leaseExpiredAtNext, outcomeText(observed.next)).toBe(true)
      expect([OLD, NEW], outcomeText(observed.next)).toContainEqual(observed.after)
    })

    it('control: an upgrade that is not killed leaves the new code and the new data, and the new code opens it', () => {
      const observed = run('K1')
      expect({ exitCode: observed.upgrade.exitCode, signal: observed.upgrade.signal }, outcomeText(observed.upgrade))
        .toEqual({ exitCode: 0, signal: undefined })
      expect(observed.after).toEqual(NEW)
    })

    it('control: before the upgrade every home holds the old code and the old data, and the old code opens it', () => {
      for (const { key } of RUN_SPECS) expect(run(key).before, key).toEqual(OLD)
    })

    it('control: an upgrade the plugin\'s validator refuses puts the code back, and the old version opens its data', () => {
      const observed = run('K3')
      expect({ exitCode: observed.upgrade.exitCode, signal: observed.upgrade.signal }, outcomeText(observed.upgrade))
        .toEqual({ exitCode: 1, signal: undefined })
      expect(observed.upgrade.stderr).toContain(`${PLUGIN}: upgrade failed at validate`)
      expect(observed.after, outcomeText(observed.next)).toEqual(OLD)
    })

    it('an upgrade whose health check fails leaves the old version whole, and the next dsh plugin run is not refused', () => {
      const observed = run('K4')
      expect({ exitCode: observed.upgrade.exitCode, signal: observed.upgrade.signal }, outcomeText(observed.upgrade))
        .toEqual({ exitCode: 1, signal: undefined })
      expect(observed.upgrade.stderr).toContain(`${PLUGIN}: upgrade failed at health-check`)
      expect(observed.next.exitCode, outcomeText(observed.next)).toBe(0)
      expect(observed.after, outcomeText(observed.next)).toEqual(OLD)
    })
  })

  describe('acceptance[0]: dsh plugin SIGKILLed during an upgrade, then dsh started on the same profile', () => {
    for (const kill of KILL_POINTS) {
      const key: RunKey = `harness-${kill.point}`

      it(`${kill.where}, then dsh started: the harness loaded the plugin row from the installed package, and the row reported what it opened`, () => {
        const observed = run(key)
        expectKilled(observed, kill.left)
        expect(observed.report, outcomeText(observed.next)).toBeDefined()
        expect(['1.0.0', '2.0.0'], outcomeText(observed.next)).toContain(observed.report?.code)
      })

      it(`${kill.where}, then dsh started: the code the harness loaded and the data it opened are one version, and that code opened its data`, () => {
        const observed = run(key)
        expectKilled(observed, kill.left)
        expect(observed.leaseExpiredAtNext, outcomeText(observed.next)).toBe(true)
        expect([OLD, NEW], `${JSON.stringify(observed.report)}\n${outcomeText(observed.next)}`).toContainEqual(observed.after)
      })

      const owed = kill.owed
      if (owed === undefined) continue
      it(`${kill.where}, then dsh started: the version the harness loaded is the ${owed} one`, () => {
        const observed = run(key)
        expectKilled(observed, kill.left)
        expect(observed.leaseExpiredAtNext, outcomeText(observed.next)).toBe(true)
        expect(observed.after, `${JSON.stringify(observed.report)}\n${outcomeText(observed.next)}`).toEqual(owed === 'new' ? NEW : OLD)
      })
    }
  })

  describe('acceptance[2]: a failed or crashed upgrade leaves approved permissions untouched', () => {
    for (const [key, label] of PERMISSION_RUNS) {
      it(`after ${label}, then the next dsh plugin run: the capability-token store and everything under the home outside the upgrade's own paths are byte-identical`, () => {
        const observed = run(key)
        expect(observed.digestsAfter).toEqual(observed.digestsBefore)
      })
    }

    it('every home those cases compare holds a signed token in its capability-token store, so "byte-identical" is not vacuous', () => {
      for (const [key] of PERMISSION_RUNS) {
        const observed = run(key)
        expect(observed.tokensSeeded, key).toBeGreaterThanOrEqual(1)
        expect(observed.digestsBefore.tokens, key).not.toBe(EMPTY_TREE_DIGEST)
      }
    })
  })

  describe('acceptance[1]: an upgrade interrupted after its health check is reconciled against the stored data by the next dsh plugin run', () => {
    it('killed after the health-check phase, then the stored records changed: the next run is refused, naming the plugin, and nothing is installed', () => {
      const observed = run('C1')
      expectKilled(observed, LEFT_AT_KILL['health-check'])
      expect(observed.next.exitCode, outcomeText(observed.next)).toBe(1)
      expect(observed.next.stderr).toMatch(/notes-plugin[^\n]*does not reconcile/u)
      expect(observed.installAfterNext).toEqual(observed.installBeforeNext)
    })

    it('killed after the health-check phase, then the stored version stamp changed: the next run is refused, naming the plugin, and nothing is installed', () => {
      const observed = run('C2')
      expectKilled(observed, LEFT_AT_KILL['health-check'])
      expect(observed.next.exitCode, outcomeText(observed.next)).toBe(1)
      expect(observed.next.stderr).toMatch(/notes-plugin[^\n]*does not reconcile/u)
      expect(observed.installAfterNext).toEqual(observed.installBeforeNext)
    })

    it('killed after the health-check phase and left untouched: the record reconciles, and the next run proceeds', () => {
      const observed = run('health-check')
      expectKilled(observed, LEFT_AT_KILL['health-check'])
      expect(observed.next.exitCode, outcomeText(observed.next)).toBe(0)
      expect(observed.next.stderr).not.toMatch(/does not reconcile/u)
    })

    it('control: after an upgrade that completed, a normal write to its data does not make the next dsh plugin run refuse', () => {
      const observed = run('K1')
      expect(observed.upgrade.exitCode, outcomeText(observed.upgrade)).toBe(0)
      expect(observed.again, 'K1 recorded no run after the write').toBeDefined()
      expect(observed.again?.exitCode, observed.again === undefined ? '' : outcomeText(observed.again)).toBe(0)
      expect(observed.again?.stderr ?? '').not.toMatch(/does not reconcile/u)
    })
  })
})
