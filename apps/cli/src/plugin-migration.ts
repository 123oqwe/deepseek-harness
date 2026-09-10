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
import { planUpgrade, requiresApprovalAndExport } from '@deepseek-ai/dsh-plugin-migrations'
import { recoverUpgrade, runUpgrade } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { UpgradeRecord } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type {
  MigrationPathDigest,
  MigrationRefusal,
  PluginMigrationManifest,
  PluginSchemaVersion,
} from '@deepseek-ai/dsh-plugin-migrations'
import type { KvUnitDescriptor, MigrationFacet, UnitContent } from '@deepseek-ai/dsh-storage'
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
  /** What one plugin's installed new version declares and ships, or why it cannot be upgraded. */
  readonly resolve: (plugin: string) => Promise<PluginUpgradeResolution>
  /**
   * Open one unit as the plugin's own code would, and read it.
   *
   * This is the health check must[1]'s last phase names, in the only terms a
   * package-manager command has: the new build's descriptor against the
   * switched-in data. A unit still stamped at the old version fails
   * `version-mismatch` here, which is exactly "the new version is not usable".
   */
  readonly openUnit: (unit: KvUnitDescriptor) => Promise<boolean>
  /**
   * Where one plugin's pre-upgrade export is written (must[2]).
   *
   * A path the operator keeps, outside the medium: the transaction's own
   * snapshot is discarded when the upgrade finishes, and an export an operator
   * cannot find after the fact is not one they can rely on.
   */
  readonly exportPathFor: (plugin: string, fromVersion: number) => string
  /** Writes one plugin's upgrade record. */
  readonly writeRecord: (plugin: string, record: UpgradeRecord) => Promise<void>
}

/**
 * What one plugin's installed new version offers an upgrade, or why it offers
 * none.
 *
 * Every refusal is NAMED. An upgrade that skipped a plugin by returning
 * nothing would leave the new code to meet the old data at the next boot and
 * fail there, with nothing pointing back at the install that caused it.
 */
export type PluginUpgradeResolution =
  /** The plugin declares no migrations: it has said its data needs none. */
  | { readonly kind: 'none' }
  /** Everything an upgrade needs, read from the installed new version. */
  | {
    readonly kind: 'ready'
    readonly unit: KvUnitDescriptor
    readonly migrate: (content: UnitContent) => Promise<UnitContent>
    readonly validate?: (content: UnitContent) => Promise<boolean>
  }
  /** The plugin declares migrations but cannot be upgraded, and why. */
  | { readonly kind: 'refused'; readonly reason: UpgradeResolutionRefusal; readonly detail: string }

