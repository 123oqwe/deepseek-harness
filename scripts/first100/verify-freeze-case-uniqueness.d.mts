/**
 * Types for `verify-freeze-case-uniqueness.mjs`: whole-suite uniqueness of live frozen case strings.
 */

/** One `command-freeze.json` entry, as this gate reads it. */
export interface UniquenessFreezeEntry {
  readonly epic: string
  readonly stage: string
  readonly argv?: readonly string[]
  readonly expectCases?: readonly string[]
  /** Absent on a base entry; present on each supplement, and part of its address. */
  readonly supplementSeq?: number
  /** Present once a later entry replaces this one, which takes it out of the check. */
  readonly supersededBy?: string
}

/** One live frozen string and its passing-case count. */
export interface FrozenCaseMatch {
  label: string
  title: string
  raw: number
  resolved: number
  via: string | null
}

export function classifyFrozenCaseMatches(
  entries: readonly UniquenessFreezeEntry[],
  matchCounts: ReadonlyMap<string, number>,
  renames: ReadonlyMap<string, string>,
): FrozenCaseMatch[]

export function argvTargets(argv: readonly string[]): string[]

export function reportRefusal(
  failedFullNames: Set<string>,
  reportFiles: readonly string[],
  entries: readonly UniquenessFreezeEntry[],
  flakeRegistry: unknown,
): string | null

export function uncoveredArgvTargets(
  entries: readonly UniquenessFreezeEntry[],
  reportFiles: readonly string[],
): { label: string; target: string }[]
