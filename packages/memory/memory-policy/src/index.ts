/**
 * P6-03 proposal policy (`@deepseek-ai/dsh-memory-policy`): the provider that
 * decides whether a candidate memory write is auto-accepted, sent to human
 * review, or rejected, and the pure decision it applies. `@deepseek-ai/dsh-memory`
 * consults the mounted `memoryProposalPolicy` service from its `propose` path.
 * @module @deepseek-ai/dsh-memory-policy
 */

export { default, Config } from './policy.ts'
export { decideProposal } from './proposal.ts'
export type {
  MemoryProposalDecision,
  MemoryProposalDisposition,
  MemoryProposalThresholds,
} from './proposal.ts'
