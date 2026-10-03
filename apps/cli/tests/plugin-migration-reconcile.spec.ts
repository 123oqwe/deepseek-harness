/**
 * P1-10 acceptance[1], reconciliation half (BLOCKED-302 condition [1]): the
 * shipped upgrade flow RECONCILES a plugin's recorded upgrade against the data
 * on the medium — by schema version and by digest — and refuses the install
 * when they disagree, rather than letting a medium whose state does not match
 * its record through.
 *
 * Red first for B-667. Today `migrateChangedPlugins` (the flow `dsh plugin`
 * runs after pnpm, apps/cli/src/plugin.ts) never reconciles: `reconcileUpgrade`
 * exists (plugin-migration.ts) but its only caller, `reportUnreconciled`, has
 * no shipped caller. So the flow skips a unit already at the version the build
 * wants (its continue path) and reports a fresh migration as succeeded, in both
 * cases without ever comparing the recorded upgrade to the medium. B-667 wires
 * that comparison into the flow at the two points the ruling names: the
 * continue path, against the completed record it encounters; and once after a
 * migration, against the record it just wrote.
 *
 * §21.4: written from the clause and the shipped machinery; the fix (B-667) is
 * not read. The two red cases observe PRODUCT STATE — `migrateChangedPlugins`'s
 * own `UpgradeOutcomes`, which apps/cli/src/plugin.ts turns into a non-zero exit
 * and a code rollback when `failed` is non-empty — not the unwired
 * `reconcileUpgrade` directly (calling it would green a cell over a subject the
 * flow never reaches).
 *
 * How each disagreement is induced, with the real JSON backend the flow mounts:
 * - (i) continue path, VERSION axis: the medium is seeded at schema 3 and the
 *   build also wants schema 3, so the flow's continue path is taken; a completed
 *   record placed beside it on disk records `upgradedTo: '2'`, with its data
 *   digest set to the medium's ACTUAL digest so the ONLY disagreement is the
 *   recorded schema version. This is the backup-restore / hand-edit case the
 *   record exists to catch.
 * - (ii) after a migration, VERSION axis: the medium is seeded at schema 1 and
 *   the build wants schema 3, so a real migration runs and writes a record at
 *   `upgradedTo: '3'`. A thin fixture facet overrides only `stampedVersion` to
 *   keep reporting the OLD version (1); the migration still succeeds because the
 *   transaction validates the migrated COPY through `readSnapshot`, not
 *   `stampedVersion`, so the post-migration medium's reported version disagrees
 *   with the record the flow just wrote.
 * - control: a completed, CONSISTENT record (`upgradedTo: '3'` against a medium
 *   at schema 3, matching digest) whose PACKAGE version (1.3.0) differs from its
 *   SCHEMA version (3). A reconcile that compared the package version would
 *   falsely flag it; the shipped data model keeps the two independent, so a
 *   correct reconcile leaves it alone.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PluginMigrationManifest, PluginSchemaVersion } from '@deepseek-ai/dsh-plugin-migrations'
import type { UpgradeRecord } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import StorageHub, {
  type KvFacet,
  type KvUnitDescriptor,
  type MigrationFacet,
} from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { afterAll, describe, expect, it } from 'vitest'
import {
  migrateChangedPlugins,
  type UpgradeEnvironment,
  type UpgradeOutcomes,
  upgradeRecordPath,
  type VersionChange,
  withUpgradeEnvironment,
} from '../src/plugin-migration.ts'

/** The plugin and its unit, named as the product's own migration fixtures name them. */
const PLUGIN = 'notes-plugin'
const UNIT = 'notes'

/** The unit descriptor at one schema version, as a plugin's migration module declares it. */
function descriptor(version: number): KvUnitDescriptor {
  return { name: UNIT, version, tables: [UNIT], hasGlobal: false }
}

/** A schema version as the manifest vocabulary brands it. */
function schema(version: number): PluginSchemaVersion {
  return brandString<PluginSchemaVersion>(String(version))
}

