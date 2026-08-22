# Agent Note: P1-11 — Extension Proposal Pipeline
## Problem
Dynamic Cordis self-modification allows agents to modify production without proposal, evaluation, canary, signature, or approval.
## Contract
- 7-stage pipeline: draft → scan → test → sign → canary → approve → publish
- Self-approval prevented
- Rollback support
## State Machine
drafted → scanned → tested → signed → approved → published → (rollback|rejected)
## Failure Semantics
- Scan failure: rejected
- Test failure: rejected
- Out-of-order: error
- Self-approval: rejected
## Rejection
- Submitter as approver: rejected
- Unscanned proposal at test stage: error
