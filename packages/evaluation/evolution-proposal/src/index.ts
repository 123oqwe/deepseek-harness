import { randomUUID, createHash } from 'node:crypto'

export type ProposalStatus = 'draft' | 'static-scan' | 'offline-eval' | 'security-eval' | 'canary' | 'approved' | 'rejected' | 'published'

export interface EvolutionProposal {
  readonly id: string
  readonly component: string
  readonly changeType: 'router' | 'prompt' | 'workflow' | 'plugin' | 'policy'
  readonly description: string
  readonly status: ProposalStatus
  readonly signedAt?: string | undefined
  readonly signedBy?: string | undefined
}

export class EvolutionProposalManager {
  private proposals = new Map<string, EvolutionProposal>()
  private nonAutoEvolvable: Set<string>

  constructor(nonAuto: string[] = ['trust-kernel', 'tenant-boundary', 'audit-integrity', 'root-signing-keys']) {
    this.nonAutoEvolvable = new Set(nonAuto)
  }

  create(component: string, changeType: EvolutionProposal['changeType'], description: string): EvolutionProposal {
    const proposal: EvolutionProposal = {
      id: `evo-${randomUUID().slice(0, 12)}`,
      component,
      changeType,
      description,
      status: 'draft',
    }
    this.proposals.set(proposal.id, proposal)
    return proposal
  }

  advance(proposalId: string): EvolutionProposal | undefined {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return undefined

    if (this.nonAutoEvolvable.has(proposal.component)) {
      return { ...proposal, status: 'rejected' }
    }

    const order: ProposalStatus[] = ['draft', 'static-scan', 'offline-eval', 'security-eval', 'canary', 'approved', 'published']
    const currentIdx = order.indexOf(proposal.status)
    if (currentIdx < 0 || currentIdx >= order.length - 1) return proposal
    const next = order[currentIdx + 1]
    if (!next) return proposal

    const updated: EvolutionProposal = { ...proposal, status: next }
    if (next === 'published') {
      const hash = createHash('sha256').update(`${proposal.id}:${Date.now()}`).digest('hex')
      updated.signedAt = new Date().toISOString()
      updated.signedBy = `sig-${hash.slice(0, 16)}`
    }
    this.proposals.set(proposalId, updated)
    return updated
  }

  get(proposalId: string): EvolutionProposal | undefined {
    return this.proposals.get(proposalId)
  }

  isNonAutoEvolvable(component: string): boolean {
    return this.nonAutoEvolvable.has(component)
  }

  clear(): void {
    this.proposals.clear()
  }
}
