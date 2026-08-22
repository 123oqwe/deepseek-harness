import type { Branded } from '@deepseek-ai/dsh-brand'

export type LeaseId = Branded<'LeaseId'>
export type FencingToken = Branded<'FencingToken'>

export interface Lease {
  readonly id: LeaseId
  readonly runId: string
  readonly workerId: string
  readonly epoch: number
  readonly acquiredAt: string
  readonly expiresAt: string
  readonly heartbeatCount: number
  readonly state: 'active' | 'expired' | 'revoked' | 'released'
}
