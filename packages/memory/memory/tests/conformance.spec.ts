import { describe, it, expect } from 'vitest'
import { createMemoryService, InMemoryProvider, validateRecord, isExpired, matchesQuery } from '../src/index.ts'

describe('P6-01 Memory Service', () => {
  it('validates required fields', () => {
    const errors = validateRecord({} as any)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors).toContain('principalId is required')
    expect(errors).toContain('content is required')
  })

  it('validates confidence range', () => {
    const errors = validateRecord({ principalId: 'u', tenantId: 't', content: 'c', source: 's', confidence: 1.5, scope: 'session', purpose: 'p' })
    expect(errors).toContain('confidence must be between 0 and 1')
  })

  it('stores and retrieves a record', async () => {
    const service = createMemoryService()
    const record = await service.store({
      principalId: 'user-1', tenantId: 'tenant-a', content: 'hello world',
      source: 'test', confidence: 0.9, scope: 'session', purpose: 'testing',
    })
    expect(record.id).toBeTruthy()
    const retrieved = await service.retrieve(String(record.id))
    expect(retrieved).toBeDefined()
    expect(retrieved!.content).toBe('hello world')
  })

  it('queries by tenant', async () => {
    const service = createMemoryService()
    await service.store({ principalId: 'u1', tenantId: 't1', content: 'a', source: 's', confidence: 0.5, scope: 'session', purpose: 'p' })
    await service.store({ principalId: 'u2', tenantId: 't1', content: 'b', source: 's', confidence: 0.5, scope: 'tenant', purpose: 'p' })
    await service.store({ principalId: 'u3', tenantId: 't2', content: 'c', source: 's', confidence: 0.5, scope: 'global', purpose: 'p' })
    const results = await service.query({ tenantId: 't1' })
    expect(results.length).toBe(2)
  })

  it('queries by scope', async () => {
    const service = createMemoryService()
    await service.store({ principalId: 'u1', tenantId: 't1', content: 'a', source: 's', confidence: 0.5, scope: 'session', purpose: 'p' })
    await service.store({ principalId: 'u1', tenantId: 't1', content: 'b', source: 's', confidence: 0.5, scope: 'tenant', purpose: 'p' })
    const results = await service.query({ tenantId: 't1', scope: 'tenant' })
    expect(results.length).toBe(1)
  })

  it('queries with filter', async () => {
    const service = createMemoryService()
    await service.store({ principalId: 'u1', tenantId: 't1', content: 'apple pie', source: 's', confidence: 0.5, scope: 'session', purpose: 'p' })
    await service.store({ principalId: 'u1', tenantId: 't1', content: 'banana bread', source: 's', confidence: 0.5, scope: 'session', purpose: 'p' })
    const results = await service.query({ tenantId: 't1', filter: 'apple' })
    expect(results.length).toBe(1)
  })

  it('deletes a record', async () => {
    const service = createMemoryService()
    const record = await service.store({ principalId: 'u', tenantId: 't', content: 'c', source: 's', confidence: 0.5, scope: 'session', purpose: 'p' })
    const deleted = await service.delete(String(record.id))
    expect(deleted).toBe(true)
    const retrieved = await service.retrieve(String(record.id))
    expect(retrieved).toBeUndefined()
  })

  it('expired records are not returned', async () => {
    const service = createMemoryService()
    const record = await service.store({
      principalId: 'u', tenantId: 't', content: 'c', source: 's', confidence: 0.5,
      scope: 'session', purpose: 'p', expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const retrieved = await service.retrieve(String(record.id))
    expect(retrieved).toBeUndefined()
  })
})
