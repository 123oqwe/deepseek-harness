/**
 * Types for `registry-file-deletions.mjs`: registry declarations of files a commit deleted.
 */

/** One declaration of a deleted file: the stage that lists it and the commit that deleted it. */
export interface FileDeletion {
  path: string
  stage: string
  deletedBy: string
}

/** One epic's `FILES_DELETED` entry. */
export interface FileDeletionRecord {
  deleted: readonly FileDeletion[]
  reason: string
  authorization: string
}

/** The registry row fields a deletion changes. */
export interface DeletableRow {
  files: { path: string; kind: string }[]
  stages: Record<string, { files: string[]; count: number } | undefined>
}

/**
 * Remove recorded deleted files from an epic's stage lists, and from `files` where no stage lists them any more; changes `epic` in place.
 * @param id - the epic id, for error messages.
 * @param epic - the row being built.
 * @param record - the epic's deletion record, or `undefined`.
 * @throws when a record lacks a reason, authorization or deleting commit, or names a stage that does not declare the path.
 */
export function applyFileDeletions(id: string, epic: DeletableRow, record: FileDeletionRecord | undefined): void
