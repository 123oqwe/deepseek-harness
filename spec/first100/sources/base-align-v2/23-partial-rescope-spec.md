# 23 个 PARTIAL epic 的 gap-over-upstream 缩范围规格

> **来源**: gap 分析 workflow wf_de508756-1b2(11-agent 逐条查上游 4e84901e)。
> **性质**: BASE-ALIGN-v2(W3 关账后、重锚到 4e84901e)时,由执行会话据此把这 23 项的 registry MUST/acceptance/files **缩成"只补 delta"**。
> **纪律(不可违反)**: 只删"上游确实已提供"的部分;**绝不丢真实需求、绝不扩范围**——是 dedup 不是弱化;每条落 registry 前独立复审 + 附上游覆盖证据 + 记 manifest-patch。
> **时机**: 现在只作为 durable 可复核规格存在(不改 live registry,因缩范围是对新基线的 gap,必须重锚后才落);registry 变更在 BASE-ALIGN-v2 内做。

## P3-03 — 结构化 Out-of-Band Denial 与执行错误
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 trusted denialSignatures + typed SANDBOX_UNAVAILABLE;只补完整 typed outcome union(policy_denied/resource_exhausted/timeout/cancelled/world_lost)
- **上游已覆盖(据实测)**: sandbox/sandbox/src/index.ts defines ONE typed code `SANDBOX_UNAVAILABLE` (SandboxUnavailableError extends HarnessError, carried through tool/result structured error channel) and a trusted-dialect denial model: ConfinedArgv.denialSignatures (per-backend stderr substrings) + runnerFailureRules (Runne
- **判定依据**: MUST partially met: the design deliberately separates a TRUSTED backend denial dialect (denialSignatures matched against the backend's own EROFS/EACCES/EPERM text, plus exit-code gates and runner-failure rules) from model-controllable output, and SANDBOX_UNAVA

## P3-05 — Process、Syscall、IPC 与 Device 隔离
- **上游冲突风险**: HIGH
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 bwrap PID-ns + Landlock + Seatbelt + Windows-ACL(仅文件+进程);只补 seccomp + IPC/剪贴板/摄像头/GPU/USB/Docker-socket/SSH-agent 词汇
- **上游已覆盖(据实测)**: sandbox-local/src/profiles.ts: bwrapProfileArgs uses `--unshare-pid --proc /proc --die-with-parent` (a private PID namespace — bwrap.e2e.ts asserts 'runs in a private PID namespace'), plus Landlock (landlockProfileArgs) and Seatbelt (seatbeltProfileArgs). New packages/sandbox/sandbox-windows-acl/ pr
- **判定依据**: MUSTs 1-3 partially present as FILE-confinement backends (Linux bwrap PID-namespace + Landlock; macOS Seatbelt; Windows restricted-token ACL) — and bwrap's PID namespace incidentally makes host processes invisible on Linux. But MUST 4 (explicit control of Unix

## P3-07 — 本地 Sandbox 跨平台 Fail-Closed 强化
- **上游冲突风险**: HIGH
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有功能性启动探针 + refuse-not-warn + 统一 canonicalization;只补 attestation artifact + 跨平台 conformance 套件
- **上游已覆盖(据实测)**: sandbox-local/src/index.ts: startup FUNCTIONAL probes (defaultProbeSeatbelt applies a real read-only profile; probeLandlock/probeBwrap chain arbitration), SandboxEnforcement 'full'|'partial' reported per confine(), and SandboxUnavailableError fail-closed with no silent unconfined passthrough (index.
- **判定依据**: Most fail-closed MUSTs met: startup probing of available isolation, refuse-rather-than-warn (SandboxUnavailableError), requested⊆supported reflected via enforcement completeness, unified path canonicalization + writable roots + read-only system paths, and dang

## P3-12 — Workspace 路径、附件准入与恶意输入边界强化
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 realpath canon + 图片 base64/尺寸准入;只补 TOCTOU inode 复验 + MIME/polyglot/zip-bomb 检测 + 隔离世界解析
- **上游已覆盖(据实测)**: workspace/workspace/src/paths.ts: realpathNormalize = fs.realpath (resolves symlinks/../ ONCE at record time — 'the ONE uniqueness canon'); used in index.ts adopt/create. No path-race.e2e.ts test exists (git ls-tree workspace/tests grep race = empty), no openat/O_NOFOLLOW/lstat/inode re-validation (
- **判定依据**: Partial foundations only: workspace canonicalizes symlinks via realpath (blocks static symlink swaps at record time) but NOT race-safe (no inode re-validation / openat before use — the TOCTOU MUST is unmet); attachment enforces base64-canonical + size/count/me

## P4-05 — 扩展 Agent Lifecycle 状态机
- **上游冲突风险**: LOW
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 durable inbox projection(state vs UI-disconnect);只补 validated state enum + 每转换的 reason/runId/lease-epoch
- **上游已覆盖(据实测)**: No packages/core/agent/src/state-machine.ts at 4e84901 (git ls-tree of core/agent/src shows no state/lifecycle file). Building blocks exist: inbox.ts ('Incremental projection of durable agent inbox events', agent/inbox/spliced) gives durable-vs-UI separation; runtime-types.ts/consumed-work.ts model 
- **判定依据**: MUST#3 (durable state separate from UI disconnect) substantially embodied by durable inbox + holder-owned model; MUST#1 (full validated state enum) and MUST#2 (reason+runId+lease epoch per transition) unmet — lease epoch does not exist anywhere.

## P4-06 — Durable Inbox / Outbox 与 Exactly-Once Effect Handoff
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 durable inbox 半边;只补 事务性 outbox + 幂等 receipt + consumer 去重 + DLQ/backpressure + 租户隔离
- **上游已覆盖(据实测)**: Durable inbox half exists: core/agent/src/inbox.ts is an append/replay projection over durable agent/inbox/spliced session events with validation; session-persistence/coordinator.ts (+243 lines upstream) and write-behind.ts provide durable write coordination. But git grep outbox over packages/**/src
- **判定依据**: Durable inbox projection is present, but the transactional domain-event+outbox write, idempotent-receipt marking, consumer dedup, DLQ/backpressure, and tenant isolation MUSTs are all missing — exactly-once handoff not provided.

## P4-10 — Workflow 预算、Scheduler、Backpressure、公平性与资源锁
- **上游冲突风险**: LOW
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 in-workflow 并发槽;只补 多维 BudgetSpec + 层级累积 + 租户公平/aging + 资源锁
- **上游已覆盖(据实测)**: packages/run/scheduler absent. workflow-worker-thread/src/runtime.ts has only in-workflow concurrency slots + a queued-waiter tick (bounds queueing within one workflow). No BudgetSpec over tokens/cost/time/agents/tool-calls/world-resources, no parent-child budget accumulation, no tenant fairness/pri
- **判定依据**: A rudimentary max-concurrency slot limiter partially touches MUST#2 (max concurrency) and MUST#4 (bounded queuing), but multi-dimensional BudgetSpec, hierarchical accumulation, tenant fairness/aging, resource locks and exclusive tools are entirely absent — the

## P4-11 — 统一 Retry Classifier、Circuit Breaker 与 Retry Budget
- **上游冲突风险**: LOW
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 LLM 层 backoff+jitter+retryable-codes;只补 跨层 taxonomy + 共享 RunRetryBudget + circuit breaker + Retry-After + 幂等门控重试
- **上游已覆盖(据实测)**: packages/llm/llm-retry/src/index.ts provides bounded exponential backoff + symmetric jitter; llm/src/retry-policy.ts defines retryableCodes classification and backoff schema. But grep over llm-retry+retry-policy for circuit/budget/Retry-After/hedge = none. packages/reliability/retry absent. Retry is
- **判定依据**: Backoff+jitter and a retryable-code taxonomy exist for the LLM layer, but the unified cross-layer taxonomy, a shared RunRetryBudget consumed by all layers, provider circuit breaker, Retry-After honoring, hedge exclusion, and side-effect idempotency-gated retry

## P4-14 — Partial-Turn Resume、Durable Schedule/Goal Trigger
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 durable schedule/goal + transcript 边界修复;只补 turn-checkpoint + ledger/journal 驱动的 exactly-once resume 决策
- **上游已覆盖(据实测)**: Strong durable-trigger infra exists upstream: packages/schedule/schedule (domain.ts resolveLocalInstant handles DST overlap/gap, types.ts 'advances directly past missed occurrences', runtime.ts claim/rechecks wall clock) and packages/goal/goal (domain.ts durable goal/change events + CAS revisions). 
- **判定依据**: MUST#3 (durable schedule/goal trigger events claimed by scheduler) and the DST/missed-schedule acceptance are largely met by upstream schedule/goal; transcript boundary repair partially covers MUST#1. But dedicated turn-checkpoint boundaries wired to exactly-o

## P5-07 — Codex Adapter: structured stream, continuation, approval & evidence mapping
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: Codex adapter 已有结构化 item 映射 + interrupt;只补 resume/fork 续跑身份 + approval 路由到父 Policy + 完整证据
- **上游已覆盖(据实测)**: packages/subagent/subagent-codex existed at baseline 0a53fb5 and upstream delta is a SHRINK (11 files, 76+/143-). Present: structured Codex thread/turn/item mapping (wire.ts 703 lines, maps item/commandExecution, item/fileChange, requestApproval cases) and interrupt (wire.ts:380 turn/interrupt, run.
- **判定依据**: MUST 'stream map items to child events' is met and interrupt exists; but 'resume/fork + save provider continuation identity' and 'tool/approval requests return to parent Policy' are unmet (ephemeral, unattended-only), and full diff/test/usage/artifact evidence

## P5-08 — Claude Code Adapter: structured stream, session resume, tool & Artifact mapping
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: Claude Code adapter 已有结构化 event/tool 映射;只补 session resume + worktree 身份 + 父策略治理的动作 + SubagentResult conformance
- **上游已覆盖(据实测)**: packages/subagent/subagent-claude-code existed at baseline; upstream delta is a SHRINK (11 files, 87+/154-). Present: structured event parsing (run.ts 597 lines, process.ts 159, existed at baseline — parses structured output not screen text). MISSING: session resume/interrupt with worktree identity 
- **判定依据**: Structured output/event + tool mapping largely satisfied at baseline, but provider session resume/interrupt + worktree identity and 'all external actions governed by parent policy/action ledger' + unified SubagentResult conformance (see P5-06) are unmet. Parti

## P5-09 — ACP Provider: remote resumable session, trace enumeration & secure identity
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: ACP provider 已有 initialize/new-session/cancel;只补 resume-token/event-cursor 重连 + 认证 continue/steer + 防身份伪造
- **上游已覆盖(据实测)**: packages/subagent/subagent-acp existed at baseline; upstream delta is a SHRINK (10 files, 57+/103-). Present: run.ts (607 lines) drives an initialize -> new-session -> prompt -> cancel lifecycle (AcpFailureStage 'initialize'|'new-session'|'prompt'|'process'|'teardown'; requestCancel/cancelSettled) a
- **判定依据**: Handshake(initialize)+new-session+cancel exist as a foundation, but the epic's distinctive MUSTs — capability/protocol/resume-token/event-cursor negotiation, cursor-resumed enumerable trace with content-addressed artifacts, authenticated continue/cancel/steer,

## P5-10 — Continuation, Steer, Human Input & Cancellation Convergence fix
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 steer/inject/cancel + epoch barriers + human-queue;只补 统一 5-way 词汇(带 priority+preconditions)+ durable 幂等 control + 已验证的 cancellation-convergence barrier
- **上游已覆盖(据实测)**: Base files continuation.ts (~1580 lines), lifecycle.ts, child-agent.ts, client.ts, control.ts, control-types.ts all exist at 4e84901 (subagent core delta 895+/845- = net-neutral refactor). Present machinery: distinct steer / inject / cancel deliveries (continuation.ts:555 delivery:'steer', :1565 par
- **判定依据**: This is a 'fix/unify' epic on strong existing primitives. Steer/inject/cancel/epoch/barriers and a human-input path are present (several MUST fragments), but the unified 5-way vocabulary with priority/preconditions, guaranteed durable+idempotent control messag

## P5-11 — Generic Taskboard, Mailbox & Blackboard primitives
- **上游冲突风险**: LOW
- **要补的 delta(缩范围后 registry 只保留这部分)**: agent-team(基线前已有,非上游)有 DAG+cycle-reject+CAS-claim+durable mailbox;只补 lease + 多进程单赢 claim + blackboard + 角色解耦
- **上游已覆盖(据实测)**: packages/collaboration tree is EMPTY at 4e84901 (planned taskboard/mailbox/blackboard packages absent). BUT packages/experimental/agent-team existed at baseline (agent-team diff base..tip is mostly test churn) and provides real primitives: task-board.ts (TeamTaskBoard) with dependency DAG (blockedBy
- **判定依据**: Taskboard-DAG + cycle-reject + CAS-claim and durable mailbox MUST fragments are met (in agent-team), but not: task lease/attempt, multi-process atomic single-winner claim (acceptance explicitly requires it; agent-team is single-process), a Blackboard of struct

## P6-05 — Per-Agent Context Topology 与稳定 Context Telemetry Contract
- **上游冲突风险**: LOW
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 subagent 父历史 seeding 控制 + telemetry redaction;只补 声明式 shared/private/retrievable context 区 + 稳定 per-context telemetry 契约
- **上游已覆盖(据实测)**: No packages/context/context-topology/ or context-telemetry/ at 4e84901 (`git ls-tree` context/ list confirms). RunPlan context-zone declarations absent (`git grep contextZone|retrievable.*zone` empty). HOWEVER subagent child-history inheritance IS controllable: packages/subagent/subagent/src/descrip
- **判定依据**: MUST 'child does not inherit full parent history' is met via subagent seeding control, and telemetry redaction partially covers the no-leak MUST. But the epic's core deliverables — declarative shared/private/retrievable context zones in RunPlan and a stable pe

## P6-06 — Compaction 保真度、来源证明与 Tool Pairing 强化
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 tool-pairing balance invariant;只补 covered-range/preserved-constraint/open-action/evidence-ref 标记 + VerificationContract-equivalence 测试
- **上游已覆盖(据实测)**: packages/compaction/compaction/ exists with checkpoint.ts, tool-pairing.ts (exports toolPairingBalancedBefore/After — real open-tool-call pairing invariant), types.ts and index.ts. BUT `git ls-tree` shows NO coverage.ts and NO provenance.ts. `git show 4e84901:.../compaction/src/types.ts | grep -i co
- **判定依据**: MUST 'open tool call/approval not pruned into inconsistent surface' is met by the baseline tool-pairing balanced invariant. But CompactionResult does NOT mark covered event ranges / preserved constraints / open actions / artifact-evidence refs / dropped catego

## P6-07 — Session 生命周期：分页、过滤、删除、保留与 Partial Data Repair
- **上游冲突风险**: HIGH
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 cursor 分页 + crash-repair;只补 租户/workspace/status 过滤 + soft-delete/legal-hold/hard-erase/retention + delete 传播
- **上游已覆盖(据实测)**: Cursor pagination exists: session-query/src/cursor.ts (SessionSearchCursor) + types.ts 'One cursor-paginated result page'. core/session/src/repair.ts exists — a real crash-recovery repair with recovery codes preserving a recoverable range (no silent fake completion). BUT `git ls-tree 4e84901:package
- **判定依据**: MUST cursor pagination and MUST repair-damage-report are met by baseline (cursor.ts, repair.ts). But tenant/workspace/status filters are absent, and the entire deletion/retention lifecycle (soft delete, legal hold blocking hard erase, hard erase propagation, a

## P6-10 — Privacy Classification、Redaction、Fork/Snapshot Lineage 与导出/擦除
- **上游冲突风险**: LOW
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 redactSecrets + session-fork lineage;只补 分类 taxonomy + 传播到所有边界 + fork purpose-filter/secret-exclusion + 跨-fork export/erase
- **上游已覆盖(据实测)**: Secret redaction at wire boundary exists: packages/settings/settings/src/redact.ts (redactSecrets, RedactedSecret/RedactedValue, 'removed from a value before it crosses a wire boundary'), plus session-telemetry redact (coordinator.ts + redact.spec.ts). Session-fork parent lineage exists: packages/ap
- **判定依据**: MUST boundary secret-redaction is partially met (redactSecrets + telemetry redaction) and fork parent-lineage recording exists. But the classification taxonomy and its propagation to events/artifacts/memory/context, classification-driven redaction across all f

## P8-02 — 一等公民 Remote Resources：Run/Agent/Action/Approval/Artifact/Verification/World
- **上游冲突风险**: HIGH
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 session+agent get/list(分页+过滤+authz);只补 Action/Approval/Artifact/Verification/World 资源 + 每响应带 tenant/classification/revision/allowedActions
- **上游已覆盖(据实测)**: packages/api/remotes/src/index.ts is only a forwarded-Cordis-event allowlist bridge (registerRemoteEvents); no run/action/approval/artifact/verification/world.ts resource files exist (dir has index/remote-events/types/client only). session-controller provides a session(~Run)+agent slice: list.ts:240
- **判定依据**: MUST partially: session+agent get/list with pagination+filter+authorization exist; MUSTs for the full first-class resource set and for tenant/classification/revision/allowedActions on every response are unmet. Thin session slice only.

## P8-03 — 远程生命周期控制：Pause/Resume/Cancel/Fork/Retry/Reconcile/Close
- **上游冲突风险**: HIGH
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 cancel+fork+idempotent-adopt;只补 治理化命令契约(commandId/idempotencyKey/expectedRevision/reason)+ pause/resume/retry/reconcile/close + 级联+补偿 + fork 不继承 secret
- **上游已覆盖(据实测)**: packages/api/session-controller/src/client/contract/session.ts:105-109 cancel():Promise<{accepted:true}> (cancels running turn, queued work resumes FIFO); contract/sessions.ts:88-97 + manager.ts:596-600 fork({sessionId,atSeq,increaseTitle}); commands.ts create is 'idempotently adopt'. No run-control
- **判定依据**: MUST partially: cancel + fork + idempotent create exist as raw session ops; the governed command contract (commandId/idempotencyKey/expectedRevision/reason, pause-at-checkpoint, cascade cancel+compensation, no-secret-inheritance fork) is absent.

## P8-05 — Resumable Event Streaming：Cursor/ACK/Replay/Dedupe/Backpressure
- **上游冲突风险**: HIGH
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 session journal 的 snapshot+delta+cursor+reconnect+repair;只补 通用 per-tenant event bus(client-ACK durable cursor)+ dedupe-by-eventId + backpressure/lossy-marking + durable outbox
- **上游已覆盖(据实测)**: gateway/src/client/journal-stream.ts: RemoteJournalStream does snapshot-first opening + resumeCursor + cursor algebra (compare/follows/first/last) + ordered live delivery + pagination + repair over a reconnecting stream ({type:'opened',cursor,page}). stream-server.ts has WebSocket mux + heartbeat/MA
- **判定依据**: Strong resumable snapshot+delta+cursor+reconnect+repair streaming exists (covers the cursor/replay/snapshot-recovery acceptance for session journals); the generic tenant event bus with ACK/dedupe/backpressure-disconnect/durable-outbox contract across all contr

## P8-07 — Schema-Generated TS/Python SDK Parity 与 Contract Test Matrix
- **上游冲突风险**: MEDIUM
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有手写 TS+Python SDK;只补 schema 生成 + 跨语言 golden round-trip fixtures + CI drift 门
- **上游已覆盖(据实测)**: python/sdk/src/deepseek_harness/{api,client,models,errors}.py exists as a hand-written Python SDK targeting the same JSON-RPC runtime; python/sdk-runtime bundles the exe; build-python-release + wheel infra present. BUT no packages/sdk/schema/control-protocol.json, no packages/sdk/codegen, no package
- **判定依据**: MUST partially: dual-language SDK coverage of the runtime protocol exists; the epic's core capability — generation from a versioned schema, cross-language golden round-trip fixtures, unified type/error mapping guarantee, and CI-fail-on-drift — is absent.

## P8-10 — Config Provenance/Dry-Run/迁移-回滚/ABI/Disaster-Recovery Release Gate
- **上游冲突风险**: HIGH
- **要补的 delta(缩范围后 registry 只保留这部分)**: 上游已有 --dump-config 逐行 provenance+shadowing;只补 typed dry-run plan + 版本化 migration/rollback + ABI 门 + 加密 backup/DR 演练 + release-evidence 门
- **上游已覆盖(据实测)**: apps/cli --dump-config (args.ts, bin.ts:42, dump-config.ts) composes profile+bundle+home+--patch layers and prints comments 'naming the file that supplied each row and every overlay that changed it' with unmatched-target reporting — genuine per-row provenance with shadowing (apps/cli/reference/READM
- **判定依据**: MUST partially: the config-provenance/'explain which layer decided a value' clause is largely met via --dump-config per-row source+shadowed-value; typed dry-run plan, migration/rollback, ABI compatibility gate, encrypted backup/restore+DR drill, and the releas
