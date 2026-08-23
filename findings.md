# DeepSeek Harness First-100 Recovery - Findings

## Repository State
- Local clone: /Users/guanjieqiao/deepseek-harness
- Worktree: /Users/guanjieqiao/dsh-first100-integration (branch: integration/first-100-rebuild)
- Remotes: fork=123oqwe/deepseek-harness, origin=deepseek-ai/deepseek-harness
- Upstream master SHA: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e (matches required baseline)
- Fork master SHA: 47f943859bef60e4160492346772ded9b24f765a (stale, as expected)
- Integration branch HEAD: 08aac47cd2 (based on upstream/master b150a551)

## Current Build Status
- typecheck: PASS (0 errors)
- lint: PASS (0 errors)
- baseline:verify: PASS
- first100:preflight: PASS (baseline + status report)

## Evidence Status Summary
- Total evidence dirs: 100 (all issues have dirs)
- E2E_VERIFIED: 54
- PARTIALLY_WIRED: 46
- No SCAFFOLD/REJECTED/BLOCKED/SPEC_ONLY statuses

## Critical Gap: Gate Script Stubs
5 of 9 gate phases are NOT_RUN stubs:
- first100:security: NOT_RUN (no security tests implemented yet)
- first100:recovery: NOT_RUN (no recovery tests implemented yet)
- first100:providers: NOT_RUN (no provider tests implemented yet)
- first100:protocol: NOT_RUN (no protocol tests implemented yet)
- first100:scale: NOT_RUN (no scale tests implemented yet)

These violate manifest rule: "Blocking CI command followed by echo-only placeholder"
And readiness gate G12 requires all these phases to pass on one commit.

## Available Tests for Each Phase
### Security
- packages/sandbox/sandbox/tests/escalation.spec.ts
- packages/sandbox/sandbox/tests/policy.spec.ts
- packages/sandbox/sandbox-policy/tests/policy.spec.ts
- packages/attachment/attachment-security/tests/malicious.spec.ts
- packages/workspace/workspace-trust/tests/trust.spec.ts
- packages/plugin/plugin-host/tests/isolation.spec.ts
- packages/kernel/trust-kernel/tests/*.spec.ts
- packages/identity/*/tests/*.spec.ts
- packages/credentials/*/tests/*.spec.ts

### Recovery
- packages/run/run/tests/recovery.spec.ts
- packages/run/message-bus/tests/crash.spec.ts
- packages/workflow/workflow-journal/tests/resume.spec.ts
- packages/interaction/approval-store/tests/recovery.spec.ts
- packages/llm/llm-retry/tests/transport-recovery.spec.ts
- packages/core/agent-loop/tests/resume.spec.ts

### Providers
- packages/hooks/hooks-codex/tests/bridge.spec.ts
- packages/hooks/hooks-claude-code/tests/bridge.spec.ts
- packages/sdk/protocol/tests/run-lifecycle.spec.ts
- packages/execution/execution-world-container/tests/provider.spec.ts

### Protocol
- packages/sdk/protocol/tests/version-negotiation.spec.ts
- packages/sdk/protocol/tests/resources.contract.spec.ts
- packages/sdk/protocol/tests/transport.spec.ts
- packages/sdk/protocol/tests/event-stream.spec.ts
- packages/hooks/hook-protocol/tests/*.spec.ts

### Scale
- packages/execution/resource-budget/tests/budget.spec.ts
- packages/settings/settings-file/tests/concurrency.spec.ts
- packages/sdk/protocol/tests/resources.contract.spec.ts
