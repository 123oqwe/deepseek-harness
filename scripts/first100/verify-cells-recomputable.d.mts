/**
 * Types for the BLOCKED-106 recomputation gate's pure decisions.
 *
 * The gate itself is a `.mjs` script run from the command line; only the
 * decisions its tests exercise are declared here, matching the precedent set by
 * `generate-ledger.d.mts`.
 */

/** One candidate artifact file and the digest of its contents. */
export interface ArtifactCandidate {
  readonly path: string
  readonly sha256: string
}

/**
 * Choose the artifact whose bytes hash to the recorded digest.
 *
 * A run uploads two files named `vitest-report.json`, and only one is what a
 * cell's `observationSha256` was taken over; selecting by digest cannot pick
 * the wrong one and needs no knowledge of the naming convention.
 * @param candidates - paths to consider, with their contents' digests.
 * @param expectedSha256 - the digest the cell recorded.
 * @returns the matching path, or null when none matches.
 */
export function selectArtifactByDigest(
  candidates: readonly ArtifactCandidate[],
  expectedSha256: string,
): string | null

/**
 * Re-derive which frozen cases an observation confirms.
 * @param expectCases - the frozen case strings for a cell.
 * @param passing - the case names the observation shows passing.
 * @returns the confirmed cases, and the frozen cases the observation does not show.
 */
export function recomputeMatchedCases(
  expectCases: readonly string[],
  passing: ReadonlySet<string>,
): { matched: string[], unmatched: string[] }

/**
 * Where a run's uploaded artifacts may be found besides the path a cell
 * recorded.
 *
 * Recorded paths are absolute paths inside the session that greened the cell,
 * and those sessions end; a rescued copy under `$FIRST100_ARTIFACT_DIR/<run
 * id>/` outlives them. Candidates are enumerated from disk rather than
 * composed from the cell, and selection still happens by digest, so widening
 * where the gate looks never widens what it accepts.
 * @param ciRunUrl - the cell's workflow-run URL; its last segment is the run id.
 * @param artifactDir - `$FIRST100_ARTIFACT_DIR`, or undefined when unset.
 * @returns absolute paths to every `vitest-report.json` that run uploaded.
 */
export function rescuedArtifactPaths(
  ciRunUrl: string | undefined,
  artifactDir: string | undefined,
): string[]

/** One live `command-freeze.json` entry, as the stage grouping carries it. */
export interface FreezeEntry {
  readonly epic: string
  readonly stage: string
  readonly expectCases: readonly string[]
  readonly supplementSeq?: number
  readonly supersededBy?: string
}

/**
 * Group the live freeze entries by the stage whose evidence they are.
 *
 * A stage's live evidence is every entry nothing superseded, primary and
 * supplements alike: keeping only the primary made a stage whose primary was
 * superseded look unfrozen while its supplements were live.
 * @param entries - the freeze entries, superseded ones included.
 * @returns live entries per `<epic>|<stage>`, in file order.
 */
export function liveFreezeByStage(
  entries: readonly FreezeEntry[],
): Map<string, FreezeEntry[]>

/** One finding about a cell, as the recomputation produces it. */
export interface CellFinding {
  readonly field: string
  readonly problem: string
  readonly detail: readonly string[]
}

/**
 * Split a cell's findings into the one that falsifies it and the ones that
 * report drift.
 *
 * Only `expectCasesMatched` says the cell records a case its own artifact does
 * not show; the others say the live freeze moved after the cell was greened,
 * which regreening repairs and which must not read as tampering.
 * @param findings - one cell's findings.
 * @returns the falsifying findings and the drift findings.
 */
export function partitionFindings(
  findings: readonly CellFinding[],
): { falsified: CellFinding[], drifted: CellFinding[] }