/** Why an installed plugin's declarations cannot produce an upgrade. */
export type UpgradeResolutionRefusal =
  /** The installed package could not be resolved or declares no Manifest v2. */
  | 'unreadable-manifest'
  /** More than one declared data store: no single unit holds the plugin's data. */
  | 'multiple-data-stores'
  /** No declared data store at all, so the declared migrations name no data. */
  | 'no-data-store'
  /** A declared step ships no `module`, so the chain has a gap. */
  | 'missing-migration-module'
  /** A migration module could not be imported: the plugin's own code threw. */
  | 'unloadable-migration-module'
  /** A migration module does not export the unit `descriptor` its plugin opens. */
  | 'missing-descriptor-export'
  /** A migration module exports a `descriptor` but no `migrate` to apply. */
  | 'missing-migrate-export'
  /** The exported descriptor's version disagrees with the declared migrations. */
  | 'descriptor-version-mismatch'
  /** The package's declaration would be denied at mount, so its code must not run here. */
  | 'denied-at-mount'

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
  lookups: Pick<UpgradeEnvironment, 'resolve'>,
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
        resolve: lookups.resolve,
        exportPathFor: (plugin, fromVersion) =>
          join(harnessHome, 'plugin-upgrades', `${plugin}.v${String(fromVersion)}.export.json`),
        openUnit: async (unit) => {
          // Opened through the hub exactly as a booting plugin would, so the
          // check fails on everything a boot would fail on — a stale version
          // stamp, a malformed document, a missing declared table.
          try {
            // `kv` is optional on the backend contract because a backend may
            // serve another shape; this one is the JSON backend, mounted here.
            const kv = backend.kv
            if (kv === undefined) return false
            const opened = await kv.open(unit)
            await opened.loadAll()
            await opened.close()
            return true
          } catch {
            // Any failure to open and read IS the negative answer; the caller
            // rolls the switch back and reports the phase.
            return false
          }
        },
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
  confirmation?: MigrationPathDigest,
): Promise<UpgradeOutcomes> {
  const migrated: string[] = []
  const failed: string[] = []
  for (const change of changes) {
    const manifest = manifests.get(change.plugin)
    // A plugin that declares no migrations is not skipped silently for lack of
    // a record: it has said its data needs none, which is different from
    // saying nothing.
    if (manifest === undefined) continue
    const resolution = await environment.resolve(change.plugin)
    if (resolution.kind === 'none') continue
    if (resolution.kind === 'refused') {
      // Named, and counted as a failure: the code is already at the new
      // version, so a plugin left here would meet its old data at the next
      // boot. The caller puts the code back.
      report(`${change.plugin}: cannot upgrade its data (${resolution.reason}) — ${resolution.detail}`)
      failed.push(change.plugin)
      continue
    }
    const facet = environment.migration
    if (facet === undefined) {
      report(`${change.plugin}: this storage backend cannot migrate (backend-cannot-migrate) — its data is unchanged`)
      failed.push(change.plugin)
      continue
    }
    const unit = resolution.unit
    // The version the DATA is at, read from the medium — not `change.from`,
    // which is the PACKAGE version. A package version stepping 1.2.0 → 2.0.0
    // says nothing about which schema version the stored records are at, and
    // passing it as one would plan a path between versions no manifest
    // declares.
    const stamped = await facet.stampedVersion(unit)
    if (stamped === undefined) {
      report(`${change.plugin}: its unit '${unit.name}' holds no data yet — nothing to migrate`)
      continue
    }
    if (stamped === unit.version) continue // already at the version this build wants

    // must[2]: an irreversible path is exported BEFORE any confirmation is
    // weighed, because what an operator confirms is that they can still get
    // their data out. The export is a file that outlives the upgrade, not the
    // transaction's own snapshot handle.
    const plan = planUpgrade(manifest, brandString<PluginSchemaVersion>(String(stamped)))
    let exportPath: string | undefined
    if (requiresApprovalAndExport(plan)) {
      exportPath = environment.exportPathFor(change.plugin, stamped)
      await facet.exportUnit(unit, exportPath)
    }

    const outcome = await runUpgrade({
      plugin: change.plugin,
      manifest,
      installed: brandString<PluginSchemaVersion>(String(stamped)),
      unit,
      migration: facet,
      lease: environment.lease,
      now: environment.now,
      migrate: resolution.migrate,
      ...(confirmation === undefined || exportPath === undefined
        ? {}
        : { confirmation: { digest: confirmation, exportPath } }),
      validate: async (copy) => {
        const digest = await facet.digestUnit(copy)
        const read = await facet.readSnapshot(copy)
        // Three things, each of which has failed for a different reason in a
        // real medium: the copy materialized at all, it carries the version it
        // was migrated TO (a copy still stamped at the old version is one the
        // new build refuses to open), and the plugin's own validator accepts
        // its content.
        if (read.version !== unit.version) return { ok: false, digest }
        if (resolution.validate !== undefined && !await resolution.validate(read.content)) {
          return { ok: false, digest }
        }
        return { ok: true, digest }
      },
      healthCheck: () => environment.openUnit(unit),
      writeRecord: async (record) => { await environment.writeRecord(change.plugin, record) },
    })
    if (outcome.upgraded) {
      migrated.push(change.plugin)
      continue
    }
    failed.push(change.plugin)
    report(
      `${change.plugin}: upgrade failed at ${outcome.failedAt}`
      + (outcome.refusal === undefined ? '' : ` (${describeRefusal(outcome.refusal)})`)
      + ' — its data is unchanged, and its code is being rolled back'
      + (exportPath === undefined ? '' : `; its data was exported to ${exportPath}`),
    )
  }
  return { migrated, failed }
}

