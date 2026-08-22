export type TaskState = 'queued' | 'claimed' | 'in-progress' | 'completed' | 'failed' | 'cancelled'

export interface Task {
  readonly id: string
  readonly runId: string
  readonly title: string
  readonly state: TaskState
  readonly claimedBy?: string
  readonly dependencies: string[]
  readonly createdAt: string
  readonly claimedAt?: string
  readonly completedAt?: string
  readonly result?: unknown
}

export interface MailboxMessage {
  readonly id: string
  readonly runId: string
  readonly from: string
  readonly to: string
  readonly subject: string
  readonly body: unknown
  readonly sentAt: string
  readonly readAt?: string
}

export interface BlackboardEntry {
  readonly key: string
  readonly runId: string
  readonly value: unknown
  readonly writtenBy: string
  readonly writtenAt: string
  readonly version: number
}
