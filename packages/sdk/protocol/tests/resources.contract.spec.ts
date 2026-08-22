import { describe, it, expect, beforeEach } from 'vitest'
import { ResourceStore } from '../../../api/remotes/src/resource-store.ts'
import type { ResourceSummary } from '../src/resources.ts'

function makeSummary(id: string, tenant: string, rev = 1): ResourceSummary {
  return {
    id, type: 'run', tenantId: tenant, classification: 'internal',
    revision: rev, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    provenance: 'test', allowedActions: ['read', 'update'],
  }
}

describe('P8-02 Remote Resources API', () => {
  let store: ResourceStore<ResourceSummary>

  beforeEach(() => { store = new ResourceStore() })

  it('creates and gets a resource by ID', () => {
    const item = makeSummary('r1', 't1')
    store.create(item)
    const result = store.get('r1', 't1')
    expect(result?.id).toBe('r1')
  })

  it('returns undefined for cross-tenant access', () => {
    store.create(makeSummary('r1', 't1'))
    expect(store.get('r1', 't2')).toBeUndefined()
  })

  it('lists resources with pagination', () => {
    for (let i = 0; i < 10; i++) store.create(makeSummary(`r${i}`, 't1'))
    const page1 = store.list({ limit: 3 }, 't1')
    expect(page1.items).toHaveLength(3)
    expect(page1.total).toBe(10)
    expect(page1.nextCursor).toBeDefined()
    const page2 = store.list({ limit: 3, cursor: page1.nextCursor }, 't1')
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id)
  })

  it('filters resources by field', () => {
    store.create(makeSummary('r1', 't1'))
    store.create({ ...makeSummary('r2', 't1'), type: 'action' })
    const filtered = store.list({ filter: { type: 'action' } }, 't1')
    expect(filtered.items).toHaveLength(1)
    expect(filtered.items[0]?.id).toBe('r2')
  })

  it('updates with optimistic concurrency token', () => {
    const item = makeSummary('r1', 't1', 1)
    store.create(item)
    const updated = store.update('r1', { status: 'done' }, { expectedRevision: 1 }, 't1')
    expect(updated?.revision).toBe(2)
    const stale = store.update('r1', { status: 'fail' }, { expectedRevision: 1 }, 't1')
    expect(stale).toBeUndefined()
  })

  it('watch receives created events', () => {
    const events: string[] = []
    store.watch(e => events.push(e.type))
    store.create(makeSummary('r1', 't1'))
    expect(events).toContain('created')
  })

  it('watch receives updated events', () => {
    const events: string[] = []
    store.watch(e => events.push(e.type))
    store.create(makeSummary('r1', 't1'))
    store.update('r1', {}, { expectedRevision: 1 }, 't1')
    expect(events).toContain('updated')
  })

  it('watch receives deleted events', () => {
    const events: string[] = []
    store.watch(e => events.push(e.type))
    store.create(makeSummary('r1', 't1'))
    store.delete('r1', 't1')
    expect(events).toContain('deleted')
  })

  it('delete is tenant-scoped', () => {
    store.create(makeSummary('r1', 't1'))
    expect(store.delete('r1', 't2')).toBe(false)
    expect(store.delete('r1', 't1')).toBe(true)
  })

  it('cross-tenant ID enumeration returns 404/undefined', () => {
    store.create(makeSummary('r1', 't1'))
    const otherTenant = store.get('r1', 't2')
    expect(otherTenant).toBeUndefined()
  })
})
