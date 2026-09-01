/**
 * RED-stage stub: type-correct exports with no real registration or
 * negotiation behavior yet. Real logic lands in the GREEN commit.
 * @module @deepseek-ai/dsh-schema-registry
 */

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

/** RED stub: not a real migration, just an identity placeholder to satisfy the type. */
export const identityMigration: SchemaMigration = payload => payload

/** RED stub: does not actually register anything. */
export function registerSchema(_schemaId: SchemaId, _version: SchemaVersion, _migrate: SchemaMigration): void {
  // TODO(GREEN): implement real registration + duplicate/version validation.
}

/** RED stub: does not actually evolve anything. */
export function evolveSchema(
  _schemaId: SchemaId,
  _changes: readonly FieldChange[],
  _nextVersion: SchemaVersion,
  _migrate: SchemaMigration,
): void {
  // TODO(GREEN): implement real must[2]/must[3] bump validation.
}

/** RED stub: always reports compatible, never negotiates for real. */
export function negotiateSchema(schemaId: SchemaId, encounteredVersion: SchemaVersion): SchemaNegotiationResult {
  return { compatible: true, registeredVersion: encounteredVersion }
}

/** RED stub: nothing is ever actually registered. */
export function getSchema(_schemaId: SchemaId): RegisteredSchema | undefined {
  return undefined
}

/** RED stub: nothing is ever actually registered. */
export function listSchemas(): readonly RegisteredSchema[] {
  return []
}

// RED stub: intentionally no bootstrap registration of session-event or
// SDK-protocol schemas — that logic lands in the GREEN commit.
