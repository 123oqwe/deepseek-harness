export type { ProposalState, ProposalDecision, MemoryProposal } from './proposal.ts'
export { createProposal } from './proposal.ts'
export { decideProposal, canAutoMerge, shouldForget, exportProposals, type ExportResult } from './conflict.ts'
