/**
 * The one place that resolves a frozen case title through its registered
 * rename.
 *
 * A frozen title names a case that may later be renamed by ordinary work. The
 * register (`frozen-title-renames.json`, BLOCKED-040) exists so a rename is not
 * mistaken for a deletion: it records the old title, the new one, and the
 * commit that renamed it, and it is reviewed when written.
 *
 * **Four tools read frozen titles, and three of them each grew their own
 * answer to this question.** `verify-frozen-titles-resolvable` consulted the
 * register from the start. `verify-frozen-titles-in-tree` did not, and reported
 * P0-05.C's renamed case as an orphan whose replacement was sitting in the
 * register — fixed there in place. The GREENING path did not either, which made
 * any cell whose case had been renamed since its last observation impossible to
 * re-green at all; that surfaced re-attesting P0-05.C, where the freeze holds
 * the old title, the report holds the new one, and greening refused anyway.
 * `verify-cells-recomputable` did not either, and reported the same cell
 * MISMATCHED for the same reason.
 *
 * One register, three independent omissions, each found separately. This module
 * exists so the next tool that reads a frozen title inherits the answer instead
 * of rediscovering the question.
 *
 * **Resolution is exact, never fuzzy.** The register is keyed by the old title,
 * so exactly one named replacement is admitted per entry and nothing else. A
 * looser match would let a cell green on a title that is merely similar to the
 * one it promised.
 *
 * @module scripts/first100/frozen-title-renames
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RENAMES_PATH = resolve(REPO_ROOT, 'spec/first100/exec/frozen-title-renames.json')

/**
 * The registered renames, keyed by `epic|stage|oldTitle`.
 *
 * Keyed by the OWNING CELL and not by the title alone, which is the stricter
 * of the two spellings this repository had: `verify-frozen-titles-resolvable`
 * already used it, and the looser title-only form would let a rename
 * registered for one epic's case silently resolve a same-titled case in
 * another. Titles are long and specific enough that a collision is unlikely —
 * and "unlikely" is the wrong standard for the register that decides whether a
 * frozen promise was kept.
 * @returns the mapping; empty when the register is absent.
 */
export function registeredRenames() {
  if (!existsSync(RENAMES_PATH)) return new Map()
  return new Map(
    JSON.parse(readFileSync(RENAMES_PATH, 'utf8')).entries
      .map(entry => [`${entry.epic}|${entry.stage}|${entry.oldTitle}`, entry.newTitle]),
  )
}

/**
 * Whether a frozen title is present in a set of observed names, directly or
 * through the one rename registered for that cell.
 * @param title - the frozen title to look for.
 * @param present - the names actually observed (passing titles, or collected test names).
 * @param renames - the register, from {@link registeredRenames}.
 * @param epic - the epic the frozen title belongs to.
 * @param stage - the stage the frozen title belongs to.
 * @returns true when the title, or its registered replacement, is present.
 */
export function frozenTitlePresent(title, present, renames, epic, stage) {
  if (present.has(title)) return true
  const renamed = renames.get(`${epic}|${stage}|${title}`)
  return renamed !== undefined && present.has(renamed)
}
