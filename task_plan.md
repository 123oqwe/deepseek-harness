# DeepSeek Harness First-100 Recovery — Task Plan

## Goal
Repair and integrate all 100 first-round issues into a real, durable, secure, testable Harness foundation on `integration/first-100-rebuild`, then unlock P9-P16 only after the Readiness Gate passes.

## Key Facts
- Fork: `123oqwe/deepseek-harness` (remote `fork`)
- Upstream: `deepseek-ai/deepseek-harness` (remote `origin`)
- Fork master SHA: `47f943859bef60e4160492346772ded9b24f765a` (0.1.0-rc.5) — STALE
- Required minimum upstream baseline: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (0.1.1-rc.2) — VERIFIED
- 94 open prototype PRs — REFERENCE ONLY, DO NOT MERGE
- 19 dependency waves, 100 issues total
- All issues must reach E2E_VERIFIED status with complete evidence packages
- 9 required first100:* commands created
- 15 Readiness Hard Gates must all PASS on one commit
- Integration worktree: `/Users/guanjieqiao/dsh-first100-integration`

## Current CI/CD Status (2026-08-23)
- typecheck: PASS
- lint: PASS
- baseline: PASS
- first100:preflight: PASS (baseline verify + issue status report)
- 100 evidence dirs exist, but only 54 E2E_VERIFIED, 46 PARTIALLY_WIRED
- Gate phases security/recovery/providers/protocol/scale are NOT_RUN stubs

## Phase 1: Implement Real Gate Scripts [in_progress]
Replace 5 NOT_RUN stub phases with real test runners:
- security: sandbox escape, attestation, authorization bypass, malicious plugin
- recovery: crash/restart, durable state survival across processes
- providers: Codex/Claude Code/ACP adapter lifecycle
- protocol: version negotiation, capability discovery, event streaming
- scale: resource quotas, backpressure, concurrency

## Phase 2: Upgrade PARTIALLY_WIRED Issues to E2E_VERIFIED [pending]
46 issues need real evidence of main-chain integration:
P0-01, P0-02, P0-03, P0-04, P0-08
P1-01, P1-06, P1-07, P1-08, P1-09, P1-11
P2-01, P2-02, P2-03, P2-05, P2-06
P3-01, P3-03
P4-05, P4-11, P4-12, P4-14
P5-01, P5-04, P5-05, P5-06, P5-07, P5-08, P5-09, P5-10, P5-11, P5-12
P6-01, P6-04, P6-05, P6-09
P7-01, P7-02, P7-03, P7-05, P7-06, P7-07, P7-09, P7-10
P8-03, P8-10

## Phase 3: Generate Readiness Gate [pending]
- Run pnpm first100:gate
- Generate artifacts/evidence/first100/second100-readiness.json
- Verify all 15 hard gates evaluated

## Decisions
| # | Decision | Rationale |
|---|----------|----------|
| 1 | Fresh integration branch from upstream/master | Manifest: old PRs reference only |
| 2 | Port salvageable code selectively | Manifest: extract correct types/algorithms |
| 3 | Run CI/CD after each modification | User requirement |
| 4 | Use .agents/notes/ for Agent Notes | Manifest rule |
| 5 | Status must be E2E_VERIFIED, never PASS | Manifest rule |
| 6 | Replace NOT_RUN stubs with real test runners | Manifest: no echo-only placeholders |
| 7 | Every gate must exit non-zero on failure | Manifest: no error swallowing |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| TS5055 overwrite input file | 1 | Cleaned stale .d.ts from eval lib/types/ |
| Circular dep eval <-> eval-registry | 2 | Created local types.ts in sub-packages |
| Unused @ts-expect-error directives | 3 | Removed (typert files now exist) |
| Unused eslint-disable directives | 4 | Restored needed, removed truly unused |
| Baseline drift after code changes | 5 | Re-captured baseline fingerprint |
| 5 gate phases are NOT_RUN stubs | 6 | Implementing real test runners |
