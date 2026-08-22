# P4-09 Nested Workflow Agent Note
## Status: IMPLEMENTED
## Date: 2026-08-22

## What was done
- Created packages/workflow/workflow-registry/ with:
  - src/types.ts: WorkflowDefinition, WorkflowVersion, NestedWorkflowCall, RegistrationResult
  - src/version.ts: compareVersions, isCompatible, resolveVersion
  - src/index.ts: WorkflowRegistry class with register, bindRun, registerNestedCall, cancelNested
  - tests/nested.e2e.ts: 12 tests (all passing)
  - package.json, tsconfig.json, README.md

## Acceptance Criteria
- [x] Save/load does not execute unverified code (definitions are data-only)
- [x] Parent cancellation propagates to children
- [x] Recursion depth, total agents, total budget are limited
- [x] Circular references detected at registration
- [x] Budget attenuation enforced (child ≤ parent)
- [x] Version resolution with major version compatibility

## Tests
12 tests covering registration, binding, nested calls, circular detection, budget attenuation, cancellation, recursion limits, version resolution.

## Dependencies
- P4-08 (Workflow Journal) ✓
- P1-02 (Plugin Provenance) ✓
