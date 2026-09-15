/**
 * Types for `verify-declared-files-exist.mjs`: declared paths that the tree does not hold.
 */

/** One `command-freeze.json` entry, as this gate reads it. */
export interface DeclaredFilesFreezeEntry {
  readonly epic: string
  readonly stage: string
  readonly files?: readonly string[]
  /** Absent on a base entry; present on each supplement, and part of its address. */
  readonly supplementSeq?: number
  /** Present once a later entry replaces this one, which takes it out of the check. */
  readonly supersededBy?: string
}

/** One registry epic, as this gate reads it. */
export interface DeclaredFilesEpic {
  readonly id: string
  readonly files?: readonly (string | { readonly path: string })[]
  readonly stages?: Readonly<Record<string, { readonly files?: readonly string[] }>>
}

export function missingFreezeFiles(
  entries: readonly DeclaredFilesFreezeEntry[],
  exists: (path: string) => boolean,
  basenameIndex: ReadonlyMap<string, readonly string[]>,
): { label: string; path: string; sameNameElsewhere: readonly string[] }[]

export function missingAcceptedRegistryRefs(
  registry: { readonly epics: readonly DeclaredFilesEpic[] },
  acceptedIds: ReadonlySet<string>,
  exists: (path: string) => boolean,
): { where: string; path: string }[]
