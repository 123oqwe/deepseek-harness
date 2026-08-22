import { createHash } from 'node:crypto'
import type { ArtifactRecord, ArtifactVersion } from './types.ts'
import { LineageGraph } from './lineage.ts'

export type { ArtifactRecord, ArtifactVersion, ArtifactLineageNode } from './types.ts'
export { LineageGraph } from './lineage.ts'

export class ArtifactStore {
  private artifacts = new Map<string, ArtifactRecord[]>()
  private lineage = new LineageGraph()

  store(
    content: Buffer, mimeType: string, tenantId: string, runId: string,
    tags: readonly string[] = [], parentArtifactId?: string,
  ): ArtifactRecord {
    const contentDigest = createHash('sha256').update(content).digest('hex')
    const id = `art-${contentDigest.slice(0, 16)}`
    const existing = this.artifacts.get(id)
    const version = (existing?.length ?? 0) + 1
    const record: ArtifactRecord = {
      id, contentDigest, mimeType, size: content.length,
      tenantId, runId, createdAt: Date.now(),
      tags, version, parentArtifactId,
    }
    const list = existing ?? []
    list.push(record)
    this.artifacts.set(id, list)
    this.lineage.add(record)
    return record
  }

  get(id: string, version?: number): ArtifactRecord | undefined {
    const list = this.artifacts.get(id)
    if (!list || list.length === 0) return undefined
    if (version) return list.find(r => r.version === version)
    return list[list.length - 1]
  }

  getVersions(id: string): readonly ArtifactVersion[] {
    const list = this.artifacts.get(id) ?? []
    return list.map(r => ({
      version: r.version, digest: r.contentDigest,
      createdAt: r.createdAt, createdBy: r.runId,
    }))
  }

  getLineage(id: string) {
    return this.lineage.getLineage(id)
  }

  isDescendant(id: string, ancestorId: string): boolean {
    return this.lineage.isDescendant(id, ancestorId)
  }

  list(tenantId?: string): readonly ArtifactRecord[] {
    const all = Array.from(this.artifacts.values()).flat()
    if (tenantId) return all.filter(a => a.tenantId === tenantId)
    return all
  }

  verifyContent(id: string, content: Buffer): boolean {
    const record = this.get(id)
    if (!record) return false
    const digest = createHash('sha256').update(content).digest('hex')
    return digest === record.contentDigest
  }
}
