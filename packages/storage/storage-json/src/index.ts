/**
 * JSON storage backend: one human-readable document per unit under a
 * configured root — a whole-unit file (`single` layout) or one document per
 * record (`per-record` layout), published by atomic rewrite. Registers as
 * backend `json` on the storage hub.
 * @module @deepseek-ai/dsh-storage-json
 */

import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type {
  KvFacet,
  KvUnit,
  KvUnitDescriptor,
  MigrationFacet,
  StorageBackend,
  UnitContent,
  UnitSnapshot,
} from '@deepseek-ai/dsh-storage'
import { serialize } from './format.ts'
import { openSingleUnit } from './single-unit.ts'
import { openPerRecordUnit } from './per-record-unit.ts'

/** Cordis plugin name. */
export const name = 'storage-json'
/** The hub must exist before the backend can register. */
export const inject = ['storage']

/**
 * Plugin configuration.
 * `root` has NO default on purpose: a `process.cwd()` fallback would scatter
 * unit files wherever the process happens to start; assemblies state the
 * location explicitly.
 */
export interface Config {
  /** Directory holding one `<unit>.json` file (or `<unit>/` tree) per unit. */
  root: string
}

/** Config schema. */
export const Config: z<Config> = z.object({
  root: z.string().required(),
})

/** JSON backend: owns the file-tree root and serves the `kv` facet. */
export class JsonStorageBackend implements StorageBackend {
  private readonly open = new Map<string, KvUnit>()
  // Reserved synchronously at open() entry so a concurrent open of the same
  // unit fails, and close() can await opens still in flight.
  private readonly opening = new Map<string, Promise<KvUnit>>()
  private closed = false

  constructor(private readonly root: string) {}

