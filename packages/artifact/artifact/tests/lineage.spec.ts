import { describe, it, expect } from 'vitest'
import { ArtifactStore } from '../src/index.ts'

describe('P6-09 Artifact Store & Lineage', () => {
  it('stores artifact with content digest', () => {
    const store = new ArtifactStore()
    const record = store.store(Buffer.from('hello'), 'text/plain', 'tenant-1', 'run-1')
    expect(record.contentDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(record.version).toBe(1)
  })

  it('retrieves artifact by id', () => {
    const store = new ArtifactStore()
    const record = store.store(Buffer.from('data'), 'text/plain', 't1', 'r1')
    const retrieved = store.get(record.id)
    expect(retrieved?.contentDigest).toBe(record.contentDigest)
  })

  it('creates new version for same content', () => {
    const store = new ArtifactStore()
    store.store(Buffer.from('hello'), 'text/plain', 't1', 'r1')
    const r2 = store.store(Buffer.from('hello'), 'text/plain', 't1', 'r1')
    expect(r2.version).toBe(2)
  })

  it('verifies content integrity', () => {
    const store = new ArtifactStore()
    const record = store.store(Buffer.from('verified'), 'text/plain', 't1', 'r1')
    expect(store.verifyContent(record.id, Buffer.from('verified'))).toBe(true)
    expect(store.verifyContent(record.id, Buffer.from('tampered'))).toBe(false)
  })

  it('tracks lineage for parent-child', () => {
    const store = new ArtifactStore()
    const parent = store.store(Buffer.from('parent'), 'text/plain', 't1', 'r1')
    const child = store.store(Buffer.from('child'), 'text/plain', 't1', 'r1', [], parent.id)
    const lineage = store.getLineage(child.id)
    expect(lineage.length).toBeGreaterThanOrEqual(2)
    expect(lineage[0]?.artifactId).toBe(parent.id)
  })

  it('checks descendant relationship', () => {
    const store = new ArtifactStore()
    const parent = store.store(Buffer.from('p'), 'text/plain', 't1', 'r1')
    const child = store.store(Buffer.from('c'), 'text/plain', 't1', 'r1', [], parent.id)
    expect(store.isDescendant(child.id, parent.id)).toBe(true)
    expect(store.isDescendant(parent.id, child.id)).toBe(false)
  })

  it('lists artifacts by tenant', () => {
    const store = new ArtifactStore()
    store.store(Buffer.from('a'), 'text/plain', 'tenant-a', 'r1')
    store.store(Buffer.from('b'), 'text/plain', 'tenant-b', 'r1')
    const tenantA = store.list('tenant-a')
    expect(tenantA).toHaveLength(1)
  })

  it('gets version history', () => {
    const store = new ArtifactStore()
    const r1 = store.store(Buffer.from('v1'), 'text/plain', 't1', 'r1')
    store.store(Buffer.from('v1'), 'text/plain', 't1', 'r1')
    const versions = store.getVersions(r1.id)
    expect(versions.length).toBeGreaterThanOrEqual(2)
  })
})
