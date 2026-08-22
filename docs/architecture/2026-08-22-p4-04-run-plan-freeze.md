# Agent Note: P4-04 — RunPlan Freeze, Signature & Amendment Protocol
## Problem
Dynamic Agent can change policy; without freeze and amendment protocol, audit cannot determine if actual execution matches approved plan.
## Contract
- freezePlan: canonicalize + kernel sign → FrozenPlan
- verifyFrozenPlan: signature + digest verification
- AmendmentProtocol: proposeAmendment with approval requirements
- canSelfEscalate: budget/approval changes require external approval
## State Machine
frozen → (amendment → approved?) → new frozen revision
## Failure Semantics
- Signature mismatch: tampered plan detected
- Digest mismatch: content modified after freeze
- Self-escalation: rejected
- Unapproved budget expansion: pending-approval
## Rejection
- Tampered plan: rejected
- Self-escalation: rejected
- Concurrent amendments: only first becomes active (CAS)
