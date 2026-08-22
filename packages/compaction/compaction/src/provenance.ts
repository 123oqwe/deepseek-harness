export interface CompactionProvenance {
  readonly compactionId: string
  readonly sourceItemIds: readonly string[]
  readonly compactedItemId: string
  readonly timestamp: number
  readonly toolPaired: boolean
  readonly verifier: string
}

export class ProvenanceTracker {
  private provenance: CompactionProvenance[] = []

  record(p: Omit<CompactionProvenance, 'compactionId'>): CompactionProvenance {
    const entry: CompactionProvenance = { ...p, compactionId: `comp-${Date.now()}` }
    this.provenance.push(entry)
    return entry
  }

  getProvenance(compactedItemId: string): CompactionProvenance | undefined {
    return this.provenance.find(p => p.compactedItemId === compactedItemId)
  }

  verifyToolPaired(compactedItemId: string): boolean {
    const p = this.getProvenance(compactedItemId)
    return p?.toolPaired ?? false
  }
}
