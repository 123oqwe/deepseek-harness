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
