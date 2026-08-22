export interface StateDiff {
  readonly actionId: string
  readonly expected: unknown
  readonly observed: unknown
  readonly matched: boolean
  readonly description: string
}

export interface RepairOption {
  readonly actionId: string
  readonly type: 'retry' | 'compensate' | 'manual'
  readonly reason: string
}

export interface ObserveResult {
  readonly actionId: string
  readonly observedState: unknown
  readonly reachable: boolean
}

export interface ReconciliationResult {
  readonly diffs: readonly StateDiff[]
  readonly repairOptions: readonly RepairOption[]
  readonly allMatched: boolean
  readonly manualInterventionCount: number
}

export interface CompensatableAction {
  readonly actionId: string
  readonly observeState: () => Promise<ObserveResult>
  readonly compareExpected: (observed: unknown, expected: unknown) => boolean
  readonly compensate: () => Promise<{ success: boolean; reason: string }>
  readonly expected: unknown
  readonly reversible: boolean
}