/** How one install's data migrations ended, per plugin. */
export interface UpgradeOutcomes {
  /** Plugins whose data reached the version their new code expects. */
  readonly migrated: readonly string[]
  /** Plugins whose data did NOT move, so their code must go back. */
  readonly failed: readonly string[]
}

/**
 * One refusal in terms an operator can act on.
 *
 * `confirmation-required` is the one an operator MUST be able to act on
 * without reading source: it names the exact digest to pass back, so the
 * approval names one specific conversion rather than "whatever runs next".
 * @param refusal - the refusal the transaction returned.
 * @returns a one-line description.
 */
function describeRefusal(refusal: MigrationRefusal): string {
  if (refusal.kind === 'confirmation-required') {
    return `${refusal.kind}: this upgrade cannot be undone — re-run with --confirm ${refusal.digest}`
  }
  if (refusal.kind === 'confirmation-mismatch') {
    return `${refusal.kind}: --confirm named ${refusal.supplied}, but this path is ${refusal.expected}`
  }
  return refusal.kind
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
        // Carried from the declaration, never defaulted: a defaulted
        // `reversible: true` would make the operator's confirmation unreachable
        // in exactly the case it exists for. A step that ships a module and
        // declares neither is rejected by `validatePluginManifestV2`, so what
        // reaches here has said which it is.
        backup: { kind: step.backup ?? 'snapshot' },
        reversible: step.reversible ?? true,
      })),
    })
  }
  return manifests
}

/**
 * What one plugin's installed new version offers an upgrade, read from its own
 * declarations and its own shipped code (must[0]).
 *
 * Everything comes from the INSTALLED NEW version: it is the build that knows
 * how to convert into its own shape, and the build whose descriptor the data
 * must end up matching. Nothing is inferred — the unit is the module's own
 * exported `descriptor` (the same value the plugin opens its unit with), not a
 * shape assembled here from a domain name.
 *
 * Loading that module runs the plugin's code in the CLI process, so the same
 * pre-mount admission a production boot applies gates it: a declaration denied
 * at mount is denied here.
 * @param plugin - the package name.
 * @param profileDir - the profile directory the packages are installed under.
 * @returns what the upgrade needs, that it needs nothing, or why it cannot.
 */
