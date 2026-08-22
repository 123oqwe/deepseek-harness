/**
 * Migration engine for the Schema Registry.
 *
 * Migrations transform data from one schema version to another. Each migration
 * is registered with a direction (from -> to), and the engine chains them to
 * reach the target version. Migrations can be reversible or one-way.
 *
 * @module @deepseek-ai/dsh-schema-registry/migrate
 */

import type { MigrationEntry, MigrationFunction, SchemaVersion } from './types.ts'

/** Compare two schema versions; returns -1, 0, or 1. */
export function compareVersions(a: SchemaVersion, b: SchemaVersion): number {
  if (a.major !== b.major) return a.major - b.major
  return a.minor - b.minor
}

/** Format a schema version as a string. */
export function formatVersion(v: SchemaVersion): string {
  return `v${v.major}.${v.minor}`
}

/** Check if version a is greater than or equal to version b. */
export function gte(a: SchemaVersion, b: SchemaVersion): boolean {
  return compareVersions(a, b) >= 0
}

/** Check if version a is less than or equal to version b. */
export function lte(a: SchemaVersion, b: SchemaVersion): boolean {
  return compareVersions(a, b) <= 0
}

/**
 * Registry of all known migrations.
 * Key: `${schemaId}@${fromMajor}.${fromMinor}->${toMajor}.${toMinor}`
 */
const migrationMap = new Map<string, MigrationEntry>()

/** Build the map key for a migration. */
function migrationKey(schemaId: string, from: SchemaVersion, to: SchemaVersion): string {
  return `${schemaId}@${from.major}.${from.minor}->${to.major}.${to.minor}`
}

/** Register a migration between two schema versions. */
export function registerMigration(entry: MigrationEntry): void {
  const key = migrationKey(entry.schemaId, entry.from, entry.to)
  if (migrationMap.has(key)) {
    throw new Error(`Migration already registered for ${key}`)
  }
  migrationMap.set(key, entry)
}

/** Look up a specific migration by exact direction. */
export function getMigration(schemaId: string, from: SchemaVersion, to: SchemaVersion): MigrationEntry | undefined {
  return migrationMap.get(migrationKey(schemaId, from, to))
}

/**
 * Look up a migration to apply for a given step.
 * For forward steps, looks up the direct migration.
 * For backward steps, looks up the reverse migration (from -> to swapped)
 * and checks reversibility.
 */
function getMigrationForStep(
  schemaId: string,
  current: SchemaVersion,
  next: SchemaVersion,
): { fn: MigrationFunction; entry: MigrationEntry } | undefined {
  // Forward: current -> next (use forward migrate)
  const forward = getMigration(schemaId, current, next)
  if (forward) {
    return { fn: forward.migrate, entry: forward }
  }

  // Backward: next -> current is registered (use its reverse)
  const backward = getMigration(schemaId, next, current)
  if (backward) {
    if (!backward.reversible) {
      throw new Error(`Migration from ${formatVersion(backward.from)} to ${formatVersion(backward.to)} is not reversible; cannot migrate ${formatVersion(current)} -> ${formatVersion(next)}`)
    }
    if (!backward.reverse) {
      throw new Error(`Migration from ${formatVersion(backward.from)} to ${formatVersion(backward.to)} claims reversible but has no reverse function`)
    }
    return { fn: backward.reverse, entry: backward }
  }

  return undefined
}

/** List all registered migrations for a schema. */
export function listMigrations(schemaId: string): MigrationEntry[] {
  return Array.from(migrationMap.values()).filter(m => m.schemaId === schemaId)
}

/**
 * Migrate data from one version to another by chaining migrations.
 *
 * @param schemaId - the schema to migrate
 * @param from - starting version
 * @param to - target version
 * @param data - the data to migrate
 * @returns the migrated data
 * @throws if no migration path exists
 */
export function migrate(schemaId: string, from: SchemaVersion, to: SchemaVersion, data: unknown): unknown {
  if (compareVersions(from, to) === 0) return data

  const direction = compareVersions(from, to) > 0 ? 'down' : 'up'
  let current = from
  let currentData = data

  while (compareVersions(current, to) !== 0) {
    const next: SchemaVersion = direction === 'up'
      ? { major: current.major, minor: current.minor + 1 }
      : { major: current.major, minor: current.minor - 1 }

    // Handle major version transitions
    if (next.minor < 0) {
      const prevMajor = current.major - 1
      if (prevMajor < 0) throw new Error('Cannot migrate below v0.0')
      const majorStep = { major: prevMajor, minor: 0 }
      const result = getMigrationForStep(schemaId, current, majorStep)
      if (!result) throw new Error(`No migration from ${formatVersion(current)} to ${formatVersion(majorStep)} for ${schemaId}`)
      currentData = result.fn(currentData)
      current = majorStep
      continue
    }

    const result = getMigrationForStep(schemaId, current, next)
    if (!result) {
      throw new Error(`No migration from ${formatVersion(current)} to ${formatVersion(next)} for ${schemaId}`)
    }
    currentData = result.fn(currentData)
    current = next
  }

  return currentData
}

/** Clear all registered migrations. For testing. */
export function clearMigrations(): void {
  migrationMap.clear()
}


/** Get all registered schema IDs that have migrations. */
export function getMigratableSchemaIds(): string[] {
  return Array.from(new Set(Array.from(migrationMap.values()).map(m => m.schemaId)))
}