  readonly kv: KvFacet = {
    // The body up to the first await runs synchronously, so the opening-slot
    // reservation below still excludes a concurrent open of the same unit.
    open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
      if (this.closed) throw new StorageError('closed', 'json backend is closed')
      validateDescriptor(descriptor)
      if (this.open.has(descriptor.name) || this.opening.has(descriptor.name)) {
        // Double-open is a caller bug, not a medium condition.
        throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`)
      }
      const opening = this.openUnit(descriptor)
      this.opening.set(descriptor.name, opening)
      return opening.finally(() => this.opening.delete(descriptor.name))
    },
  }

  /**
   * Unit migration in this medium's own terms (first100 registry P1-10
   * must[1]).
   *
   * A unit here is one file (`single`) or one directory (`per-record`), so a
   * snapshot is a copy beside it and a switch is a rename. The copy is
   * consistent only while nothing writes, which is why the transaction holds a
   * cross-process lease over the whole upgrade: a backend cannot exclude a
   * writer in another process, and a `per-record` directory copied under one
   * would tear between records.
   */
  readonly migration: MigrationFacet = {
    stampedVersion: async (descriptor: KvUnitDescriptor): Promise<number | undefined> => {
      validateDescriptor(descriptor)
      // A `per-record` unit stamps each record and treats a record at another
      // version as absent, so it has no unit-level version to migrate FROM —
      // it self-heals instead. Reported as "no stamp" rather than as a version,
      // so an upgrade leaves it alone.
      if (descriptor.layout === 'per-record') return undefined
      return (await readDocument(this.mediumPath(descriptor)))?.version
    },
    digestUnit: async (snapshot): Promise<string> => {
      const document = await readDocument(join(this.root, snapshot.handle))
      // Over the content, not the file: a rewrite that reorders keys or
      // changes indentation is the same data, and a digest that moved would
      // report a change nothing made.
      return `sha256-${createHash('sha256')
        .update(canonicalJson(document?.content ?? EMPTY_CONTENT), 'utf8')
        .digest('hex')}`
    },
    readSnapshot: async (snapshot) => {
      const document = await readDocument(join(this.root, snapshot.handle))
      return document ?? { version: undefined, content: EMPTY_CONTENT }
    },
    exportUnit: async (descriptor: KvUnitDescriptor, destination: string): Promise<void> => {
      validateDescriptor(descriptor)
      await cpPath(this.mediumPath(descriptor), destination)
    },
    snapshotUnit: async (descriptor: KvUnitDescriptor): Promise<UnitSnapshot> => {
      validateDescriptor(descriptor)
      const handle = `${descriptor.name}.snapshot-${String(Date.now())}`
      await cpPath(this.mediumPath(descriptor), join(this.root, handle))
      return { unit: descriptor.name, handle }
    },
    materializeMigrated: async (snapshot, version, migrate): Promise<UnitSnapshot> => {
      const source = join(this.root, snapshot.handle)
      const handle = `${snapshot.unit}.migrated-${String(version)}-${String(Date.now())}`
      await cpPath(source, join(this.root, handle))
      // Read and written as the SAME document `open` would use — this
      // backend's real `{ unit, global, tables }` format — so a migration sees
      // what the plugin sees rather than a shape invented for the occasion.
      const document = await readDocument(join(this.root, handle))
      const migrated = await migrate(document?.content ?? EMPTY_CONTENT)
      await writeDocument(join(this.root, handle), snapshot.unit, version, migrated)
      return { unit: snapshot.unit, handle }
    },
    switchIn: async (migrated): Promise<UnitSnapshot> => {
      const previous = `${migrated.unit}.previous-${String(Date.now())}`
      const live = join(this.root, migrated.unit)
      const livePath = existsSync(live) ? live : `${live}.json`
      const previousPath = existsSync(live) ? join(this.root, previous) : join(this.root, `${previous}.json`)
      // The live path moves ASIDE first: a rename over it would not preserve
      // what it replaced, and the aside IS the rollback target until the
      // health check passes.
      if (existsSync(livePath)) await rename(livePath, previousPath)
      await rename(join(this.root, migrated.handle), livePath)
      return { unit: migrated.unit, handle: previous }
    },
    rollbackTo: async (previous): Promise<void> => {
      const live = join(this.root, previous.unit)
      const previousPath = existsSync(join(this.root, previous.handle))
        ? join(this.root, previous.handle)
        : join(this.root, `${previous.handle}.json`)
      const livePath = existsSync(live) ? live : `${live}.json`
      await rm(livePath, { recursive: true, force: true })
      await rename(previousPath, livePath)
    },
    discard: async (snapshot): Promise<void> => {
      await rm(join(this.root, snapshot.handle), { recursive: true, force: true })
      await rm(join(this.root, `${snapshot.handle}.json`), { force: true })
    },
  }

  /** Where one unit's medium lives, whichever layout it uses. */
  private mediumPath(descriptor: KvUnitDescriptor): string {
    const directory = join(this.root, descriptor.name)
    return descriptor.layout === 'per-record' ? directory : `${directory}.json`
  }

  private async openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    // The two layouts differ in medium shape only; each opener owns its own
    // path convention under the shared root.
    const onClose = () => this.open.delete(descriptor.name)
    const unit = descriptor.layout === 'per-record'
      ? await openPerRecordUnit(descriptor, this.root, onClose)
      : await openSingleUnit(descriptor, this.root, onClose)
    if (this.closed) {
      // The backend closed while this open was in flight: do not hand out a
      // live unit past close().
      await unit.close()
      throw new StorageError('closed', 'json backend is closed')
    }
    this.open.set(descriptor.name, unit)
    return unit
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
    }
    await Promise.allSettled([...this.opening.values()])
    for (const unit of [...this.open.values()]) {
      await unit.close()
    }
  }
}

/**
 * Copy one unit's medium, whichever shape it has.
 *
 * A `single` unit is a file and a `per-record` unit is a directory, and the
 * caller does not know which — it holds a descriptor, not a layout decision.
 * A medium that does not exist yet copies to nothing rather than failing: a
 * unit whose first write has not landed is a legitimate state, and an upgrade
 * of it is a no-op rather than an error.
 */
async function cpPath(source: string, destination: string): Promise<void> {
  if (!existsSync(source)) return
  await cp(source, destination, { recursive: true })
}

/**
 * The document a handle names, whichever of the two spellings exists.
 *
 * A handle is stored without an extension while the live unit carries `.json`,
 * and a copy of either keeps the shape it was copied from, so both spellings
 * are legitimate for the same handle.
 * @param medium - the extension-less path.
 * @returns the existing path, or undefined when neither spelling exists.
 */
function mediumOf(medium: string): string | undefined {
  if (existsSync(medium)) return medium
  return existsSync(`${medium}.json`) ? `${medium}.json` : undefined
}

/**
 * One JSON encoding of a value that does not depend on key insertion order.
 *
 * A digest exists to answer "is this the same data", so two encodings of the
 * same records must produce one string. Array order is preserved: in records it
 * is data, not formatting.
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

/** The content of a unit whose medium does not exist yet. */
const EMPTY_CONTENT: UnitContent = { global: null, tables: {} }

/**
 * One unit document as a migration sees it: its stamp and its content.
 *
 * Deliberately NOT `format.ts`'s `parse`, which rejects a version other than
 * the descriptor's. Reading a document stamped with the version the DATA is at
 * is the whole point here: that is the version an upgrade converts from.
 * @param medium - the extension-less path of the document.
 * @returns the stamp and content, or undefined when no document exists.
 */
async function readDocument(
  medium: string,
): Promise<{ version: number; content: UnitContent } | undefined> {
  const path = mediumOf(medium)
  if (path === undefined) return undefined
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  const document = parsed as { unit?: { version?: unknown }; global?: unknown; tables?: unknown }
  const version = document.unit?.version
  if (typeof version !== 'number') {
    throw new StorageError('malformed-medium', `unit document at ${path} carries no version stamp`)
  }
  const tables = typeof document.tables === 'object' && document.tables !== null
    ? document.tables as UnitContent['tables']
    : {}
  return { version, content: { global: document.global ?? null, tables } }
}

/**
 * Write migrated content back, stamping the document with the new version.
 *
 * The stamp is what `KvFacet.open` compares against `descriptor.version`, so
 * writing the content without it would leave a migrated unit the new build
 * still refuses to open — the failure this epic exists to remove. Written
 * through `format.ts`'s `serialize`, so a migrated document is shaped exactly
 * like one this backend wrote itself.
 */
async function writeDocument(
  medium: string,
  name: string,
  version: number,
  content: UnitContent,
): Promise<void> {
  const path = mediumOf(medium) ?? `${medium}.json`
  const tables = new Map<string, Map<string, unknown>>(
    Object.entries(content.tables).map(([table, records]) => [
      table,
      new Map<string, unknown>(Object.entries(records)),
    ]),
  )
  await writeFile(path, serialize(name, { version, global: content.global, tables }), 'utf8')
}

function validateDescriptor(descriptor: KvUnitDescriptor): void {
  if (!UNIT_NAME_RE.test(descriptor.name)) {
    throw new StorageError('malformed-medium', `invalid unit name '${descriptor.name}'`)
  }
  for (const table of descriptor.tables) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new StorageError('malformed-medium', `invalid table name '${table}' in unit '${descriptor.name}'`)
    }
  }
}

/**
 * Register the `json` backend on the storage hub.
 * @param ctx - Plugin context.
 * @param config - Validated configuration.
 */
export function apply(ctx: Context, config: Config) {
  const backend = new JsonStorageBackend(config.root)
  ctx.effect(() => {
    const unregister = ctx.storage.backend.register('json', backend)
    return async () => {
      unregister()
      await backend.close()
    }
  })
  ctx.provide(storageBackendServiceKey('json'), backend)
}
