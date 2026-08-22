# Agent Note: P5-06 — SubagentResult with Evidence Return
## Contract
- SubagentResult: status, output, artifacts, evidence, metrics
- validateResult, mergeResults
## State Machine
request → executing → (completed|failed|cancelled|partial)
## Dependencies: P5-05, P6-09
