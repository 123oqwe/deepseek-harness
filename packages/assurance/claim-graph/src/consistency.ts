import type { ClaimNode, EvidenceEdge, ClaimStatus } from './types.ts'

export function computeStatus(
  claimId: string,
  nodes: ReadonlyMap<string, ClaimNode>,
  edges: readonly EvidenceEdge[],
  verifiedByGate: ReadonlySet<string>,
): ClaimStatus {
  const supporting = edges.filter(e => e.sourceClaimId === claimId && e.supports)
  const contradicting = edges.filter(e => e.sourceClaimId === claimId && !e.supports)

  if (contradicting.length > 0) return 'conflicted'
  if (verifiedByGate.has(claimId)) return 'verified'
  if (supporting.length === 0) return 'unverified'

  const now = Date.now()
  const expired = supporting.some(e => e.expiresAt !== undefined && e.expiresAt < now)
  if (expired) return 'stale'

  return 'unverified'
}

export function propagateStatus(
  nodes: ReadonlyMap<string, ClaimNode>,
  edges: readonly EvidenceEdge[],
  derivedFromEdges: readonly { claimId: string; derivedFromClaimId: string }[],
  verifiedByGate: ReadonlySet<string>,
): Map<string, ClaimNode> {
  const updated = new Map<string, ClaimNode>()
  const changed = new Set<string>()

  for (const [id, node] of nodes) {
    const newStatus = computeStatus(id, /* nodes, */ edges, verifiedByGate)
    if (newStatus !== node.status) {
      updated.set(id, { ...node, status: newStatus })
      changed.add(id)
    } else {
      updated.set(id, node)
    }
  }

  for (let i = 0; i < 10; i++) {
    let anyChange = false
    for (const edge of derivedFromEdges) {
      const parent = updated.get(edge.derivedFromClaimId)
      const child = updated.get(edge.claimId)
      if (!parent || !child) continue
      if ((parent.status === 'conflicted' || parent.status === 'stale') && child.status === 'verified') {
        updated.set(edge.claimId, { ...child, status: parent.status })
        anyChange = true
      }
    }
    if (!anyChange) break
  }

  return updated
}
