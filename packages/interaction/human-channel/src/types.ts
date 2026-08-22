export type EmergencyAction = 'pause-new-actions' | 'cancel-run' | 'kill-execution-world' | 'ask-question' | 'resume'

export interface EmergencyStopOrder {
  readonly id: string
  readonly action: EmergencyAction
  readonly runId?: string
  readonly reason: string
  readonly issuedBy: string
  readonly issuedAt: string
  readonly persistent: boolean
}

export interface HumanInteractionRequest {
  readonly id: string
  readonly runId: string
  readonly type: 'question' | 'confirmation' | 'choice' | 'input'
  readonly prompt: string
  readonly options?: string[]
  readonly timeout?: number
}
