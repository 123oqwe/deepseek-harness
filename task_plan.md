# DeepSeek Harness First-100 Recovery - Task Plan

## Goal
Repair and integrate the first 100 issues into a real, durable, secure, testable Harness foundation on integration/first-100-rebuild, so all Readiness Hard Gates pass.

## Current State (verified 2026-08-23)
- Integration branch exists, based on upstream/master at b150a551 (correct baseline)
- 57 commits from previous session, 100 evidence dirs created
- 63 issues claim E2E_VERIFIED, 37 are SCAFFOLD
- BLOCKER: typecheck FAILS with 38 errors (tsconfig.host.json syntax error + real code issues)
- 5 first100 gate phases are NOT_RUN stubs (security, recovery, providers, protocol, scale)
- Many E2E_VERIFIED claims are questionable since typecheck fails

## Phases

### Phase 1: Fix typecheck (BLOCKING) - in_progress
- [1.1] Fix tsconfig.host.json missing comma after apps/cli (line 344)
- [1.2] Fix all TS6307 errors (files not listed in project)
- [1.3] Fix TS2305/TS2614 errors (missing exports in test files)
- [1.4] Fix TS2367 policy-engine comparison error
- [1.5] Fix TS2741 StopOrder missing persistent property
- [1.6] Fix TS2345 recovery.spec.ts type mismatches
- [1.7] Fix TS2339 scheduler.spec.ts completed property
- [1.8] Fix TS2353 schema-registry patch property
- [1.9] Fix TS2305 run-plan compile/verifyPlan/CompileInput exports
- [1.10] Fix TS2614 sandbox policy exports
- [1.11] Fix TS2305 plugin-manifest checkWildcardPermissions
- [1.12] Run typecheck, verify PASS, commit

### Phase 2: Fix build and lint - pending
- [2.1] Run pnpm build, fix errors
- [2.2] Run pnpm lint, fix errors
- [2.3] Commit

### Phase 3: Fix first100 gate scripts - pending
- [3.1] Implement security phase (real security tests)
- [3.2] Implement recovery phase (real crash/restart tests)
- [3.3] Implement providers phase (real provider tests)
- [3.4] Implement protocol phase (real protocol tests)
- [3.5] Implement scale phase (real scale tests)
- [3.6] Run each gate, verify PASS, commit

### Phase 4: Audit and fix E2E_VERIFIED issues - pending
- [4.1] For each of 63 E2E_VERIFIED issues, verify evidence is real
- [4.2] Demote any inflated statuses honestly
- [4.3] Fix actual implementation gaps
- [4.4] Re-verify and promote

### Phase 5: Promote SCAFFOLD issues to E2E_VERIFIED - pending
- [5.1-5.37] For each SCAFFOLD issue, implement real integration
- Follow manifest waves 9-19 for remaining SCAFFOLD issues
- Write failing test, implement, verify, evidence

### Phase 6: Final gate - pending
- [6.1] Run pnpm first100:gate
- [6.2] Generate second100-readiness.json
- [6.3] Verify all 15 hard gates pass

## Decisions
| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Fix typecheck first | tsconfig syntax error blocks ALL compilation |
| 2 | Use existing integration branch | Previous session created correct baseline |
| 3 | Don't merge 94 PRs | Manifest forbids it; reference only |
| 4 | Implement real gate phases | NOT_RUN stubs violate manifest |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| tsconfig.host.json syntax error | 1 | Fixing missing comma after apps/cli |
| 38 typecheck errors | 1 | Fixing systematically by error type |
