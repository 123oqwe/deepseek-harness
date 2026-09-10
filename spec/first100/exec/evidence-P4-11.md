# Evidence package — P4-11 统一 Retry Classifier、Circuit Breaker 与 Retry Budget

Started after `check-ready.mjs` reported **READY**: every predecessor (`P4-01`, `P4-12`) is ACCEPTED or fully landed, and the declared file set does not overlap any in-flight epic. Wave membership is not a start condition — the gate's own rule is that a predecessor expresses "I need your work to exist", not "I need your books closed" (BLOCKED-087). This is not the §12.55 shape: there, P9-08's predecessor `P7-09` was entirely NOT_RUN.

## Mandated subtask split

The registry records a spec gap for this epic: **"Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务"**. Implementation may not begin against the 10-file declaration, so the split is the first deliverable and is recorded here before any code.

| subtask | stage | files | what it decides |
| --- | --- | --- | --- |
| **C — decision semantics** | Contract | `packages/reliability/retry/src/classify.ts` [N], `src/budget.ts` [N], `src/circuit.ts` [N], `tests/retry.spec.ts` [N] | 4 files. Pure and total: the failure taxonomy and its retryability, the single run budget's accounting, and the circuit's state decisions. No I/O, no ambient clock — `nowMs` is a parameter, as `decideTransition` and `classify` already are in P4-05 and P2-04. |
| **P — the runtime seam** | Provider | `packages/reliability/retry/src/index.ts` [N], `packages/llm/llm/src/adapter-failure.ts` [B], `packages/llm/llm/src/retry-policy.ts` [B] | 3 files. Translates real adapter failures into the taxonomy the Contract stage decides on, and exposes the policy the LLM layer already consults. |
| **U — the consumers** | Usage | `packages/llm/llm-retry/src/index.ts` [B], `packages/llm/llm-retry/src/history.ts` [B], `packages/core/agent-loop/src/agent.ts` [B] | 3 files. The clause that makes the epic real: **every layer consumes the SAME `RunRetryBudget`**. Without this the module is another decision surface with no caller — the shape 4.4a exists to catch, and the one this program has found in P2-03, P4-05, P4-08, P4-09, P4-12 and P5-11. |

No migration subtask: nothing durable changes format. No separate assurance subtask: the Fault stage's boundary matrix rides the Contract stage's own test file, as P2-04's does.

## Clause map, and what each subtask must actually establish

| clause | subtask | note |
| --- | --- | --- |
| must[0] 统一错误 taxonomy 与 retryability | C | The taxonomy is the Contract. |
| must[1] 所有层消费同一 RunRetryBudget | **U** | Deliberately NOT C. A budget type nothing consumes would satisfy the noun and not the clause; "所有层" is a statement about callers. |
| must[2] exponential backoff+jitter、Retry-After、provider circuit breaker、hedge exclusion | C (decisions) + P (Retry-After parsing) | Jitter is a decision over an injected random source, not a call to `Math.random`, so the Contract stays pure and testable. |
| must[3] 有副作用动作只有在 idempotency/reconciliation 保证下可重试 | C + U | The predicate is P4-12's ledger state; this epic decides retryability FROM it rather than re-deciding idempotency. |
| acceptance[0] 永久 4xx、policy deny、invalid input 不重试 | C | |
| acceptance[1] 多个插件不能使总重试超过 Run budget | **U** | Two registered retry layers, one budget, measured through the real path. |
| acceptance[2] provider 故障时 circuit 打开且可恢复 | C (state) + P (provider identity) | |

## Package placement

`packages/reliability/retry` is a new group. Under `scripts/architecture/layer-order.ts` the Contract stage is a pure decision module with no service of its own, so it classifies as `capability-definitions`; the LLM-facing seam in the P subtask stays in the existing `llm` packages rather than importing upward. The group's layer must be registered in `layer-order.ts` before the first import lands, or `architecture:layers` reports it unclassified.

## Status

**Split recorded; no code written.** The C subtask is the next unit of work: three pure modules plus their test file, then a sensitivity proof, then the SPEC-FREEZE entry — in that order, since `command-freeze.json` requires `dryRunProof.testsDiscovered` and a `sensitivityProof`, both of which need the tests to exist. Nothing is frozen and nothing is claimed.

## 4.4a — where the epic's decisions are actually consumed

Measured at `e5488e86c6` (the same tree as the CI observation at `874db203f0`, on which P4-11's C/U/F cells are green). Each row names a PRODUCTION call site, not a test.

| clause | production call site | what it consumes |
| --- | --- | --- |
| must[1] 所有层消费同一 RunRetryBudget | `packages/llm/llm-retry/src/index.ts:249` resolves `ctx.get('runRetryUsage')`; `:251` maps this session to its charged run via `chargedRunFor` + `chargedRun`; `:265` calls `budgets.admit(charged, delayMs)` and returns `next()` — declining to retry — when the run's budget refuses. | `RunRetryUsageContract.admit`, `packages/reliability/retry/src/usage.ts:190`. One call decides AND records, so no caller can consult without charging. |
| must[1] 归属:child 记到父 run | `packages/reliability/retry/src/root.ts:46` walks `parentSession` to the root and returns THAT session's `RunId`; the walk is cycle-guarded (`seen`). `llm-retry` supplies the lookup from the live agent registry (`index.ts:252-260`), so a child's retry is charged to the run its parent holds rather than to an allowance of its own. | `chargedRun`, memoized per session by `chargedRunFor` (`usage.ts:200`). |
| must[2] provider circuit breaker | `packages/llm/llm/src/index.ts:1071` calls `guardedFirstChunk` inside the same `try` that converts an adapter throw into a terminal chunk; `:1013` wraps the FIRST chunk pull in `breaker.execute({ provider, baseUrl, model }, ...)` with `llmFailureFacts` as the classifier. The destination key is per (provider, baseUrl, model), so one model's outage does not open another's. | `CircuitBreakerContract.execute`, `packages/reliability/retry/src/provider.ts`; the shipped implementation is `packages/reliability/retry-cockatiel`. |

**Absence is capability absence, not permission.** Both consumers resolve their service with `ctx.get` and fall through to their pre-epic behaviour when it is not mounted (`llm-retry` keeps its per-session policy; `llm/llm` pulls the first chunk directly). A composition that mounts neither behaves exactly as it did before this epic, which is why `inject` would be wrong here: a hard dependency would stop both plugins registering in every composition that does not mount the retry family.
