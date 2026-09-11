/**
 * Backend-facing vocabulary of the storage hub: a backend owns one medium
 * (a file-tree root, a database file) and exposes operation groups over it.
 * This module defines the normative contract text for backend implementers; the shared
 * conformance suite in `tests/contract.ts` checks every rule.
 * @module @deepseek-ai/dsh-storage/src/backend
 */

/** Allowed format for unit and table names: safe as a file name and as a SQL identifier segment without escaping. */
export const UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/

/**
 * One registered backend. A backend owns exactly one medium and shares its
 * lifecycle across all facets; facets are optional members — a backend that
 * cannot serve a data kind simply omits it, and resolution fails loud instead.
 */
export interface StorageBackend {
  /** Key-value operations; absent when this backend cannot serve them. */
  readonly kv?: KvFacet

  /**
   * Unit migration; absent when this medium cannot snapshot and swap a unit
   * (first100 registry P1-10 must[1]).
   *
   * Optional like every facet, and its absence is answered at PLAN time rather
   * than at compile time: a deployment whose backend cannot migrate is told so
   * by name before anything is installed, which a missing method would express
   * as a type error nobody sees at runtime.
   */
  readonly migration?: MigrationFacet

  /**
   * Drain in-flight writes across all open units and release the medium.
   * Idempotent; concurrent and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void>
}

/** The key-value data shape: whole-unit snapshots plus per-record durable writes. */
export interface KvFacet {
  /**
   * Open one unit, creating it when the medium holds no trace of it yet
   * (materialization may defer to the first write, but {@link KvUnit.loadAll}
   * must immediately serve the empty shape). A version already stamped on the
   * medium that differs from `descriptor.version` rejects with
   * `version-mismatch`; a medium that cannot be parsed as this unit rejects
   * with `malformed-medium`. Opening the same unit name twice without closing
   * is a caller bug and rejects.
   * @param descriptor - Static identity and shape of the unit to open.
   * @returns the opened unit.
   */
  open(descriptor: KvUnitDescriptor): Promise<KvUnit>
}

/**
 * One unit's snapshot, held between the phases of an upgrade.
 *
 * Opaque to the transaction: what it names is the backend's business — a file,
 * a directory, a second database — and a transaction that could read it would
 * be knowing a medium's layout.
 */
export interface UnitSnapshot {
  /** The unit this snapshot was taken of. */
  readonly unit: string
  /** Backend-private handle; meaningful only to the backend that made it. */
  readonly handle: string
}

/**
 * One unit's whole content, in the same shape {@link KvUnit.loadAll} returns.
 *
 * A migration converts THIS, so what it sees is exactly what the plugin sees
 * when it reads its own unit, not a per-medium encoding. An earlier version of
 * this facet passed an opaque record array matching no backend's real
 * document, so a migration would have rewritten a shape nothing reads.
 */
export interface UnitContent {
  /** The global singleton slot; `null` when never written or not declared. */
  readonly global: unknown
  /** Every table's records, keyed by table name then record key. */
  readonly tables: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

/**
 * Snapshot, migrate and swap one unit, in whatever the medium's own terms are
 * (P1-10 must[1]).
 *
 * The transaction orders these; it never names a path. `storage-json` copies a
 * file or a directory tree and renames; `storage-sqlite` ATTACHes a sidecar
 * database holding one unit's rows and replaces rows in a transaction, because
 * a unit there is rows inside a SHARED database and a file-level copy would
 * make a rollback of one unit a rollback of all of them. Both are the same four
 * operations over different media, which is what makes the six-phase ordering
 * medium-independent.
 */
export interface MigrationFacet {
  /**
   * The version currently stamped on a unit's medium.
   *
   * An upgrade needs the version the DATA is at, which is not the version the
   * new build wants and not the package version either — the three move
   * independently. Only the medium knows it, which is why this is a facet
   * operation rather than something a consumer derives.
   *
   * A unit whose first write has not landed has no stamp, and `undefined` says
   * so: there is nothing to migrate, which a caller must tell apart from a unit
   * stamped at version 0.
   * @param descriptor - the unit to read.
   * @returns the stamped version, or undefined when the medium does not exist yet.
   */
  stampedVersion(descriptor: KvUnitDescriptor): Promise<number | undefined>
  /**
   * Digest of what a snapshot or migrated copy HOLDS.
   *
   * Computed by the medium over the records themselves, so the value survives
   * a re-encoding that changes bytes without changing data, and so a
   * reconciliation compares data against data. A digest derived from a version
   * number would compare a number with itself.
   * @param snapshot - the snapshot, migrated copy, or replaced state to digest.
   * @returns the digest, prefixed with its algorithm.
   */
  digestUnit(snapshot: UnitSnapshot): Promise<string>
  /**
   * The version stamp and records a snapshot or migrated copy holds.
   *
   * Exists so a caller can VALIDATE a migrated copy before it is switched in —
   * that it materialized, that it carries the version it was migrated to, and
   * that its records load — without knowing the medium. `version` is undefined
   * when the copy carries no stamp, which is itself a validation failure for a
   * migrated copy.
   * @param snapshot - the snapshot or migrated copy to read.
   * @returns its stamped version and records.
   */
  readSnapshot(snapshot: UnitSnapshot): Promise<{
    readonly version: number | undefined
    readonly content: UnitContent
  }>
  /**
   * Write a unit's current state OUT of the medium, to a path the operator
   * keeps.
   *
   * Distinct from `snapshotUnit`, whose handle is backend-private and lives
   * and dies with the transaction. An operator confirming an irreversible
   * conversion is confirming that they can still get their data out, so the
   * export must be a file that outlives the upgrade.
   * @param descriptor - the unit to export.
   * @param destination - absolute path to write.
   */
  exportUnit(descriptor: KvUnitDescriptor, destination: string): Promise<void>
  /**
   * Copy a unit's current state aside, consistently.
   *
   * Consistency here is the backend's to provide: a copy taken while writers
   * are active must not tear. Callers additionally hold a cross-process lease
   * over the upgrade, because a backend cannot exclude a writer in another
   * process.
   * @param descriptor - the unit to snapshot.
   * @returns the snapshot handle.
   */
  snapshotUnit(descriptor: KvUnitDescriptor): Promise<UnitSnapshot>
  /**
   * Produce the migrated form of a snapshot, at the new version, without
   * touching the live unit.
   * @param snapshot - the snapshot to migrate from.
   * @param version - the version the migrated copy is stamped with.
   * @param migrate - converts the content; the backend supplies and stores it.
   * @returns a handle to the migrated copy.
   */
  materializeMigrated(
    snapshot: UnitSnapshot,
    version: number,
    migrate: (content: UnitContent) => Promise<UnitContent>,
  ): Promise<UnitSnapshot>
  /**
   * Put a migrated copy in place of the live unit, keeping the previous state
   * as the rollback target.
   *
   * The previous state survives, because the point of the swap is that it can
   * be undone until the health check passes.
   * @param migrated - the migrated copy to swap in.
   * @returns the handle of the state that was replaced.
   */
  switchIn(migrated: UnitSnapshot): Promise<UnitSnapshot>
  /**
   * Put a previously replaced state back.
   * @param previous - the handle `switchIn` returned.
   */
  rollbackTo(previous: UnitSnapshot): Promise<void>
  /**
   * Delete a snapshot or migrated copy that is no longer needed.
   * @param snapshot - the handle to discard.
   */
  discard(snapshot: UnitSnapshot): Promise<void>
}

/** Static identity and shape of one KV unit, projected from its owner's spec. */
export interface KvUnitDescriptor {
  /** Unit name; must match {@link UNIT_NAME_RE}. Also the file-name / SQL-identifier segment. */
  readonly name: string
  /** Unit format version; a non-negative integer stamped on the medium at first materialization. */
  readonly version: number
  /** Table names; each must match {@link UNIT_NAME_RE}. */
  readonly tables: readonly string[]
  /** Whether this unit carries the global singleton slot. */
  readonly hasGlobal: boolean
  /**
   * Medium layout. `single` (the default) keeps the whole unit in one
   * document; `per-record` keeps each record in its own document, so a unit
   * whose records are large or sparse never rewrites the rest on one write,
   * and a version bump discards stale records instead of rejecting the whole
   * unit. Backends that only serve one layout accept the other's units as
   * foreign documents.
   */
  readonly layout?: 'single' | 'per-record'
}

/**
 * One opened unit. Values are opaque JSON to this layer: no schema, no
 * events, no domain meaning. The unit does NOT serialize concurrent writes —
 * write ordering is the caller's responsibility (the domain layer runs one
 * write chain per unit); the unit only guarantees that each single call is
 * atomic on the medium and durable once resolved (a crash after resolution
 * followed by a re-open observes the write). Any call after {@link close}
 * rejects with `closed`.
 */
export interface KvUnit {
  /**
   * Read the full current snapshot.
   * @returns every table's records keyed by table name, plus the global
   * singleton (`null` when never written or not declared).
   */
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>

  /**
   * Upsert one record durably. Overwrite semantics: an existing key is replaced.
   * @param table - Declared table name.
   * @param key - Record key. In the `per-record` layout a key becomes a path
   * segment and must match `[a-zA-Z0-9_-]+` (an unsafe key rejects); in the
   * `single` layout keys stay opaque.
   * @param value - Opaque JSON-serializable record.
   * @returns resolution after durability.
   */
  putRecord(table: string, key: string, value: unknown): Promise<void>

  /**
   * Delete one record durably. Idempotent: a missing key is a no-op.
   * @param table - Declared table name.
   * @param key - Record key.
   * @returns resolution after durability.
   */
  deleteRecord(table: string, key: string): Promise<void>

  /**
   * Write the global singleton durably. Only valid when the descriptor
   * declared `hasGlobal`.
   * @param value - Opaque JSON-serializable value.
   * @returns resolution after durability.
   */
  setGlobal(value: unknown): Promise<void>

  /**
   * Drain this unit's in-flight writes and release it. Idempotent.
   * @returns resolution after the unit is released.
   */
  close(): Promise<void>
}
