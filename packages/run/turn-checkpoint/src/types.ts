export type CheckpointBoundary = 'model_request' | 'tool_call' | 'tool_result' | 'assistant_commit'

export interface TurnCheckpoint {
  readonly checkpointId: string
  readonly runId: string
  readonly boundary: CheckpointBoundary
  readonly timestamp: number
  readonly userMessage: string
  readonly actionLedgerState: string
  readonly canResume: boolean
}

export interface ResumeDecision {
  readonly action: 'continue' | 'replay' | 'reconcile'
  readonly fromCheckpointId: string
  readonly reason: string
}
