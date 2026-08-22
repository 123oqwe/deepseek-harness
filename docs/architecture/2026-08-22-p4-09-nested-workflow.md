# Agent Note: P4-09 — Detached, Saved, Versioned & Nested Workflow

## Problem
Current workflow is owned by holder; no saved/nested workflow; holder disposal ends run.

## Contract
WorkflowRegistry manages:
- WorkflowDefinition: id, version, scriptDigest, meta, budget, failureStrategy, digest
- WorkflowDefinitionRef: definitionId, version, digest (used by runs)
- NestedWorkflowCall: parentRunId, childDefinitionRef, depth, attenuatedBudget, capabilityTokenDigest, traceId

## State Machine
registered → bound-to-run → executing → completed/failed/cancelled

## Failure Semantics
- Circular reference: rejected at registration
- Budget attenuation violation: rejected
- Recursion depth exceeded: rejected
- Parent cancellation: propagated to all nested children

## Compatibility
- Major version compatibility for version resolution
- Digest pinning for exact definition matching
- Old runs reference old digests; version upgrade requires explicit migration

## Rejection
- Unregistered definition: rejected
- Digest mismatch: rejected
- Budget exceeding parent: rejected
