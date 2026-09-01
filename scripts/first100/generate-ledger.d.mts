/**
 * Declaration file for the exported pure predicates in `generate-ledger.mjs`
 * (maintainer decision BLOCKED-004/BLOCKED-005, 2026-09-01), consumed only by
 * `generate-ledger.spec.ts`. The CLI script itself stays plain `.mjs` --
 * this does not type the whole module, only what tests import.
 */
export interface CoverageClosureCitation {
  stage: 'C' | 'P' | 'U' | 'F'
  title: string
  supplementSeq?: number
}

export interface CoverageClosureResult {
  valid: boolean
  missingIndices: number[]
  unverifiedCitations: (CoverageClosureCitation & { acceptanceIndex: number })[]
}

export interface CandidateChainResult {
  valid: boolean
  candidateShas: string[]
  divergentPairs: [string, string][]
}

export interface ObservationDistinctnessResult {
  valid: boolean
  conflicts: [string, string][]
}

export function checkCoverageClosure(
  epicId: string,
  registry: unknown,
  freeze: unknown,
  coverage: unknown,
  row: unknown,
): CoverageClosureResult

export function checkCandidateChainConsistency(row: unknown, applicableStages: string[]): CandidateChainResult

export function checkObservationDistinctness(row: unknown, applicableStages: string[]): ObservationDistinctnessResult
