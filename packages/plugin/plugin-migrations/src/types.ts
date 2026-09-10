/**
 * The manifest vocabulary Epic P1-10's must[0] names: a plugin's migration
 * DAG, each migration's preconditions, its backup strategy and whether it can
 * be rolled back.
 *
 * Types only. The decisions over them are `./index.ts`, and performing any of
 * them is the Provider stage's — a manifest describes what an upgrade WOULD
 * do, and a description that could act would be a second place the upgrade
 * happens.
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * One plugin schema version, as the plugin's own manifest declares it.
 *
 * Branded because it crosses from a manifest file into decisions here and into
 * storage at the Provider stage, and a bare string would let a package version
 * be passed where a schema version belongs — the two move independently, which
 * is why a migration DAG exists at all.
 */
export type PluginSchemaVersion = Branded<'PluginSchemaVersion'>

/** Digest of a plugin's durable data at one instant, for reconciliation (acceptance[1]). */
export type PluginDataDigest = Branded<'PluginDataDigest'>

/**
 * What must already be true before one migration may run.
 *
 * Declared rather than probed: a precondition the migration checked for itself
 * could only be checked once it had started, and must[1]'s ordering exists so
 * that an upgrade decides everything it can before it touches anything.
 */
export interface MigrationPrecondition {
  /** Stable identifier an operator sees when the precondition refuses. */
  readonly id: string
  /** What must hold, in terms an operator can act on. */
  readonly requirement: string
}

/**
 * How a migration's starting state is preserved so a rollback has something to
 * return to (must[0]).
 *
 * `none` is a declaration, not an omission: a migration that needs no backup
 * says so, and the difference between that and a manifest that forgot the
 * field is what {@link isReversible} reads.
 */
export type BackupStrategy =
  /** The plugin's durable data is copied before the migration runs. */
  | { readonly kind: 'snapshot' }
  /** The migration only adds, so the previous state is still present afterwards. */
  | { readonly kind: 'additive' }
  /** Nothing is preserved; the migration cannot be undone from data alone. */
  | { readonly kind: 'none' }

/**
 * One edge of the migration DAG: the conversion from one schema version to the
 * next.
 *
 * An edge is directed and names both ends, so a manifest cannot declare a
 * migration whose starting version is inferred from wherever it happens to be
 * applied.
 */
export interface PluginMigration {
  /** The version this migration converts FROM. */
  readonly from: PluginSchemaVersion
  /** The version it converts TO. */
  readonly to: PluginSchemaVersion
  /** What must hold before it may run. */
  readonly preconditions?: readonly MigrationPrecondition[]
  /** How the starting state is preserved. */
  readonly backup: BackupStrategy
  /**
   * Whether this migration can be undone.
   *
   * Declared by the plugin author rather than derived from `backup`, because
   * the two answer different questions: a snapshot makes the DATA restorable,
   * while reversibility is about whether the migration's effects are confined
   * to that data. A migration that also rewrote an external system is
   * irreversible however good its snapshot is, and must[2]'s approval exists
   * for exactly that case.
   */
  readonly reversible: boolean
}

/** The migration section of one plugin's manifest (must[0]). */
export interface PluginMigrationManifest {
  /** The plugin these migrations belong to. */
  readonly plugin: string
  /** The schema version this build of the plugin expects. */
  readonly current: PluginSchemaVersion
  /** Every declared conversion, in no particular order. */
  readonly migrations: readonly PluginMigration[]
}

/**
 * A plugin's own durable data, config and schema at one instant.
 *
 * Named for what it covers and what it does not: workspace files are P3-11's
 * checkpointing, not this. The manifest's {@link BackupStrategy} is where that
 * line would otherwise blur, so a workspace path is a refused input rather
 * than an unsupported one.
 */
export interface PluginDataSnapshot {
  /** The plugin whose data this is. */
  readonly plugin: string
  /** The schema version the data was at when the snapshot was taken. */
  readonly version: PluginSchemaVersion
  /** Digest of the data at that instant (acceptance[1]). */
  readonly digest: PluginDataDigest
  /** Where the copy lives, under the plugin's own storage root. */
  readonly path: string
}

/** Why a manifest, path or snapshot was refused. */
export type MigrationRefusal =
  /** The declared migrations contain a cycle, so no order can run them. */
  | { readonly kind: 'cyclic'; readonly versions: readonly PluginSchemaVersion[] }
  /** Two migrations declare the same `from`, so the next step is ambiguous. */
  | { readonly kind: 'ambiguous-edge'; readonly from: PluginSchemaVersion }
  /** No declared chain reaches the requested version. */
  | { readonly kind: 'unreachable'; readonly from: PluginSchemaVersion; readonly to: PluginSchemaVersion }
  /** A migration on the path declares a precondition, which only a caller can check. */
  | { readonly kind: 'preconditions-undecided'; readonly preconditions: readonly MigrationPrecondition[] }
  /** The snapshot belongs to another plugin or another version. */
  | { readonly kind: 'snapshot-mismatch'; readonly expected: string; readonly actual: string }
  /** The path is not under the plugin's own storage root (P3-11's boundary). */
  | { readonly kind: 'outside-plugin-storage'; readonly path: string }

/** An admitted upgrade path, or the reason it was refused. */
export type UpgradePlan =
  | { readonly admitted: true; readonly steps: readonly PluginMigration[]; readonly reversible: boolean }
  | { readonly admitted: false; readonly refusal: MigrationRefusal }