export async function resolvePluginUpgrade(
  plugin: string,
  profileDir: string,
): Promise<PluginUpgradeResolution> {
  const manifest = installedManifestV2(plugin, profileDir)
  if (manifest === undefined) {
    return {
      kind: 'refused',
      reason: 'unreadable-manifest',
      detail: `${plugin} is unresolvable or declares no Plugin Manifest v2`,
    }
  }
  const declared = [...manifest.migrations ?? []].sort((left, right) => left.fromVersion - right.fromVersion)
  if (declared.length === 0) return { kind: 'none' }

  if (!evaluatePreMountAdmission(classifyPluginDeclaration({ ...manifest }), true).admitted) {
    return {
      kind: 'refused',
      reason: 'denied-at-mount',
      detail: `${plugin}'s declaration is denied at mount, so its migration code must not run either`,
    }
  }
  const stores = manifest.dataStores ?? []
  if (stores.length === 0) {
    return {
      kind: 'refused',
      reason: 'no-data-store',
      detail: `${plugin} declares migrations but no data store, so the migrations name no data`,
    }
  }
  if (stores.length > 1) {
    return {
      kind: 'refused',
      reason: 'multiple-data-stores',
      detail: `${plugin} declares ${String(stores.length)} data stores; an upgrade would move an arbitrary part of its data`,
    }
  }
  const missing = declared.find(step => step.module === undefined)
  if (missing !== undefined) {
    return {
      kind: 'refused',
      reason: 'missing-migration-module',
      detail: `${plugin} declares ${String(missing.fromVersion)} -> ${String(missing.toVersion)} but ships no module for it`,
    }
  }
  let dir: string
  try {
    dir = resolveBundleDir(NAME, plugin, INSTALL_ANCHOR, profileDir)
  } catch {
    return { kind: 'refused', reason: 'unreadable-manifest', detail: `${plugin} is installed but unresolvable` }
  }

  const steps: PluginMigrationModule[] = []
  for (const step of declared) {
    // The plugin's own code runs here, and it can fail for reasons that have
    // nothing to do with migrating: a missing transitive dependency, syntax
    // this Node rejects. Uncaught, it leaves `migrateChangedPlugins` as a
    // rejected promise that names no plugin and stops every plugin after this
    // one — so it becomes this plugin's named refusal, like every other way
    // its declarations can be unusable.
    try {
      steps.push(await import(pathToFileURL(join(dir, step.module as string)).href) as PluginMigrationModule)
    } catch (failure: unknown) {
      return {
        kind: 'refused',
        reason: 'unloadable-migration-module',
        detail: `${plugin}'s migration module ${String(step.module)} failed to load: `
          + (failure instanceof Error ? failure.message : String(failure)),
      }
    }
  }
  // The LAST step's module is the one that ends at the version this build
  // wants, so its descriptor is the one the data must match.
  const last = steps.at(-1)
  if (last === undefined || (last.descriptor as KvUnitDescriptor | undefined) === undefined) {
    return {
      kind: 'refused',
      reason: 'missing-descriptor-export',
      detail: `${plugin}'s migration module must export \`descriptor\``,
    }
  }
  // Checked on EVERY step, not just the one carrying the descriptor: `migrate`
  // below chains all of them, so a middle step missing it fails the same way
  // and just as late — inside the transaction, with the data already
  // snapshotted.
  const unapplied = declared.find((_step, index) => typeof steps[index]?.migrate !== 'function')
  if (unapplied !== undefined) {
    return {
      kind: 'refused',
      reason: 'missing-migrate-export',
      detail: `${plugin}'s migration module ${String(unapplied.module)} exports no \`migrate\` to apply`,
    }
  }
  const target = Math.max(...declared.map(step => step.toVersion))
  if (last.descriptor.version !== target) {
    return {
      kind: 'refused',
      reason: 'descriptor-version-mismatch',
      detail: `${plugin}'s module descriptor is version ${String(last.descriptor.version)} `
        + `but its declarations reach ${String(target)}`,
    }
  }
  const validate = last.validate
  const migrate = async (content: UnitContent): Promise<UnitContent> => {
    let current = content
    for (const step of steps) current = await step.migrate(current)
    return current
  }
  return {
    kind: 'ready',
    unit: last.descriptor,
    migrate,
    ...(validate === undefined ? {} : { validate }),
  }
}

/**
 * What a plugin's migration module exports.
 *
 * `descriptor` is the plugin's own unit descriptor — the same value it passes
 * to `kv.open` at boot — so an upgrade targets the unit the plugin actually
 * opens rather than one assembled from its manifest. `validate` is optional
 * because not every conversion has a check worth writing; when it exists it
 * runs against the migrated copy, before anything is switched in.
 */
export interface PluginMigrationModule {
  /** The unit this plugin opens once the migration has run. */
  readonly descriptor: KvUnitDescriptor
  /** Converts one unit's content to this step's target version. */
  readonly migrate: (content: UnitContent) => Promise<UnitContent>
  /** Answers whether the migrated content is acceptable. */
  readonly validate?: (content: UnitContent) => Promise<boolean>
}
