import type { ClaimNode, EvidenceEdge } from './types.ts'
import { propagateStatus } from './consistency.ts'

export class ClaimGraph {
  private nodes = new Map<string, ClaimNode>()
  private evidenceEdges: EvidenceEdge[] = []
  private derivedFromEdges: { claimId: string; derivedFromClaimId: string }[] = []
  private verifiedByGate = new Set<string>()

  addClaim(id: string, text: string, scope = 'default', confidence = 0.5): ClaimNode {
    const node: ClaimNode = {
      id, text, status: 'unverified', confidence, scope, createdAt: Date.now(),
    }
    this.nodes.set(id, node)
    return node
  }

  addEvidence(claimId: string, evidenceRef: string, evidenceType: string, supports: boolean, expiresAt?: number): void {
    this.evidenceEdges.push({
      sourceClaimId: claimId, evidenceRef, evidenceType, supports,
      createdAt: Date.now(), expiresAt: expiresAt ?? undefined,
    })
  }

  addDerivation(claimId: string, derivedFromClaimId: string): void {
    this.derivedFromEdges.push({ claimId, derivedFromClaimId })
  }

  markVerifiedByGate(claimId: string): void {
    this.verifiedByGate.add(claimId)
    this.recompute()
  }

  recompute(): void {
    const updated = propagateStatus(this.nodes, this.evidenceEdges, this.derivedFromEdges, this.verifiedByGate)
    this.nodes = updated
  }

  getClaim(id: string): ClaimNode | undefined {
    return this.nodes.get(id)
  }

  getAllClaims(): readonly ClaimNode[] {
    return Array.from(this.nodes.values())
  }

  getEvidenceFor(claimId: string): readonly EvidenceEdge[] {
    return this.evidenceEdges.filter(e => e.sourceClaimId === claimId)
  }

  traceToEvidence(claimId: string): { found: boolean; evidenceRefs: string[] } {
    const refs: string[] = []
    const visited = new Set<string>()
    const traverse = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      const direct = this.evidenceEdges.filter(e => e.sourceClaimId === id)
      for (const edge of direct) {
        refs.push(edge.evidenceRef)
      }
      const derived = this.derivedFromEdges.filter(d => d.claimId === id)
      for (const d of derived) {
        traverse(d.derivedFromClaimId)
      }
    }
    traverse(claimId)
    return { found: refs.length > 0, evidenceRefs: refs }
  }

  clear(): void {
    this.nodes.clear()
    this.evidenceEdges = []
    this.derivedFromEdges = []
    this.verifiedByGate.clear()
  }
}
