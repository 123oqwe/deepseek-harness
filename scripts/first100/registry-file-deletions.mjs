/**
 * Registry declarations of files a commit deleted, applied to one epic's row.
 *
 * Kept out of `extract-registry.mjs` because that script writes the registry at
 * module scope, so a spec cannot import it; this module holds only the rule.
 *
 * @module scripts/first100/registry-file-deletions
 */

/**
 * Remove the recorded deleted files from an epic's stage lists and, where no stage lists a path any more, from its epic-level `files`.
 *
 * Each deletion names the stage whose list declares the path and the commit that
 * deleted it. A stage that does not declare the path is a record that disagrees
 * with the registry, so it throws rather than skipping. `count` is kept equal to
 * the stage's list length, as the extractor's additions keep it. The row is
 * changed in place, as the extractor builds it.
 * @param id - the epic id, for error messages.
 * @param epic - the row being built, with `files` and `stages`.
 * @param record - the epic's `FILES_DELETED` entry, or `undefined` when it has none.
 */
export function applyFileDeletions(id, epic, record) {
  if (record === undefined) return
  if (typeof record.reason !== 'string' || record.reason.trim() === '' || typeof record.authorization !== 'string' || record.authorization.trim() === '') {
    throw new Error(`${id}: a file deletion record needs a reason and an authorization`)
  }
  for (const { path, stage, deletedBy } of record.deleted) {
    if (typeof deletedBy !== 'string' || !/^[0-9a-f]{7,40}$/u.test(deletedBy)) {
      throw new Error(`${id}: file deletion of ${path} names no deleting commit: ${JSON.stringify(deletedBy)}`)
    }
    const list = epic.stages[stage]
    if (list?.files === undefined || !list.files.includes(path)) {
      throw new Error(`${id}: file deletion expects ${path} in stage ${stage}, which does not declare it`)
    }
    list.files = list.files.filter(entry => entry !== path)
    list.count = list.files.length
  }
  for (const path of new Set(record.deleted.map(entry => entry.path))) {
    const stillDeclared = Object.values(epic.stages).some(list => list?.files?.includes(path))
    if (!stillDeclared) epic.files = epic.files.filter(file => file.path !== path)
  }
}
