# @deepseek-ai/dsh-strategy-router
Strategy router: Direct / ReAct / Plan / Workflow / Multi-Agent.
## Overview
- evaluateRules: context → strategy decision
- 5 strategies: direct, react, plan, workflow, multi-agent
- Shadow mode logs decisions without changing behavior
- Deterministic: same input always produces same decision
## Key Invariants
- Decisions have confidence score
- Fallback strategy provided for all non-direct strategies
- Shadow mode is observable
