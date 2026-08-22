export type { ClaimNode, EvidenceEdge, DerivedFromEdge, ClaimStatus } from './types.ts'
export { ClaimGraph } from './projector.ts'
export { computeStatus, propagateStatus } from './consistency.ts'
