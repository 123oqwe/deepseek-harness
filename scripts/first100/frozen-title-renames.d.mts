/**
 * Types for `frozen-title-renames.mjs`: resolving a frozen title through its registered rename.
 */

export function registeredRenames(): Map<string, string>

export function frozenTitlePresent(
  title: string,
  present: ReadonlySet<string>,
  renames: ReadonlyMap<string, string>,
  epic: string,
  stage: string,
): boolean
