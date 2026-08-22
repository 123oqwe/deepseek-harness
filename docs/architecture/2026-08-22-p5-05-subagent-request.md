# Agent Note: P5-05 — Structured SubagentRequest Contract
## Problem
Subagent requests lack structured contract with budget attenuation, capability token, and verification.
## Contract
- SubagentRequest: id, parentId, runId, objective, constraints, capabilityTokenDigest, budgetAllocation, worldId, requiredTools, verificationContractRef, priority, deadline, traceId
- validateSubagentRequest: validates all fields
- attenuateBudget: child budget <= parent budget
## State Machine
pending → dispatched → running → (completed|failed|cancelled)
## Failure Semantics
- Missing required fields: rejected
- Budget exceeding parent: attenuated
- No capability token: rejected
## Rejection
- Empty requiredTools: rejected
- Zero budget: rejected
- Missing worldId: rejected
