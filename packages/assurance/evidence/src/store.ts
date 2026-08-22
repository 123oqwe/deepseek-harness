import type { EvidenceBundle } from './types.ts'

export class EvidenceStore {
  private bundles = new Map<string, EvidenceBundle>()

  store(bundle: EvidenceBundle): { stored: boolean; reason: string } {
    if (this.bundles.has(bundle.id)) {
      return { stored: false, reason: 'Bundle already exists' }
    }
    this.bundles.set(bundle.id, bundle)
    return { stored: true, reason: 'stored' }
  }

  get(id: string): EvidenceBundle | undefined {
    return this.bundles.get(id)
  }

  getByRun(runId: string): readonly EvidenceBundle[] {
    return Array.from(this.bundles.values()).filter(b => b.runId === runId)
  }

  list(): readonly EvidenceBundle[] {
    return Array.from(this.bundles.values())
  }
}
