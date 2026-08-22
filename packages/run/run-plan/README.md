# @deepseek-ai/dsh-run-plan

RunPlan: model, agent, tool, world, budget, and verification compiled into an auditable, freezable, recoverable execution specification.

## Overview

RunPlan is the frozen, signed execution specification that connects:
- Model routes (provider, model, fallback)
- Agent graph (nodes with roles, tools, world assignments)
- Execution worlds (local, container, remote)
- Budgets (tokens, cost, time, agents)
- Approval gates
- Verification contract reference
- Recovery strategy

## API

```typescript
import { compile, verifyPlan, type CompileInput } from '@deepseek-ai/dsh-run-plan'

const plan = compile(input)
// plan.digest is a SHA-256 hash of the canonicalized plan
```

## Architecture

- `compile()`: Takes CompileInput, performs satisfiability checks, produces a deterministic RunPlan with digest
- `verifyPlan()`: Validates a plan's internal consistency
- Plan is data only; no executable code is embedded
- `verificationContractRef` is a versioned extension point for P7-01

## Non-Goals

- No vertical domain logic (sales, finance, medical, etc.)
- No arbitrary code execution in plans
- No direct model calls
