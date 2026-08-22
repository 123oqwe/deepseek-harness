import { describe, it, expect } from 'vitest'
import { SnapshotStore } from '../src/store.ts'

describe('P3-11 World Snapshot / Restore / Rollback', () => {
  it('creates a consistent snapshot with file digests', () => {
    const store = new SnapshotStore()
    const files = [{ path: '/app/index.ts', content: Buffer.from('hello') }]
    const snap = store.create('world-1', files)
    expect(snap.consistent).toBe(true)
    expect(snap.fileDigests).toHaveLength(1)
    expect(snap.fileDigests[0]?.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('restores to a new world identity', () => {
    const store = new SnapshotStore()
    const snap = store.create('world-1', [{ path: '/f', content: Buffer.from('x') }])
    const result = store.restore(snap.id)
    expect(result.newWorldId).not.toBe('world-1')
    expect(result.verified).toBe(true)
  })

  it('old tokens are not inherited on restore', () => {
    const store = new SnapshotStore()
    const snap = store.create('world-1', [{ path: '/f', content: Buffer.from('x') }], [], [{ leaseId: 'lease-1', secretName: 'api-key' }])
    const result = store.restore(snap.id)
    expect(result.newWorldId).not.toBe(snap.worldId)
  })

  it('verifies content matches snapshot digests', () => {
    const store = new SnapshotStore()
    const files = [{ path: '/a.txt', content: Buffer.from('data') }]
    const snap = store.create('w1', files)
    const verify = store.verifyContent(snap.id, files)
    expect(verify.verified).toBe(true)
    expect(verify.mismatches).toHaveLength(0)
  })

  it('detects content mismatch on verify', () => {
    const store = new SnapshotStore()
    const snap = store.create('w1', [{ path: '/a.txt', content: Buffer.from('original') }])
    const verify = store.verifyContent(snap.id, [{ path: '/a.txt', content: Buffer.from('tampered') }])
    expect(verify.verified).toBe(false)
    expect(verify.mismatches.length).toBeGreaterThan(0)
  })

  it('tracks rollback events in lineage', () => {
    const store = new SnapshotStore()
    const snap = store.create('world-1', [{ path: '/f', content: Buffer.from('x') }])
    store.restore(snap.id, 'world-2')
    const log = store.getRollbackLog()
    expect(log).toHaveLength(1)
    expect(log[0]?.fromWorldId).toBe('world-1')
    expect(log[0]?.toWorldId).toBe('world-2')
  })

  it('marks inconsistent snapshots explicitly', () => {
    const store = new SnapshotStore()
    const snap = store.create('w1', [], [], [], 'action-boundary-1', false)
    expect(snap.consistent).toBe(false)
    const result = store.restore(snap.id)
    expect(result.verified).toBe(false)
    expect(result.mismatches).toContain('Snapshot was marked inconsistent')
  })

  it('lists snapshots by world', () => {
    const store = new SnapshotStore()
    store.create('w1', [{ path: '/f', content: Buffer.from('a') }])
    store.create('w1', [{ path: '/f', content: Buffer.from('b') }])
    store.create('w2', [{ path: '/f', content: Buffer.from('c') }])
    const w1Snaps = store.listByWorld('w1')
    expect(w1Snaps).toHaveLength(2)
  })

  it('deletes snapshots cleanly', () => {
    const store = new SnapshotStore()
    const snap = store.create('w1', [{ path: '/f', content: Buffer.from('x') }])
    expect(store.delete(snap.id)).toBe(true)
    expect(store.get(snap.id)).toBeUndefined()
    expect(store.listByWorld('w1')).toHaveLength(0)
  })

  it('handles snapshot corruption detection', () => {
    const store = new SnapshotStore()
    const snap = store.create('w1', [{ path: '/missing', content: Buffer.from('x') }])
    const verify = store.verifyContent(snap.id, [])
    expect(verify.verified).toBe(false)
    expect(verify.mismatches).toContain('Missing file: /missing')
  })

  it('survives 100 create/restore/delete cycles without leak', () => {
    const store = new SnapshotStore()
    for (let i = 0; i < 100; i++) {
      const snap = store.create(`w-${i}`, [{ path: `/f-${i}`, content: Buffer.from(`data-${i}`) }])
      store.restore(snap.id)
      store.delete(snap.id)
    }
    expect(store.getRollbackLog()).toHaveLength(100)
    expect(store.listByWorld('w-0')).toHaveLength(0)
  })
})
