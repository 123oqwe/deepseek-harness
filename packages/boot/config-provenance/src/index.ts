import { createHash } from 'node:crypto'
import type { ConfigSource, DryRunResult, MigrationPlan, DRGateResult, DRGateReport } from './types.ts'

export type { ConfigSource, DryRunResult, MigrationPlan, DRGateResult, DRGateReport } from './types.ts'

export class ConfigProvenanceManager {
  private sources: ConfigSource[] = []
  private migrations: MigrationPlan[] = []
  private drResults: DRGateReport[] = []

  recordSource(layer: string, file: string, content: string): ConfigSource {
    const source: ConfigSource = {
      layer, file, hash: createHash('sha256').update(content).digest('hex'),
      appliedAt: Date.now(),
    }
    this.sources.push(source)
    return source
  }

  getSources(): readonly ConfigSource[] {
    return this.sources
  }

  getProvenanceDiff(before: string, after: string): { changed: boolean; addedLayers: string[]; removedLayers: string[] } {
    const beforeSources = this.sources.filter(s => s.appliedAt < parseInt(before))
    const afterSources = this.sources.filter(s => s.appliedAt < parseInt(after))
    const beforeLayers = new Set(beforeSources.map(s => s.layer))
    const afterLayers = new Set(afterSources.map(s => s.layer))
    return {
      changed: beforeLayers.size !== afterLayers.size || [...beforeLayers].some(l => !afterLayers.has(l)),
      addedLayers: [...afterLayers].filter(l => !beforeLayers.has(l)),
      removedLayers: [...beforeLayers].filter(l => !afterLayers.has(l)),
    }
  }

  dryRun(configId: string, changes: { path: string; before: unknown; after: unknown }[]): DryRunResult {
    const warnings: string[] = []
    for (const change of changes) {
      if (change.path.includes('trust-kernel')) warnings.push('Trust kernel modification requires approval')
      if (change.path.includes('tenant-boundary')) warnings.push('Tenant boundary change detected')
    }
    return {
      configId, changes, warnings,
      safe: warnings.length === 0,
    }
  }

  createMigration(fromVersion: string, toVersion: string, steps: { description: string; reversible: boolean }[]): MigrationPlan {
    const plan: MigrationPlan = {
      fromVersion, toVersion, steps,
      rollbackPossible: steps.every(s => s.reversible),
    }
    this.migrations.push(plan)
    return plan
  }

  getMigrations(): readonly MigrationPlan[] {
    return this.migrations
  }

  runDRGate(checks: { name: string; passed: boolean; detail: string }[]): DRGateReport {
    const allPassed = checks.every(c => c.passed)
    const result: DRGateResult = allPassed ? 'pass' : checks.some(c => !c.passed && c.name.includes('approval')) ? 'needs-human' : 'fail'
    const report: DRGateReport = {
      result, checks,
      runRecoveryTested: checks.some(c => c.name.includes('run-recovery') && c.passed),
      approvalBackupTested: checks.some(c => c.name.includes('approval-backup') && c.passed),
      artifactBackupTested: checks.some(c => c.name.includes('artifact-backup') && c.passed),
    }
    this.drResults.push(report)
    return report
  }

  getDRResults(): readonly DRGateReport[] {
    return this.drResults
  }

  clear(): void {
    this.sources = []
    this.migrations = []
    this.drResults = []
  }
}
