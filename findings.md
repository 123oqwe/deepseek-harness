# Findings: DeepSeek Harness First-100 Recovery

## Repository State (2026-08-22)

### Remotes
- fork: https://github.com/123oqwe/deepseek-harness.git (user's fork)
- origin: https://github.com/deepseek-ai/deepseek-harness (upstream)

### Integration Branch
- Branch: integration/first-100-rebuild (6 commits ahead of origin/master)
- Base SHA: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e (upstream 0.1.1-rc.2)
- HEAD: 44b894995c (Wave0/1 scaffold + evidence commit)

### Status Distribution
- WIRED: 3 (P0-01, P0-03, P0-06)
- PARTIALLY_WIRED: 1 (P0-02)
- SCAFFOLD: 4 (P0-05, P0-07, P1-01, P2-01)
- NOT_STARTED: 92

### Key Manifest Rules
1. Do not merge 94 prototype PRs (reference only)
2. Create integration/first-100-rebuild from latest upstream/master
3. Each item: pre-audit -> failing test -> implement -> verify -> evidence
4. Durable = kill -9 + restart across different processes
5. No Map/Set/Array as production durability
6. No hardcoded attestation
7. No || true, continue-on-error, TBD, empty scenarios
8. Evidence status: BLOCKED/REJECTED/SPEC_ONLY/SCAFFOLD/PARTIALLY_WIRED/E2E_VERIFIED
9. No P9-P16 until readiness gate passes

### Dependency Waves (from manifest)
- Wave 1: P0-01 (done)
- Wave 2: P0-02, P0-06 (done)
- Wave 3: P0-03, P0-05, P0-07, P1-01, P2-01 (done - scaffold)
- Wave 4: P0-04, P0-08, P1-02, P1-07, P1-08, P1-09, P2-02, P2-03, P4-01, P6-01, P6-07
- Wave 5: P1-03, P2-04, P4-05, P4-06, P6-02, P8-01
- Wave 6-19: remaining issues through P8-10

### Wave 4 Issue Details

P0-04 (layer-deps):
- Prototype: scripts/architecture/check-layer-deps.mjs, tests/architecture/layer-deps.spec.ts
- Must wire: package.json, pnpm-workspace.yaml
- Acceptance: no unexempted cycles, kernel->UI deps fail, <10s, CI blocking
- Required proof: architecture/static, shipping build/boot/CI integration

P4-01 (run-service):
- Prototype: packages/run/run/src/* (uses module-level Map)
- Must wire: packages/core/session, packages/core/agent, packages/workflow, packages/session/session-persistence
- Acceptance: cross-process recovery, illegal transitions rejected, RunState schema authoritative
- Required proof: separate-process kill/restart, external-state reconciliation

P6-01 (memory-service):
- Prototype: packages/memory/memory/src/* (InMemoryProvider)
- Must wire: agent loop, context graph
- Acceptance: durable storage, provider-neutral, wired into agent loop
- Required proof: separate-process kill/restart
