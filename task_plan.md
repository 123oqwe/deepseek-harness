# DeepSeek Harness 通用化改造 — 总执行计划

## 目标
将 DeepSeek Harness fork (123oqwe/deepseek-harness) 改造成通用 Agent Hypervisor。
基于 100 个优化项，分 19 个依赖 Wave 执行。每项独立 worktree、branch、PR。

## 基线
- 仓库: deepseek-ai/deepseek-harness
- Fork: https://github.com/123oqwe/deepseek-harness.git
- 审计基线: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e (不在本地, master 已移动到 47f943859b)
- 100 个 Issue, 68 P0, 32 P1, 19 Waves

## 当前状态
- 47 branches with implementations (pushed to fork)
- 1 branch (feat/p4-03-run-plan) with uncommitted work
- 52 missing branches

## 执行计划 (按 Wave 顺序)

### Phase A: Wave 8 剩余 (3 issues)
- [ ] P4-03: RunPlan (commit existing untracked work)
- [ ] P4-09: Detached/Saved/Versioned/Nested Workflow
- [ ] P4-11: Unified Retry Classifier, Circuit Breaker & Retry Budget

### Phase B: Wave 9 (11 issues)
- [ ] P1-05, P2-08, P2-09, P2-11, P3-04, P3-05, P4-04, P4-10, P5-01, P5-05, P6-08

### Phase C: Wave 10 (9 issues)
- [ ] P1-11, P1-12, P3-07, P3-08, P5-02, P5-12, P6-09, P7-01, P8-04

### Phase D: Wave 11 (7 issues)
- [ ] P3-11, P5-03, P5-04, P5-06, P6-04, P6-06, P6-10

### Phase E: Wave 12 (4 issues)
- [ ] P5-07, P5-08, P6-05, P7-02

### Phase F: Wave 13 (3 issues)
- [ ] P4-13, P7-03, P7-07

### Phase G: Wave 14 (3 issues)
- [ ] P4-14, P7-04, P7-08

### Phase H: Wave 15 (1 issue)
- [ ] P7-05

### Phase I: Wave 16 (3 issues)
- [ ] P7-06, P7-09, P8-02

### Phase J: Wave 17 (4 issues)
- [ ] P7-10, P8-03, P8-05, P8-06

### Phase K: Wave 18 (4 issues)
- [ ] P5-09, P8-07, P8-08, P8-09

### Phase L: Wave 19 (1 issue)
- [ ] P8-10

### Phase M: PR Creation & Verification
- [ ] Push P4-03 branch to fork
- [ ] Create PRs for all 100 branches on fork
- [ ] Independent verification

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |
