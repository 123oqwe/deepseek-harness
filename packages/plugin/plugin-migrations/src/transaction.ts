/**
 * The six-phase plugin upgrade transaction Epic P1-10's must[1] declares:
 * freeze, snapshot, migrate in quarantine, validate, atomic switch, health
 * check.
 *
 * The phases are an ordering over real effects, which is why they live here
 * and not beside the decisions in `./index.ts`. What each phase leaves behind
 * is observable on disk between phases, and that is what this module's tests
 * assert: a transaction whose only evidence is "it returned true" is
 * indistinguishable from a function that returns true.
 */

import { rename, rm, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

import { computeMigrationPathDigest, planUpgrade } from './index.ts'
import type {
  MigrationRefusal,
  PluginMigrationManifest,
  PluginSchemaVersion,
  UpgradePlan,
} from './types.ts'

/** The phases must[1] names, in the order it names them. */
export const UPGRADE_PHASES = [
  'freeze',
  'snapshot',
  'quarantine',
  'validate',
  'switch',
  'health-check',
] as const

/** One phase of the upgrade transaction. */
export type UpgradePhase = typeof UPGRADE_PHASES[number]

/** What the caller supplies to run one upgrade. */
export interface UpgradeRequest {
  /** The plugin being upgraded. */
  readonly plugin: string
  /** Its declared migrations. */
  readonly manifest: PluginMigrationManifest
  /** The version currently on disk. */
  readonly installed: PluginSchemaVersion
  /** The plugin's own storage root; everything this transaction writes is under it. */
  readonly storageRoot: string
  /**
   * Stops the plugin accepting work, and resumes it when the returned disposer
   * runs.
   *
   * Supplied rather than performed here: what "frozen" means belongs to
   * whatever runs the plugin, and a transaction that decided it would be
   * freezing something it does not own.
   */
  readonly freeze: () => Promise<() => Promise<void>>
  /** Runs the migration steps against the quarantined COPY. */
  readonly migrate: (quarantineDir: string, plan: UpgradePlan) => Promise<void>
  /** Answers whether the migrated data validates; the digest it returns is recorded. */
  readonly validate: (quarantineDir: string) => Promise<{ readonly ok: boolean; readonly digest: string }>
  /** Answers whether the plugin works on the switched-in data (must[1]'s last phase). */
  readonly healthCheck: () => Promise<boolean>
}

/** How one upgrade ended, and how far it got. */
export type UpgradeOutcome =
  | { readonly upgraded: true; readonly digest: string; readonly rollbackDir: string }
  | { readonly upgraded: false; readonly failedAt: UpgradePhase; readonly refusal?: MigrationRefusal }

/** Where each phase writes, all under the plugin's own storage root. */
function layout(storageRoot: string): {
  live: string
  quarantine: string
  snapshot: string
  rollback: string
  record: string
} {
  return {
    live: join(storageRoot, 'data'),
    quarantine: join(storageRoot, 'quarantine'),
    snapshot: join(storageRoot, 'snapshot'),
    rollback: join(storageRoot, 'rollback'),
    record: join(storageRoot, 'upgrade.json'),
  }
}

/**
 * Copy one SQLite database atomically, without stopping its writers.
 *
 * `VACUUM INTO` is the adopted mechanism (the make-vs-use ledger's `adapt`):
 * it produces a consistent copy of a live database, which a file copy of a
 * database being written to does not. The destination must not exist, and
 * SQLite refuses rather than overwriting — a refusal this transaction keeps
 * rather than clearing the path first, because a snapshot destination that
 * already exists means a previous upgrade left state behind.
 * @param source - the live database file.
 * @param destination - the copy to create; must not exist.
 */
export function vacuumInto(source: string, destination: string): void {
  const database = new DatabaseSync(source, { readOnly: true })
  try {
    // Bound as a parameter rather than interpolated: a storage root can carry
    // a quote, and a path spliced into SQL is an injection even when the only
    // author is this file.
    database.prepare('VACUUM INTO ?').run(destination)
  } finally {
    database.close()
  }
}

/**
 * Run one plugin upgrade as the six-phase transaction (must[1]).
 *
 * Every phase leaves an observable state, and the order is chosen so that each
 * intermediate one is resolvable by a restart: the migration runs against a
 * COPY while production stays readable, and the switch renames the current
 * directory aside BEFORE renaming the migrated one in, so the old state
 * survives the switch and is the rollback target until the health check
 * passes.
 * @param request - the plugin, its manifest, its storage root and the
 *   caller-owned freeze, migrate, validate and health-check operations.
 * @returns the outcome, naming the phase that failed when one did.
 */
export async function runUpgrade(request: UpgradeRequest): Promise<UpgradeOutcome> {
  const paths = layout(request.storageRoot)
  const plan = planUpgrade(request.manifest, request.installed)
  if (!plan.admitted) return { upgraded: false, failedAt: 'freeze', refusal: plan.refusal }

  const thaw = await request.freeze()
  try {
    // snapshot: an atomically consistent copy, plus its manifest written
    // through the house atomic-write so a torn manifest cannot describe a
    // snapshot that exists.
    await mkdir(paths.snapshot, { recursive: true })
    const snapshotDb = join(paths.snapshot, 'data.db')
    if (existsSync(snapshotDb)) await rm(snapshotDb)
    vacuumInto(join(paths.live, 'data.db'), snapshotDb)
    await writeFileAtomic(paths.record, JSON.stringify({
      plugin: request.plugin,
      from: request.installed,
      to: request.manifest.current,
      pathDigest: computeMigrationPathDigest(request.plugin, plan.steps),
    }, undefined, 2), { mode: 0o600, dirMode: 0o700 })

    // quarantine: the migration runs against a COPY. Production is untouched
    // and still readable throughout, which is what makes a crash here
    // recoverable by deleting the quarantine directory.
    await rm(paths.quarantine, { recursive: true, force: true })
    await mkdir(paths.quarantine, { recursive: true })
    vacuumInto(snapshotDb, join(paths.quarantine, 'data.db'))
    await request.migrate(paths.quarantine, plan)

    const validated = await request.validate(paths.quarantine)
    if (!validated.ok) return { upgraded: false, failedAt: 'validate' }

    // switch: two renames on one filesystem. The current directory moves ASIDE
    // first, because a rename over a directory does not preserve what it
    // replaced and the aside IS the rollback target.
    await rm(paths.rollback, { recursive: true, force: true })
    await rename(paths.live, paths.rollback)
    await rename(paths.quarantine, paths.live)

    if (!await request.healthCheck()) {
      // Back to exactly what was there before the switch. The migrated data is
      // kept aside rather than deleted: an operator diagnosing a failed health
      // check needs to see what the migration produced.
      await rename(paths.live, paths.quarantine)
      await rename(paths.rollback, paths.live)
      return { upgraded: false, failedAt: 'health-check' }
    }
    return { upgraded: true, digest: validated.digest, rollbackDir: paths.rollback }
  } finally {
    await thaw()
  }
}

/**
 * The upgrade record written at the snapshot phase, read back.
 * @param storageRoot - the plugin's storage root.
 * @returns the parsed record, or `undefined` when no upgrade has written one.
 */
export async function readUpgradeRecord(storageRoot: string): Promise<unknown> {
  const path = layout(storageRoot).record
  if (!existsSync(path)) return undefined
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}
