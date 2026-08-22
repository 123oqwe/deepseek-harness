import type { MemoryRecordId } from './record.ts'

export interface ProvenanceRelation {
  readonly type: 'supersedes' | 'disputes' | 'derives_from' | 'cites'
  readonly fromId: MemoryRecordId
  readonly toId: MemoryRecordId
  readonly reason: string
  readonly createdAt: string
}

const relations: ProvenanceRelation[] = []

export function addRelation(rel: Omit<ProvenanceRelation, 'createdAt'>): ProvenanceRelation {
  const full: ProvenanceRelation = { ...rel, createdAt: new Date().toISOString() }
  relations.push(full)
  return full
}

export function getRelations(recordId: string): ProvenanceRelation[] {
  return relations.filter(r => String(r.fromId) === recordId || String(r.toId) === recordId)
}

export function getSupersessionChain(recordId: string): MemoryRecordId[] {
  const chain: MemoryRecordId[] = []
  let current = recordId
  const visited = new Set<string>()
  while (true) {
    if (visited.has(current)) break
    visited.add(current)
    const supersedes = relations.find(r => String(r.fromId) === current && r.type === 'supersedes')
    if (supersedes) {
      chain.push(supersedes.toId)
      current = String(supersedes.toId)
    } else {
      break
    }
  }
  return chain
}

export function getDisputes(recordId: string): ProvenanceRelation[] {
  return relations.filter(r => String(r.toId) === recordId && r.type === 'disputes')
}

export function clearRelations(): void {
  relations.length = 0
}
