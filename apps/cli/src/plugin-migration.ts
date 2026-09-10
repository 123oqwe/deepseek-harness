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
import { readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { reconcileUpgrade, readUpgradeRecord } from '@deepseek-ai/dsh-plugin-migrations/transaction'

/** One plugin's version before and after pnpm ran. */
export interface VersionChange {
  readonly plugin: string
  readonly from: string
  readonly to: string
}

/** Where one plugin's durable data and upgrade state live. */
export function pluginStorageRoot(harnessHome: string, plugin: string): string {
  return join(harnessHome, 'plugins', plugin)
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
 * A `SIGKILL` skips `runUpgrade`'s `finally`, so the plugin stays frozen and
 * its quarantine and rollback directories stay on disk. "The old version is
 * wholly usable after a restart" is not true of a plugin nothing will ever
 * thaw, which is why this runs first and unconditionally rather than only when
 * an upgrade is about to happen.
 *
 * The rule is the one the record's two halves already encode: intent with no
 * achievement means the upgrade did not finish, so the rollback directory —
 * if the switch got that far — goes back, and the quarantine is cleared.
 * @param harnessHome - the resolved harness home.
 * @param plugins - the plugins to check.
 * @returns the plugins that needed recovery, for the caller to report.
 */
export async function recoverInterruptedUpgrades(
  harnessHome: string,
  plugins: readonly string[],
): Promise<string[]> {
  const recovered: string[] = []
  for (const plugin of plugins) {
    const root = pluginStorageRoot(harnessHome, plugin)
    const record = await readUpgradeRecord(root) as { upgradedTo?: string } | undefined
    if (record === undefined || record.upgradedTo !== undefined) continue
    // Intent with no achievement: the upgrade started and did not finish.
    const rollback = join(root, 'rollback')
    const live = join(root, 'data')
    if (existsSync(rollback)) {
      // The switch had happened, so the live directory holds migrated data
      // whose health was never confirmed. Put the previous version back and
      // keep the migrated copy for diagnosis.
      await rm(join(root, 'quarantine'), { recursive: true, force: true })
      if (existsSync(live)) await rename(live, join(root, 'quarantine'))
      await rename(rollback, live)
    } else {
      // The switch had not happened, so production was never touched; only the
      // quarantine needs clearing.
      await rm(join(root, 'quarantine'), { recursive: true, force: true })
    }
    await rm(join(root, 'upgrade.json'), { force: true })
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
): Promise<string | undefined> {
  const root = pluginStorageRoot(harnessHome, change.plugin)
  const record = await readUpgradeRecord(root) as
    { upgradedTo?: string; dataDigest?: string } | undefined
  if (record === undefined) return undefined
  const digestPath = join(root, 'data', 'digest')
  const observedDigest = existsSync(digestPath) ? (await readFile(digestPath, 'utf8')).trim() : ''
  if (await reconcileUpgrade(root, { upgradedTo: change.to, dataDigest: observedDigest })) return undefined
  const missing = record.upgradedTo === undefined
    ? 'the record has no completed-upgrade half (the upgrade did not finish)'
    : record.dataDigest === undefined
      ? 'the record has no data digest'
      : `the recorded digest ${record.dataDigest} does not match the data on disk`
  return `${change.plugin}: recorded upgrade to ${change.to} does not reconcile — ${missing}`
}
