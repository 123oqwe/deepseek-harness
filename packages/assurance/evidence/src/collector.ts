import { createHash } from 'node:crypto'
import type { EvidenceItem, EvidenceBundle, EvidenceType } from './types.ts'

export class EvidenceCollector {
  private items: EvidenceItem[] = []

  collect(
    type: EvidenceType, content: string | Buffer, runId: string, collectedBy: string,
    metadata: Record<string, string> = {},
  ): EvidenceItem {
    const contentStr = typeof content === 'string' ? content : content.toString('hex')
    const contentDigest = createHash('sha256').update(contentStr).digest('hex')
    const id = `ev-${contentDigest.slice(0, 12)}`
    const item: EvidenceItem = {
      id, type, contentDigest, collectedAt: Date.now(),
      collectedBy, runId, metadata,
    }
    this.items.push(item)
    return item
  }

  bundle(runId: string): EvidenceBundle {
    const runItems = this.items.filter(i => i.runId === runId)
    const content = JSON.stringify(runItems.map(i => i.contentDigest).sort())
    const bundleDigest = createHash('sha256').update(content).digest('hex')
    return {
      id: `bundle-${bundleDigest.slice(0, 12)}`,
      items: runItems,
      bundleDigest,
      createdAt: Date.now(),
      runId,
    }
  }

  verify(item: EvidenceItem, content: string | Buffer): boolean {
    const contentStr = typeof content === 'string' ? content : content.toString('hex')
    const digest = createHash('sha256').update(contentStr).digest('hex')
    return digest === item.contentDigest
  }

  verifyBundle(bundle: EvidenceBundle): boolean {
    const expectedContent = JSON.stringify(bundle.items.map(i => i.contentDigest).sort())
    const expectedDigest = createHash('sha256').update(expectedContent).digest('hex')
    return expectedDigest === bundle.bundleDigest
  }

  getItems(runId: string): readonly EvidenceItem[] {
    return this.items.filter(i => i.runId === runId)
  }
}
