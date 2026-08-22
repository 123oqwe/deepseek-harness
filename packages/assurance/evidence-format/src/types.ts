/**
  * Evidence format types for release evidence packages.
  *
  * @module @deepseek-ai/dsh-evidence-format
  */


/** A hash of a file or artifact, using SHA-256. */
export type Digest = string

/** Result of a single gate execution. */
export interface GateResult {
  /** Gate name (e.g. 'test', 'typecheck', 'lint'). */
  readonly gate: string
  /** Command that was run. */
  readonly command: string
  /** ISO timestamp when the gate started. */
  readonly startedAt: string
  /** ISO timestamp when the gate finished. */
  readonly finishedAt: string
  /** Process exit code. */
  readonly exitCode: number
  /** Whether this is a blocking gate. */
  readonly blocking: boolean
  /** Number of tests run (if applicable). */
  readonly testCount?: number
  /** Number of tests passed. */
  readonly testsPassed?: number
  /** Reason the gate was skipped, if any. */
  readonly skipReason?: string
  /** SHA-256 digest of the stdout log. */
  readonly stdoutDigest?: string
  /** SHA-256 digest of the stderr log. */
  readonly stderrDigest?: string
  /** Whether the gate was accepted (passed and not skipped). */
  readonly accepted: boolean
}

/** A complete release evidence package. */
export interface EvidencePackage {
  /** ISO timestamp of evidence collection. */
  readonly collectedAt: string
  /** Git SHA the evidence was collected from. */
  readonly gitSha: string
  /** Git diff summary at collection time. */
  readonly gitDiffSummary: string
  /** Baseline fingerprint digest. */
  readonly baselineFingerprint?: string
  /** Results of all gates. */
  readonly gates: GateResult[]
  /** Digests of build artifacts. */
  readonly buildArtifactDigests: Record<string, string>
  /** Whether the entire package is accepted. */
  readonly accepted: boolean
  /** SHA-256 digest of the entire package (computed at finalization). */
  readonly packageDigest?: string
}

/** Error thrown when evidence verification fails. */
export class EvidenceVerificationError extends Error {
  readonly failures: string[]
  constructor(failures: string[]) {
    super(`Evidence verification failed:\n${failures.map(f => `  - ${f}`).join('\\n')}`)
    this.name = 'EvidenceVerificationError'
    this.failures = failures
  }
}
