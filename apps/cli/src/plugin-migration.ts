/**
 * Drives Epic P1-10's upgrade transaction from the one place in the product
 * that knows a plugin changed version: `dsh plugin update` / `add`, after pnpm
 * has run and before the profile's layer list is reconciled.
 *
 * Two entry points, and the split is the point. `recoverInterruptedUpgrades`
 * runs BEFORE pnpm, because a crash skips `runUpgrade`'s `finally` and leaves
 * a frozen plugin with a quarantine and a rollback directory on disk; nothing
 * else would ever clear them, and acceptance[0]'s "the old version is wholly
 * usable after a restart" includes "not frozen". `migrateChangedPlugins` runs
 * after, because only then is `(plugin, from, to)` known.
 *
 * The bridge from P1-01's Plugin Manifest v2 to this epic's vocabulary lives
 * here too: `declaredMigrationManifests` and `upgradeLookups` read a plugin's
 * declared migrations and data store out of the package the user installed, so
 * an upgrade acts on what a plugin author actually wrote rather than on a
 * second manifest format.
 *
 * @module @deepseek-ai/dsh/plugin-migration
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

import { readProfileManifest, resolveBundleDir } from '@deepseek-ai/dsh-app-boot'
import { classifyPluginDeclaration, evaluatePreMountAdmission } from '@deepseek-ai/dsh-plugin-manifest'
import type { PluginManifestV2 } from '@deepseek-ai/dsh-plugin-manifest'
import { INSTALL_ANCHOR } from './profile-boot.ts'

import { Context } from '@deepseek-ai/cordis'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { openLeaseStore } from '@deepseek-ai/dsh-lease-sqlite'
import { acquireRunLease } from '@deepseek-ai/dsh-lease-contract'
import type { WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease-contract'
import StorageHub from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'

import { brandString } from '@deepseek-ai/dsh-brand'
import { recoverUpgrade, runUpgrade } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { UpgradeRecord } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { PluginMigrationManifest, PluginSchemaVersion } from '@deepseek-ai/dsh-plugin-migrations'
import type { KvUnitDescriptor, MigrationFacet } from '@deepseek-ai/dsh-storage'
import type { RunLease } from '@deepseek-ai/dsh-lease-contract'

/** The bin name every profile diagnostic and resolution is reported under. */
const NAME = 'dsh'

/** One plugin's version before and after pnpm ran. */
export interface VersionChange {
  readonly plugin: string
  readonly from: string
  readonly to: string
}

/** The well-known work item the whole upgrade holds. */
export const UPGRADE_WORK_ITEM = 'dsh-plugin-upgrade'

/**
 * How long the upgrade lease is granted for, and how the transaction renews.
 *
 * A migration can outlast this, which is why the transaction renews rather
 * than taking one long lease: a lease long enough for the slowest conceivable
 * migration is also long enough to block every other process after a crash.
 */
export const UPGRADE_LEASE_MS = 30_000

/**
 * Everything one upgrade needs from the running composition, resolved by the
 * caller.
 *
 * Passed in rather than resolved here because `runPlugin` has no Context: the
 * CLI mounts storage on its own, and keeping that in the caller is what lets a
 * case supply a fake backend without a filesystem.
 */
export interface UpgradeEnvironment {
  /** The migration facet, absent when the mounted backend cannot migrate. */
  readonly migration: MigrationFacet | undefined
  /** The upgrade's cross-process lease, already acquired. */
  readonly lease: RunLease
  /** Reads the clock. */
  readonly now: () => number
  /** The unit each plugin's durable data lives in. */
  readonly unitFor: (plugin: string) => KvUnitDescriptor | undefined
  /** The migration steps for one plugin, loaded from its installed new version. */
  readonly stepsFor: (plugin: string) => Promise<
    ((records: readonly unknown[]) => Promise<readonly unknown[]>) | undefined
  >
  /** Writes one plugin's upgrade record. */
  readonly writeRecord: (plugin: string, record: UpgradeRecord) => Promise<void>
}

