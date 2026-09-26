/**
 * Child process for P1-10 acceptance[0]'s crash campaign (A-446): runs one
 * plugin data upgrade through the product's own upgrade environment and
 * SIGKILLs itself as the named phase completes.
 *
 * `withUpgradeEnvironment` mounts the storage hub and the JSON backend under
 * `<home>/storages`, takes the upgrade lease under `<home>/leases`, and writes
 * the upgrade record under `<home>/plugin-upgrades`, as `dsh plugin` does. The
 * transaction gets the validate and health check `migrateChangedPlugins`
 * passes. A SIGKILL skips every `finally`, so what the phase left on disk is
 * what a machine losing power leaves behind.
 *
 * argv: `<home> <plugin> <unit> <phase>`.
 * @module apps/cli/tests/fixtures/plugin-migration-crash-child
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { PluginSchemaVersion } from '@deepseek-ai/dsh-plugin-migrations'
import { runUpgrade, UPGRADE_PHASES, type UpgradePhase } from '@deepseek-ai/dsh-plugin-migrations/transaction'
import type { KvUnitDescriptor, UnitContent } from '@deepseek-ai/dsh-storage'
import { withUpgradeEnvironment } from '../../src/plugin-migration.ts'

/**
 * Whether a command-line word names a transaction phase.
 * @param value - the word.
 * @returns true for a phase.
 */
function isPhase(value: string | undefined): value is UpgradePhase {
  return UPGRADE_PHASES.some(phase => phase === value)
}

/**
 * The migration from version 1 to 2: one record added to `notes`.
 * @param content - the unit's content at version 1.
 * @returns the content at version 2.
 */
function addMigratedNote(content: UnitContent): Promise<UnitContent> {
  return Promise.resolve({
    ...content,
    tables: { ...content.tables, notes: { ...content.tables.notes, b: { body: 'migrated' } } },
  })
}

const [home, plugin, unitName, crashAt] = process.argv.slice(2)
if (home === undefined || plugin === undefined || unitName === undefined || !isPhase(crashAt)) {
  throw new Error('plugin-migration crash child requires <home> <plugin> <unit> <phase>')
}

const unit: KvUnitDescriptor = { name: unitName, version: 2, tables: ['notes'], hasGlobal: false }
const version = (value: string): PluginSchemaVersion => brandString<PluginSchemaVersion>(value)

const held = await withUpgradeEnvironment(home, { resolve: () => Promise.resolve({ kind: 'none' as const }) }, async (environment) => {
  const facet = environment.migration
  if (facet === undefined) throw new Error('plugin-migration crash child: the JSON backend offers no migration facet')
  return runUpgrade({
    plugin,
    manifest: {
      plugin,
      current: version('2'),
      migrations: [{ from: version('1'), to: version('2'), backup: { kind: 'snapshot' }, reversible: true }],
    },
    installed: version('1'),
    unit,
    migration: facet,
    lease: environment.lease,
    now: environment.now,
    migrate: addMigratedNote,
    // As `migrateChangedPlugins` validates: the copy carries the target version.
    validate: async (copy) => {
      const digest = await facet.digestUnit(copy)
      const read = await facet.readSnapshot(copy)
      return { ok: read.version === unit.version, digest }
    },
    healthCheck: () => environment.openUnit(unit),
    writeRecord: async (record) => { await environment.writeRecord(plugin, record) },
    onPhase: (phase) => {
      // SIGKILL to self: no unwinding, no finally, no rollback.
      if (phase === crashAt) process.kill(process.pid, 'SIGKILL')
    },
  })
})
if (!held.held) throw new Error(`plugin-migration crash child: ${held.refusal}`)
throw new Error(`plugin-migration crash child: the upgrade ended without reaching ${crashAt}: ${JSON.stringify(held.value)}`)
