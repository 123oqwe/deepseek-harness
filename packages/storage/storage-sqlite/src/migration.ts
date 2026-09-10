/**
 * Unit migration in this medium's own terms (first100 registry P1-10 must[1]).
 *
 * A unit here is a set of rows inside one shared database, so a snapshot
 * cannot be a copy of the file: that would carry every OTHER unit along and
 * make a rollback of one unit a rollback of all of them. A snapshot is instead
 * a sidecar database holding exactly this unit's rows, produced by `ATTACH`,
 * and a switch is a row replacement inside a single transaction — so a crash
 * mid-switch leaves either the old rows or the new ones and never half of
 * each.
 *
 * `:memory:` has no directory to put sidecars in, so a memory-backed backend
 * exposes no migration facet at all: the absence is the answer, and a caller
 * is told by name rather than discovering it as a failure mid-upgrade.
 * @module @deepseek-ai/dsh-storage-sqlite/migration
 */

import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type {
  KvUnitDescriptor,
  MigrationFacet,
  UnitContent,
  UnitSnapshot,
} from '@deepseek-ai/dsh-storage'
import { recordTableName } from './schema.ts'

/** One unit's rows, held in a sidecar database beside the live one. */
export class SqliteMigrationFacet implements MigrationFacet {
  /**
   * @param ready - the open live database.
   * @param path - the live database's resolved path; sidecars sit beside it.
   */
  constructor(
    private readonly ready: Promise<DatabaseSync>,
    private readonly path: string,
  ) {}

  async stampedVersion(descriptor: KvUnitDescriptor): Promise<number | undefined> {
    const db = await this.ready
    const row = db.prepare('SELECT version FROM units WHERE name = ?').get(descriptor.name) as
      | { version: number }
      | undefined
    return row?.version
  }

  async snapshotUnit(descriptor: KvUnitDescriptor): Promise<UnitSnapshot> {
    const handle = `${descriptor.name}.snapshot-${String(Date.now())}`
    await this.writeSidecar(descriptor, this.sidecarPath(handle))
    return { unit: descriptor.name, handle }
  }

  async exportUnit(descriptor: KvUnitDescriptor, destination: string): Promise<void> {
    await this.writeSidecar(descriptor, destination)
  }

  readSnapshot(snapshot: UnitSnapshot): Promise<{
    readonly version: number | undefined
    readonly content: UnitContent
  }> {
    // `node:sqlite` is synchronous; the facet is asynchronous because other
    // media are not. A failure REJECTS rather than throwing synchronously — a
    // caller holding a promise would otherwise miss it entirely.
    try {
      const db = new DatabaseSync(this.sidecarPath(snapshot.handle))
      try {
        // Projected to the facet's two fields: the table list is this backend's
        // own bookkeeping, and a caller that received it would be reading a
        // medium detail out of a medium-independent contract.
        const { version, content } = readSidecar(db, snapshot.unit)
        return Promise.resolve({ version, content })
      } finally {
        db.close()
      }
    } catch (failure) {
      return Promise.reject(failure instanceof Error ? failure : new Error(String(failure)))
    }
  }

  async digestUnit(snapshot: UnitSnapshot): Promise<string> {
    const { content } = await this.readSnapshot(snapshot)
    // Over the content, not the file: two SQLite files holding the same rows
    // differ in page layout, freelists and vacuum state, none of which is data.
    return `sha256-${createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex')}`
  }

  async materializeMigrated(
    snapshot: UnitSnapshot,
    version: number,
    migrate: (content: UnitContent) => Promise<UnitContent>,
  ): Promise<UnitSnapshot> {
    const handle = `${snapshot.unit}.migrated-${String(version)}-${String(Date.now())}`
    const source = new DatabaseSync(this.sidecarPath(snapshot.handle))
    let content: UnitContent
    let tables: string[]
    try {
      const read = readSidecar(source, snapshot.unit)
      content = read.content
      tables = read.tables
    } finally {
      source.close()
    }
    const migrated = await migrate(content)

    const destination = new DatabaseSync(this.sidecarPath(handle))
    try {
      createSidecarSchema(destination)
      // Stamped with the NEW version here: the stamp is what `kv.open`
      // compares against the descriptor, so a migrated copy without it is one
      // the new build still refuses to open.
      writeContent(destination, snapshot.unit, version, [...new Set([...tables, ...Object.keys(migrated.tables)])], migrated)
    } finally {
      destination.close()
    }
    return { unit: snapshot.unit, handle }
  }

  async switchIn(migrated: UnitSnapshot): Promise<UnitSnapshot> {
    const db = await this.ready
    const previous = `${migrated.unit}.previous-${String(Date.now())}`
    const source = new DatabaseSync(this.sidecarPath(migrated.handle))
    let read: { version: number | undefined; content: UnitContent; tables: string[] }
    try {
      read = readSidecar(source, migrated.unit)
    } finally {
      source.close()
    }
    if (read.version === undefined) {
      throw new StorageError('malformed-medium', `migrated copy of unit '${migrated.unit}' carries no version stamp`)
    }
    // The replaced state is preserved BEFORE the live rows change: it is the
    // rollback target until the health check passes.
    await this.writeSidecar(
      { name: migrated.unit, version: read.version, tables: read.tables, hasGlobal: true },
      this.sidecarPath(previous),
    )
    db.exec('BEGIN IMMEDIATE')
    try {
      writeContent(db, migrated.unit, read.version, read.tables, read.content)
      db.exec('COMMIT')
    } catch (failure) {
      db.exec('ROLLBACK')
      throw failure
    }
    return { unit: migrated.unit, handle: previous }
  }

