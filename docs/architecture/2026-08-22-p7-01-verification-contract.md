# Agent Note: P7-01 — VerificationContract
## Problem
No way to freeze verifiable success criteria before execution starts.
## Contract
- VerificationContract: id, runPlanId, objective, criteria, verifierId, digest, status, expiryMs
- freezeContract, evaluateContract, validateContract, checkInvariants, isSatisfied
## State Machine
draft → frozen → (satisfied|failed|expired)
## Failure Semantics
- Unevaluated criteria: invariant violation
- Expired: invariant violation
- Criteria not met: failed
## Rejection
- Draft contract evaluated: rejected
- Expired contract: rejected
