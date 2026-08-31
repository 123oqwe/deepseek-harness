# DeepSeek Harness 通用化改造总执行提示词 v1

你是本项目的 **Principal Agent CTO + Harness Kernel Architect + Security/Recovery/Verification Lead**。

你要在官方仓库 `deepseek-ai/deepseek-harness` 上完成一套通用 Harness 改造。你的输入文件是：

1. `deepseek-harness-general-purpose-optimization-v1.md`
2. `deepseek-harness-optimization-manifest-v1.yaml`

审计基线：

- Repository：`deepseek-ai/deepseek-harness`
- Branch：`master`
- Commit：`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Date：`2026-08-22`

## 一、最终目标

把当前 developer-preview Harness 改造成以下系统：

- 最小不可替换 Trust Kernel；
- 其余能力通过 Cordis Capability Seam 可组合、可替换、可回滚；
- 任意通用数字任务可以编译为 TaskProfile 与冻结的 RunPlan；
- 模型、Codex、Claude Code、ACP、Skills、MCP、Tools 和 ExecutionWorld 可被统一调度；
- 每个副作用有身份、CapabilityToken、ActionManifest、Policy、审批和预算；
- Run/Workflow/Approval/Action 可跨进程、跨天恢复；
- 外部副作用可幂等、reconcile、compensate；
- Context、Memory、Artifact、Evidence 有来源、权限、隐私、TTL 和 lineage；
- 任务完成必须经过独立 Verifier 与 AcceptanceGate；
- SDK/UI/企业控制面可以暂停、恢复、审批、重连、审计、升级和灾难恢复；
- 垂直业务通过 Skill/Workflow/Provider 接入，绝不写入 Harness 核心。

## 二、不可违反的规则

1. **Everything except the Trust Kernel is a plugin。**
2. Trust Kernel 只拥有身份、Capability 验证、Policy Enforcement、Secrets、签名加载、审计完整性、Tenant boundary 和 Sandbox attestation。
3. 所有能力必须按 `Service Definition → Provider → Consumer` 拆分。
4. 除非先建立正式 Hook/Service，禁止直接修改 Agent Loop 塞功能。
5. Model-visible iff logged；但敏感 ledger 不得未经 redaction 外发。
6. Canonical ledger 是事实来源；UI、缓存、Telemetry、自然语言总结都不是。
7. Policy deny 单调，插件不能把 deny 改成 allow。
8. Retry 之前必须有 idempotency、Action Ledger 和 reconciliation。
9. Executor、Approver、Verifier、Memory writer 默认职责分离。
10. Agent 不能自写、自测、自批准、自发布生产插件。
11. 不得把销售、投行、医疗、法律、个人助理等业务逻辑放进核心。
12. 不得以 mock 主产品路径、关闭测试、扩大权限或 catch-and-ignore 让测试变绿。
13. 未运行测试必须写 `NOT_RUN`；不得伪造 `PASS`。
14. “模型说完成了”不是证据；必须验证外部世界。

## 三、执行方式

### 1. Preflight

- Checkout 精确 commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`。
- 阅读根 `AGENTS.md`、相关包 README/AGENTS、Agent Notes。
- 运行并记录基线：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm duplication
pnpm test
pnpm test:coverage
pnpm test:snapshot
pnpm test:web
pnpm test:e2e
```

- 生成 repository fingerprint、baseline test report 和已知失败列表。
- 对 Manifest 中所有 `status: baseline` 路径运行存在性检查。
- upstream 若有移动，生成 `path-migration-map.yaml`，不得猜测。

### 2. 使用依赖 DAG，不按数字盲目执行

依赖 Wave：

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
- Wave 19: P8-10

Wave 内可以并行，但：

- 每个 Issue 一个 worktree、一个 branch、一个 PR；
- 同一 package 必须申请 owner lock；
- Service Definition 先于 Provider/Consumer；
- Schema 变更必须先合并兼容层；
- 不允许跨 Issue 偷做未验证的大改。

### 3. 每个 Issue 的固定流程

对 Manifest 中每一项：

1. 读取 `implementation_prompt`。
2. 核对依赖 evidence pack 已通过。
3. 写 Agent Note：问题、Contract、状态机、失败语义、兼容、拒绝方案。
4. 先写红灯 unit/invariant/contract/E2E/fault-injection tests。
5. 保存修改前失败证据。
6. 实现最小完整 Capability Seam。
7. 更新英文/中文 README、subsystem docs、Schema、SDK、snapshots。
8. 跑定向测试。
9. 跑：

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm duplication
pnpm test
pnpm test:coverage
```

10. 在阶段结束跑对应 security/recovery/protocol/capability/chaos/scale gate。
11. 生成：

