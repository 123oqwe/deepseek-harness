import { randomUUID } from 'node:crypto'

export type ProposalState = 'pending' | 'accepted' | 'rejected' | 'reviewing' | 'merged' | 'forgotten'
export type ProposalDecision = 'auto-accept' | 'review' | 'reject'

export interface MemoryProposal {
  readonly id: string
  readonly content: string
  readonly evidence: string[]
  readonly intendedUse: string
  readonly ttl?: number
  readonly sensitivity: 'public' | 'internal' | 'confidential' | 'restricted'
  readonly principalId: string
  readonly tenantId: string
  readonly state: ProposalState
  readonly createdAt: string
  readonly decidedAt?: string
  readonly decidedBy?: string
  readonly rejectionReason?: string
}

export function createProposal(opts: Omit<MemoryProposal, 'id' | 'state' | 'createdAt'>): MemoryProposal {
  return { ...opts, id: randomUUID(), state: 'pending', createdAt: new Date().toISOString() }
}