const homes: string[] = []

/** A fresh harness home, cleaned up after the suite. */
async function freshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'p1-10-reconcile-'))
  homes.push(home)
  return home
}

afterAll(async () => {
  for (const home of homes) await rm(home, { recursive: true, force: true })
})

/**
 * Run one body against the JSON backend mounted at the same storage root the
 * upgrade flow mounts, so a unit seeded here is the unit the flow reads.
 * @param home - the harness home.
 * @param body - receives the backend's KV and migration facets.
 * @returns the body's value.
 */
async function withBackend<T>(
  home: string,
  body: (facets: { kv: KvFacet; migration: MigrationFacet }) => Promise<T>,
): Promise<T> {
  const ctx = new Context()
  await ctx.plugin(StorageHub)
  await ctx.plugin(storageJson, { root: join(home, 'storages') })
  try {
    const backend = ctx.storage.backend.get('json')
    const { kv, migration } = backend
    if (kv === undefined || migration === undefined) throw new Error('the JSON backend offers no KV or migration facet')
    return await body({ kv, migration })
  } finally {
    await ctx.fiber.dispose()
  }
}

/**
 * Seed the unit at one schema version with one record, stamping that version on
 * the medium.
 * @param home - the harness home.
 * @param version - the schema version to stamp.
 */
async function seedUnit(home: string, version: number): Promise<void> {
  await withBackend(home, async ({ kv }) => {
    const opened = await kv.open(descriptor(version))
    try {
      await opened.putRecord(UNIT, 'a', { body: 'original' })
    } finally {
      await opened.close()
    }
  })
}

/**
 * The medium's actual data digest, computed through the facet the reconcile
 * would compute it through, so a record carrying this digest disagrees with the
 * medium on no axis but the one a case varies.
 * @param home - the harness home.
 * @param version - the version the medium is stamped at.
 * @returns the digest, prefixed with its algorithm.
 */
async function mediumDigest(home: string, version: number): Promise<string> {
  return withBackend(home, async ({ migration }) => migration.digestUnit(await migration.snapshotUnit(descriptor(version))))
}

/** Place a completed upgrade record on disk, where the flow's record writer keeps it. */
async function placeRecord(home: string, record: UpgradeRecord): Promise<void> {
  await mkdir(join(home, 'plugin-upgrades'), { recursive: true })
  await writeFile(upgradeRecordPath(home, PLUGIN), JSON.stringify(record, undefined, 2), 'utf8')
}

/** A manifest whose current schema version is `current`, declaring the given single edge. */
function manifestTo(current: number, from: number): PluginMigrationManifest {
  return {
    plugin: PLUGIN,
    current: schema(current),
    migrations: [{ from: schema(from), to: schema(current), backup: { kind: 'additive' }, reversible: true }],
  }
}

/**
 * Drive the shipped upgrade flow once over the real JSON backend, optionally
 * wrapping the migration facet.
 * @param home - the harness home.
 * @param changes - the package version changes that put the plugin in the install.
 * @param manifest - the plugin's declared migrations.
 * @param target - the schema version the installed build wants (the resolved unit).
 * @param wrapFacet - wraps the backend's migration facet, for cases that make the medium disagree.
 * @returns what the flow decided, per plugin.
 */
async function runFlow(
  home: string,
  changes: readonly VersionChange[],
  manifest: PluginMigrationManifest,
  target: number,
  wrapFacet?: (base: MigrationFacet) => MigrationFacet,
): Promise<UpgradeOutcomes> {
  const manifests = new Map([[PLUGIN, manifest]])
  const resolve: UpgradeEnvironment['resolve'] = async () => ({
    kind: 'ready',
    unit: descriptor(target),
    migrate: async content => ({
      global: content.global,
      tables: { [UNIT]: { ...content.tables[UNIT], migrated: { body: 'added' } } },
    }),
  })
  const result = await withUpgradeEnvironment(home, { resolve }, async (environment) => {
    if (wrapFacet === undefined) return migrateChangedPlugins(changes, manifests, environment, () => {})
    if (environment.migration === undefined) throw new Error('the JSON backend offers no migration facet')
    const wrapped: UpgradeEnvironment = { ...environment, migration: wrapFacet(environment.migration) }
    return migrateChangedPlugins(changes, manifests, wrapped, () => {})
  })
  if (!result.held) throw new Error(`the upgrade lease was refused: ${result.refusal}`)
  return result.value
}

