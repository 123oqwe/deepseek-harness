import { describe, it, expect, beforeEach } from 'vitest'
import { ReconciliationEngine } from '../src/engine.ts'
import type { CompensatableAction } from '../src/types.ts'
import { SagaCoordinator } from '../../compensation/src/index.ts'
import type { SagaStep } from '../../compensation/src/index.ts'

function makeAction(id: string, expected: unknown, reversible: boolean, observed: unknown, reachable = true): CompensatableAction {

  return {
    actionId: id,
    expected,
    reversible,
    observeState: async () => ({ actionId: id, observedState: observed, reachable }),
    compareExpected: (obs: unknown, exp: unknown) => JSON.stringify(obs) === JSON.stringify(exp),
    compensate: async () => {

      return { success: true, reason: 'Compensated successfully' }
    },
  }
}

describe('P4-13 Reconciliation Engine & Saga Compensation', () => {
  let engine: ReconciliationEngine

  beforeEach(() => {
    engine = new ReconciliationEngine()
  })

  it('reconciles matching states', async () => {
    engine.register(makeAction('a1', { status: 'done' }, true, { status: 'done' }))
    const result = await engine.reconcile(['a1'])
    expect(result.allMatched).toBe(true)
    expect(result.repairOptions).toHaveLength(0)
  })

  it('detects state mismatch', async () => {
    engine.register(makeAction('a1', { status: 'done' }, true, { status: 'pending' }))
    const result = await engine.reconcile(['a1'])
    expect(result.allMatched).toBe(false)
    expect(result.repairOptions[0]?.type).toBe('compensate')
  })

  it('marks irreversible actions for manual intervention', async () => {
    engine.register(makeAction('a1', { status: 'done' }, false, { status: 'pending' }))
    const result = await engine.reconcile(['a1'])
    expect(result.repairOptions[0]?.type).toBe('manual')
    expect(result.manualInterventionCount).toBe(1)
  })

  it('handles unreachable targets', async () => {
    engine.register(makeAction('a1', { status: 'done' }, true, null, false))
    const result = await engine.reconcile(['a1'])
    expect(result.diffs[0]?.description).toContain('unreachable')
    expect(result.repairOptions[0]?.type).toBe('retry')
  })

  it('compensates reversible actions', async () => {
    engine.register(makeAction('a1', { status: 'done' }, true, { status: 'pending' }))
    const result = await engine.compensate('a1')
    expect(result.success).toBe(true)
  })

  it('refuses to compensate irreversible actions', async () => {
    engine.register(makeAction('a1', { status: 'done' }, false, { status: 'pending' }))
    const result = await engine.compensate('a1')
    expect(result.success).toBe(false)
    expect(result.reason).toContain('manual intervention')
  })

  it('compensates all actions in batch', async () => {
    engine.register(makeAction('a1', { s: 'done' }, true, { s: 'pending' }))
    engine.register(makeAction('a2', { s: 'done' }, true, { s: 'pending' }))
    const result = await engine.compensateAll(['a1', 'a2'])
    expect(result.results).toHaveLength(2)
    expect(result.results.every(r => r.success)).toBe(true)
  })

  it('handles unregistered actions', async () => {
    const result = await engine.reconcile(['unknown'])
    expect(result.diffs[0]?.matched).toBe(false)
    expect(result.repairOptions[0]?.type).toBe('manual')
  })

  it('runs multi-step saga with failure at step 2', async () => {
    const saga = new SagaCoordinator()
    saga.addStep({ stepId: 's1', actionId: 'a1', reversible: true })
    saga.addStep({ stepId: 's2', actionId: 'a2', reversible: true })
    saga.addStep({ stepId: 's3', actionId: 'a3', reversible: true })

    const executeFn = async (step: SagaStep) => {
      if (step.stepId === 's2') return { success: false, reason: 'Failed at step 2' }
      return { success: true, reason: 'OK' }
    }
    const compensateFn = async () => ({ success: true, reason: 'Compensated' })

    const result = await saga.execute(executeFn, compensateFn)
    expect(result.completed).toContain('s1')
    expect(result.failed).toContain('s2')
    expect(result.compensated).toContain('s1')
  })

  it('handles compensation failure with secondary compensation', async () => {
    const saga = new SagaCoordinator()
    saga.addStep({ stepId: 's1', actionId: 'a1', reversible: true })
    saga.addStep({ stepId: 's2', actionId: 'a2', reversible: true })

    let compensateAttempts = 0
    const executeFn = async (step: SagaStep) => {
      if (step.stepId === 's2') return { success: false, reason: 'Failed' }
      return { success: true, reason: 'OK' }
    }
    const compensateFn = async () => {
      compensateAttempts++
      if (compensateAttempts === 1) return { success: false, reason: 'Compensation failed' }
      return { success: true, reason: 'Retry succeeded' }
    }

    const result = await saga.execute(executeFn, compensateFn)
    expect(result.compensated).toContain('s1')
    expect(result.failed).toContain('s2')
  })

  it('marks irreversible saga steps as manual intervention', async () => {
    const saga = new SagaCoordinator()
    saga.addStep({ stepId: 's1', actionId: 'a1', reversible: false })
    saga.addStep({ stepId: 's2', actionId: 'a2', reversible: true })

    const executeFn = async (step: SagaStep) => {
      if (step.stepId === 's2') return { success: false, reason: 'Failed' }
      return { success: true, reason: 'OK' }
    }
    const compensateFn = async () => ({ success: true, reason: 'OK' })

    const result = await saga.execute(executeFn, compensateFn)
    expect(result.manualIntervention).toContain('s1')
    expect(result.failed).toContain('s2')
  })
})
