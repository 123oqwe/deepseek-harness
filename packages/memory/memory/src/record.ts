import type { Branded } from '@deepseek-ai/dsh-brand'
import { randomUUID } from 'node:crypto'

export type MemoryRecordId = Branded<'MemoryRecordId'>

export type MemoryKind = 'fact' | 'preference' | 'event' | 'instruction' | 'observation'
export type MemoryStatus = 'active' | 'superseded' | 'disputed' | 'expired' | 'forgotten'
export type MemorySensitivity = 'public' | 'internal' | 'confidential' | 'restricted'

export interface MemoryRecordFull {
  readonly id: MemoryRecordId
  readonly content: string
  readonly contentRef?: string
  readonly kind: MemoryKind
  readonly subject?: string
  readonly sourceEvents: string[]
  readonly principalId: string
  readonly tenantId: string
  readonly createdAt: string
  readonly validFrom: string
  readonly validUntil?: string
  readonly confidence: number
  readonly scope: 'session' | 'tenant' | 'global'
  readonly purpose: string
  readonly ttl?: number
  readonly sensitivity: MemorySensitivity
  readonly status: MemoryStatus
  readonly supersedes?: MemoryRecordId
  readonly disputedBy?: MemoryRecordId[]
}

function asMemoryRecordId(s: string): MemoryRecordId {
  return s as Branded<'MemoryRecordId'>
}

export function createRecord(opts: Omit<MemoryRecordFull, 'id' | 'createdAt' | 'status' | 'sourceEvents'> & { sourceEvents?: string[] }): MemoryRecordFull {
  const now = new Date().toISOString()
  return {
    ...opts,
    id: asMemoryRecordId(randomUUID()),
    createdAt: now,
    status: 'active',
    sourceEvents: opts.sourceEvents ?? [],
  }
}

export function isExpired(record: MemoryRecordFull, now: Date = new Date()): boolean {
  if (record.validUntil && new Date(record.validUntil) < now) return true
  if (record.ttl) {
    const expiry = new Date(record.createdAt).getTime() + record.ttl * 1000
    if (expiry < now.getTime()) return true
  }
  return false
}

export function isAccessible(record: MemoryRecordFull, principalId: string, tenantId: string): boolean {
  if (record.scope === 'global') return true
  if (record.tenantId !== tenantId) return false
  if (record.scope === 'tenant') return true
  return record.principalId === principalId
}
