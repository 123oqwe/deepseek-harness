# Agent Note: P5-01 — Strategy Router
## Problem
No unified strategy router to decide between direct, ReAct, plan, workflow, and multi-agent execution.
## Contract
- RoutingContext: task complexity, tools, planning, multi-agent, steps, side effects, feature gate
- evaluateRules: context → strategy with confidence and fallback
- 5 strategies: direct, react, plan, workflow, multi-agent
## State Machine
input → evaluateRules → (direct|react|plan|workflow|multi-agent)
## Failure Semantics
- Shadow mode: logs but doesn't change behavior
- Deterministic: same input always same output
## Rejection
- Feature gate 'off': no routing (would return direct)
