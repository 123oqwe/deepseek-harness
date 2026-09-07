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

export function checkCandidateChainConsistency(row: unknown, applicableStages: string[], gitRoot?: string): CandidateChainResult

export function checkObservationDistinctness(row: unknown, applicableStages: string[], freeze: unknown, epicId: string): ObservationDistinctnessResult

export interface FlakeRegistryCheckResult {
  valid: boolean
  unregisteredFailures: string[]
  absorbedFlakes: string[]
}

export function checkFailureSetAgainstFlakeRegistry(failedFullNames: Set<string>, registry: unknown): FlakeRegistryCheckResult

/** Frozen case strings a single entry names more than once (BLOCKED-104). */
export function findDuplicateFrozenCases(expectCases: readonly string[]): { title: string, count: number }[]

/** Frozen case strings that name more than one passing case (BLOCKED-104). */
export function findAmbiguousCaseMatches(
  expectCases: readonly string[],
  matchCounts: ReadonlyMap<string, number>,
): { title: string, count: number }[]

export interface DelegateSignoffEntry {
  epic: string
  rowDigestSha256: string
  /** 'PASS' or 'WITHDRAWN'; the LAST entry for an epic decides. */
  conclusion: string
  /** Required on a WITHDRAWN entry: what the sign-off rested on that no longer holds. */
  reason?: string
  delegateSession?: string
  signedAtUtc?: string
  userConfirmationRef?: string
  note?: string
}

export interface DelegateSignoffResult {
  valid: boolean
  reason: 'missing' | 'stale' | 'missing-user-confirmation-ref' | null
  currentRowDigest: string
  matchedEntry?: DelegateSignoffEntry
}

export function rowDigest(row: unknown): string

export interface Reattestation {
  fromCiRunUrl: string
  fromCandidateSha?: string
  reason: string
  atUtc: string
}

export function reattestationOf(
  priorCell: { ciRunUrl?: string; candidateSha?: string } | undefined,
  ciRunUrl: string,
  reason: string | undefined,
  atUtc: string,
): Reattestation | undefined

export function checkDelegateSignoff(
  epicId: string,
  row: unknown,
  signoffRegistry: unknown,
  userConfirmationTierEpics?: Set<string>,
): DelegateSignoffResult

/**
 * Whether every P9 item has reached a state the program's goal admits —
 * VERIFIED or scheduled-BLOCKED. An empty record is not settled.
 * @param p9 - the recorded per-item terminal states.
 * @returns whether every item is settled.
 */
export function p9ItemsSettled(p9: readonly { terminalState: string }[]): boolean

export interface RedStep {
  step: string
  failingCases: readonly string[]
  evidence: string
  subjectPaths: readonly string[]
}

export function redStepComplaints(steps: unknown): string[]
