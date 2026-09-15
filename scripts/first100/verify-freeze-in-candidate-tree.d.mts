/**
 * Types for `verify-freeze-in-candidate-tree.mjs`: acceptance predicate (v) as functions.
 */

/** A freeze entry, in the fields this check reads. */
export interface CandidateTreeFreezeEntry {
  epic: string
  stage: string
  supplementSeq?: number
  expectCases?: readonly string[]
  supersededBy?: unknown
}

/** A cell or supplement the ledger records as GREEN at a candidate commit. */
export interface CandidateTreeCell {
  status?: string
  candidateSha?: string
}

/** One line about a GREEN cell or supplement, with its epic. */
export interface CandidateTreeFinding {
  epic: string
  text: string
}

export function freezeEntriesAt(sha: string): CandidateTreeFreezeEntry[] | undefined

export const commitmentKey: (entry: CandidateTreeFreezeEntry) => string

export function candidateTreeFindings(
  rows: Readonly<Record<string, { cells?: Readonly<Record<string, CandidateTreeCell>>; supplements?: Readonly<Record<string, CandidateTreeCell>> }>>,
  live: readonly CandidateTreeFreezeEntry[],
  freezeAt?: (sha: string) => readonly CandidateTreeFreezeEntry[] | undefined,
): { verified: string[]; missing: CandidateTreeFinding[]; unreadable: CandidateTreeFinding[] }
