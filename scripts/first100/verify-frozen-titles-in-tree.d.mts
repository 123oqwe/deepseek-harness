/**
 * Types for `verify-frozen-titles-in-tree.mjs`: which frozen titles no test produces.
 */

/** One `command-freeze.json` entry, as this gate reads it. */
export interface InTreeFreezeEntry {
  readonly epic: string
  readonly stage: string
  readonly expectCases: readonly string[]
  /** Absent on a base entry; present on each supplement, and part of its address. */
  readonly supplementSeq?: number
  /** Present once a later entry replaces this one, which takes it out of the check. */
  readonly supersededBy?: string
}

export function collectProducibleTitles(): Set<string>

export function findOrphans(
  entries: readonly InTreeFreezeEntry[],
  producible: ReadonlySet<string>,
  renames: ReadonlyMap<string, string>,
): { key: string; title: string }[]
