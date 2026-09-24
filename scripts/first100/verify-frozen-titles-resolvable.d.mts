/**
 * Types for `verify-frozen-titles-resolvable.mjs`'s report mode: resolving frozen titles from a full-suite report.
 */

/** One vitest assertion as the json reporter records it. */
export interface ReportAssertion {
  title: string
  fullName: string
  status: string
}

/** A report file under its repository path. */
export interface ReportFile {
  path: string
  assertionResults: ReportAssertion[]
}

/** What a bound report says about this tree. */
export interface ReportContext {
  reportFiles: ReportFile[]
  /** This tree's paths that match `vitest.config.ts`'s `testIncludes`. */
  testFiles: string[]
  /** The units of every path changed since the report's commit, uncommitted changes included. */
  changedUnits: Set<string>
  /** The shared test inputs among those changed paths. */
  sharedInputsChanged: string[]
}

/**
 * The titles one parsed vitest report resolves, any status, and how many cases each names.
 * @param report - a parsed `--reporter=json` document.
 * @returns every assertion's `title` and `fullName`, and per name the number of cases it can resolve to.
 */
export function collectTitles(report: {
  readonly testResults?: readonly { readonly assertionResults?: readonly { readonly title?: unknown; readonly fullName?: unknown }[] }[]
}): { ok: true; titles: Set<string>; matchCounts: Map<string, number> }

/**
 * The unit a changed path invalidates in report mode.
 * @param path - a repository-relative path.
 * @returns `packages/<group>/<package>`, `apps/<app>`, `tests/<dir>` or `scripts/<dir>`, otherwise the path's directory (`.` at the root).
 */
export function unitOf(path: string): string

/**
 * The path filters of a frozen `pnpm exec vitest run` command.
 * @param argv - the frozen argv.
 * @returns `{ filters }`, or `{ reason }` when report mode cannot stand in for the command.
 */
export function commandFilters(argv: readonly string[]): { filters: string[]; reason?: undefined } | { filters?: undefined; reason: string }

/**
 * A report file's repository path.
 * @param name - the absolute test-file path the report records.
 * @param treeFiles - the paths this tree has.
 * @returns the longest suffix of `name` the tree has; otherwise the suffix from its first `packages`, `apps`, `scripts` or `tests` segment; otherwise `null`.
 */
export function repositoryPath(name: string, treeFiles: ReadonlySet<string>): string | null

/**
 * Whether a frozen command's titles can come from the full-suite report.
 * @param argv - the frozen argv.
 * @param context - from the report binding.
 * @returns `{ testResults }` to collect titles from, or `{ reasons }` the command must run.
 */
export function planCommand(
  argv: readonly string[],
  context: ReportContext,
): { testResults: { assertionResults: ReportAssertion[] }[]; reasons?: undefined } | { testResults?: undefined; reasons: string[] }
