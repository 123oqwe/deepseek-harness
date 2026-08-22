export interface LineageEntry {
  readonly dataId: string
  readonly source: string
  readonly tenantId: string
  readonly forkedFrom?: string
  readonly snapshotAt: number
}

export class DataLineage {
  private entries = new Map<string, LineageEntry[]>()

  record(entry: LineageEntry): void {
    const list = this.entries.get(entry.dataId) ?? []
    list.push(entry)
    this.entries.set(entry.dataId, list)
  }

  getLineage(dataId: string): readonly LineageEntry[] {
    return this.entries.get(dataId) ?? []
  }

  canExport(dataId: string, tenantId: string): { allowed: boolean; reason: string } {
    const lineage = this.entries.get(dataId) ?? []
    for (const entry of lineage) {
      if (entry.tenantId !== tenantId) {
        return { allowed: false, reason: `Cross-tenant data: owned by ${entry.tenantId}` }
      }
    }
    return { allowed: true, reason: 'allowed' }
  }

  erase(dataId: string): { erased: boolean; entriesRemoved: number } {
    const count = this.entries.get(dataId)?.length ?? 0
    this.entries.delete(dataId)
    return { erased: count > 0, entriesRemoved: count }
  }
}
