import type { Branded } from '@deepseek-ai/dsh-brand'

export type RunId = Branded<'RunId'>

export type RunState = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface RunEvent {
  readonly seq: number
  readonly runId: RunId
  readonly type: string
  readonly timestamp: string
  readonly payload: unknown
  readonly prevHash: string
  readonly hash: string
}

export interface Run {
  readonly id: RunId
  readonly principalId: string
  readonly tenantId: string
  readonly state: RunState
  readonly createdAt: string
  readonly updatedAt: string
  readonly events: RunEvent[]
}
