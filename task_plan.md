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
- typecheck: PASS (after fixing eval circular dependency + TS5055)
- lint: PASS (after fixing unused eslint-disable directives)
- 975 files changed, 44879 insertions vs upstream/master
- first100:preflight: reports 48 E2E_VERIFIED, 52 SCAFFOLD (exit code 1)

## Evidence Quality Audit
- Full evidence (8 files): P0-01, P0-02, P0-06, P2-01
- Good evidence (5-7 files): P0-03, P0-04, P0-05, P0-07, P0-08, P1-01, P1-07, P1-08, P1-09, P2-02, P2-03, P4-01, P4-05, P6-01, P6-07, P8-01
- Partial evidence (2-3 files): P1-02, P1-03, P2-04, P2-05, P2-06, P2-10, P2-12, P3-01, P4-02, P4-06, P4-07, P4-08, P4-12, P5-10, P5-11, P6-02, P6-03
- Minimal evidence (1 file = just status.json): P1-04, P1-06, P1-10, P2-07, P3-02, P3-03, P3-06, P3-09, P3-10, P3-12, P4-09, P4-11
- SCAFFOLD (50 issues): P1-05, P1-11, P1-12, P2-08, P2-09, P2-11, P3-04, P3-05, P3-07, P3-08, P3-11, P4-04, P4-10, P4-13, P4-14, P5-01 through P5-09, P5-12, P6-04, P6-05, P6-06, P6-08, P6-09, P6-10, P7-01 through P7-10, P8-02 through P8-10

## Priority Work Order

### Phase A: Fix Minimal-Evidence Issues [in_progress]
12 issues claim E2E_VERIFIED with only status.json — violates manifest "handwritten pass summaries rejected"
Must generate: pre-audit.json, commands.jsonl, raw/ logs, tests/, changed-files.txt, artifact-digests.json, remaining-risks.md

### Phase B: Complete SCAFFOLD Issues (Waves 7-19) [pending]
50 issues need implementation verification and evidence generation

### Phase C: Final Gate [pending]
Run pnpm first100:gate, generate second100-readiness.json, verify all 15 hard gates

## Decisions
| # | Decision | Rationale |
|---|----------|----------|
| 1 | Fresh integration branch from upstream/master | Manifest: old PRs reference only |
| 2 | Port salvageable code selectively | Manifest: extract correct types/algorithms |
| 3 | Run CI/CD after each modification | User requirement |
| 4 | Use .agents/notes/ for Agent Notes | Manifest rule |
| 5 | Status must be E2E_VERIFIED, never PASS | Manifest rule |
| 6 | Break eval circular dependency with local types.ts | tsc -b cannot resolve circular imports |
| 7 | Clean stale .d.ts files from eval lib/types/ | TS5055: output treated as input |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| TS5055 overwrite input file | 1 | Cleaned stale .d.ts from eval lib/types/ |
| Circular dep eval <-> eval-registry | 2 | Created local types.ts in sub-packages |
| Unused @ts-expect-error directives | 3 | Removed (typert files now exist) |
| Unused eslint-disable directives | 4 | Restored needed, removed truly unused |
| Indentation error gen-typert | 5 | Fixed 7-space to 8-space indentation |
| Missing catch block gen-typert | 6 | Restored after python edit |
