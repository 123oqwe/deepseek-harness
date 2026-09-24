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

/** One `--e2e-report`, by its path and the test files it ran. */
export interface OwnConfigReport {
  readonly path: string
  /** `testResults[].name`, absolute on the machine that ran it. */
  readonly files: readonly string[]
}

/**
 * The report that observes each live entry frozen under its own vitest config: the first of `reports` that ran
 * every test path its argv names.
 * @param entries - command-freeze entries; superseded entries and entries naming no config are skipped.
 * @param reports - the `--e2e-report` reports in argument order.
 * @returns `owned`, one `{ entry, path }` per entry observed, and `refusals`, one message per entry that is not.
 */
export function configFrozenOwnReports(
  entries: readonly UniquenessFreezeEntry[],
  reports: readonly OwnConfigReport[],
): { owned: { entry: UniquenessFreezeEntry; path: string }[]; refusals: string[] }

/** A frozen string's row, with the report it was counted in: `null` for the whole-suite report. */
export interface ObservedFrozenCaseMatch extends FrozenCaseMatch {
  report: string | null
}

/**
 * One row per live frozen string, counted in the report that observes its entry.
 * @param entries - command-freeze entries; an entry naming no config is counted in the whole-suite report.
 * @param suiteCounts - the whole-suite report's passing-case counts.
 * @param owned - from `configFrozenOwnReports`; each is counted in its own report only.
 * @param countsByPath - each `--e2e-report`'s passing-case counts, by its path.
 * @param renames - `epic|stage|oldTitle` -> newTitle.
 * @returns the rows, each naming the report it was counted in.
 */
export function classifyAgainstObservingReports(
  entries: readonly UniquenessFreezeEntry[],
  suiteCounts: ReadonlyMap<string, number>,
  owned: readonly { entry: UniquenessFreezeEntry; path: string }[],
  countsByPath: ReadonlyMap<string, ReadonlyMap<string, number>>,
  renames: ReadonlyMap<string, string>,
): ObservedFrozenCaseMatch[]
