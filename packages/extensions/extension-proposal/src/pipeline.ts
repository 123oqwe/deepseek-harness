import type { ExtensionProposal, PipelineStage } from './types.ts'

export class ExtensionProposalPipeline {
  private readonly proposals = new Map<string, ExtensionProposal>()
  /* private readonly _stages: PipelineStage[] = [
    { name: 'draft', status: 'pending' },
    { name: 'static-scan', status: 'pending' },
    { name: 'isolation-test', status: 'pending' },
    { name: 'sign', status: 'pending' },
    { name: 'canary', status: 'pending' },
    { name: 'approve', status: 'pending' },
    { name: 'publish', status: 'pending' },
  ]

  submit(proposal: Omit<ExtensionProposal, 'status'>): ExtensionProposal {
    const full: ExtensionProposal = { ...proposal, status: 'drafted' }
    this.proposals.set(full.id, full)
    return full
  }

  scan(proposalId: string, scanResult: { passed: boolean; findings: number }): ExtensionProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Unknown proposal ${proposalId}`)
    if (proposal.status !== 'drafted') throw new Error(`Proposal must be drafted, got ${proposal.status}`)
    if (!scanResult.passed) {
      const rejected: ExtensionProposal = { ...proposal, scanResult, status: 'rejected', rejectionReason: 'Static scan failed' }
      this.proposals.set(proposalId, rejected)
      return rejected
    }
    const updated: ExtensionProposal = { ...proposal, scanResult, status: 'scanned' }
    this.proposals.set(proposalId, updated)
    return updated
  }

  test(proposalId: string, testResult: { passed: boolean; coverage: number }): ExtensionProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Unknown proposal ${proposalId}`)
    if (proposal.status !== 'scanned') throw new Error(`Proposal must be scanned, got ${proposal.status}`)
    if (!testResult.passed) {
      const rejected: ExtensionProposal = { ...proposal, testResult, status: 'rejected', rejectionReason: 'Isolation test failed' }
      this.proposals.set(proposalId, rejected)
      return rejected
    }
    const updated: ExtensionProposal = { ...proposal, testResult, status: 'tested' }
    this.proposals.set(proposalId, updated)
    return updated
  }

  sign(proposalId: string, signature: string): ExtensionProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Unknown proposal ${proposalId}`)
    if (proposal.status !== 'tested') throw new Error(`Proposal must be tested, got ${proposal.status}`)
    const updated: ExtensionProposal = { ...proposal, signature, status: 'signed' }
    this.proposals.set(proposalId, updated)
    return updated
  }

  canary(proposalId: string, deployed: boolean): ExtensionProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Unknown proposal ${proposalId}`)
    if (proposal.status !== 'signed') throw new Error(`Proposal must be signed, got ${proposal.status}`)
    const updated: ExtensionProposal = { ...proposal, canaryDeployed: deployed, status: 'approved' }
    this.proposals.set(proposalId, updated)
    return updated
  }

  publish(proposalId: string): ExtensionProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Unknown proposal ${proposalId}`)
    if (proposal.status !== 'approved') throw new Error(`Proposal must be approved, got ${proposal.status}`)
    const updated: ExtensionProposal = { ...proposal, status: 'published' }
    this.proposals.set(proposalId, updated)
    return updated
  }

  reject(proposalId: string, reason: string): ExtensionProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Unknown proposal ${proposalId}`)
    const updated: ExtensionProposal = { ...proposal, status: 'rejected', rejectionReason: reason }
    this.proposals.set(proposalId, updated)
    return updated
  }

  rollback(proposalId: string): ExtensionProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Unknown proposal ${proposalId}`)
    if (proposal.status !== 'published') throw new Error('Can only rollback published proposals')
    const updated: ExtensionProposal = { ...proposal, status: 'rollback' }
    this.proposals.set(proposalId, updated)
    return updated
  }

  getProposal(proposalId: string): ExtensionProposal | undefined {
    return this.proposals.get(proposalId)
  }

  canSelfApprove(proposalId: string, approver: string): { allowed: boolean; reason: string } {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) return { allowed: false, reason: 'Unknown proposal' }
    if (proposal.submittedBy === approver) {
      return { allowed: false, reason: 'Cannot self-approve: submitter cannot be approver' }
    }
    return { allowed: true, reason: 'External approval allowed' }
  }
}
