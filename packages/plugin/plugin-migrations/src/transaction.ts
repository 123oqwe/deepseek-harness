import type { MigrationPlan, MigrationStep } from './types.ts'

export type MigrationState = 'frozen' | 'snapshot' | 'migrating' | 'validating' | 'switching' | 'health-check' | 'completed' | 'rolled-back' | 'failed'

export interface MigrationTransaction {
  readonly id: string
  readonly plan: MigrationPlan
  readonly state: MigrationState
  readonly startedAt: string
  readonly completedAt?: string
  readonly snapshotPath?: string
  readonly failureReason?: string
}

export function beginMigration(plan: MigrationPlan): MigrationTransaction {
  return { id: crypto.randomUUID(), plan, state: 'frozen', startedAt: new Date().toISOString() }
}

export function snapshot(tx: MigrationTransaction, path: string): MigrationTransaction {
  if (tx.state !== 'frozen') throw new Error(`Cannot snapshot: state is ${tx.state}`)
  return { ...tx, state: 'snapshot', snapshotPath: path }
}

export function migrate(tx: MigrationTransaction): MigrationTransaction {
  if (tx.state !== 'snapshot') throw new Error(`Cannot migrate: state is ${tx.state}`)
  return { ...tx, state: 'migrating' }
}

export function validate(tx: MigrationTransaction): MigrationTransaction {
  if (tx.state !== 'migrating') throw new Error(`Cannot validate: state is ${tx.state}`)
  return { ...tx, state: 'validating' }
}

export function atomicSwitch(tx: MigrationTransaction): MigrationTransaction {
  if (tx.state !== 'validating') throw new Error(`Cannot switch: state is ${tx.state}`)
  return { ...tx, state: 'switching' }
}

export function healthCheck(tx: MigrationTransaction, passed: boolean): MigrationTransaction {
  if (tx.state !== 'switching') throw new Error(`Cannot health check: state is ${tx.state}`)
  if (passed) {
    return { ...tx, state: 'completed', completedAt: new Date().toISOString() }
  }
  return { ...tx, state: 'failed', failureReason: 'health check failed' }
}

export function rollbackMigration(tx: MigrationTransaction, reason: string): MigrationTransaction {
  return { ...tx, state: 'rolled-back', completedAt: new Date().toISOString(), failureReason: reason }
}

export function canRollback(plan: MigrationPlan): boolean {
  return plan.steps.every(s => s.rollbackSupported)
}