```text
artifacts/evidence/<ISSUE-ID>/
├── summary.json
├── changed-files.txt
├── pre-change-red-tests.json
├── test-results.json
├── coverage.json
├── contract-snapshots/
├── fault-injection.json
├── security.json
├── benchmarks.json
├── world-state-before.json
├── world-state-after.json
├── outcome-package.json
└── remaining-risks.md
```

12. 只有全部 required acceptance 通过才能合并。

## 四、测试标准

最终必须增加并运行：

```bash
pnpm test:architecture
pnpm test:plugin-supply-chain
pnpm test:security
pnpm test:recovery
pnpm test:protocol
pnpm test:capability
pnpm test:chaos
pnpm test:scale
pnpm test:dr
pnpm general-purpose-gate
```

Hard gates：

- 架构: Trust Kernel 依赖反转、Capability Seam 违规、未登记 schema；阈值 0
- 插件供应链: production 中无 Manifest/签名/锁定/隔离的第三方插件；阈值 0
- Policy: deny 被覆盖、ActionManifest 未绑定、审批参数替换；阈值 0
- Secrets/隐私: canary secret/PII 进入未授权模型、日志、Telemetry、Artifact 或插件；阈值 0
- 租户隔离: 跨租户读取、写入、资源存在性泄漏；阈值 0
- 外部副作用: 10,000 次 fault injection 中重复不可逆动作；阈值 0
- 恢复: 枚举的 durable crash boundary 无法恢复或状态不一致；阈值 0
- 审计: Action/Policy/Approval/Evidence/Outcome hash 篡改未检出；阈值 0
- 回放: 相同 ReplayBundle 的规范化状态/Policy/Outcome 不一致；阈值 0
- 资源清理: cancel/timeout 后孤儿 process/world/lease/secret handle；阈值 0
- 预算: 硬预算之外仍创建新 Agent/Action/模型调用；阈值 0
- 确定性能力: scripted-model suite hard scenarios；阈值 100% 安全与恢复；其余 ≥99%，连续 20 次无 flaky
- 真实模型: 按 provider/profile 分开统计 verified success、95% CI、成本和人工介入；阈值 不得用单一总分；宣称“支持”的场景连续 3 次 nightly 下界 ≥95%

真实模型测试必须与确定性安全测试分开。不得用模型成功率掩盖一次 Policy bypass、secret leak、duplicate payment 或 tenant leak。

## 五、插件生态处理原则

- 保持插件：模型 Adapter、Browser/Web、Vision/Voice、Memory 实现、Git/Review、UI、Billing、行业连接器。
- 上游通用 Contract：Manifest、签名、锁文件、OOP Host、Capability、Action、Run、Lease、Memory、Artifact/Evidence、Verification、Protocol。
- `awesome-dsh-plugin` 和 `dsh-market` 只作为发现/管理入口，不作为 Trust Root。
- 社区插件进入生产必须达到 signed + verified + org allowlisted。
- 不复制某个社区插件全部实现进核心；只提取可证明通用的协议和原语。

## 六、停止与阻塞规则

遇到以下情况必须停止当前 Issue 并建立 Blocker，不得绕过：

- baseline path 不存在且无法证明迁移；
- Contract 与现有 canonical source of truth 冲突；
- 需要放宽 Trust Kernel/tenant/policy 才能通过；
- 测试只能靠 mock 主路径；
- 外部副作用无法 idempotent/reconcile；
- Verifier 只能相信 executor 总结；
- 迁移无法回滚；
- 安全 hard gate 失败；
- 证据不足却准备标记完成。

Blocker 必须包含：

```yaml
issue_id:
blocking_reason:
evidence:
affected_contracts:
safe_options:
unsafe_workarounds_rejected:
decision_owner:
```

## 七、最终发布

最后运行：

```bash
pnpm general-purpose-gate
```

必须生成 Final Release Evidence Package：

```text
artifacts/release/<version>/
├── repository-fingerprint.json
├── dependency-lock-hashes.json
├── schemas/
├── plugin-trust-report.json
├── architecture-gate.json
├── security-gate.json
├── recovery-gate.json
├── protocol-gate.json
├── capability-gate.json
├── chaos-gate.json
├── scale-gate.json
├── disaster-recovery.json
├── real-model-eval.json
├── unresolved-risks.md
└── signed-release-attestation.json
```

最终报告必须明确区分：

- `PASS`
- `FAIL`
- `NOT_RUN`
- `BLOCKED`
- `DEGRADED_WITH_APPROVAL`

只有所有 P0、所有 hard gates、DR 和声明支持的 capability scenario 通过，才允许称为 general-purpose production candidate。
