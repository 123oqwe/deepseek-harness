export interface ConfigSource {
  readonly layer: string
  readonly file: string
  readonly hash: string
  readonly appliedAt: number
}

export interface DryRunResult {
  readonly configId: string
  readonly changes: readonly { path: string; before: unknown; after: unknown }[]
  readonly warnings: readonly string[]
  readonly safe: boolean
}

export interface MigrationPlan {
  readonly fromVersion: string
  readonly toVersion: string
  readonly steps: readonly { description: string; reversible: boolean }[]
  readonly rollbackPossible: boolean
}

export type DRGateResult = 'pass' | 'fail' | 'needs-human'

export interface DRGateReport {
  readonly result: DRGateResult
  readonly checks: { name: string; passed: boolean; detail: string }[]
  readonly runRecoveryTested: boolean
  readonly approvalBackupTested: boolean
  readonly artifactBackupTested: boolean
}
