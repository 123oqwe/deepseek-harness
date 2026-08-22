 # DeepSeek Harness General-Purpose Optimization Plan

 ## Goal
 Transform the DeepSeek Harness from developer-preview to a general-purpose Agent Hypervisor
 by implementing all 100 issues from the optimization manifest.

 ## Key Facts
 - Repo: /Users/guanjieqiao/deepseek-harness
 - Fork: github.com/123oqwe/deepseek-harness
 - Origin: github.com/deepseek-ai/deepseek-harness
 - Current HEAD: 47f943859b (manifest references b150a551 which does not exist locally)
 - 100 issues, 19 dependency waves, 9 phases, 68 P0 + 32 P1
 - Each issue: one branch, one PR, red-light tests first, evidence package

 ## Phases Overview
 - Phase 0 (8 issues): Baseline, migration, engineering gates
 - Phase 1 (12 issues): Plugin supply chain & dynamic extension governance
 - Phase 2 (12 issues): Identity, capability, approval, human boundary
 - Phase 3 (12 issues): Execution world, sandbox, secrets, resource governance
 - Phase 4 (14 issues): Durable run, workflow, recovery, external reconciliation
 - Phase 5 (12 issues): Strategy router, model router, adapters, taskboard
 - Phase 6 (10 issues): Memory, context, artifact, evidence, privacy
 - Phase 7 (10 issues): Verification, evidence, independent verifier, acceptance gate
 - Phase 8 (10 issues): Protocol, remote resources, lifecycle, governance, DR

 ## Dependency Waves (execution order)
 - Wave 1: P0-01
 - Wave 2: P0-02, P0-06
 - Wave 3: P0-03, P0-05, P0-07, P1-01, P2-01
 - Wave 4: P0-04, P0-08, P1-02, P1-07, P1-08, P1-09, P2-02, P2-03, P4-01, P6-01, P6-07
 - Wave 5: P1-03, P2-04, P4-05, P4-06, P6-02, P8-01
 - Wave 6: P2-05, P4-02, P4-07
 - Wave 7: P2-06, P2-10, P2-12, P3-01, P4-08, P4-12, P5-10, P5-11, P6-03
 - Wave 8: P1-04, P1-06, P1-10, P2-07, P3-02, P3-03, P3-06, P3-09, P3-10, P3-12, P4-03, P4-09, P4-11
 - Wave 9: P1-05, P2-08, P2-09, P2-11, P3-04, P3-05, P4-04, P4-10, P5-01, P5-05, P6-08
 - Wave 10: P1-11, P1-12, P3-07, P3-08, P5-02, P5-12, P6-09, P7-01, P8-04
 - Wave 11: P3-11, P5-03, P5-04, P5-06, P6-04, P6-06, P6-10
 - Wave 12: P5-07, P5-08, P6-05, P7-02
 - Wave 13: P4-13, P7-03, P7-07
 - Wave 14: P4-14, P7-04, P7-08
 - Wave 15: P7-05
 - Wave 16: P7-06, P7-09, P8-02
 - Wave 17: P7-10, P8-03, P8-05, P8-06
 - Wave 18: P5-09, P8-07, P8-08, P8-09
 - Wave 19: P8-10 (Final Release Gate)

 ## Per-Issue Process
 1. Read implementation_prompt from YAML manifest
 2. Verify dependency evidence packs exist
 3. Create worktree + branch
 4. Write Agent Note (contract, state machine, failure semantics)
 5. Write red-light tests first
 6. Save pre-change failure evidence
 7. Implement minimal complete Capability Seam
 8. Update docs, schema, SDK, golden fixtures
 9. Run targeted tests
 10. Run build, typecheck, lint, duplication, test, coverage
 11. Run phase-specific gate
 12. Generate artifacts/evidence/ISSUE-ID/
 13. Only merge if all acceptance criteria pass

 ## Status
 - [x] Phase: Planning & Setup
 - [ ] Wave 1: P0-01
 - [ ] Wave 2: P0-02, P0-06
 - [ ] Wave 3: P0-03, P0-05, P0-07, P1-01, P2-01
 - [ ] Waves 4-19: Pending