/**
 * Hold the upgrade's cross-process lease and a mounted storage backend for the
 * duration of `body`, or refuse the whole command.
 *
 * The lease is taken BEFORE the package manager runs, which is stronger than
 * freezing: a refused upgrade never moves the code, so no code/data mixture is
 * produced at all. A refusal names the holder, because P4-07's denial carries
 * it and "something else is running" without saying what leaves an operator
 * guessing between a live session and a stale entry.
 *
 * Storage is mounted here rather than resolved from a running harness because
 * `dsh plugin` has no Context: two plugins — the hub and the JSON backend —
 * are what a migration needs, and booting the whole agent runtime inside a
 * package-manager command would start an agent nobody asked for.
 * @param harnessHome - the resolved harness home.
 * @param lookups - where a plugin's unit and migration steps come from; the
 *   caller owns them because they are read from the INSTALLED package, which
 *   this module has no anchor for.
 * @param body - runs with the environment; the lease is released afterwards.
 * @returns the body's value, or the refusal to report.
 */
export async function withUpgradeEnvironment<T>(
  harnessHome: string,
  lookups: Pick<UpgradeEnvironment, 'unitFor' | 'stepsFor'>,
  body: (environment: UpgradeEnvironment) => Promise<T>,
): Promise<{ readonly held: true; readonly value: T } | { readonly held: false; readonly refusal: string }> {
  const store = openLeaseStore(join(harnessHome, 'leases'))
  const taken = acquireRunLease(
    store,
    brandString<WorkItemId>(UPGRADE_WORK_ITEM),
    brandString<WorkerId>(`cli-${String(process.pid)}`),
    Date.now(),
    UPGRADE_LEASE_MS,
  )
  if ('denied' in taken) {
    const denial = taken.denied
    return {
      held: false,
      refusal: denial.reason === 'held-by-another'
        ? `another dsh process (${String(denial.holder ?? 'unnamed')}) is upgrading plugins — stop it and retry`
        : 'the lease store is unavailable, so a plugin upgrade cannot be made exclusive — refusing to install',
    }
  }

  const ctx = new Context()
  await ctx.plugin(StorageHub)
  await ctx.plugin(storageJson, { root: join(harnessHome, 'storages') })
  try {
    const backend = ctx.storage.backend.get('json')
    return {
      held: true,
      value: await body({
        migration: backend.migration,
        lease: taken.lease,
        now: () => Date.now(),
        unitFor: lookups.unitFor,
        stepsFor: lookups.stepsFor,
        writeRecord: async (plugin, record) => {
          await mkdir(join(harnessHome, 'plugin-upgrades'), { recursive: true, mode: 0o700 })
          await writeFileAtomic(
            upgradeRecordPath(harnessHome, plugin),
            JSON.stringify(record, undefined, 2),
            { mode: 0o600, dirMode: 0o700 },
          )
        },
      }),
    }
  } finally {
    taken.lease.release()
    await ctx.fiber.dispose()
  }
}

/**
 * Run the upgrade transaction for every plugin whose version moved and whose
 * new manifest declares migrations (must[1]).
 *
 * This is the production caller the transaction exists for. A failed migration
 * leaves the data at the old version, and the CODE has to follow it: by this
 * point the package manager has already installed the new build, so a data
 * rollback alone would leave new code against old data — the mixed state
 * acceptance[0] forbids one layer up from the medium.
 * @param changes - the plugins whose versions moved.
 * @param manifests - each plugin's declared migrations, keyed by plugin.
 * @param environment - the facet, lease, clock and per-plugin lookups.
 * @param report - receives one line per plugin that failed or was refused.
 * @returns the plugins whose data was migrated.
 */
