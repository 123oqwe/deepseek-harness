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

/**
 * Throw when a freeze entry carries `supplementSeq` without `supplements`, the reverse, or a null `supplements` (BLOCKED-161).
 * @param entries - the command-freeze entries.
 */
export function assertSupplementKeysAgree(entries: readonly unknown[]): void

export function checkCandidateChainConsistency(row: unknown, applicableStages: string[], gitRoot?: string): CandidateChainResult

export function checkObservationDistinctness(row: unknown, applicableStages: string[], freeze: unknown, epicId: string): ObservationDistinctnessResult

/** One consumer of an observation digest: its label and the frozen entry it is judged against (`undefined` when unresolvable). */
export interface ObservationConsumer {
  label: string
  frozen: unknown
}

/**
 * Every observation digest recorded on a cell or a non-SUPERSEDED supplement record.
 * @param rows - the ledger rows, keyed by epic id.
 * @param freeze - the command freeze.
 * @returns each digest mapped to its consumers.
 */
export function usedObservationDigests(rows: Record<string, unknown>, freeze: unknown): Map<string, ObservationConsumer[]>

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

/** One ledger supplement row, as the liveness derivation reads and stamps it. */
export interface LedgerSupplementRow {
  status: string
  supersededBy?: string
}

/** One command-freeze entry, as the liveness derivation reads it. */
export interface FreezeLivenessEntry {
  epic: string
  stage: string
  supplementSeq?: number
  supersededBy?: string
}

/**
 * Stamp every ledger supplement whose freeze entry has been superseded, so the
 * row cannot outlive the entry it observed (§12.61).
 * @param rows - the ledger rows about to be written, mutated in place.
 * @param freezeEntries - the command-freeze entries, the authority on liveness.
 */
export function deriveSupplementLiveness(
  rows: Record<string, { id: string; supplements?: Record<string, LedgerSupplementRow> }>,
  freezeEntries: readonly FreezeLivenessEntry[],
): void

/** Predicate (vi): an epic with an open finding may not be accepted (§12.63). */
export function checkNoOpenFindings(row: { openFindings?: readonly string[] | null }): {
  valid: boolean
  open: readonly string[]
}

/** One Ajv validation error, narrowed to the fields the caller reports. */
export interface AcceptanceCoverageSchemaError {
  instancePath: string
  message?: string | undefined
  params: Record<string, unknown>
}

/** BLOCKED-206: validate acceptance-coverage.json against its own 2020-12 schema. */
export function validateAcceptanceCoverage(
  schema: unknown,
  coverage: unknown,
): { valid: boolean; errors: readonly AcceptanceCoverageSchemaError[] }

/** Whether a report is tied to a candidate, and why not when it is refused. */
export interface ReportDirVerdict {
  ok: boolean
  reason?: string
}

/**
 * Whether a report's parent directory name carries a commit token tied to the
 * candidate being greened: a run of at least 10 lowercase hex characters, not
 * all digits, that is a prefix of the candidate or names a local commit the
 * candidate is an ancestor of. Reads only local git objects.
 * @param reportPath - the `--report` argument.
 * @param candidateSha - the 40-hex `--candidate-sha` argument.
 * @param gitRoot - repository whose objects resolve a token; defaults to this repository.
 * @returns `{ ok: true }`, or `{ ok: false, reason }` naming why the report is refused.
 */
export function reportDirMatchesCandidate(reportPath: string, candidateSha: string, gitRoot?: string): ReportDirVerdict

/** One EXEC-STATE digest that no longer matches its file. `recorded` is `undefined` when the digest is absent. */
export interface ExecStateDigestDrift {
  field: 'ledgerDigest' | 'registryDigest' | 'freezeDigest'
  recorded: string | undefined
  actual: string
}

/**
 * EXEC-STATE digests that no longer match the files they name; an absent digest is reported.
 * @param state - the parsed `EXEC-STATE.json`.
 * @param bytes - the current contents of the ledger, the registry and the command freeze.
 * @returns one entry per digest that differs from its file or is absent.
 */
export function execStateDigestDrift(
  state: { ledgerDigest?: string, registryDigest?: string, freezeDigest?: string },
  bytes: { ledger: string | Uint8Array, registry: string | Uint8Array, freeze: string | Uint8Array },
): ExecStateDigestDrift[]

/** One epic-state gate finding for the epic being accepted. */
export interface AcceptPreflightFinding {
  gate: string
  text: string
}

/** The epic-state gates' results, in the fields `acceptPreflightFindings` reads. */
export interface AcceptPreflightResults {
  makeVsUse: { findings: readonly { epic: string; text: string }[]; control: string | undefined }
  candidateTree: { missing: readonly { epic: string; text: string }[]; unreadable: readonly { epic: string; text: string }[] }
  adaptDispositions: { unrecorded: readonly { id: string; missing: readonly string[] }[] }
  missingFreezeFiles: readonly { label: string; path: string }[]
}

/**
 * The epic-state gate findings of one epic, which `--accept` refuses on; a make-vs-use scan that found nothing blocks every epic.
 * @param epic - the epic id being accepted.
 * @param results - the gates' results.
 * @returns one `{ gate, text }` per finding for this epic.
 */
export function acceptPreflightFindings(epic: string, results: AcceptPreflightResults): AcceptPreflightFinding[]

/** A vitest `--reporter=json` document, in the fields the ledger tools read. */
export interface VitestJsonReport {
  readonly success?: boolean
  readonly testResults?: readonly {
    readonly assertionResults?: readonly {
      readonly title: string
      readonly fullName?: string
      readonly status: string
    }[]
  }[]
}

/**
 * Read one vitest JSON report into the names a frozen case can match.
 *
 * `titles` and `matchCounts` count passing cases only and carry both the bare
 * `title` and the `fullName`; a bare title shared by several cases counts once per
 * case, which is what `findAmbiguousCaseMatches` reads. `exit` is 0 when the
 * report says `success: true`, otherwise 1.
 * @param reportPath - the report on disk.
 * @returns the raw text, the parsed document, the matchable names and their counts, the failed full names, and the exit.
 */
export function parseVitestJsonReport(reportPath: string): {
  raw: string
  report: VitestJsonReport
  titles: Set<string>
  matchCounts: Map<string, number>
  failedFullNames: Set<string>
  exit: 0 | 1
}
