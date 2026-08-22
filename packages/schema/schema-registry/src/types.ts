/**
  * Type definitions for the Schema Registry.
  *
  * Each persistent or wire-protocol object declares a schemaId, major/minor
  * version, compatibility rule, and optional migration function. New fields
  * are backward-compatible by default; deletions, renames, or semantic changes
  * require a major version bump and migration.
  *
  * @module @deepseek-ai/dsh-schema-registry/types
  */

/** Compatibility strategy for schema evolution. */
export type CompatibilityRule =
   | 'backward' // New optional fields are OK; removed fields need major bump
   | 'forward'  // Old client can read new data (extra fields ignored)
   | 'full'     // Both backward and forward compatible
   | 'none'     // Breaking change; requires major version and migration

/** A semantic version for a schema. */
export interface SchemaVersion {
  readonly major: number
  readonly minor: number
}

/** A registered schema definition. */
export interface SchemaDefinition {
  /** Unique schema identifier (e.g. 'session-event', 'sdk-protocol'). */
  readonly schemaId: string
  /** Semantic version of this schema. */
  readonly version: SchemaVersion
  /** Compatibility strategy for this schema. */
  readonly compatibility: CompatibilityRule
  /** Human-readable description. */
  readonly description: string
}

/** Result of a schema compatibility check. */
export interface CompatibilityResult {
  readonly compatible: boolean
  readonly reason: string
  /** The breaking changes detected, if any. */
  readonly breakingChanges?: string[]
}

/** Result of a schema negotiation. */
export interface NegotiationResult {
  readonly agreed: boolean
  readonly agreedVersion?: SchemaVersion
  readonly reason: string
}

/** Error thrown when an incompatible schema is detected. */
export class SchemaCompatibilityError extends Error {
  readonly schemaId: string
  readonly expectedVersion: SchemaVersion
  readonly actualVersion: SchemaVersion

  constructor(
    schemaId: string,
    expectedVersion: SchemaVersion,
    actualVersion: SchemaVersion,
    reason: string,
  ) {
    super(`Schema incompatibility for '${schemaId}': expected v${expectedVersion.major}.${expectedVersion.minor}, got v${actualVersion.major}.${actualVersion.minor}: ${reason}`)
    this.name = 'SchemaCompatibilityError'
    this.schemaId = schemaId
    this.expectedVersion = expectedVersion
    this.actualVersion = actualVersion
  }
}

/** A migration function from one schema version to another. */
export type MigrationFunction<TBefore = unknown, TAfter = unknown> = (data: TBefore) => TAfter

/** A registered migration between two schema versions. */
export interface MigrationEntry {
  readonly schemaId: string
  readonly from: SchemaVersion
  readonly to: SchemaVersion
  readonly migrate: MigrationFunction
  /** Whether this migration is reversible. */
  readonly reversible: boolean
  /** If reversible, the reverse migration function. */
  readonly reverse?: MigrationFunction
}
