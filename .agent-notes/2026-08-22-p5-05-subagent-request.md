# P5-05 SubagentRequest Agent Note
## Status: IMPLEMENTED
## Date: 2026-08-22
## What was done
- Created packages/subagent/subagent/src/request.ts
- SubagentRequest with 13 fields including capabilityTokenDigest, budgetAllocation, worldId, verificationContractRef
- validateSubagentRequest with 8+ checks
- attenuateBudget: child budget cannot exceed parent
- 9 tests all passing
## Acceptance Criteria
- [x] Structured request with all required fields
- [x] Budget attenuation enforced
- [x] Capability token required
- [x] Verification contract ref is optional extension point
## Dependencies: P2-02, P4-03
