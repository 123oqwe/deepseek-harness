import type { MemoryProposal, ProposalDecision } from './proposal.ts'

export function decideProposal(proposal: MemoryProposal): ProposalDecision {
  if (proposal.sensitivity === 'restricted') return 'review'
  if (proposal.evidence.length === 0) return 'reject'
  if (proposal.sensitivity === 'confidential') return 'review'
  return 'auto-accept'
}

export function canAutoMerge(proposal: MemoryProposal): boolean {
  return decideProposal(proposal) === 'auto-accept'
}

export function shouldForget(proposal: MemoryProposal, now: Date = new Date()): boolean {
  if (proposal.state === 'forgotten') return true
  if (proposal.ttl) {
    const expiry = new Date(proposal.createdAt).getTime() + proposal.ttl * 1000
    if (expiry < now.getTime()) return true
  }
  return false
}

export interface ExportResult {
  readonly exported: number
  readonly skipped: number
  readonly skippedReasons: string[]
}

export function exportProposals(proposals: MemoryProposal[], tenantId: string, includeRestricted: boolean = false): ExportResult {
  let exported = 0
  let skipped = 0
  const skippedReasons: string[] = []

  for (const p of proposals) {
    if (p.tenantId !== tenantId) {
      skipped++
      skippedReasons.push(`${p.id}: wrong tenant`)
      continue
    }
    if (!includeRestricted && p.sensitivity === 'restricted') {
      skipped++
      skippedReasons.push(`${p.id}: restricted sensitivity`)
      continue
    }
    if (p.state !== 'accepted' && p.state !== 'merged') {
      skipped++
      skippedReasons.push(`${p.id}: not accepted (state=${p.state})`)
      continue
    }
    exported++
  }

  return { exported, skipped, skippedReasons }
}
