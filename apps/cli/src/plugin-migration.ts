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
 * @module @deepseek-ai/dsh/plugin-migration
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { recoverUpgrade } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { UpgradeRecord } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { MigrationFacet } from '@deepseek-ai/dsh-storage'

/** One plugin's version before and after pnpm ran. */
export interface VersionChange {
  readonly plugin: string
  readonly from: string
  readonly to: string
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
