/**
 * Runtime schema registry: registration, version-bump validation against
 * declared field changes, and read-time compatibility negotiation for
 * persisted and wire-protocol leaf objects. See `./types.ts` for the full
 * scope-split rationale against `SESSION_FORMAT_VERSION`.
 *
 * This module also bootstraps the registry with every leaf object this
 * repository currently declares: every session-event payload type in
 * `KNOWN_SESSION_EVENT_TYPES` (`@deepseek-ai/dsh-session`) and every named
 * wire type documented in `@deepseek-ai/dsh-sdk-protocol`'s `src/types.ts`
 * (mirrored here by schemaId string — protocol's own package exports carry
 * no runtime value for this, only the JSDoc declaration, so the mirrored
 * list is this package's registration source of truth and must be kept in
 * sync by hand when a protocol wire type is added or removed). All of them
 * register at their real first version, 1.0, with an identity migration.
 *
 * @module @deepseek-ai/dsh-schema-registry
 */

import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  FieldChange,
  RegisteredSchema,
  SchemaCompatibilityErrorCode,
  SchemaId,
  SchemaMigration,
  SchemaRegistryErrorCode,
  SchemaVersion,
} from './types.ts'

export type {
  FieldChange,
  FieldChangeKind,
  RegisteredSchema,
  SchemaCompatibilityErrorCode,
  SchemaId,
  SchemaMigration,
  SchemaRegistryErrorCode,
  SchemaVersion,
} from './types.ts'

/** Thrown by `registerSchema`/`evolveSchema` when a declared registration or version bump violates the registry's contract. */
export class SchemaRegistryError extends Error {
  readonly code: SchemaRegistryErrorCode
  readonly schemaId: SchemaId

  constructor(code: SchemaRegistryErrorCode, schemaId: SchemaId, message: string) {
    super(message)
    this.name = 'SchemaRegistryError'
    this.code = code
    this.schemaId = schemaId
  }
}

/** Structured, machine-readable reason `negotiateSchema` could not confirm compatibility — never a bare string. */
export class SchemaCompatibilityError extends Error {
  readonly code: SchemaCompatibilityErrorCode
  readonly schemaId: SchemaId
  readonly encounteredVersion: SchemaVersion
  readonly registeredVersion: SchemaVersion | undefined

  constructor(
    code: SchemaCompatibilityErrorCode,
    schemaId: SchemaId,
    encounteredVersion: SchemaVersion,
    registeredVersion: SchemaVersion | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'SchemaCompatibilityError'
    this.code = code
    this.schemaId = schemaId
    this.encounteredVersion = encounteredVersion
    this.registeredVersion = registeredVersion
  }
}

/** Result of negotiating one encountered version against this registry's current registration. */
export type SchemaNegotiationResult =
  | { readonly compatible: true; readonly registeredVersion: SchemaVersion }
  | { readonly compatible: false; readonly error: SchemaCompatibilityError }

const registry = new Map<SchemaId, RegisteredSchema>()

/** An identity migration for a schema's own first version, which has no true predecessor payload. */
export const identityMigration: SchemaMigration = payload => payload

function isValidVersion(version: SchemaVersion): boolean {
  return Number.isInteger(version.major) && version.major >= 1
    && Number.isInteger(version.minor) && version.minor >= 0
}

/**
 * Register a leaf schema's first version. This registry never loses or
 * silently replaces a registration: a second registration under the same
 * `schemaId` is rejected — evolve an existing schema with {@link evolveSchema}.
 * @param schemaId - identity this registration will be resolved by.
 * @param version - the schema's first declared version.
 * @param migrate - the version's migration function (identity for a genuine first version).
 * @throws {@link SchemaRegistryError} `SCHEMA_ALREADY_REGISTERED` for a duplicate id, `SCHEMA_INVALID_VERSION` for a malformed version.
 */
export function registerSchema(schemaId: SchemaId, version: SchemaVersion, migrate: SchemaMigration): void {
  if (registry.has(schemaId)) {
    throw new SchemaRegistryError('SCHEMA_ALREADY_REGISTERED', schemaId, `schema "${schemaId}" is already registered`)
  }
  if (!isValidVersion(version)) {
    throw new SchemaRegistryError(
      'SCHEMA_INVALID_VERSION',
      schemaId,
      `schema "${schemaId}" version must have an integer major >= 1 and an integer minor >= 0, got ${JSON.stringify(version)}`,
    )
  }
  registry.set(schemaId, { schemaId, version, migrate, history: [version] })
}

/**
 * Evolve an already-registered schema to a new version. must[2]/must[3]'s
 * compatibility rule is enforced here: a change set that is entirely
 * `additive` may only bump `minor`; a change set containing any `breaking`
 * change must bump `major` by exactly 1 and reset `minor` to 0. The prior
 * version is retained in `history`, never dropped.
 * @param schemaId - identity of an existing registration.
 * @param changes - every field-level change since the current registered version, at least one.
 * @param nextVersion - the version these changes bump to.
 * @param migrate - transforms a payload from the current version to `nextVersion`.
 * @throws {@link SchemaRegistryError} `SCHEMA_UNKNOWN`, `SCHEMA_INVALID_VERSION`, `SCHEMA_NO_CHANGES`, or `SCHEMA_BUMP_MISMATCH`.
 */
