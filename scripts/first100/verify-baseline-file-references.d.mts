/**
 * Types for `verify-baseline-file-references.mjs`: registry file references checked against the pinned baseline commit.
 */

/** One registry `files[]` entry, in the fields this check reads. */
export interface BaselineFileEntry {
  path: string
  kind: string
  /** For a `kind: 'B'` file renamed after the baseline: the path the baseline holds. */
  baselinePath?: string
}

/** One epic's result. `missingB` names the declared path, and the baseline path when one is recorded. */
export interface BaselineEpicFindings {
  missingB: string[]
  existingN: string[]
  okB: number
  okN: number
  pCount: number
}

/**
 * Every epic's `files[]` checked against one baseline commit; a renamed `B` file is checked at its `baselinePath`.
 * @param registry - the parsed registry.
 * @param exists - whether a repo-relative path exists as a blob at the baseline.
 * @returns per-epic findings, the entries with an unknown kind, and the totals.
 */
export function baselineReferenceFindings(
  registry: { epics: readonly { id: string; files?: readonly BaselineFileEntry[] }[] },
  exists: (path: string) => boolean,
): {
  epics: Record<string, BaselineEpicFindings>
  unknownKinds: { epic: string; path: string; kind: string }[]
  summary: { totalEpics: number; epicsWithMissingB: number; totalMissingB: number; epicsWithExistingN: number; totalExistingN: number }
}
