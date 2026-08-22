export type RepairActionKind = 'retry' | 'rollback-redo' | 'alternate-model' | 'human-takeover'

export interface RepairAction {
  readonly actionId: string
  readonly kind: RepairActionKind
  readonly reason: string
  readonly canRepeatExternalEffect: boolean
}

export interface RepairPlan {
  readonly planId: string
  readonly failedChecks: readonly string[]
  readonly actions: readonly RepairAction[]
  readonly maxRounds: number
  readonly budget: { maxTokens: number; maxTimeMs: number; maxExternalWrites: number }
  readonly planAmendment?: string | undefined
}

export interface RepairBudgetTracker {
  roundsUsed: number
  tokensUsed: number
  timeUsedMs: number
  externalWritesUsed: number
}

export type RepairOutcome = 'repaired' | 'needs-human' | 'rejected' | 'budget-exhausted'