describe('P1-10 acceptance[1]: the shipped upgrade flow reconciles the recorded upgrade against the medium (red first for B-667)', () => {
  it('(i) continue path: a completed record whose recorded schema version disagrees with the medium is refused, not skipped', async () => {
    const home = await freshHome()
    await seedUnit(home, 3) // the medium is already at the version the build wants
    await placeRecord(home, {
      plugin: PLUGIN,
      unit: UNIT,
      from: '1',
      to: '2',
      pathDigest: 'reconcile-red-first-path-digest',
      // The record says the data was upgraded to schema 2; the medium is at 3.
      // Its digest is the medium's actual digest, so ONLY the recorded version
      // disagrees — this isolates the schema-version axis of the reconcile.
      upgradedTo: '2',
      dataDigest: await mediumDigest(home, 3),
    })

    // The package moved but the schema did not, so the flow takes its continue
    // path (the medium is already at schema 3). B-667 must still reconcile the
    // completed record it finds there and refuse on the version mismatch.
    const outcomes = await runFlow(home, [{ plugin: PLUGIN, from: '1.0.0', to: '2.0.0' }], manifestTo(3, 2), 3)

    // RED today: the continue path skips without reading the record, so the
    // plugin is reported neither migrated nor failed, and the install proceeds.
    expect(outcomes.failed, JSON.stringify(outcomes)).toContain(PLUGIN)
  })

  it('(ii) after a migration: a post-migration medium whose version disagrees with the record just written is refused', async () => {
    const home = await freshHome()
    await seedUnit(home, 1) // a real migration 1 -> 3 runs

    // A thin fixture facet: everything is the real backend except `stampedVersion`,
    // which keeps reporting the OLD version (1). The migration still succeeds —
    // the transaction validates the migrated copy through `readSnapshot`, not
    // `stampedVersion` — but the post-migration medium's reported version (1)
    // disagrees with the record the flow just wrote (upgradedTo 3).
    const staleStamp = (base: MigrationFacet): MigrationFacet => ({ ...base, stampedVersion: async () => 1 })
    const outcomes = await runFlow(home, [{ plugin: PLUGIN, from: '1.0.0', to: '2.0.0' }], manifestTo(3, 1), 3, staleStamp)

    // RED today: the flow reports the migration as succeeded (migrated, not
    // failed) because it never reconciles the medium against the new record.
    expect(outcomes.failed, JSON.stringify(outcomes)).toContain(PLUGIN)
  })

  it('control: a consistent record whose PACKAGE version differs from its SCHEMA version is not flagged', async () => {
    const home = await freshHome()
    await seedUnit(home, 3)
    await placeRecord(home, {
      plugin: PLUGIN,
      unit: UNIT,
      from: '1',
      to: '3',
      pathDigest: 'reconcile-red-first-path-digest',
      // Consistent with the medium on both axes: upgraded to schema 3, matching digest.
      upgradedTo: '3',
      dataDigest: await mediumDigest(home, 3),
    })

    // The package version (1.3.0) is not the schema version (3); a reconcile that
    // compared the package version would falsely flag this. A correct reconcile
    // compares the recorded SCHEMA version and leaves it alone — green today
    // (nothing reconciles) and green after B-667 (the record matches the medium).
    const outcomes = await runFlow(home, [{ plugin: PLUGIN, from: '1.2.0', to: '1.3.0' }], manifestTo(3, 2), 3)

    expect(outcomes.failed, JSON.stringify(outcomes)).not.toContain(PLUGIN)
  })
})