export function evolveSchema(
  schemaId: SchemaId,
  changes: readonly FieldChange[],
  nextVersion: SchemaVersion,
  migrate: SchemaMigration,
): void {
  const current = registry.get(schemaId)
  if (current === undefined) {
    throw new SchemaRegistryError('SCHEMA_UNKNOWN', schemaId, `schema "${schemaId}" has no existing registration to evolve`)
  }
  if (!isValidVersion(nextVersion)) {
    throw new SchemaRegistryError(
      'SCHEMA_INVALID_VERSION',
      schemaId,
      `schema "${schemaId}" version must have an integer major >= 1 and an integer minor >= 0, got ${JSON.stringify(nextVersion)}`,
    )
  }
  if (changes.length === 0) {
    throw new SchemaRegistryError('SCHEMA_NO_CHANGES', schemaId, `schema "${schemaId}" evolution declared no field changes`)
  }
  const hasBreaking = changes.some(change => change.kind === 'breaking')
  const validBump = hasBreaking
    ? nextVersion.major === current.version.major + 1 && nextVersion.minor === 0
    : nextVersion.major === current.version.major && nextVersion.minor > current.version.minor
  if (!validBump) {
    throw new SchemaRegistryError(
      'SCHEMA_BUMP_MISMATCH',
      schemaId,
      hasBreaking
        ? `schema "${schemaId}" declares a breaking change and must bump major from ${current.version.major} to ${current.version.major + 1} with minor reset to 0, got ${JSON.stringify(nextVersion)}`
        : `schema "${schemaId}" declares only additive changes and must keep major at ${current.version.major} with minor greater than ${current.version.minor}, got ${JSON.stringify(nextVersion)}`,
    )
  }
  registry.set(schemaId, {
    schemaId,
    version: nextVersion,
    migrate,
    history: [...current.history, nextVersion],
  })
}

/**
 * Negotiate whether a version encountered while reading a payload (session
 * replay, SDK initialize, plugin load) is compatible with this build's
 * registered schema. Same `major` is always compatible regardless of minor
 * difference (must[2]: additive/`ignorable`-safe changes never break a
 * reader on either side). This function inspects only version identity —
 * it never reads, strips, or otherwise touches a payload's fields, so it
 * cannot itself cause silent field loss; an incompatible result is a
 * structured {@link SchemaCompatibilityError}, never a bare string or a
 * silently accepted read.
 * @param schemaId - identity of the schema to negotiate against.
 * @param encounteredVersion - the version the payload was written at.
 * @returns a compatible result, or a structured incompatibility error.
 */
export function negotiateSchema(schemaId: SchemaId, encounteredVersion: SchemaVersion): SchemaNegotiationResult {
  const entry = registry.get(schemaId)
  if (entry === undefined) {
    return {
      compatible: false,
      error: new SchemaCompatibilityError(
        'SCHEMA_UNKNOWN',
        schemaId,
        encounteredVersion,
        undefined,
        `schema "${schemaId}" is not registered by this build`,
      ),
    }
  }
  if (entry.version.major !== encounteredVersion.major) {
    return {
      compatible: false,
      error: new SchemaCompatibilityError(
        'SCHEMA_MAJOR_MISMATCH',
        schemaId,
        encounteredVersion,
        entry.version,
        `schema "${schemaId}" encountered major ${encounteredVersion.major} is incompatible with this build's registered major ${entry.version.major}`,
      ),
    }
  }
  return { compatible: true, registeredVersion: entry.version }
}

/**
 * Look up one schema's live registration.
 * @param schemaId - identity to resolve.
 * @returns the live registration, or `undefined` when unregistered.
 */
export function getSchema(schemaId: SchemaId): RegisteredSchema | undefined {
  return registry.get(schemaId)
}

/**
 * Enumerate every currently registered schema.
 * @returns every live registration, in registration order.
 */
export function listSchemas(): readonly RegisteredSchema[] {
  return [...registry.values()]
}

function bootstrapSessionEventSchemas(): void {
  for (const type of KNOWN_SESSION_EVENT_TYPES) {
    registerSchema(brandString<SchemaId>(`session-event:${type}`), { major: 1, minor: 0 }, identityMigration)
  }
}

/**
 * schemaId mirror of every named wire type `@deepseek-ai/dsh-sdk-protocol`'s
 * `src/types.ts` documents. The protocol package's own exports carry no
 * runtime value for this (its `exports` map has no reachable subpath for
 * one), so this list is the registration source of truth; keep it in sync
 * by hand with that file's schemaId doc comments.
 */
const PROTOCOL_WIRE_SCHEMA_IDS = [
  'InitializeParams',
  'InitializeResult',
  'SessionPromptParams',
  'SessionPromptResult',
  'SessionEventNotification',
  'SessionStatusNotification',
  'SubagentStartedNotification',
  'SubagentFinishedNotification',
] as const

function bootstrapProtocolSchemas(): void {
  for (const name of PROTOCOL_WIRE_SCHEMA_IDS) {
    registerSchema(brandString<SchemaId>(`sdk-protocol:${name}`), { major: 1, minor: 0 }, identityMigration)
  }
}

bootstrapSessionEventSchemas()
bootstrapProtocolSchemas()
