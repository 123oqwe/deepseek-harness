import { describe, it, expect, beforeEach } from 'vitest'
import { RepairCoordinator, checkBudget, canMarkCheckAsOptional, determineOutcome } from '../src/index.ts'
import type { RepairAction } from '../src/types.ts'

function makeAction(id: string, kind: RepairAction['kind'] = 'retry', canRepeat = false): RepairAction {
  return { actionId: id, kind, reason: 'test', canRepeatExternalEffect: canRepeat }
}

describe('P7-06 Bounded Repair/Replan Loop', () => {
  let coordinator: RepairCoordinator

  beforeEach(() => { coordinator = new RepairCoordinator() })

  it('creates a repair plan with budget', () => {
    const plan = coordinator.createPlan(['check-1'], [makeAction('a1')], 3)
    expect(plan.maxRounds).toBe(3)
    expect(plan.budget.maxTokens).toBeGreaterThan(0)
    expect(plan.budget.maxExternalWrites).toBeGreaterThan(0)
  })

  it('executes repair round', async () => {
    const plan = coordinator.createPlan(['c1'], [makeAction('a1')])
    const result = await coordinator.executeRound(plan.planId,
      async () => ({ success: true, tokensUsed: 100, timeMs: 50, externalWrite: false }))
    expect(result.actionsExecuted).toContain('a1')
    expect(result.outcome).toBe('repaired')
  })

  it('does not repeat non-repeatable external effects', async () => {
    const plan = coordinator.createPlan(['c1'], [makeAction('a1', 'retry', false)])
    await coordinator.executeRound(plan.planId,
      async () => ({ success: true, tokensUsed: 10, timeMs: 5, externalWrite: false }))
    const result2 = await coordinator.executeRound(plan.planId,
      async () => ({ success: true, tokensUsed: 10, timeMs: 5, externalWrite: false }))
    expect(result2.actionsExecuted).not.toContain('a1')
  })

  it('budget exhaustion stops repair', async () => {
    const plan = coordinator.createPlan(['c1'], [makeAction('a1')], 1)
    await coordinator.executeRound(plan.planId, async () => ({ success: false, tokensUsed: 10, timeMs: 5, externalWrite: false }))
    const result = await coordinator.executeRound(plan.planId,
      async () => ({ success: true, tokensUsed: 10, timeMs: 5, externalWrite: false }))
    expect(result.outcome).toBe('budget-exhausted')
  })

  it('cannot mark failed check as optional', () => {
    const result = canMarkCheckAsOptional('check-1')
    expect(result.allowed).toBe(false)
  })

  it('determines correct outcomes', () => {
    expect(determineOutcome(true, false, false)).toBe('repaired')
    expect(determineOutcome(false, true, false)).toBe('budget-exhausted')
    expect(determineOutcome(false, false, true)).toBe('needs-human')
    expect(determineOutcome(false, false, false)).toBe('rejected')
  })

  it('human-takeover action triggers needs-human', () => {
    const plan = coordinator.createPlan(['c1'], [makeAction('a1', 'human-takeover')])
    const outcome = coordinator.finalize(plan.planId, false)
    expect(outcome).toBe('needs-human')
  })

  it('tracks external writes per action', async () => {
    const plan = coordinator.createPlan(['c1'], [makeAction('a1', 'retry', true)], 5, { maxTokens: 100000, maxTimeMs: 300000, maxExternalWrites: 2 })
    await coordinator.executeRound(plan.planId, async () => ({ success: false, tokensUsed: 10, timeMs: 5, externalWrite: true }))
    await coordinator.executeRound(plan.planId, async () => ({ success: false, tokensUsed: 10, timeMs: 5, externalWrite: true }))
    const tracker = coordinator.getTracker(plan.planId)!
    expect(tracker.externalWritesUsed).toBe(2)
  })

  it('budget check detects token exhaustion', () => {
    const plan = coordinator.createPlan(['c1'], [makeAction('a1')], 10, { maxTokens: 100, maxTimeMs: 300000, maxExternalWrites: 10 })
    const result = checkBudget(plan, { roundsUsed: 0, tokensUsed: 200, timeUsedMs: 0, externalWritesUsed: 0 })
    expect(result.exhausted).toBe(true)
  })

  it('finalizes as repaired when all checks pass', () => {
    const plan = coordinator.createPlan(['c1'], [makeAction('a1')])
    const outcome = coordinator.finalize(plan.planId, true)
    expect(outcome).toBe('repaired')
  })
})
