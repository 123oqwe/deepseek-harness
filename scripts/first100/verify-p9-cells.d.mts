/**
 * Types for the P9 cell verifier's pure decisions.
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

/** A command-freeze entry, as far as the verifier reads one. */
export interface P9FreezeEntry {
  readonly epic: string
  readonly stage: string
  readonly argv: readonly string[]
  readonly expectCases: readonly string[]
  readonly files?: readonly string[]
  readonly supplementSeq?: number
}

/** The command freeze, as far as the verifier reads it. */
export interface P9Freeze {
  readonly entries: readonly P9FreezeEntry[]
}

/** A stage parked on a recorded blocker, from `p9-stage-blockers.json`. */
export interface P9StageBlocker {
  readonly epic: string
  readonly stage: string
  readonly blocker: string
  readonly clause?: string
}

/** One frozen string that names more than one passing case. */
export interface P9AmbiguousCase {
  readonly title: string
  readonly count: number
}

/** One (epic, stage) outcome. */
export interface P9Cell {
  readonly epic: string
  readonly stage: string
  readonly status: string
  readonly frozenCases?: number
  readonly matchedCases?: number
  readonly missingCases?: readonly string[]
  readonly ambiguousCases?: readonly P9AmbiguousCase[]
}

/** The recorded verification, as far as the staleness check reads it. */
export interface P9Record {
  readonly candidateSha: string
  readonly cells?: readonly P9Cell[]
}

/** The ledger's two matching rules, handed to {@link verifyCells}. */
export interface P9Matching {
  /** Passing-case counts per matchable name, from the ledger's report parser. */
  readonly matchCounts?: ReadonlyMap<string, number>
  /** The rename register, keyed `epic|stage|oldTitle`. */
  readonly renames?: ReadonlyMap<string, string>
}

/** The repository reads {@link staleCells} depends on. */
export interface P9Git {
  /**
   * The freeze entries in one commit's tree.
   * @returns them, or `undefined` when the tree cannot be read.
   */
  freezeAt(sha: string): readonly P9FreezeEntry[] | undefined
  /**
   * The paths that differ between a commit and HEAD.
   * @returns them, or `undefined` when the comparison fails.
   */
  changedPaths(sha: string, paths: readonly string[]): readonly string[] | undefined
}

/** A recorded VERIFIED cell that no longer describes the current tree. */
export interface P9StaleCell {
  readonly epic: string
  readonly stage: string
  readonly reason: string
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

/**
 * Verify every frozen P9 cell against one observation.
 * @param freeze - the command freeze.
 * @param passing - case names observed passing.
 * @param p9Ids - every P9 epic id.
 * @param releasedEpics - the epics authorized to start; `undefined` authorizes all.
 * @param stageBlockers - stages parked on a recorded blocker.
 * @param matching - the ledger's matching rules; omitted, a title matches only by exact string.
 * @returns one record per (epic, stage).
 */
export function verifyCells(
  freeze: P9Freeze,
  passing: ReadonlySet<string>,
  p9Ids: readonly string[],
  releasedEpics?: ReadonlySet<string>,
  stageBlockers?: readonly P9StageBlocker[],
  matching?: P9Matching,
): P9Cell[]

/**
 * Every repository path a freeze entry's observation depends on.
 * @param entry - a command-freeze entry.
 * @returns the files it names and the test paths its command runs.
 */
export function referencedPaths(entry: P9FreezeEntry): string[]

/**
 * Which recorded VERIFIED cells no longer describe the tree this runs in.
 * @param record - the recorded verification.
 * @param freeze - the command freeze as it is now.
 * @param git - the repository reads the decision depends on.
 * @returns one entry per stale cell, with the reason.
 */
export function staleCells(record: P9Record, freeze: P9Freeze, git: P9Git): P9StaleCell[]
