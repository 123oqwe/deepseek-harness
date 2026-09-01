/**
 * Type contract for the schema registry: identity, major/minor versioning,
 * change-classification, and migration-function shape for persisted and
 * wire-protocol LEAF objects (session-event payload shapes, SDK protocol
 * wire types, and future leaf objects such as settings shapes).
 *
 * Scope split (BLOCKED-008, ANSWERED-BY-DELEGATE(gq-92)): this registry
 * versions only individual leaf objects. It never versions, references,
 * wraps, or proxies the session log's own container format (header shape,
 * event envelope, core event semantics) — that stays governed by
 * `SESSION_FORMAT_VERSION` in `@deepseek-ai/dsh-session`, unweakened and
 * untouched by this package. The two mechanisms are orthogonal: the
 * container is a single sequential artifact where "will this turn out
 * major" is unknowable in advance (monotonic-integer-plus-upgrader is
 * correct there); a leaf object has multiple independent consumption
 * boundaries (SDK, remote, persisted data) that need a machine-decidable
 * "can this be safely read" signal for negotiation — major/minor serves
 * that cross-boundary compatibility question, not migration sequencing.
 *
 * `minor` bumps conceptually align with the session log's existing per-event
 * `ignorable` envelope marker (`SessionEvent.ignorable` in
 * `@deepseek-ai/dsh-session/types`): an additive, minor-bump change is
 * exactly the kind of change a reader may safely not recognize, the same
 * default `ignorable` already encodes for session events. This registry
 * does not import or call `ignorable` -- a leaf object's version identity
 * and a session event's envelope marker are different mechanisms serving
 * the same default-compatibility philosophy -- and it does not build a
 * second, competing default-compatibility philosophy alongside it.
 *
 * @module @deepseek-ai/dsh-schema-registry/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one registered leaf schema, e.g. `"session-event:tool/call"` or `"sdk-protocol:InitializeParams"`. */
export type SchemaId = Branded<'SchemaId'>

/** One registered schema's version. */
export interface SchemaVersion {
  /** Bumped only by a deletion, rename, or semantic change — a change a reader that does not know it would misinterpret. */
  readonly major: number
  /** Bumped by an additive, `ignorable`-safe change — must[2]: new fields are backward-compatible by default. */
  readonly minor: number
}

/** Compatibility classification of one field-level change against a schema's previous version. */
export type FieldChangeKind =
  /** A field was added; a reader that does not recognize it can safely ignore it (the `SessionEvent.ignorable` mechanism). */
  | 'additive'
  /** A field was removed, renamed, or its meaning changed; a reader that does not know the change would misinterpret data. */
  | 'breaking'

/**
 * One field-level change declared against a schema's immediately preceding
 * version, driving whether its version bump must be major or minor.
 */
export interface FieldChange {
  /** Changed field path (dot-separated for a nested field). */
  readonly field: string
  readonly kind: FieldChangeKind
  /** Why this change is classified this way — required so a major bump is never silent. */
  readonly reason: string
}

/**
 * Transform one payload written at the schema's immediately preceding
 * registered version forward to its current version. A schema's very first
 * registered version has no true predecessor payload, so this is the
 * identity function; a later version's real transformation body is a
 * P-stage concern (`migrate.ts`) — this registry only fixes the function's
 * shape and where it plugs into a registration.
 * @param payload - a payload written at the preceding version.
 * @returns the payload transformed to the current version's shape.
 */
export type SchemaMigration = (payload: unknown) => unknown

/** One schema's live registration state. */
export interface RegisteredSchema {
  readonly schemaId: SchemaId
  /** The schema's current (latest registered) version. */
  readonly version: SchemaVersion
  /** Upgrades a payload from the immediately preceding version to {@link version}. */
  readonly migrate: SchemaMigration
  /**
   * Every version this schema has carried, oldest first, ending at
   * {@link version} — append-only; a version already registered is never
   * removed or replaced in place.
   */
  readonly history: readonly SchemaVersion[]
}

/** Machine-readable reason a schema negotiation could not confirm compatibility. */
export type SchemaCompatibilityErrorCode =
  /** No schema is registered under the given id. */
  | 'SCHEMA_UNKNOWN'
  /** The encountered version's major differs from the registered major — a breaking difference. */
  | 'SCHEMA_MAJOR_MISMATCH'

/** Machine-readable reason a registration or version evolution was rejected. */
export type SchemaRegistryErrorCode =
  /** `registerSchema` named a `schemaId` that already has a registration. */
  | 'SCHEMA_ALREADY_REGISTERED'
  /** `evolveSchema` named a `schemaId` with no existing registration. */
  | 'SCHEMA_UNKNOWN'
  /** A declared version's `major`/`minor` is not a valid non-negative integer, or `major` is not at least 1. */
  | 'SCHEMA_INVALID_VERSION'
  /** `evolveSchema` declared no changes. */
  | 'SCHEMA_NO_CHANGES'
  /**
   * The declared version bump does not match must[2]/must[3]: an
   * additive-only change set must bump only `minor`; a change set containing
   * a breaking change must bump `major` by exactly 1 and reset `minor` to 0.
   */
  | 'SCHEMA_BUMP_MISMATCH'
