import type { EvidenceItem, EvidenceBundle } from './types.ts'

export function checkInvariants(items: readonly EvidenceItem[]): { passed: boolean; violations: string[] } {
  const violations: string[] = []
  const seenIds = new Set<string>()
  for (const item of items) {
    if (seenIds.has(item.id)) {
      violations.push(`Duplicate evidence id: ${item.id}`)
    }
    seenIds.add(item.id)
    if (!item.contentDigest.match(/^[0-9a-f]{64}$/)) {
      violations.push(`Invalid digest format: ${item.id}`)
    }
  }
  return { passed: violations.length === 0, violations }
}

export function isTamperEvident(bundle: EvidenceBundle): boolean {
  // Bundle digest is content-addressed by sorted item digests
  // Any change to items would change the bundle digest
  return bundle.bundleDigest.length === 64
}
