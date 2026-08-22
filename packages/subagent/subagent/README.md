# @deepseek-ai/dsh-subagent-request
Structured SubagentRequest contract.
## Overview
- SubagentRequest: id, parentId, runId, objective, constraints, capabilityToken, budget, world, tools, verification
- validateSubagentRequest: validates all required fields
- attenuateBudget: child budget cannot exceed parent budget
## Key Invariants
- Capability token required for all subagent requests
- Budget attenuation: child <= parent
- Required tools must be declared
- Trace ID for causality tracking
