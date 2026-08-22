# Agent Note: P2-09 — Multi-person Approval & Separation of Duties
## Problem
Single-user approval cannot express maker-checker, two-person rules, or legal+finance governance.
## Contract
- QuorumSpec: requiredRoles, minApprovals, mutualExclusion, ordered, timeoutMs
- ApprovalQuorum: initiate, submitVote, checkExpiry
- All votes bound to same actionManifestDigest
## State Machine
pending → (satisfied|denied|expired)
## Failure Semantics
- Initiator approval: rejected (separation of duties)
- Any deny: entire request denied
- Mutual exclusion violation: rejected
- Ordered violation: rejected
- Timeout: expired
## Rejection
- Duplicate approver: rejected
- Unknown role: rejected
- Digest mismatch: rejected
