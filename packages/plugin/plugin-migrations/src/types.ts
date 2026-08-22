export interface MigrationStep {
  readonly fromVersion: string
  readonly toVersion: string
  readonly preconditions: string[]
  readonly backupStrategy: 'snapshot' | 'copy' | 'none'
  readonly rollbackSupported: boolean
}

export interface MigrationPlan {
  readonly pluginId: string
  readonly currentVersion: string
  readonly targetVersion: string
  readonly steps: MigrationStep[]
}