  async rollbackTo(previous: UnitSnapshot): Promise<void> {
    const db = await this.ready
    const source = new DatabaseSync(this.sidecarPath(previous.handle))
    let read: { version: number | undefined; content: UnitContent; tables: string[] }
    try {
      read = readSidecar(source, previous.unit)
    } finally {
      source.close()
    }
    if (read.version === undefined) {
      throw new StorageError('malformed-medium', `rollback target of unit '${previous.unit}' carries no version stamp`)
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      writeContent(db, previous.unit, read.version, read.tables, read.content)
      db.exec('COMMIT')
    } catch (failure) {
      db.exec('ROLLBACK')
      throw failure
    }
  }

  async discard(snapshot: UnitSnapshot): Promise<void> {
    await rm(this.sidecarPath(snapshot.handle), { force: true })
  }

  /** Where one handle's sidecar database lives. */
  private sidecarPath(handle: string): string {
    return `${this.path}.${handle}.db`
  }

  /** Copy one unit's rows into a fresh database at `destination`. */
  private async writeSidecar(descriptor: KvUnitDescriptor, destination: string): Promise<void> {
    const db = await this.ready
    await rm(destination, { force: true })
    const sidecar = new DatabaseSync(destination)
    try {
      createSidecarSchema(sidecar)
    } finally {
      sidecar.close()
    }
    // ATTACH rather than a second connection: the copy then runs inside the
    // live database's own transaction, so it observes one consistent state
    // rather than reading rows a concurrent write is still changing.
    db.exec(`ATTACH DATABASE '${destination.replaceAll("'", "''")}' AS copy_target`)
    try {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO copy_target.units (name, version) SELECT name, version FROM units WHERE name = ?')
          .run(descriptor.name)
        db.prepare('INSERT INTO copy_target.unit_globals (unit, value) SELECT unit, value FROM unit_globals WHERE unit = ?')
          .run(descriptor.name)
        for (const table of descriptor.tables) {
          // Both segments passed UNIT_NAME_RE at open, so the identifier is
          // safe to interpolate.
          const physical = recordTableName(descriptor.name, table)
          db.exec(`CREATE TABLE IF NOT EXISTS copy_target."${physical}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
          db.exec(`INSERT INTO copy_target."${physical}" (key, value) SELECT key, value FROM main."${physical}"`)
        }
        db.exec('COMMIT')
      } catch (failure) {
        db.exec('ROLLBACK')
        throw failure
      }
    } finally {
      db.exec('DETACH DATABASE copy_target')
    }
  }
}

/** The unit-metadata tables every sidecar carries, mirroring the live layout. */
function createSidecarSchema(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS units (name TEXT PRIMARY KEY, version INTEGER NOT NULL) STRICT')
  db.exec('CREATE TABLE IF NOT EXISTS unit_globals (unit TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
}

/** One sidecar's stamp, content and the table names it holds. */
function readSidecar(
  db: DatabaseSync,
  unit: string,
): { version: number | undefined; content: UnitContent; tables: string[] } {
  const stamp = db.prepare('SELECT version FROM units WHERE name = ?').get(unit) as
    | { version: number }
    | undefined
  const prefix = `u_${unit}_`
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?")
    .all(`${prefix}%`) as { name: string }[]
  const tables: Record<string, Record<string, unknown>> = {}
  const declared: string[] = []
  for (const { name } of names) {
    const table = name.slice(prefix.length)
    declared.push(table)
    const rows = db.prepare(`SELECT key, value FROM "${name}"`).all() as { key: string; value: string }[]
    tables[table] = Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value) as unknown]))
  }
  const global = db.prepare('SELECT value FROM unit_globals WHERE unit = ?').get(unit) as
    | { value: string }
    | undefined
  return {
    version: stamp?.version,
    content: { global: global === undefined ? null : JSON.parse(global.value) as unknown, tables },
    tables: declared,
  }
}

/** Replace one unit's rows in `db` with `content`, stamped at `version`. */
function writeContent(
  db: DatabaseSync,
  unit: string,
  version: number,
  tables: readonly string[],
  content: UnitContent,
): void {
  db.prepare('INSERT INTO units (name, version) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET version = excluded.version')
    .run(unit, version)
  db.prepare('DELETE FROM unit_globals WHERE unit = ?').run(unit)
  if (content.global !== null && content.global !== undefined) {
    db.prepare('INSERT INTO unit_globals (unit, value) VALUES (?, ?)').run(unit, JSON.stringify(content.global))
  }
  for (const table of tables) {
    const physical = recordTableName(unit, table)
    db.exec(`CREATE TABLE IF NOT EXISTS "${physical}" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
    db.exec(`DELETE FROM "${physical}"`)
    const insert = db.prepare(`INSERT INTO "${physical}" (key, value) VALUES (?, ?)`)
    for (const [key, value] of Object.entries(content.tables[table] ?? {})) {
      insert.run(key, JSON.stringify(value))
    }
  }
}

/**
 * One JSON encoding of a value that does not depend on key insertion order, so
 * two encodings of the same content produce one digest.
 * @param value - the value to encode.
 * @returns the canonical encoding.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  // `undefined` has no JSON encoding; in a record it reads as absent.
  if (value === null || typeof value !== 'object') return value === undefined ? 'null' : JSON.stringify(value)
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}
