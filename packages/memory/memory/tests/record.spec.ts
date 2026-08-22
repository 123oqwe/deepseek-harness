import { describe, it, expect, beforeEach } from 'vitest'
import { createRecord, isExpired, isAccessible, type MemoryRecordFull } from '../src/record.ts'
import { addRelation, getRelations, getSupersessionChain, getDisputes, clearRelations } from '../src/provenance.ts'

describe('P6-02 MemoryRecord with provenance', () => {
  beforeEach(() =>{  clearRelations() })

  it('creates a record with all fields', () => {
    const record = createRecord({
      content: 'test', kind: 'fact', principalId: 'u', tenantId: 't',
      validFrom: new Date().toISOString(), confidence: 0.9, scope: 'session',
      purpose: 'test', sensitivity: 'internal',
    } as never)
    expect(record.id).toBeTruthy()
    expect(record.status).toBe('active')
    expect(record.sourceEvents).toEqual([])
  })

  it('isExpired checks validUntil', () => {
    const record = { validUntil: new Date(Date.now() - 1000).toISOString(), ttl: undefined } as unknown as MemoryRecordFull
    expect(isExpired(record)).toBe(true)
  })

  it('isExpired checks TTL', () => {
    const record = {
      createdAt: new Date(Date.now() - 2000).toISOString(),
      ttl: 1,
      validUntil: undefined,
    } as unknown as MemoryRecordFull
    expect(isExpired(record)).toBe(true)
  })

  it('isAccessible checks scope and tenant', () => {
    const record = { tenantId: 't1', principalId: 'u1', scope: 'session' } as unknown as MemoryRecordFull
    expect(isAccessible(record, 'u1', 't1')).toBe(true)
    expect(isAccessible(record, 'u2', 't1')).toBe(false)
    expect(isAccessible(record, 'u1', 't2')).toBe(false)
  })

  it('global scope is accessible to all', () => {
    const record = { tenantId: 't1', principalId: 'u1', scope: 'global' } as unknown as MemoryRecordFull
    expect(isAccessible(record, 'u2', 't2')).toBe(true)
  })

  it('provenance relation tracks supersedes', () => {
    const record1 = createRecord({ content: 'a', kind: 'fact', principalId: 'u', tenantId: 't', validFrom: new Date().toISOString(), confidence: 0.5, scope: 'session', purpose: 'p', sensitivity: 'internal' } as never)
    const record2 = createRecord({ content: 'b', kind: 'fact', principalId: 'u', tenantId: 't', validFrom: new Date().toISOString(), confidence: 0.9, scope: 'session', purpose: 'p', sensitivity: 'internal' } as never)
    addRelation({ type: 'supersedes', fromId: record2.id, toId: record1.id, reason: 'higher confidence' })
    const chain = getSupersessionChain(String(record2.id))
    expect(chain.length).toBe(1)
    expect(String(chain[0])).toBe(String(record1.id))
  })

  it('provenance tracks disputes', () => {
    const record1 = createRecord({ content: 'a', kind: 'fact', principalId: 'u', tenantId: 't', validFrom: new Date().toISOString(), confidence: 0.5, scope: 'session', purpose: 'p', sensitivity: 'internal' } as never)
    const record2 = createRecord({ content: 'b', kind: 'fact', principalId: 'u', tenantId: 't', validFrom: new Date().toISOString(), confidence: 0.5, scope: 'session', purpose: 'p', sensitivity: 'internal' } as never)
    addRelation({ type: 'disputes', fromId: record2.id, toId: record1.id, reason: 'conflicting evidence' })
    const disputes = getDisputes(String(record1.id))
    expect(disputes.length).toBe(1)
    expect(disputes[0]!.reason).toContain('conflicting')
  })

  it('getRelations returns both directions', () => {
    const record1 = createRecord({ content: 'a', kind: 'fact', principalId: 'u', tenantId: 't', validFrom: new Date().toISOString(), confidence: 0.5, scope: 'session', purpose: 'p', sensitivity: 'internal' } as never)
    const record2 = createRecord({ content: 'b', kind: 'fact', principalId: 'u', tenantId: 't', validFrom: new Date().toISOString(), confidence: 0.9, scope: 'session', purpose: 'p', sensitivity: 'internal' } as never)
    addRelation({ type: 'cites', fromId: record1.id, toId: record2.id, reason: 'source' })
    const rels1 = getRelations(String(record1.id))
    const rels2 = getRelations(String(record2.id))
    expect(rels1.length).toBe(1)
    expect(rels2.length).toBe(1)
  })
})
