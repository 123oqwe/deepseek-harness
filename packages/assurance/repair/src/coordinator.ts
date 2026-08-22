import { randomUUID } from 'node:crypto'
import type { RepairPlan, RepairAction, RepairBudgetTracker, RepairOutcome } from './types.ts'
import { checkBudget, determineOutcome } from './policy.ts'

export class RepairCoordinator {
  private plans = new Map<string, RepairPlan>()
  private trackers = new Map<string, RepairBudgetTracker>()
  private executedActions = new Map<string, Set<string>>()
  private externalWritesByAction = new Map<string, number>()

  createPlan(
    failedChecks: readonly string[],
    actions: readonly RepairAction[],
    maxRounds = 3,
    budget = { maxTokens: 100000, maxTimeMs: 300000, maxExternalWrites: 10 },
  ): RepairPlan {
    const plan: RepairPlan = {
      planId: `repair-${randomUUID().slice(0, 12)}`,
      failedChecks,
      actions,
      maxRounds,
      budget,
    }
    this.plans.set(plan.planId, plan)
    this.trackers.set(plan.planId, { roundsUsed: 0, tokensUsed: 0, timeUsedMs: 0, externalWritesUsed: 0 })
    this.executedActions.set(plan.planId, new Set())
    return plan
  }

  getPlan(planId: string): RepairPlan | undefined {
    return this.plans.get(planId)
  }

  getTracker(planId: string): RepairBudgetTracker | undefined {
    return this.trackers.get(planId)
  }

  async executeRound(
    planId: string,
    executeFn: (action: RepairAction) => Promise<{ success: boolean; tokensUsed: number; timeMs: number; externalWrite: boolean }>,
  ): Promise<{ outcome: RepairOutcome; actionsExecuted: string[]; reason: string }> {
    const plan = this.plans.get(planId)
    const tracker = this.trackers.get(planId)
    if (!plan || !tracker) {
      return { outcome: 'rejected', actionsExecuted: [], reason: 'Plan not found' }
    }

    const budgetCheck = checkBudget(plan, tracker)
    if (budgetCheck.exhausted) {
      return { outcome: determineOutcome(false, true, false), actionsExecuted: [], reason: budgetCheck.reason }
    }

    tracker.roundsUsed++
    const executed: string[] = []
    const executedSet = this.executedActions.get(planId)
    if (!executedSet) return { outcome: 'rejected', actionsExecuted: [], reason: 'Internal error' }

    for (const action of plan.actions) {
      if (executedSet.has(action.actionId) && !action.canRepeatExternalEffect) {
        continue
      }

      if (action.canRepeatExternalEffect) {
        const writes = this.externalWritesByAction.get(action.actionId) ?? 0
        if (writes >= plan.budget.maxExternalWrites) {
          continue
        }
      }

      const result = await executeFn(action)
      tracker.tokensUsed += result.tokensUsed
      tracker.timeUsedMs += result.timeMs
      if (result.externalWrite) {
        tracker.externalWritesUsed++
        this.externalWritesByAction.set(action.actionId, (this.externalWritesByAction.get(action.actionId) ?? 0) + 1)
      }
      if (result.success) {
        executedSet.add(action.actionId)
      }

      executed.push(action.actionId)
    }

    return {
      outcome: 'repaired',
      actionsExecuted: executed,
      reason: 'Round executed',
    }
  }

  finalize(planId: string, allChecksPass: boolean): RepairOutcome {
    const plan = this.plans.get(planId)
    const tracker = this.trackers.get(planId)
    if (!plan || !tracker) return 'rejected'

    const budgetCheck = checkBudget(plan, tracker)
    const hasHumanTakeover = plan.actions.some(a => a.kind === 'human-takeover')
    return determineOutcome(allChecksPass, budgetCheck.exhausted, hasHumanTakeover)
  }

  clear(): void {
    this.plans.clear()
    this.trackers.clear()
    this.executedActions.clear()
    this.externalWritesByAction.clear()
  }
}
