/**
 * The schema-registry census P0-06 acceptance[2] is judged by: every
 * registered migration is either the declared identity or carries a declared
 * reverse or irreversibility case that holds against the migration the
 * registry holds.
 *
 * An entry is the declared identity when its `migrate` IS the registry's own
 * `identityMigration` constant and its history holds one version. An evolved
 * entry is therefore never the declared identity, whatever its migration: a
 * schema that moved to a new version declares its migration in
 * {@link DECLARED_MIGRATIONS} or it is an offender. A declaration is checked,
 * not trusted: a reverse must undo the registered migration on every witness,
 * and an irreversibility case must name two different payloads the registered
 * migration maps to equal results. The identity constant and the registered
 * migration are passed in by the caller, because a census taken in a fresh
 * module instance must compare against that instance's own.
 */

import { isDeepStrictEqual } from 'node:util'
import type { RegisteredSchema, SchemaMigration } from '@deepseek-ai/dsh-schema-registry'

/** How a non-identity migration is declared: with its reverse and the payloads it round-trips, or as irreversible with two payloads it cannot tell apart afterwards. */
export interface DeclaredMigration {
  readonly reverse?: { readonly migrate: SchemaMigration; readonly witnesses: readonly unknown[] }
  readonly irreversible?: { readonly reason: string; readonly lossWitness: readonly [unknown, unknown] }
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

/**
 * Whether a declaration holds against the migration the registry holds.
 * @param migrate - the registered migration.
 * @param declaration - the declaration.
 * @returns true when the declared reverse undoes `migrate` on every one of at
 * least one witness, or the two loss witnesses differ and `migrate` maps them
 * to deep-equal results.
 */
export function declarationHolds(migrate: SchemaMigration, declaration: DeclaredMigration): boolean {
  const reverse = declaration.reverse
  if (reverse !== undefined && reverse.witnesses.length > 0
    && reverse.witnesses.every(witness => isDeepStrictEqual(reverse.migrate(migrate(witness)), witness))) return true
  const irreversible = declaration.irreversible
  if (irreversible === undefined) return false
  const [first, second] = irreversible.lossWitness
  return !isDeepStrictEqual(first, second) && isDeepStrictEqual(migrate(first), migrate(second))
}

/** One registration as a census records it. */
export interface CensusRecord {
  readonly schemaId: string
  readonly declaredIdentity: boolean
  /** Present only for a declared schema: whether its declaration holds against the registered migration. */
  readonly declarationHolds?: boolean
}

/**
 * The recorded registrations that are neither the declared identity nor declared with a declaration that holds.
 * @param records - the census records to judge.
 * @param declared - the declared non-identity migrations, by schema id.
 * @returns the offending schema ids, sorted.
 */
export function offendingIds(
  records: readonly CensusRecord[],
  declared: Readonly<Record<string, DeclaredMigration>> = DECLARED_MIGRATIONS,
): string[] {
  return records
    .filter(record => !record.declaredIdentity && !(declared[record.schemaId] !== undefined && record.declarationHolds === true))
    .map(record => record.schemaId)
    .sort()
}

/**
 * The census record of one registration.
 * @param entry - the registration.
 * @param identity - the registry instance's own `identityMigration`.
 * @param declared - the declared non-identity migrations, by schema id.
 * @returns its record.
 */
export function censusRecord(
  entry: RegisteredSchema,
  identity: SchemaMigration,
  declared: Readonly<Record<string, DeclaredMigration>> = DECLARED_MIGRATIONS,
): CensusRecord {
  const schemaId = String(entry.schemaId)
  const declaration = declared[schemaId]
  return {
    schemaId,
    declaredIdentity: isDeclaredIdentity(entry, identity),
    ...declaration === undefined ? {} : { declarationHolds: declarationHolds(entry.migrate, declaration) },
  }
}

/**
 * The registrations that are neither the declared identity nor declared with a declaration that holds.
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
  return offendingIds(entries.map(entry => censusRecord(entry, identity, declared)), declared)
}
