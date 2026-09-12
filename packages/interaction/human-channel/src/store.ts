/**
 * The emergency stop's durable record (Epic P2-12, Provider stage).
 *
 * The channel decides; this makes the decision outlive the process that made
 * it. acceptance[2] is the whole reason this module exists separately: a stop
 * survives a restart and must be lifted explicitly, and neither half is a
 * property the decision can hold on its own.
 *
 * **Separate from the channel so a mutation can aim at it.** P4-12 measured
 * why: with its store split out, changing one SQL comparison reddened exactly
 * one case and left twelve green. A store folded into the module that decides
 * cannot be mutated on its own, so a sensitivity proof for "the write happened"
 * has nothing to aim at.
 *
 * **One JSON document, replaced atomically.** The record is a handful of fields
 * written rarely — a stop is a human action — so a database would buy nothing a
 * rename does not. The write goes to a temporary file in the same directory and
 * is renamed over the target, because a partially written stop record is the
 * one state a recovering process must never read: `rename` within a directory
 * is atomic, so a reader sees the old record or the new one and never half.
 *
 * @module @deepseek-ai/dsh-human-channel/store
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StopRecord } from './types.ts'

/**
 * The on-disk format this module writes.
 *
 * An unknown version is refused by name rather than migrated, which is this
 * repository's pre-release stance and BLOCKED-221's precedent: that ledger
 * names the file and both versions and tells the reader to delete it. A stop
 * record is the one object where failing closed and failing loud are the same
 * choice — a record this build cannot read might be a stop in force, and
 * guessing either way is worse than refusing.
 */
const STOP_FORMAT_VERSION = 1

/** The file name inside the caller's directory, so two stores never share one document. */
const STOP_FILE = 'emergency-stop.json'

/** The store's handle. */
export interface StopStore {
  /**
   * The stop in force, or undefined when none is.
   *
   * Read at construction by the channel, which is what makes a restart start
   * stopped with nothing re-applying the stop.
   */
  read: () => StopRecord | undefined
  /**
   * Persist the stop, or clear it, returning only once the document is replaced.
   *
   * Synchronous and durable BEFORE the caller reports the stop as in force. A
   * report that outlives its record is a lie the next process cannot detect:
   * the caller was told work is halted, the process died, and the file says
   * nothing was ever stopped.
   */
  write: (record: StopRecord | undefined) => void
}

/** What the document holds; `record: null` is "no stop", distinct from a missing file. */
interface StopDocument {
  readonly version: number
  readonly record: StopRecord | null
}

/**
 * Open (creating the directory if absent) the stop store for one profile.
 * @param directory - the directory holding `emergency-stop.json`.
 * @returns the store handle.
 * @throws when the document exists and its version is not this build's.
 */
export function openStopStore(directory: string): StopStore {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, STOP_FILE)
  const readDocument = (): StopDocument | undefined => {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch (error) {
      // ENOENT only: no stop has ever been written here, which is the ordinary
      // first-boot state and not a failure. Anything else — a permission
      // problem, a directory where the file should be — is a real fault and
      // must not read as "not stopped".
      if ((error as { code?: string }).code === 'ENOENT') return undefined
      throw error
    }
    const document = JSON.parse(raw) as StopDocument
    if (document.version !== STOP_FORMAT_VERSION) {
      throw new Error(
        `human-channel: ${path} is stop-format version ${String(document.version)}, not ${String(STOP_FORMAT_VERSION)};`
        + ' this build ships no upgrade path, so delete it only if you know no stop is in force',
      )
    }
    return document
  }
  return {
    read: () => readDocument()?.record ?? undefined,
    write: (record) => {
      const document: StopDocument = { version: STOP_FORMAT_VERSION, record: record ?? null }
      // A temporary file in the SAME directory, because `rename` is atomic only
      // within a filesystem. Writing the target in place would leave a window
      // where a recovering process reads a truncated document and cannot tell
      // whether a stop is in force.
      const temporary = `${path}.${String(process.pid)}.tmp`
      writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
      try {
        renameSync(temporary, path)
      } catch (error) {
        // The rename is the commit. If it fails the temporary file is residue
        // that would otherwise accumulate one per attempt, and the caller must
        // still learn the write did not happen.
        try {
          unlinkSync(temporary)
        } catch {
          // The temporary file is already gone, or unreachable for the same
          // reason the rename failed. Nothing else can be done here and the
          // original error is the one worth reporting.
        }
        throw error
      }
    },
  }
}
