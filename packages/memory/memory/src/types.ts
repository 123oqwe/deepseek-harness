import type { Branded } from '@deepseek-ai/dsh-brand'

export type MemoryId = Branded<'MemoryId'>

export interface MemoryRecord {
  readonly id: MemoryId
  readonly principalId: string
  readonly tenantId: string
  readonly content: string
  readonly source: string
  readonly confidence: number
  readonly ttl?: number
  readonly scope: 'session' | 'tenant' | 'global'
  readonly purpose: string
  readonly createdAt: string
  readonly expiresAt?: string
}

export interface MemoryQuery {
  readonly principalId?: string
  readonly tenantId: string
  readonly scope?: 'session' | 'tenant' | 'global'
  readonly filter?: string
  readonly limit?: number
}

export interface MemoryProvider {
  store(record: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<MemoryRecord>
  retrieve(id: string): Promise<MemoryRecord | undefined>
  query(query: MemoryQuery): Promise<MemoryRecord[]>
  delete(id: string): Promise<boolean>
  expire(): Promise<number>
}

export interface MemoryService {
  readonly provider: MemoryProvider
  store(record: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<MemoryRecord>
  query(query: MemoryQuery): Promise<MemoryRecord[]>
  retrieve(id: string): Promise<MemoryRecord | undefined>
  delete(id: string): Promise<boolean>
}
