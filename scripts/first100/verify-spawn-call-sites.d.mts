/**
 * Types for the P3-10 R5 call-site gate's pure functions, which its spec
 * exercises; the verifier itself is a `.mjs` script run from the command line.
 */

/** One row of `spec/first100/exec/spawn-call-sites.json`. */
export interface SpawnCallSiteRow {
  readonly path: string
  readonly calls: number
  readonly class: string
  /** Why the call site is where it is; required for `limited`, `exempt`, `opt-in-mount` and `spawns-nothing`. */
  readonly reason?: string
  /** The work-order phase that wires it; required for `deferred`. */
  readonly until?: string
}

/** The parsed table. */
export interface SpawnCallSiteTable {
  readonly note?: string
  readonly callSites: readonly SpawnCallSiteRow[]
}

/**
 * Whether `path` is a file this gate scans.
 * @param path - a repository-relative path.
 * @returns true for production source outside the seam's own packages and the generated API catalog.
 */
export function isScannedSource(path: string): boolean

/**
 * Count the call sites in one file's text.
 * @param text - the file's contents.
 * @returns the number of reaches into the seam on non-comment lines.
 */
export function countCallSites(text: string): number

/**
 * Compare the tree's call sites with the table.
 * @param counts - call sites per scanned file, files with none omitted.
 * @param table - the parsed table.
 * @returns one line per finding; empty when every call site is classified and every row is current.
 */
export function spawnCallSiteFindings(counts: ReadonlyMap<string, number>, table: SpawnCallSiteTable): string[]

/**
 * Read the tree's call sites and the table.
 * @returns the counts and the table.
 */
export function loadSpawnCallSiteInputs(): { counts: Map<string, number>; table: SpawnCallSiteTable }
