/**
 * Types for the P9 cell verifier's pure reporting decision.
 *
 * The verifier itself is a `.mjs` script run from the command line; only the
 * part its tests exercise is declared here, matching the precedent set by
 * `generate-ledger.d.mts` and `verify-cells-recomputable.d.mts`.
 */

/** One P9 item's settled state, as the verifier computes it. */
export interface P9EpicState {
  readonly epic: string
  readonly terminalState: string
}

/**
 * Render the one line a reader takes the program's P9 answer from.
 *
 * Counts the goal as stated — VERIFIED **or** scheduled-BLOCKED — while keeping
 * the two apart in the text, because "proved" and "proved unbuildable and
 * parked" are different facts.
 * @param epics - the per-epic terminal states.
 * @param total - how many P9 items the program has.
 * @param candidateSha - the observation these states were computed from.
 * @param provenance - how the caller obtained them, for the sentence.
 * @returns the summary line.
 */
export function summaryLine(
  epics: readonly P9EpicState[],
  total: number,
  candidateSha: string,
  provenance: string,
): string
