export type Severity = 'blocking' | 'review' | 'informational'
export type ScanPhase = 'static' | 'dynamic'

export interface ScanFinding {
  readonly rule: string
  readonly severity: Severity
  readonly phase: ScanPhase
  readonly file: string
  readonly line?: number
  readonly description: string
  readonly ruleVersion: string
}

export interface ScanResult {
  readonly findings: readonly ScanFinding[]
  readonly passed: boolean
  readonly timedOut: boolean
  readonly crashed: boolean
  readonly durationMs: number
}

export interface ScanRule {
  readonly id: string
  readonly version: string
  readonly severity: Severity
  readonly phase: ScanPhase
  readonly description: string
}
