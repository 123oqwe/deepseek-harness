import { describe, it, expect, beforeEach } from 'vitest'
import { ConfigProvenanceManager } from '../src/index.ts'

describe('P8-10 Config Provenance & DR Gate', () => {
  let mgr: ConfigProvenanceManager

  beforeEach(() => { mgr = new ConfigProvenanceManager() })

  it('records config sources with hashes', () => {
    mgr.recordSource('base', 'config.yaml', 'content')
    expect(mgr.getSources()).toHaveLength(1)
    expect(mgr.getSources()[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('dry-run detects trust kernel changes', () => {
    const result = mgr.dryRun('c1', [{ path: 'trust-kernel/key', before: 'old', after: 'new' }])
    expect(result.safe).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('dry-run allows safe changes', () => {
    const result = mgr.dryRun('c1', [{ path: 'ui/theme', before: 'dark', after: 'light' }])
    expect(result.safe).toBe(true)
  })

  it('creates migration plan with rollback check', () => {
    const plan = mgr.createMigration('1.0', '2.0', [
      { description: 'add field', reversible: true },
      { description: 'rename column', reversible: false },
    ])
    expect(plan.rollbackPossible).toBe(false)
  })

  it('migration with all reversible steps allows rollback', () => {
    const plan = mgr.createMigration('1.0', '1.1', [
      { description: 'add index', reversible: true },
    ])
    expect(plan.rollbackPossible).toBe(true)
  })

  it('DR gate passes when all checks pass', () => {
    const report = mgr.runDRGate([
      { name: 'run-recovery', passed: true, detail: 'ok' },
      { name: 'approval-backup', passed: true, detail: 'ok' },
      { name: 'artifact-backup', passed: true, detail: 'ok' },
    ])
    expect(report.result).toBe('pass')
    expect(report.runRecoveryTested).toBe(true)
  })

  it('DR gate fails when checks fail', () => {
    const report = mgr.runDRGate([
      { name: 'run-recovery', passed: true, detail: 'ok' },
      { name: 'approval-backup', passed: false, detail: 'missing' },
    ])
    expect(report.result).toBe('needs-human')
  })

  it('DR gate tracks history', () => {
    mgr.runDRGate([{ name: 'run-recovery', passed: true, detail: 'ok' }])
    mgr.runDRGate([{ name: 'run-recovery', passed: false, detail: 'fail' }])
    expect(mgr.getDRResults()).toHaveLength(2)
  })
})