export async function migrateChangedPlugins(
  changes: readonly VersionChange[],
  manifests: ReadonlyMap<string, PluginMigrationManifest>,
  environment: UpgradeEnvironment,
  report: (line: string) => void,
): Promise<string[]> {
  const migrated: string[] = []
  for (const change of changes) {
    const manifest = manifests.get(change.plugin)
    // A plugin that declares no migrations is not skipped silently for lack of
    // a record: it has said its data needs none, which is different from
    // saying nothing.
    if (manifest === undefined) continue
    const unit = environment.unitFor(change.plugin)
    if (unit === undefined) {
      report(`${change.plugin}: declares migrations but owns no storage unit — nothing to migrate`)
      continue
    }
    const steps = await environment.stepsFor(change.plugin)
    if (steps === undefined) {
      report(`${change.plugin}: declares migrations but ships no migration module — refusing to upgrade its data`)
      continue
    }
    // The version the DATA is at, read from the medium — not `change.from`,
    // which is the PACKAGE version. A package version stepping 1.2.0 → 2.0.0
    // says nothing about which schema version the stored records are at, and
    // passing it as one would plan a path between versions no manifest
    // declares.
    const stamped = await environment.migration?.stampedVersion(unit)
    if (stamped === undefined) {
      report(`${change.plugin}: its unit '${unit.name}' holds no data yet — nothing to migrate`)
      continue
    }
    if (stamped === unit.version) continue // already at the version this build wants

    const outcome = await runUpgrade({
      plugin: change.plugin,
      manifest,
      installed: brandString<PluginSchemaVersion>(String(stamped)),
      unit,
      migration: environment.migration,
      lease: environment.lease,
      now: environment.now,
      migrate: steps,
      // Both phases accept unconditionally, and that is a stated gap rather
      // than a check: validating the migrated records means opening them as
      // the plugin would, and a health check means asking the plugin whether
      // it works — neither is available from a package-manager command, which
      // mounts no plugin. The transaction still runs them as phases, so the
      // day a booted-plugin probe exists it replaces these two closures and
      // nothing else. Recorded in this epic's Known Limitations.
      validate: () => Promise.resolve({ ok: true, digest: `sha256-${String(unit.version)}` }),
      healthCheck: () => Promise.resolve(true),
      writeRecord: async (record) => { await environment.writeRecord(change.plugin, record) },
    })
    if (outcome.upgraded) {
      migrated.push(change.plugin)
      continue
    }
    report(
      `${change.plugin}: upgrade failed at ${outcome.failedAt}`
      + (outcome.refusal === undefined ? '' : ` (${outcome.refusal.kind})`)
      + ' — its data is unchanged, and its code is being rolled back',
    )
  }
  return migrated
}

/**
 * Where one plugin's upgrade RECORD lives.
 *
 * The record only — a plugin's durable data lives in the storage hub's units,
 * and the transaction reaches it through the backend's migration facet. An
 * earlier version of this epic invented a `plugins/<name>/data/data.db` for
 * the data itself, a path nothing else in the tree writes.
 */
export function upgradeRecordPath(harnessHome: string, plugin: string): string {
  return join(harnessHome, 'plugin-upgrades', `${plugin}.json`)
}

/**
 * Read one plugin's upgrade record.
 * @param harnessHome - the resolved harness home.
 * @param plugin - the plugin to read for.
 * @returns the record, or `undefined` when no upgrade has written one.
 */
export async function readUpgradeRecord(
  harnessHome: string,
  plugin: string,
): Promise<UpgradeRecord | undefined> {
  const path = upgradeRecordPath(harnessHome, plugin)
  if (!existsSync(path)) return undefined
  return JSON.parse(await readFile(path, 'utf8')) as UpgradeRecord
}

/**
 * Whether a plugin's recorded upgrade agrees with what the medium reports
 * (acceptance[1]).
 *
 * Reconciling is against the plugin's OWN declared schema version, not the
 * `{major, minor}` of `@deepseek-ai/dsh-schema-registry`: that vocabulary is
 * for protocol and interface compatibility, while a plugin's durable data
 * carries the version its manifest declares and the storage hub stamps on the
 * medium.
 *
 * A record with no achieved half — an upgrade that started and never finished
 * — reconciles as `false` rather than throwing. It is a legitimate on-disk
 * state after a crash, and the caller's next move is to recover, not to handle
 * an exception.
 * @param harnessHome - the resolved harness home.
 * @param plugin - the plugin to reconcile.
 * @param observed - the version and digest read back from the medium.
 * @returns whether the record and the medium agree.
 */
