import type { RepairPlan, RepairBudgetTracker, RepairOutcome } from './types.ts'

export function checkBudget(plan: RepairPlan, tracker: RepairBudgetTracker): { exhausted: boolean; reason: string } {
  if (tracker.roundsUsed >= plan.maxRounds) {
    return { exhausted: true, reason: `Max rounds (${plan.maxRounds}) reached` }
  }
  if (tracker.tokensUsed >= plan.budget.maxTokens) {
    return { exhausted: true, reason: `Token budget (${plan.budget.maxTokens}) exhausted` }
  }
  if (tracker.timeUsedMs >= plan.budget.maxTimeMs) {
    return { exhausted: true, reason: `Time budget (${plan.budget.maxTimeMs}ms) exhausted` }
  }
  if (tracker.externalWritesUsed >= plan.budget.maxExternalWrites) {
    return { exhausted: true, reason: `External write budget (${plan.budget.maxExternalWrites}) exhausted` }
  }
  return { exhausted: false, reason: 'Budget available' }
}

export function canMarkCheckAsOptional(failedCheckId: string): { allowed: boolean; reason: string } {
  return { allowed: false, reason: `Cannot mark failed check ${failedCheckId} as optional to bypass verification` }
}

export function requiresPlanAmendment(plan: RepairPlan): boolean {
  return plan.planAmendment !== undefined
}

export function determineOutcome(
  allChecksPass: boolean,
  budgetExhausted: boolean,
  hasHumanTakeover: boolean,
): RepairOutcome {
  if (hasHumanTakeover) return 'needs-human'
  if (budgetExhausted && !allChecksPass) return 'budget-exhausted'
  if (budgetExhausted) return 'needs-human'
  if (allChecksPass) return 'repaired'
  return 'rejected'
}
