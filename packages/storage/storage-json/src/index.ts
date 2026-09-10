/**
 * JSON storage backend: one human-readable document per unit under a
 * configured root — a whole-unit file (`single` layout) or one document per
 * record (`per-record` layout), published by atomic rewrite. Registers as
 * backend `json` on the storage hub.
 * @module @deepseek-ai/dsh-storage-json
 */

import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
  UnitSnapshot,
} from '@deepseek-ai/dsh-storage'
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
      const path = this.mediumPath(descriptor)
      if (!existsSync(path)) return undefined
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      const version = (parsed as { version?: unknown }).version
      return typeof version === 'number' ? version : undefined
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
      // The records are read and written through the same documents `open`
      // would use, so a migration sees what the plugin sees rather than a
      // shape this backend invented for the occasion.
      const migrated = await migrate(await readUnitRecords(join(this.root, handle)))
      await writeUnitRecords(join(this.root, handle), version, migrated)
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
 * Every record in one unit's medium, as the migration sees them.
 *
 * Read through the same documents `open` would use, so a migration sees what
 * the plugin sees rather than a shape invented for the occasion.
 */
async function readUnitRecords(medium: string): Promise<readonly unknown[]> {
  const path = existsSync(medium) ? medium : `${medium}.json`
  if (!existsSync(path)) return []
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  const records: unknown = (parsed as { records?: unknown }).records
  return Array.isArray(records) ? records as readonly unknown[] : []
}

/**
 * Write migrated records back, stamping the medium with the new version.
 *
 * The stamp is what `KvFacet.open` compares against `descriptor.version`, so
 * writing the records without it would leave a migrated unit that the new
 * build still refuses to open — the failure this epic exists to remove.
 */
async function writeUnitRecords(
  medium: string,
  version: number,
  records: readonly unknown[],
): Promise<void> {
  const path = existsSync(medium) ? medium : `${medium}.json`
  await writeFile(path, JSON.stringify({ version, records }, undefined, 2), 'utf8')
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
