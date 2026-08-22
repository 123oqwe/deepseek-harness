/**
 * Unified Schema Registry with versioning, compatibility rules, and migration.
 *
 * Each persistent or wire-protocol object declares a schemaId, major/minor
 * version, compatibility rule, and optional migration function. New fields
 * are backward-compatible by default; deletions, renames, or semantic changes
 * require a major version bump and migration.
 *
 * @module @deepseek-ai/dsh-schema-registry
 */

import type {
  SchemaDefinition,
  SchemaVersion,
  CompatibilityResult,
  NegotiationResult,
} from './types.ts'
import { compareVersions, formatVersion, getMigration } from './migrate.ts'

export type {
  CompatibilityRule,
  SchemaVersion,
  SchemaDefinition,
  CompatibilityResult,
  NegotiationResult,
  SchemaCompatibilityError,
  MigrationFunction,
  MigrationEntry,
} from './types.ts'

export {
  compareVersions,
  formatVersion,
  gte,
  lte,
  registerMigration,
  getMigration,
  listMigrations,
  migrate,
  clearMigrations,
  getMigratableSchemaIds,
} from './migrate.ts'

export { SchemaCompatibilityError } from './types.ts'

// ---------------------------------------------------------------------------
// Schema Registry
// ---------------------------------------------------------------------------

/** Registry of all known schema definitions. Key: schemaId */
const schemaRegistry = new Map<string, SchemaDefinition[]>()

/** Register a schema definition. */
export function registerSchema(def: SchemaDefinition): void {
  const versions = schemaRegistry.get(def.schemaId) ?? []
  const exists = versions.some(v =>
    v.version.major === def.version.major && v.version.minor === def.version.minor,
  )
  if (exists) {
    throw new Error(`Schema '${def.schemaId}' version ${formatVersion(def.version)} already registered`)
  }
  versions.push(def)
  versions.sort((a, b) => compareVersions(a.version, b.version))
  schemaRegistry.set(def.schemaId, versions)
}

/** Get the latest version of a schema. */
export function getLatestVersion(schemaId: string): SchemaVersion | undefined {
  const versions = schemaRegistry.get(schemaId)
  if (!versions || versions.length === 0) return undefined
  return versions[versions.length - 1].version
}

/** Get a specific schema version. */
export function getSchema(schemaId: string, version: SchemaVersion): SchemaDefinition | undefined {
  const versions = schemaRegistry.get(schemaId)
  if (!versions) return undefined
  return versions.find(v =>
    v.version.major === version.major && v.version.minor === version.minor,
  )
}

/** List all registered schema IDs. */
export function listSchemas(): string[] {
  return Array.from(schemaRegistry.keys())
}

/** List all versions of a schema. */
export function listSchemaVersions(schemaId: string): SchemaVersion[] {
  const versions = schemaRegistry.get(schemaId)
  if (!versions) return []
  return versions.map(v => v.version)
}

/**
 * Check compatibility between two versions of a schema.
 *
 * Rules:
 * - Same major version: backward compatible (new optional fields OK)
 * - Different major version: requires migration; not directly compatible
 */
export function checkCompatibility(
  schemaId: string,
  from: SchemaVersion,
  to: SchemaVersion,
): CompatibilityResult {
  const fromDef = getSchema(schemaId, from)
  const toDef = getSchema(schemaId, to)
  if (!fromDef) {
    return { compatible: false, reason: `Schema '${schemaId}' version ${formatVersion(from)} not registered` }
  }
  if (!toDef) {
    return { compatible: false, reason: `Schema '${schemaId}' version ${formatVersion(to)} not registered` }
  }

  if (compareVersions(from, to) === 0) {
    return { compatible: true, reason: 'identical versions' }
  }

  if (from.major === to.major && compareVersions(from, to) < 0) {
    if (toDef.compatibility === 'backward' || toDef.compatibility === 'full') {
      return { compatible: true, reason: `${toDef.compatibility} compatible within major ${to.major}` }
    }
  }

  if (from.major === to.major && compareVersions(from, to) > 0) {
    if (fromDef.compatibility === 'forward' || fromDef.compatibility === 'full') {
      return { compatible: true, reason: `${fromDef.compatibility} compatible within major ${from.major}` }
    }
  }

  if (from.major !== to.major) {
    const breakingChanges: string[] = []
    if (toDef.compatibility === 'none') {
      breakingChanges.push(`Major version change ${from.major} -> ${to.major} is a breaking change`)
    }
    return {
      compatible: false,
      reason: 'Major version mismatch requires migration',
      breakingChanges,
    }
  }

  return { compatible: false, reason: `Unknown incompatibility between ${formatVersion(from)} and ${formatVersion(to)}` }
}

/**
 * Negotiate a schema version between a client and server.
 *
 * @param schemaId - the schema to negotiate
 * @param clientVersion - the version the client supports
 * @param serverVersions - the versions the server supports
 * @returns the agreed version, or a reason for failure
 */
export function negotiateSchema(
  schemaId: string,
  clientVersion: SchemaVersion,
  serverVersions: SchemaVersion[],
): NegotiationResult {
  for (const sv of serverVersions) {
    if (compareVersions(clientVersion, sv) === 0) {
      return { agreed: true, agreedVersion: clientVersion, reason: 'exact match' }
    }
  }

  for (const sv of serverVersions) {
    const result = checkCompatibility(schemaId, clientVersion, sv)
    if (result.compatible) {
      return { agreed: true, agreedVersion: sv, reason: result.reason }
    }
  }

  for (const sv of serverVersions) {
    const migration = getMigration(schemaId, clientVersion, sv) ?? getMigration(schemaId, sv, clientVersion)
    if (migration) {
      return { agreed: true, agreedVersion: sv, reason: `migration available from ${formatVersion(clientVersion)} to ${formatVersion(sv)}` }
    }
  }

  return { agreed: false, reason: `no compatible or migratable version found for '${schemaId}'` }
}

/** Clear all registered schemas. For testing. */
export function clearSchemas(): void {
  schemaRegistry.clear()
}

/**
 * Register the built-in schemas for the Harness.
 * Called at boot to establish the baseline schema set.
 */
export function registerBuiltinSchemas(): void {
  registerSchema({
    schemaId: 'session-event',
    version: { major: 0, minor: 1 },
    compatibility: 'backward',
    description: 'Session log event envelope',
  })

  registerSchema({
    schemaId: 'sdk-protocol',
    version: { major: 0, minor: 1 },
    compatibility: 'backward',
    description: 'SDK JSON-RPC protocol types',
  })

  registerSchema({
    schemaId: 'plugin-manifest',
    version: { major: 0, minor: 1 },
    compatibility: 'backward',
    description: 'Plugin manifest v2',
  })

  registerSchema({
    schemaId: 'settings',
    version: { major: 0, minor: 1 },
    compatibility: 'full',
    description: 'User settings types',
  })
}
