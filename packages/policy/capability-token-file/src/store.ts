/**
 * The file-backed durability seam for Capability Tokens (Epic P2-02 must[1],
 * acceptance[1]).
 *
 * Whole-state load and whole-state save, because that is what
 * `CapabilityTokenStore` requires and the requirement is a safety property
 * rather than a simplification: a revocation must become visible to the
 * lineage check in the same instant as the digest that recorded it, so there
 * is no partial write a reader could observe between the two.
 *
 * Writes go through `@deepseek-ai/dsh-atomic-write` — the repository's one
 * atomic replacement, already used by `dsh-plugin-lock`, whose own comment
 * records that adding `write-file-atomic` beside it as a third implementation
 * was rejected. A read-modify-write cycle takes `withFileLock` as well, since
 * two hosts sharing a home directory would otherwise let one resurrect a
 * revocation the other had just recorded.
 *
 * **No token content is logged.** Errors name the path and the failure, never
 * the state being written (acceptance[2]).
 *
 * @module @deepseek-ai/dsh-capability-token-file/store
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { CapabilityTokenStore, CapabilityTokenStoreState } from '@deepseek-ai/dsh-capability-token'

/** The empty state a directory with no token file starts from. */
const EMPTY_STATE: CapabilityTokenStoreState = Object.freeze({
  tokens: [],
  revokedDigests: [],
  spentNonces: [],
  auditRecords: [],
})

/**
 * Open the token store held in one directory.
 *
 * The directory is created on first write rather than at open, so opening a
 * store for a home that does not exist yet is not itself a failure — the same
 * arrangement the lease store reaches by creating its parent before SQLite
 * opens, for the same reason: a first run must not have to pre-create paths.
 * @param directory - the directory holding `capability-tokens.json`.
 * @returns the store, reading and writing that file.
 */
export function openFileCapabilityTokenStore(directory: string): CapabilityTokenStore {
  const path = join(directory, 'capability-tokens.json')
  return {
    async load(): Promise<CapabilityTokenStoreState> {
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        // A store that has never been written is empty, not broken. Any other
        // read failure is a real one and must not be flattened into "empty",
        // which would silently drop every recorded revocation.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_STATE
        throw error
      }
      try {
        return JSON.parse(text) as CapabilityTokenStoreState
      } catch (error) {
        throw new Error(`capability-token store at ${path} is not valid JSON`, { cause: error })
      }
    },
    async save(state: CapabilityTokenStoreState): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      // The lock spans the whole replacement, not just the rename: another
      // host performing its own load-modify-save must not interleave between
      // this caller's load and this write, or its revocation is lost.
      await withFileLock(path, async () => {
        await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
      })
    },
  }
}
