import { randomUUID } from 'node:crypto'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MemoryRecord, MemoryQuery, MemoryProvider, MemoryService } from './types.ts'
import { validateRecord, isExpired, matchesQuery } from './invariant.ts'

export type { MemoryId, MemoryRecord, MemoryQuery, MemoryProvider, MemoryService } from './types.ts'
export { validateRecord, isExpired, matchesQuery } from './invariant.ts'

function asMemoryId(s: string): Branded<'MemoryId'> {
  return s as Branded<'MemoryId'>
}

/** In-memory provider for testing and development. */
export class InMemoryProvider implements MemoryProvider {
  private records = new Map<string, MemoryRecord>()

  async store(record: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<MemoryRecord> {
    const errors = validateRecord(record)
    if (errors.length > 0) throw new Error(`Invalid memory record: ${errors.join(', ')}`)
    const full: MemoryRecord = {
      ...record,
      id: asMemoryId(randomUUID()),
      createdAt: new Date().toISOString(),
    }
    this.records.set(String(full.id), full)
    await Promise.resolve()
    return full
  }

  async retrieve(id: string): Promise<MemoryRecord | undefined> {
    const record = this.records.get(id)
    if (!record || isExpired(record)) return undefined
    await Promise.resolve()
    return record
  }

  async query(query: MemoryQuery): Promise<MemoryRecord[]> {
    const results = Array.from(this.records.values()).filter(r => matchesQuery(r, query))
    await Promise.resolve()
    return query.limit ? results.slice(0, query.limit) : results
  }

  async delete(id: string): Promise<boolean> {
    await Promise.resolve()
    return this.records.delete(id)
  }

  async expire(): Promise<number> {
    let count = 0
    for (const [id, record] of this.records) {
      if (isExpired(record)) {
        this.records.delete(id)
        count++
      }
    }
    return count
  }
}

export function createMemoryService(provider?: MemoryProvider): MemoryService {
  const p = provider ?? new InMemoryProvider()
  return {
    provider: p,
    store: r => p.store(r),
    query: q => p.query(q),
    retrieve: id => p.retrieve(id),
    delete: id => p.delete(id),
  }
}
