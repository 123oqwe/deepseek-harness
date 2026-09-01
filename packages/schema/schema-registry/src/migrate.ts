/**
 * Illustrative, synthetic migration functions demonstrating the schema
 * registry's non-identity migration mechanism end-to-end.
 *
 * Neither example below corresponds to a real historical change in this
 * repository: no field in `KNOWN_SESSION_EVENT_TYPES` or the SDK-protocol
 * wire types has ever been renamed, merged, or removed since
 * `@deepseek-ai/dsh-sdk-protocol`'s inception. Both examples exist only to
 * exercise `evolveSchema`'s breaking-change path with a real, non-identity
 * `SchemaMigration` and to prove this P-stage's acceptance clause: every
 * registry migration carries a bidirectional test or an explicit
 * irreversibility test. See `tests/migration.spec.ts`.
 *
 * @module @deepseek-ai/dsh-schema-registry/migrate
 */

import type { SchemaMigration } from './types.ts'

/**
 * ILLUSTRATIVE EXAMPLE, not a real historical schema. A hypothetical future
 * breaking change on a synthetic "AgentTimestamp" leaf object's version 1.0:
 * the timestamp is carried under `firedAt`.
 */
export interface LegacyAgentTimestampV1 {
  readonly firedAt: string
  readonly [key: string]: unknown
}

/**
 * ILLUSTRATIVE EXAMPLE, not a real historical schema. The synthetic
 * "AgentTimestamp" leaf object's version 2.0: `firedAt` renamed to
 * `occurredAt`, carrying the same value.
 */
export interface AgentTimestampV2 {
  readonly occurredAt: string
  readonly [key: string]: unknown
}

/**
 * Forward half of the illustrative rename migration: `firedAt` renamed to
 * `occurredAt`, carrying the same value losslessly. Registered as the
 * `migrate` function for the synthetic schema's 1.0 -> 2.0 breaking
 * evolution.
 * @param payload - a payload written at the synthetic schema's version 1.0.
 * @returns the payload with `firedAt` renamed to `occurredAt`.
 */
export const renameFiredAtToOccurredAt: SchemaMigration = (payload) => {
  const { firedAt, ...rest } = payload as LegacyAgentTimestampV1
  return { ...rest, occurredAt: firedAt }
}

/**
 * Backward half of the illustrative rename migration, demonstrating full
 * reversibility: `occurredAt` renamed back to `firedAt`. Not part of the
 * registry's migration slot (`SchemaMigration` transforms only forward) --
 * provided here only to prove, in `tests/migration.spec.ts`, that this
 * specific migration loses no information in either direction.
 * @param payload - a payload written at the synthetic schema's version 2.0.
 * @returns the payload with `occurredAt` renamed back to `firedAt`.
 */
export const renameOccurredAtToFiredAt = (payload: AgentTimestampV2): LegacyAgentTimestampV1 => {
  const { occurredAt, ...rest } = payload
  return { ...rest, firedAt: occurredAt }
}

/**
 * ILLUSTRATIVE EXAMPLE, not a real historical schema. A hypothetical future
 * breaking change on a synthetic "ContactName" leaf object's version 1.0:
 * given and family name are carried under separate `firstName`/`lastName`
 * fields.
 */
export interface LegacyContactNameV1 {
  readonly firstName: string
  readonly lastName: string
  readonly [key: string]: unknown
}

/**
 * ILLUSTRATIVE EXAMPLE, not a real historical schema. The synthetic
 * "ContactName" leaf object's version 2.0: `firstName`/`lastName` merged
 * into a single `fullName` field.
 */
export interface ContactNameV2 {
  readonly fullName: string
  readonly [key: string]: unknown
}

/**
 * Forward half of the illustrative merge migration: combines `firstName`
 * and `lastName` into one space-separated `fullName` field. Registered as
 * the `migrate` function for the synthetic schema's 1.0 -> 2.0 breaking
 * evolution. Deliberately irreversible: no reverse migration is provided or
 * possible for the general case, because a merged, space-separated string
 * cannot in general be split back into the original two fields -- see
 * `tests/migration.spec.ts` for a concrete ambiguous case this loses
 * information on.
 * @param payload - a payload written at the synthetic schema's version 1.0.
 * @returns the payload with `firstName`/`lastName` merged into `fullName`.
 */
export const mergeNameFields: SchemaMigration = (payload) => {
  const { firstName, lastName, ...rest } = payload as LegacyContactNameV1
  return { ...rest, fullName: `${firstName} ${lastName}` }
}