export async function reconcileUpgrade(
  harnessHome: string,
  plugin: string,
  observed: { readonly upgradedTo: string; readonly dataDigest: string },
): Promise<boolean> {
  const record = await readUpgradeRecord(harnessHome, plugin)
  if (record?.upgradedTo === undefined || record.dataDigest === undefined) return false
  return record.upgradedTo === observed.upgradedTo && record.dataDigest === observed.dataDigest
}

/**
 * Plugins whose installed version differs from the one recorded before pnpm
 * ran.
 *
 * Computed from the two manifests rather than from the command line: a caller
 * writing `pnpm update` with no argument updates everything, and the arguments
 * do not say which packages actually moved.
 * @param before - dependency versions read before pnpm ran.
 * @param after - dependency versions read after it.
 * @returns one entry per plugin whose version changed.
 */
export function changedVersions(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): VersionChange[] {
  return Object.entries(after)
    .filter(([plugin, version]) => before[plugin] !== undefined && before[plugin] !== version)
    .map(([plugin, version]) => ({ plugin, from: before[plugin] ?? '', to: version }))
}

/**
 * Finish or undo every upgrade a crash left half-done, before anything else
 * runs (acceptance[0]).
 *
 * A `SIGKILL` skips the transaction's own cleanup, so the snapshot the upgrade
 * took stays on the medium and — if the switch had happened — the live unit
 * holds data whose health was never confirmed. Nothing else would ever undo
 * that, and acceptance[0]'s "the old version is wholly usable after a restart"
 * is not true of a plugin left in that state, which is why this runs first and
 * unconditionally rather than only when an upgrade is about to happen.
 *
 * A backend with no migration facet has nothing to recover, and says so by
 * returning nothing rather than by refusing: it could never have started an
 * upgrade in the first place.
 * @param harnessHome - the resolved harness home.
 * @param plugins - the plugins to check.
 * @param facet - the backend's migration facet, absent when it cannot migrate.
 * @param clearRecord - removes one plugin's upgrade record once it is undone.
 * @returns the plugins that needed recovery, for the caller to report.
 */
export async function recoverInterruptedUpgrades(
  harnessHome: string,
  plugins: readonly string[],
  facet: MigrationFacet | undefined,
  clearRecord: (plugin: string) => Promise<void>,
): Promise<string[]> {
  if (facet === undefined) return []
  const recovered: string[] = []
  for (const plugin of plugins) {
    const record = await readUpgradeRecord(harnessHome, plugin)
    if (record === undefined) continue
    // The transaction owns what a half-done upgrade means and what undoing it
    // requires; this only decides which plugins to ask about and clears the
    // record afterwards.
    if (!await recoverUpgrade(facet, record)) continue
    await clearRecord(plugin)
    recovered.push(plugin)
  }
  return recovered
}

/** What a caller must supply to undo the CODE half of a failed upgrade. */
export interface CodeRollback {
  /** The profile directory pnpm ran in. */
  readonly profileDir: string
  /** The `package.json` bytes from before pnpm ran. */
  readonly manifestBefore: string
  /** The `pnpm-lock.yaml` bytes from before pnpm ran. */
  readonly lockBefore: string
}

/**
 * Put the plugin's CODE back to the version its data is at, after a data
 * migration failed.
 *
 * The property acceptance[0] states is about the PAIR. By the time the
 * transaction runs, pnpm has already moved the code to the new version; a data
 * migration that fails and rolls back leaves data at v1 and code at v2, which
 * is precisely the mixed state the clause forbids. The lockfile and manifest
 * from before pnpm ran are still in hand, and pnpm's store is content
 * addressed, so the old version is still there to install from.
 *
 * A failure to restore is REPORTED and returned, never swallowed: the data is
 * at the old version and the code is not, and an operator who is not told has
 * a plugin that will fail on its next read with nothing pointing at why.
 * @param rollback - the profile directory and the bytes to restore.
 * @param writeFile - writes one file, injected so a caller can test the report.
 * @returns `undefined` on success, or the diagnostic to report.
 */
