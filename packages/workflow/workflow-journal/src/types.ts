export type StepState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface JournalStep {
  readonly stepId: string
  readonly phase: string
  readonly state: StepState
  readonly inputRef?: string
  readonly outputRef?: string
  readonly sideEffectReceipts: string[]
  readonly childAgentReceipts: string[]
  readonly startedAt?: string
  readonly completedAt?: string
}

export interface WorkflowJournal {
  readonly runId: string
  readonly scriptDigest: string
  readonly steps: JournalStep[]
  readonly createdAt: string
}
