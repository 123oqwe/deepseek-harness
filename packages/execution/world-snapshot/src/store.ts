import { createHash, randomUUID } from 'node:crypto'
import type { WorldSnapshot, FileDigest, RestoreResult, RollbackEvent, ProviderMetadata, SecretReference } from './types.ts'

export class SnapshotStore {
  private snapshots = new Map<string, WorldSnapshot>()
  private byWorld = new Map<string, string[]>()
  private rollbackLog: RollbackEvent[] = []

  create(
    worldId: string,
    files: readonly { path: string; content: Buffer }[],
    providers: readonly ProviderMetadata[] = [],
    secretRefs: readonly SecretReference[] = [],
    actionBoundary?: string,
    consistent = true,
  ): WorldSnapshot {
    const fileDigests: FileDigest[] = files.map(f => ({
      path: f.path,
      digest: createHash('sha256').update(f.content).digest('hex'),
    }))
    const snapshot: WorldSnapshot = {
      id: `snap-${randomUUID().slice(0, 12)}`,
      worldId,
      createdAt: Date.now(),
      consistent,
      fileDigests,
      providers,
      secretRefs,
      actionBoundary,
    }
    this.snapshots.set(snapshot.id, snapshot)
    const list = this.byWorld.get(worldId) ?? []
    list.push(snapshot.id)
    this.byWorld.set(worldId, list)
    return snapshot
  }

  get(snapshotId: string): WorldSnapshot | undefined {
    return this.snapshots.get(snapshotId)
  }

  listByWorld(worldId: string): readonly WorldSnapshot[] {
    const ids = this.byWorld.get(worldId) ?? []
    return ids.map(id => this.snapshots.get(id)).filter((s): s is WorldSnapshot => s !== undefined)
  }

  restore(snapshotId: string, newWorldId?: string): RestoreResult {
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) {
      return { newWorldId: '', verified: false, mismatches: ['Snapshot not found'] }
    }
    const targetWorld = newWorldId ?? `world-${randomUUID().slice(0, 12)}`
    const mismatches: string[] = []
    if (!snapshot.consistent) {
      mismatches.push('Snapshot was marked inconsistent')
    }
    const event: RollbackEvent = {
      snapshotId: snapshot.id,
      fromWorldId: snapshot.worldId,
      toWorldId: targetWorld,
      at: Date.now(),
    }
    this.rollbackLog.push(event)
    return {
      newWorldId: targetWorld,
      verified: mismatches.length === 0,
      mismatches,
    }
  }

  verifyContent(snapshotId: string, files: readonly { path: string; content: Buffer }[]): { verified: boolean; mismatches: string[] } {
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) return { verified: false, mismatches: ['Snapshot not found'] }
    const mismatches: string[] = []
    for (const fd of snapshot.fileDigests) {
      const file = files.find(f => f.path === fd.path)
      if (!file) {
        mismatches.push(`Missing file: ${fd.path}`)
        continue
      }
      const digest = createHash('sha256').update(file.content).digest('hex')
      if (digest !== fd.digest) {
        mismatches.push(`Digest mismatch for ${fd.path}`)
      }
    }
    return { verified: mismatches.length === 0, mismatches }
  }

  getRollbackLog(): readonly RollbackEvent[] {
    return this.rollbackLog
  }

  delete(snapshotId: string): boolean {
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) return false
    this.snapshots.delete(snapshotId)
    const list = this.byWorld.get(snapshot.worldId)
    if (list) {
      const filtered = list.filter(id => id !== snapshotId)
      if (filtered.length === 0) {
        this.byWorld.delete(snapshot.worldId)
      } else {
        this.byWorld.set(snapshot.worldId, filtered)
      }
    }
    return true
  }

  clear(): void {
    this.snapshots.clear()
    this.byWorld.clear()
    this.rollbackLog = []
  }
}
