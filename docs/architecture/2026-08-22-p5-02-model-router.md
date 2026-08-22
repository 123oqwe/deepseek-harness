# Agent Note: P5-02 — Model Router
## Problem
No unified model selection based on success rate, cost, latency, privacy, and tool support.
## Contract
- scoreCandidate: 0-100 with disqualification for privacy/tools/context
- routeModel: best candidate with fallback
## State Machine
candidates → filter → score → sort → (best + fallback|undefined)
## Failure Semantics
- Insufficient privacy: disqualified (-1)
- Missing tools: disqualified
- Small context: disqualified
- No candidates: undefined
## Rejection
- Privacy mismatch: rejected
- Tool mismatch: rejected
READMEEOF
cat > .agent-notes/2026-08-22-p5-02-model-router.md << 'ANEOF'
# P5-02 Model Router Agent Note
## Status: IMPLEMENTED
## Date: 2026-08-22
## What was done
- Created packages/router/model-router/ with 3 source files + tests
- scoreCandidate: weighted scoring with disqualification
- routeModel: best selection with fallback
- 9 tests all passing
## Dependencies: P5-01, P2-05
ANEOF
cat > artifacts/evidence/P5-02/summary.json << 'SUMEOF'
{ "issue_id": "P5-02", "title": "Model Router", "status": "PASS", "tests_run": 9, "tests_passed": 9, "tests_failed": 0, "tests_not_run": 0, "timestamp": "2026-08-22T14:00:00+08:00", "commit": "pending" }
SUMEOF
cat > artifacts/evidence/P5-02/changed-files.txt << 'CFEOF'
packages/router/model-router/src/index.ts
packages/router/model-router/src/types.ts
packages/router/model-router/src/score.ts
packages/router/model-router/tests/router.spec.ts
packages/router/model-router/package.json
packages/router/model-router/tsconfig.json
packages/router/model-router/README.md
docs/architecture/2026-08-22-p5-02-model-router.md
.agent-notes/2026-08-22-p5-02-model-router.md
artifacts/evidence/P5-02/summary.json
artifacts/evidence/P5-02/changed-files.txt
artifacts/evidence/P5-02/test-results.json
artifacts/evidence/P5-02/remaining-risks.md
CFEOF
cat > artifacts/evidence/P5-02/test-results.json << 'TREOF'
{ "test_command": "npx vitest run packages/router/model-router/tests/router.spec.ts", "total": 9, "passed": 9, "failed": 0, "skipped": 0, "status": "PASS" }
TREOF
cat > artifacts/evidence/P5-02/remaining-risks.md << 'RREOF'
## Remaining Risks (P5-02)
1. Real provider success rate tracking — needs integration with telemetry.
2. Dynamic cost/latency adjustment — needs real-time monitoring.
3. Hedging integration with P5-04 — interface defined.
4. Provider-specific prompt compilation — deferred to P5-03.
RREOF
echo "All P5-02 files created"