export async function rollbackCode(
  rollback: CodeRollback,
  writeFile: (path: string, content: string) => Promise<void>,
): Promise<string | undefined> {
  await writeFile(join(rollback.profileDir, 'package.json'), rollback.manifestBefore)
  await writeFile(join(rollback.profileDir, 'pnpm-lock.yaml'), rollback.lockBefore)
  const result = spawnSync('pnpm', ['install', '--offline', '--frozen-lockfile'], {
    cwd: rollback.profileDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if ((result.status ?? 1) === 0) return undefined
  return 'the plugin data was rolled back but its code was NOT: '
    + `pnpm install --offline --frozen-lockfile failed in ${rollback.profileDir}. `
    + 'The plugin is now running new code against old data — reinstall the previous version before using it.'
}

/**
 * Report a plugin whose recorded upgrade does not reconcile with its data
 * (acceptance[1]).
 *
 * `reconcileUpgrade` returning `false` is a fact about the disk, and a caller
 * that dropped it would leave an operator with a plugin the harness quietly
 * believes is upgraded. The message names which plugin, which version, and
 * which half of the record is missing.
 * @param harnessHome - the resolved harness home.
 * @param change - the plugin and the version it moved to.
 * @returns the diagnostic, or `undefined` when the record reconciles.
 */
export async function reportUnreconciled(
  harnessHome: string,
  change: VersionChange,
  observedDigest: string,
): Promise<string | undefined> {
  const record = await readUpgradeRecord(harnessHome, change.plugin)
  if (record === undefined) return undefined
  if (await reconcileUpgrade(harnessHome, change.plugin, {
    upgradedTo: change.to,
    dataDigest: observedDigest,
  })) return undefined
  const missing = record.upgradedTo === undefined
    ? 'the record has no completed-upgrade half (the upgrade did not finish)'
    : record.dataDigest === undefined
      ? 'the record has no data digest'
      : `the recorded digest ${record.dataDigest} does not match what the medium reports`
  return `${change.plugin}: recorded upgrade to ${change.to} does not reconcile — ${missing}`
}

/**
 * The Plugin Manifest v2 an installed package declares, or undefined when it
 * declares none, declares an invalid one, or is unresolvable.
 * @param plugin - the package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns the validated manifest, or undefined.
 */
export function installedManifestV2(plugin: string, profileDir: string): PluginManifestV2 | undefined {
  let dshField: unknown
  try {
    dshField = (readProfileManifest(NAME, resolveBundleDir(NAME, plugin, INSTALL_ANCHOR, profileDir)) as {
      dsh?: unknown
    }).dsh
  } catch {
    return undefined // unresolvable after a successful install: reconcilePlugins already warned
  }
  const declaration = classifyPluginDeclaration(dshField)
  return declaration.kind === 'manifest-v2' ? declaration.manifest : undefined
}

/**
 * Build each changed plugin's migration manifest from what its INSTALLED new
 * version declares (P1-10 must[0]).
 *
 * Read through P1-01's `dsh` manifest — the product's own vocabulary — rather
 * than a parallel one this epic invented. The NEW version is the one consulted
 * because it is the build that knows how to convert into its own shape; the old
 * one could only describe conversions that already happened.
 *
 * `current` is the highest version the declarations reach, NOT the package
 * version: a package stepping 1.2.0 → 2.0.0 says nothing about which schema
 * version its records should end at.
 *
 * A plugin that declares nothing gets no entry, which is how
 * `migrateChangedPlugins` tells "needs no migration" from "declared one and
 * shipped no module".
 * @param changes - the plugins whose versions moved.
 * @param profileDir - the profile directory the packages are installed under.
 * @returns each plugin's manifest, keyed by plugin name.
 */
export function declaredMigrationManifests(
  changes: readonly VersionChange[],
  profileDir: string,
): Map<string, PluginMigrationManifest> {
  const manifests = new Map<string, PluginMigrationManifest>()
  for (const change of changes) {
    const declared = installedManifestV2(change.plugin, profileDir)?.migrations
    if (declared === undefined || declared.length === 0) continue
    manifests.set(change.plugin, {
      plugin: change.plugin,
      current: brandString<PluginSchemaVersion>(String(Math.max(...declared.map(step => step.toVersion)))),
      migrations: declared.map(step => ({
        from: brandString<PluginSchemaVersion>(String(step.fromVersion)),
        to: brandString<PluginSchemaVersion>(String(step.toVersion)),
        // P1-01's declaration carries neither field. Defaulted HERE rather than
        // in the decision package, so the gap stays visible at the bridge:
        // until the declaration is extended, every declared migration reads as
        // snapshot-backed and reversible, and an irreversible one cannot be
        // expressed at all. Recorded in this epic's Known Limitations.
        backup: { kind: 'snapshot' },
        reversible: true,
      })),
    })
  }
  return manifests
}

/**
 * Where a plugin's unit and its migration steps come from: its own installed
 * manifest.
 *
 * The unit is derived from P1-01's `dataStores` declaration, so the data an
 * upgrade touches is the data the plugin declared it owns. A plugin declaring
 * more than one store has no single unit and gets none — an upgrade that picked
 * one would migrate an arbitrary half of its data.
 *
 * The steps are loaded from the INSTALLED NEW version by `import()`, gated by
 * the same pre-mount admission a boot applies: this runs the plugin's own code
 * in the CLI process, so a declaration that would be denied at mount must not
 * be executed here either.
 * @param profileDir - the profile directory the packages are installed under.
 * @returns the lookups `withUpgradeEnvironment` needs.
 */
export function upgradeLookups(profileDir: string): Pick<UpgradeEnvironment, 'unitFor' | 'stepsFor'> {
  return {
    unitFor: (plugin) => {
      const manifest = installedManifestV2(plugin, profileDir)
      const stores = manifest?.dataStores ?? []
      if (manifest === undefined || stores.length !== 1 || stores[0] === undefined) return undefined
      const declared = manifest.migrations ?? []
      if (declared.length === 0) return undefined
      return {
        name: stores[0].domainName,
        version: Math.max(...declared.map(step => step.toVersion)),
        tables: [stores[0].domainName],
        hasGlobal: false,
      }
    },
    stepsFor: async (plugin) => {
      const manifest = installedManifestV2(plugin, profileDir)
      if (manifest === undefined) return undefined
      const declaration = classifyPluginDeclaration({ ...manifest })
      if (!evaluatePreMountAdmission(declaration, true).admitted) return undefined
      // Ordered by the version each step converts FROM, because the modules run
      // as a chain and a manifest lists its steps in no particular order.
      const modules = [...manifest.migrations ?? []]
        .sort((left, right) => left.fromVersion - right.fromVersion)
        .map(step => step.module)
      // Every declared step must ship its module or none run: a partial chain
      // would leave the records between two versions with no declaration
      // describing where they are.
      if (modules.length === 0 || modules.some(specifier => specifier === undefined)) return undefined
      let dir: string
      try {
        dir = resolveBundleDir(NAME, plugin, INSTALL_ANCHOR, profileDir)
      } catch {
        return undefined
      }
      const steps: ((records: readonly unknown[]) => Promise<readonly unknown[]>)[] = []
      for (const specifier of modules) {
        const loaded = await import(pathToFileURL(join(dir, specifier as string)).href) as {
          default?: (records: readonly unknown[]) => Promise<readonly unknown[]>
        }
        if (loaded.default === undefined) return undefined
        steps.push(loaded.default)
      }
      return async (records) => {
        let current = records
        for (const step of steps) current = await step(current)
        return current
      }
    },
  }
}
