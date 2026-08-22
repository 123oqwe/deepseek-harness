import { describe, it, expect } from 'vitest'
import { beginMigration, snapshot, migrate, validate, atomicSwitch, healthCheck, rollbackMigration, canRollback, type MigrationPlan } from '../src/index.ts'

const plan: MigrationPlan = {
  pluginId: 'test-plugin',
  currentVersion: '1.0.0',
  targetVersion: '2.0.0',
  steps: [
    { fromVersion: '1.0.0', toVersion: '1.1.0', preconditions: ['data-backed-up'], backupStrategy: 'snapshot', rollbackSupported: true },
    { fromVersion: '1.1.0', toVersion: '2.0.0', preconditions: [], backupStrategy: 'copy', rollbackSupported: true },
  ],
}

describe('P1-10 Plugin Migrations', () => {
  it('begins migration in frozen state', () => {
    const tx = beginMigration(plan)
    expect(tx.state).toBe('frozen')
  })

  it('full migration lifecycle', () => {
    let tx = beginMigration(plan)
    tx = snapshot(tx, '/tmp/snapshot')
    tx = migrate(tx)
    tx = validate(tx)
    tx = atomicSwitch(tx)
    tx = healthCheck(tx, true)
    expect(tx.state).toBe('completed')
    expect(tx.completedAt).toBeTruthy()
  })

  it('fails on health check failure', () => {
    let tx = beginMigration(plan)
    tx = snapshot(tx, '/tmp/snap')
    tx = migrate(tx)
    tx = validate(tx)
    tx = atomicSwitch(tx)
    tx = healthCheck(tx, false)
    expect(tx.state).toBe('failed')
    expect(tx.failureReason).toContain('health check')
  })

  it('rollback restores previous state', () => {
    let tx = beginMigration(plan)
    tx = snapshot(tx, '/tmp/snap')
    tx = migrate(tx)
    tx = rollbackMigration(tx, 'migration failed')
    expect(tx.state).toBe('rolled-back')
  })

  it('canRollback checks all steps', () => {
    expect(canRollback(plan)).toBe(true)
    const noRollback: MigrationPlan = { ...plan, steps: [{ ...plan.steps[0]!, rollbackSupported: false }] }
    expect(canRollback(noRollback)).toBe(false)
  })

  it('rejects invalid state transitions', () => {
    const tx = beginMigration(plan)
    expect(() => migrate(tx)).toThrow('Cannot migrate')
  })
})
