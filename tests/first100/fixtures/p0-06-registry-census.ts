/**
 * The schema-registry census P0-06 acceptance[2] is judged by: every
 * registered migration is either the declared identity or carries a declared
 * reverse or irreversibility case.
 *
 * An entry is the declared identity when its `migrate` IS the registry's own
 * `identityMigration` constant and its history holds one version. An evolved
 * entry is therefore never the declared identity, whatever its migration: a
 * schema that moved to a new version declares its migration in
 * {@link DECLARED_MIGRATIONS} or it is an offender. The identity constant is
 * passed in by the caller, because a census taken in a fresh module instance
 * must compare against that instance's constant.
 */

import type { RegisteredSchema, SchemaMigration } from '@deepseek-ai/dsh-schema-registry'

/** How a non-identity migration is declared: with its reverse, or as irreversible with a witness of what it loses. */
export interface DeclaredMigration {
  readonly reverse?: SchemaMigration
  readonly irreversible?: { readonly reason: string, readonly lossWitness: unknown }
}

/** The non-identity migrations the shipped product declares, by schema id. None today. */
export const DECLARED_MIGRATIONS: Readonly<Record<string, DeclaredMigration>> = {}

/**
 * Whether one registration is the declared identity.
 * @param entry - the registration.
 * @param identity - the registry instance's own `identityMigration`.
 * @returns true when its migration is that constant and it was never evolved.
 */
export function isDeclaredIdentity(entry: RegisteredSchema, identity: SchemaMigration): boolean {
  return entry.migrate === identity && entry.history.length === 1
}

/** One registration as a census records it. */
export interface CensusRecord {
  readonly schemaId: string
  readonly declaredIdentity: boolean
}

/**
 * The recorded registrations that are neither the declared identity nor declared in `declared`.
 * @param records - the census records to judge.
 * @param declared - the declared non-identity migrations, by schema id.
 * @returns the offending schema ids, sorted.
 */
export function offendingIds(
  records: readonly CensusRecord[],
  declared: Readonly<Record<string, DeclaredMigration>> = DECLARED_MIGRATIONS,
): string[] {
  return records
    .filter((record) => {
      if (record.declaredIdentity) return false
      const declaration = declared[record.schemaId]
      return declaration?.reverse === undefined && declaration?.irreversible === undefined
    })
    .map(record => record.schemaId)
    .sort()
}

/**
 * The registrations whose migration is neither the declared identity nor declared in `declared`.
 * @param entries - the registrations to judge.
 * @param identity - the registry instance's own `identityMigration`.
 * @param declared - the declared non-identity migrations, by schema id.
 * @returns the offending schema ids, sorted.
 */
export function offenders(
  entries: readonly RegisteredSchema[],
  identity: SchemaMigration,
  declared: Readonly<Record<string, DeclaredMigration>> = DECLARED_MIGRATIONS,
): string[] {
  return offendingIds(entries.map(entry => ({ schemaId: String(entry.schemaId), declaredIdentity: isDeclaredIdentity(entry, identity) })), declared)
}
