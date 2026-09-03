# DeepSeek Harness First-100 规范化需求矩阵

> 覆盖：YAML 实际 100/100 项。用途：实施前 SDD 输入，不是实现报告。所有字段来自四份不可信历史规格，经来源审计规范化；没有检查 DSH、没有把任何测试写成 PASS。

## 阅读规则

- `[B]` = YAML `status: baseline`（只代表静态审计声明，实施 preflight 仍须核验）；`[P]` = `prior_output`；`[N]` = 本项新增。
- `W#` 是声明 wave；依赖只列 YAML 显式 dependencies。若文件生产者关系另有缺口，写在“规格缺口”。
- `MUST`、Acceptance 与 Validation 保留 YAML 的全部实质条款，仅压缩标点；不以执行提示词扩张权限。
- 不变量/失败语义：该项列出的 acceptance 均为 required；任一未满足为 `FAIL`，未运行命令为 `NOT_RUN`，依赖/路径/阈值/证据未闭合为 `BLOCKED`。Policy、tenant、secret、签名、schema、幂等、恢复与外部状态不确定时 fail closed；模型/执行者自报不构成证据。
- YAML 未写 `non_goals` 时，明确记为“来源缺失”，并采用 Markdown 已注入的最小默认边界：**不引入与本项无关的垂直业务逻辑**；不得借此补做其他 Issue 或扩大权限。
- `G`（每项共享工程门）：`pnpm build && pnpm typecheck && pnpm lint && pnpm duplication && pnpm test && pnpm test:coverage`。`R`（阶段/发布门）：`pnpm test:architecture`、`pnpm test:plugin-supply-chain`、`pnpm test:security`、`pnpm test:recovery`、`pnpm test:protocol`、`pnpm test:capability`、`pnpm test:chaos`、`pnpm test:scale`、`pnpm test:dr`、`pnpm general-purpose-gate`。G/R 不能替代项级 focused command。
- 真实任务证据一律还要进入完整 13 项 evidence pack，并绑定 baseline、真实命令/退出码/日志 hash、world-state before/after、Artifact/Evidence digest、独立 Verifier 与 OutcomePackage。外部边界可控替身不等于 mock 产品路径；声明真实 provider/model 支持时必须另跑 live statistical lane。
- 场景代码：S01 Code，S02 Research，S03 External Write，S04 Schedule/Message，S05 High-Risk Finance（仅模拟），S06 Medical/Legal Safety Policy，S07 24h Virtual Run，S08 50-Agent，S09 Provider Failure，S10 Malicious Plugin，S11 Multi-Tenant，S12 Self-Extension，S13 Hostile Attachment，S14 Crash Matrix，S15 SDK Reconnect。

## 每项统一证据类型

| 类别 | 最低真实证据 |
|---|---|
| E0 基线/架构 | 精确 checkout、两平台或声明平台的真实命令、dependency/schema diff、离线可验 hash；不得用生成器自证正确 |
| E1 插件供应链 | 实际 tarball/lock/signature/SBOM、真实 install/boot/OOP 路径、恶意与 benign corpus、宿主/网络/secret 观察与清理证明 |
| E2 身份/Policy/人机 | 真实 CLI/Web/SDK action→policy→approval→execution 链、签名身份/租户、版本化外部测试服务 receipts、越权与竞态证据 |
| E3 ExecutionWorld | 声明支持 OS/container/remote provider 的真实执行、attestation、escape/SSRF/secret/resource canary、kill 后资源盘点 |
| E4 Durable Run/Effect | 可观测版本化外部服务、每个 durable boundary crash、ledger/receipt/reconciliation、虚拟长时钟、重复 effect = 0 |
| E5 Router/Subagent | 标准 contract trace、真实 adapter（声称支持时）或可控协议 server、diff/tool/action/usage receipts、取消/重连/预算对账 |
| E6 Data plane | 真实 tenant-isolated store、来源/TTL/lineage/erase、跨 sink PII/secret canary 扫描、备份/legal-hold 报告 |
| E7 Assurance | 冻结 contract、原始 EvidenceRef、独立只读 verifier、tamper/replay/crash 结果、signed OutcomePackage |
| E8 Protocol/Enterprise | TS/Python 真客户端、认证多租户 server、真实浏览器（UI 项）、reconnect/backpressure/DR、schema/authorization matrix |

## 矩阵

## Phase 0 — 基线、迁移与工程门禁

先冻结事实、架构边界、Schema 与证据门，避免后续大改不可审计。

### P0-01 — 锁定可复现审计基线与仓库指纹

- **Priority / Wave / 依赖：** P0 / W1 / 无。
- **问题 → 目标：** 当前仓库处于 developer preview，接口持续变化；如果没有机器可验证的基线指纹，执行 Agent 很容易在不同提交上应用错误文件映射，或把上游变化误判为自己的改动。 → 防止在移动中的 master 上边改边验，确保每个后续结论、补丁和测试都能绑定到唯一源码状态。
- **Files：** target `package.json` [B]；`pnpm-lock.yaml` [B]；`packages/bundle/base/cordis.patch.yml` [B]；`docs/testing.md` [B]；`BENCHMARK.md` [B]；new `docs/audit/baseline-b150a551.md` [N]；`scripts/release/baseline-fingerprint.mjs` [N]；`tests/release/baseline-fingerprint.spec.ts` [N]；`.dsh/baseline.json` [N]。
- **MUST：** 实现 `pnpm baseline:capture` 与 `pnpm baseline:verify`，记录 Git SHA、Node/pnpm 版本、workspace package 列表、默认 bundle 行 ID、关键协议/事件 schema 哈希。；将审计 SHA 写入文档和机器文件；任何执行批次开始前必须 verify，发现上游漂移时停止并生成 rebase report。；指纹只覆盖架构与协议关键面，不把构建产物、时间戳等非确定信息纳入哈希。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不冻结上游开发；这里只冻结每个优化批次的输入。
- **Acceptance：** 同一干净 checkout 在 Linux 与 macOS 生成相同规范化指纹。；修改任一关键 schema、bundle 行或 package manifest 后，verify 必须失败并指出最小差异。；恢复文件后 verify 必须重新通过。
- **Validation：** 运行 `pnpm baseline:capture && pnpm baseline:verify`。；在测试夹具中分别篡改 `cordis.patch.yml`、SDK types 和事件类型，验证三种漂移均被发现。；把 baseline report 作为所有后续 Evidence Package 的第一项。
- **验证命令：** `pnpm baseline:capture && pnpm baseline:verify`；随后 G，阶段按适用项跑 R。
- **真实任务证据：** E0；场景 S01（架构/工程基线夹具）；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 Node/pnpm/platform 元数据是否进入 canonical hash 未定义，跨平台相同指纹的规范化规则未闭合。

### P0-02 — 确立 Minimal Immutable Trust Kernel 边界

- **Priority / Wave / 依赖：** P0 / W2 / `P0-01`。
- **问题 → 目标：** 现有架构明确强调没有 privileged core；这对组合性很好，但不适合身份、权限、签名根、审计完整性和沙箱证明等安全根。插件若能替换限制自己的服务，生产级不变量无法成立。 → 保留 Cordis 的可组合性，同时建立插件绝对不能替换或绕过的最小可信计算基。
- **Files：** target `docs/architecture.md` [B]；`README.md` [B]；`packages/README.md` [B]；`AGENTS.md` [B]；`apps/cli/src/profile-boot.ts` [B]；`packages/boot/app-boot/src/index.ts` [B]；new `docs/architecture/trust-kernel-boundary.md` [N]；`packages/kernel/trust-kernel/src/index.ts` [N]；`packages/kernel/trust-kernel/src/types.ts` [N]；`packages/kernel/trust-kernel/src/invariant.ts` [N]；`packages/kernel/trust-kernel/tests/boundary.spec.ts` [N]。
- **MUST：** 在 Cordis Context 创建前初始化 TrustKernel；它只拥有 root identity、signature roots、policy enforcement entrypoint、audit append、secret broker handle、sandbox attestation verifier。；禁止 TrustKernel 注册成可替换 Cordis Service；只向运行时发放窄接口和不可伪造 handle。；文档明确哪些仍是插件：模型、工具、存储 provider、workflow、memory provider、UI；哪些永远不是插件：根身份、deny enforcement、审计链根、签名验证根。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不把整个 Harness 重写成微内核；只固化不可绕过的最小边界。
- **Acceptance：** 任意插件卸载、覆盖 service 或动态 mount 都不能替换 kernel policy/audit/signature verifier。；Kernel API 无模型可见文本、无业务领域逻辑、无具体 provider 实现。；未初始化 kernel 时，生产 profile 必须 fail closed；开发 profile 可显式启用 insecure 模式并显示永久警告。
- **Validation：** 新增恶意插件测试，尝试覆盖 policy/audit/signature services，必须被 boot 阶段拒绝。；运行架构依赖检查，确保 kernel 不依赖 Cordis product packages。；运行默认 web/headless profile smoke test，确认兼容模式仍能启动。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E0；场景 S01（架构/工程基线夹具）；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 11 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。 最终清单要求 spec/trust-kernel.md，但 100 项文件列表无人声明该路径。

### P0-03 — 增加 Capability Seam 架构一致性检查器

- **Priority / Wave / 依赖：** P1 / W3 / `P0-01`、`P0-02`。
- **问题 → 目标：** 当前规范主要依赖 AGENTS.md 与人工 Review；大型改造后容易出现 consumer 直接 import provider、provider 同时定义业务协议、或在 agent-loop 中硬编码某个实现。 → 把仓库现有的 Service Definition / Provider / Consumer 原则变成可执行门禁，防止新能力偷偷耦合进 Agent Loop。
- **Files：** target `AGENTS.md` [B]；`packages/README.md` [B]；`package.json` [B]；`packages/core/agent-loop/src/index.ts` [B]；`packages/core/agent-loop/src/agent.ts` [B]；new `architecture.layers.json` [N]；`scripts/architecture/check-capability-seams.mjs` [N]；`tests/architecture/capability-seams.spec.ts` [N]。
- **MUST：** 为每个 capability family 声明 definition、providers、consumers、allowed dependency edges。；扫描 workspace package.json 和 TypeScript imports，禁止 consumer deep-import provider `src/*`，禁止 provider 反向依赖 app/UI。；要求新增可替换能力同时具备 service definition、至少一个 provider fixture、consumer composition test 和卸载回滚测试。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 现有仓库在受控 allowlist 下通过；allowlist 每项必须带删除日期和负责人。；构造违规 deep import、缺 provider、不可逆注册三类夹具时门禁均失败。；CI 输出具体依赖边、源文件和修复建议。
- **Validation：** 运行 `pnpm architecture:seams`。；对一个测试 package 临时加入 consumer→provider deep import，确认失败后恢复。；将检查加入 `pnpm ci:gate`。
- **验证命令：** `pnpm architecture:seams`；`pnpm ci:gate`；随后 G，阶段按适用项跑 R。
- **真实任务证据：** E0；场景 S01（架构/工程基线夹具）；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。

### P0-04 — 建立分层依赖与禁止环规则

- **Priority / Wave / 依赖：** P1 / W4 / `P0-03`。
- **问题 → 目标：** Cordis 允许高度动态组合，但包级依赖若无约束，仍可能形成 kernel→product→kernel、data→UI、policy→tool provider 等循环，最终破坏可测试性和替换性。 → 确保新增 kernel、policy、run、verification、memory 等平面不会形成隐式循环和全局服务泥球。
- **Files：** target `package.json` [B]；`pnpm-workspace.yaml` [B]；`packages/README.md` [B]；new `scripts/architecture/check-layer-deps.mjs` [N]；`tests/architecture/layer-deps.spec.ts` [N]；`docs/architecture/layering.md` [N]。
- **MUST：** 定义层序：kernel → protocol/types → capability definitions → providers → orchestration/runtime → surfaces/apps。；允许事件类型作为窄共享依赖，但禁止通过全局 singleton 绕过层级。；检测 package graph、TypeScript path alias 与动态 require；对合法循环要求显式 ADR。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 生产 package graph 无未豁免环。；任何 kernel 对 Cordis、UI、具体模型 provider 的依赖都失败。；检查在 10 秒内完成并给出最短环路径。
- **Validation：** 运行 `pnpm architecture:layers`。；使用三种环路夹具验证检测。；在 PR gate 中把新增环路设为 blocking。
- **验证命令：** `pnpm architecture:layers`；随后 G，阶段按适用项跑 R。
- **真实任务证据：** E0；场景 S01（架构/工程基线夹具）；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 6 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。

### P0-05 — 为重大能力引入 Shadow/Enforce Feature Gates

- **Priority / Wave / 依赖：** P0 / W3 / `P0-02`。
- **问题 → 目标：** 现有配置是 profile/bundle/patch 组合；缺少统一的 capability rollout 状态和迁移观察模式，容易出现新旧语义并存但无人知道谁生效。 → 让安全内核、Run、Policy、Verification 等大改造可以先观察、后强制，避免一次性破坏现有 profile。
- **Files：** target `packages/settings/settings/src/index.ts` [B]；`packages/settings/settings/src/types.ts` [B]；`packages/bundle/base/cordis.patch.yml` [B]；`apps/cli/src/profile-boot.ts` [B]；`apps/cli/src/dump-config.ts` [B]；new `packages/migration/feature-gates/src/index.ts` [N]；`packages/migration/feature-gates/src/types.ts` [N]；`packages/migration/feature-gates/tests/gates.spec.ts` [N]。
- **MUST：** 统一状态 `off | shadow | enforce`；shadow 模式执行决策但不改变结果，只写入可比较事件。；每个 gate 记录 owner、introducedVersion、defaultByProfile、removalVersion。；`--dump-config` 必须展示最终 gate 来源和覆盖链。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 同一请求在 legacy 与 shadow 模式得到相同用户可见结果。；shadow 决策与 legacy 决策差异被完整记录且不泄露敏感参数。；过期 gate 在 release gate 中失败。
- **Validation：** 为 policy、plugin trust、run journal 各建一个 shadow fixture。；运行 profile composition tests，覆盖 bundle/profile/home/CLI 四层覆盖。；验证热更新不能把 enforce 降级为 off，除非拥有 kernel 管理权限。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E0；场景 S01（架构/工程基线夹具）；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P0-06 — 建立统一 Schema Registry 与兼容性规则

- **Priority / Wave / 依赖：** P0 / W2 / `P0-01`。
- **问题 → 目标：** 当前 SDK 没有协议协商，Session 事件和多种 types 直接成为线协议的一部分；新增字段或闭合 union 很容易导致旧客户端、旧插件和持久日志不可读。 → 给事件、SDK、插件清单、RunPlan、ActionManifest 等长期协议建立版本化和迁移基础。
- **Files：** target `packages/core/session/src/known-event-types.ts` [B]；`packages/core/session/src/types.ts` [B]；`packages/core/session/src/repair.ts` [B]；`packages/sdk/protocol/src/types.ts` [B]；`packages/settings/settings/src/types.ts` [B]；new `packages/schema/schema-registry/src/index.ts` [N]；`packages/schema/schema-registry/src/types.ts` [N]；`packages/schema/schema-registry/src/migrate.ts` [N]；`packages/schema/schema-registry/tests/compatibility.spec.ts` [N]。
- **MUST：** 为每个持久/线协议对象声明 schemaId、major/minor、兼容规则和迁移函数。；新增字段默认 backward-compatible；删除/重命名/语义改变要求 major 版本和迁移。；Session replay、SDK initialize、plugin load 在使用前先协商/验证 schema。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 至少能够读取审计基线产生的旧 session fixture。；不兼容客户端收到机器可读错误，不出现静默字段丢失。；所有 registry migration 具有双向或明确不可逆测试。
- **Validation：** 运行 schema golden tests。；用旧版 fixture 对新 runtime 做 replay；用新版 unknown optional field 对旧兼容 client 做降级测试。；对 closed union 增加未知值测试，要求 fail closed 或显式 `unknown` 分支。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E0；场景 S01（架构/工程基线夹具）；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P0-07 — 建立 Release Evidence Package 与不可伪造完成门

- **Priority / Wave / 依赖：** P0 / W3 / `P0-01`、`P0-06`。
- **问题 → 目标：** 仓库已有严格单测/覆盖率思想，但缺少统一 release evidence manifest，无法证明某个构建到底跑过哪些测试、基于哪个 commit、使用何种配置和外部依赖。 → 让“完成”由可验证证据决定，而不是执行 Agent 的总结文本。
- **Files：** target `package.json` [B]；`docs/testing.md` [B]；`AGENTS.md` [B]；new `scripts/release/collect-evidence.mjs` [N]；`scripts/release/verify-evidence.mjs` [N]；`packages/assurance/evidence-format/src/types.ts` [N]；`tests/release/evidence-package.spec.ts` [N]。
- **MUST：** 每个 gate 输出带哈希的 JSON 结果：命令、开始结束时间、退出码、环境、日志/工件 digest、测试数、跳过原因。；最终 evidence package 绑定 baseline fingerprint、Git diff、构建产物 digest。；任何 skipped blocking gate 或缺失 artifact 都不能标记 `accepted=true`。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 篡改任一测试日志、二进制或配置后 evidence verify 失败。；同一次执行的 evidence 可离线验证。；Agent 最终回答必须引用 package path 和 accepted 状态。
- **Validation：** 运行 `pnpm evidence:collect -- pnpm test` 后执行 `pnpm evidence:verify`。；分别删除日志、改退出码、换构建产物，验证检测。；将 evidence verifier 放到发布脚本最后一步。
- **验证命令：** `pnpm evidence:collect -- pnpm test`；`pnpm evidence:verify`；随后 G，阶段按适用项跑 R。
- **真实任务证据：** E0；场景 S01（架构/工程基线夹具）；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。

### P0-08 — 把 BENCHMARK.md 升级为通用 Harness 能力基准框架

- **Priority / Wave / 依赖：** P0 / W4 / `P0-07`。
- **问题 → 目标：** 当前 BENCHMARK.md 主要说明如何运行 SDK，没有任务集、指标、统计方法、失败分类或可比较报告，无法证明 Harness 能覆盖通用用途。 → 建立与模型无关的底座能力测试，衡量恢复、安全、验证、隔离、成本和编排，而不仅是能否启动 SDK。
- **Files：** target `BENCHMARK.md` [B]；`package.json` [B]；`packages/test-support/README.md` [B]；new `benchmarks/harness-capability/README.md` [N]；`benchmarks/harness-capability/manifest.yml` [N]；`benchmarks/harness-capability/runner.ts` [N]；`benchmarks/harness-capability/report.ts` [N]；`benchmarks/harness-capability/scenarios/` [N]；`tests/benchmark/runner.spec.ts` [N]。
- **MUST：** 分 deterministic lane、fault lane、security lane、real-model lane、scale lane。；标准指标包含 task success、duplicate side effect、policy bypass、recovery success、verification precision、router regret、token/cost、latency。；报告记录置信区间和每个失败的可重放 seed。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 不配置外部 API 时 deterministic/security/fault lanes 可完整运行。；同一 seed 可复现相同事件投影和失败位置。；real-model 结果与底座不变量分开评分，模型失败不能掩盖安全绕过。
- **Validation：** 运行 `pnpm benchmark:harness --lane deterministic`。；运行 100 次 seeded fault campaign，报告所有注入点。；生成机器 JSON 与人读 Markdown 两份报告。
- **验证命令：** `pnpm benchmark:harness --lane deterministic`；随后 G，阶段按适用项跑 R。
- **真实任务证据：** E0；场景 S01–S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。


## Phase 1 — 插件供应链与动态扩展治理

把插件生态从“可安装代码”升级为可声明、可签名、可隔离、可回滚的能力供应链。

### P1-01 — Plugin Manifest v2：声明能力、权限与副作用

- **Priority / Wave / 依赖：** P0 / W3 / `P0-06`、`P0-02`。
- **问题 → 目标：** 官方 CLI 当前主要把请求转给 pnpm，安装后只确认 `dsh.bundle`；社区条目元数据也只有名称/分类/描述，无法做生产级最小权限判断。 → 让安装器、Policy 和管理员在执行插件前知道它能访问什么、暴露什么、修改什么。
- **Files：** target `apps/cli/src/plugin.ts` [B]；`apps/cli/src/profile-boot.ts` [B]；`packages/host/plugin-inventory/src/index.ts` [B]；`packages/host/plugin-inventory/src/types.ts` [B]；`packages/boot/app-boot/src/profile.ts` [B]；new `packages/plugin/plugin-manifest/src/index.ts` [N]；`packages/plugin/plugin-manifest/src/types.ts` [N]；`packages/plugin/plugin-manifest/src/validate.ts` [N]；`packages/plugin/plugin-manifest/tests/manifest.spec.ts` [N]；`docs/plugins/manifest-v2.md` [N]。
- **MUST：** 定义 `dsh.manifestVersion=2`，字段包含 services、tools、skills、MCP servers/resources/prompts、events、filesystem、network、process、secrets、UI surfaces、data stores、migrations、executionMode、compatibility；每个 Tool/MCP capability 声明 side-effect class、auth audience、allowed destinations 与 data classification。；manifest 必须是静态数据，禁止通过执行包代码生成。；旧 `dsh.bundle` 兼容读取但标记 `legacy-untrusted`，生产 profile 默认拒绝。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 缺少 manifest、声明与实际注册不一致、申请通配权限时安装失败或进入明确 quarantine。；Plugin Inventory 能展示声明权限、实际观察权限、版本与来源。；manifest schema 有 golden fixture 与向后兼容测试。；Skill/MCP Provider 未声明 transport、auth、network destination 或副作用时不能进入 production profile。
- **Validation：** 新增 benign、overprivileged、undeclared-tool、undeclared-network 四个插件夹具。；运行 `pnpm plugin:verify <fixture>`。；启动 profile 后比较 Cordis 实际注册表与 manifest，任何差异为 blocking violation。；新增恶意 MCP server 与 Skill 脚本夹具，验证 schema 欺骗、tool-name collision、elicitation 和 secret 请求被拦截。
- **验证命令：** `pnpm plugin:verify <fixture>`；随后 G，阶段按适用项跑 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 最终 capability-manifest schema 的 spec/ 路径无人负责；参数化命令 <fixture> 仍须绑定真实 fixture 路径。

### P1-02 — 插件签名、来源证明与 SBOM

- **Priority / Wave / 依赖：** P0 / W4 / `P1-01`、`P0-02`。
- **问题 → 目标：** 社区市场可做仓库映射与构建脚本限制，但 listing 明确不等于安全审查；Harness 自身没有签名根、provenance、SBOM 或 artifact digest 校验。 → 阻止名称抢注、篡改 tarball、依赖投毒和来源不可追溯。
- **Files：** target `apps/cli/src/plugin.ts` [B]；`packages/host/plugin-inventory/src/types.ts` [B]；`packages/kernel/trust-kernel/src/types.ts` [P]；new `packages/plugin/plugin-provenance/src/index.ts` [N]；`packages/plugin/plugin-provenance/src/signature.ts` [N]；`packages/plugin/plugin-provenance/src/sbom.ts` [N]；`packages/plugin/plugin-provenance/tests/provenance.spec.ts` [N]。
- **MUST：** 支持 Sigstore 风格 identity/provenance 或组织离线签名；验证 package digest、source commit、builder identity 和依赖 SBOM。；TrustKernel 持有可信根；普通插件不能修改。；允许 `unsigned-dev` 仅在显式开发 profile，且 UI/日志持续显示不可信状态。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 篡改一个字节、替换 source repo、伪造 builder 三种情况都拒绝。；同一锁定包在离线模式可验证。；Inventory 和审计事件记录验证结果而不记录密钥。
- **Validation：** 用签名 fixture 正常安装；篡改 tarball 后重装必须失败。；生成 CycloneDX/SPDX SBOM，并检查所有运行依赖均被列出。；运行 revoked signing identity 测试。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P1-03 — 可复现插件锁文件与依赖解析

- **Priority / Wave / 依赖：** P0 / W5 / `P1-01`、`P1-02`。
- **问题 → 目标：** 直接 `pnpm add/update` 会随 registry、tag、transitive dependency 变化；仅有 pnpm lock 不足以表达 profile 启用顺序、manifest digest、签名状态和批准权限。 → 保证同一 profile 在不同机器和时间解析到相同插件字节与兼容图。
- **Files：** target `apps/cli/src/plugin.ts` [B]；`apps/cli/src/profile-boot.ts` [B]；`packages/bundle/base/cordis.patch.yml` [B]；new `.dsh/plugins.lock.json` [N]；`packages/plugin/plugin-lock/src/index.ts` [N]；`packages/plugin/plugin-lock/src/types.ts` [N]；`packages/plugin/plugin-lock/tests/lock.spec.ts` [N]。
- **MUST：** 锁定 package/version/integrity/source commit/manifest digest/signature identity/dependency graph/load order/granted capabilities。；`plugin add/update/remove` 采用事务：先生成候选 lock，验证后原子替换。；生产 boot 只加载 lock 中已批准且 digest 匹配的插件。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 断网冷启动可按 lock 验证本地 cache。；registry tag 漂移不改变已锁定 profile。；并发两个安装进程不会产生半写 lock。
- **Validation：** 运行 parallel install race test。；修改 registry fixture 的 latest 指向，确认 lock 保持原版本。；在 lock 与 node_modules 不一致时 boot fail closed。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P1-04 — 隔离安装与默认禁止生命周期脚本

- **Priority / Wave / 依赖：** P0 / W8 / `P1-02`、`P1-03`、`P3-01`。
- **问题 → 目标：** 当前官方 CLI 会警告脚本但仍依赖包管理器语义；安装脚本本身发生在 Harness policy/approval 之外，可能直接读取用户文件和凭证。 → 让未知插件在获得宿主权限前完成静态检查和构建。
- **Files：** target `apps/cli/src/plugin.ts` [B]；`apps/cli/src/process-shutdown.ts` [B]；new `packages/plugin/plugin-installer/src/index.ts` [N]；`packages/plugin/plugin-installer/src/quarantine.ts` [N]；`packages/plugin/plugin-installer/src/transaction.ts` [N]；`packages/plugin/plugin-installer/tests/quarantine.e2e.ts` [N]。
- **MUST：** 下载 tarball 到只读 quarantine；以 `--ignore-scripts` 解包并验证 manifest、签名、SBOM、路径穿越。；需要构建的插件在无凭证、无宿主网络、临时 filesystem 的 build sandbox 中执行。；通过后原子 promote；失败清理且不修改 profile/lock。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** preinstall/postinstall 尝试读取 `$HOME`、访问网络、写 profile 均失败。；tar path traversal、symlink escape、zip bomb 被拒绝。；安装失败后 profile、lock、node_modules 可恢复到字节级原状态。
- **Validation：** 运行恶意 npm fixture 集。；在 promote 前 kill 进程，重启后 transaction recovery 清理或继续。；验证无生命周期脚本在宿主权限下执行。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 6 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P1-05 — 插件静态/动态安全扫描器

- **Priority / Wave / 依赖：** P1 / W9 / `P1-01`、`P1-04`。
- **问题 → 目标：** 策展列表只能检查仓库年龄、bundle 声明等元数据；无法证明运行时代码与权限清单一致。 → 在安装和升级时发现未声明网络、进程、凭证、native addon、动态代码和持久化行为。
- **Files：** target `apps/cli/src/plugin.ts` [B]；`packages/host/plugin-inventory/src/index.ts` [B]；new `packages/plugin/plugin-scanner/src/index.ts` [N]；`packages/plugin/plugin-scanner/src/static.ts` [N]；`packages/plugin/plugin-scanner/src/dynamic.ts` [N]；`packages/plugin/plugin-scanner/src/rules.ts` [N]；`packages/plugin/plugin-scanner/tests/scanner.spec.ts` [N]。
- **MUST：** 静态扫描 imports、child_process、fs、net、eval/vm、native bindings、postinstall、dynamic require。；动态扫描在 instrumented plugin host 记录实际 syscall/network/fs/service registration，并与 manifest 比较。；结果分 blocking、review、informational，规则带版本。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 已知恶意 fixture 检出率 100%，benign fixture 无 blocking false positive。；动态扫描超时或崩溃不能被解释为通过。；扫描报告进入 plugin provenance 和 evidence package。
- **Validation：** 运行 curated malicious corpus。；用故意混淆的 dynamic import/child process fixture 验证。；对官方默认 bundle 做回归扫描并建立基线。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P1-06 — 不可信插件 Out-of-Process Host

- **Priority / Wave / 依赖：** P0 / W8 / `P1-01`、`P2-02`、`P3-01`。
- **问题 → 目标：** 社区文档明确第三方插件当前以用户权限运行，工具审批不沙箱插件代码；这意味着一个 UI 或 provider 插件可绕过工具管线直接读文件/网络。 → 把第三方插件从用户进程权限中移出，令工具审批与 capability policy 真正覆盖插件行为。
- **Files：** target `packages/boot/app-boot/src/index.ts` [B]；`packages/boot/app-boot/src/profile.ts` [B]；`packages/host/plugin-inventory/src/index.ts` [B]；`packages/core/tools/src/index.ts` [B]；new `packages/plugin/plugin-host-protocol/src/types.ts` [N]；`packages/plugin/plugin-host/src/index.ts` [N]；`packages/plugin/plugin-host/src/supervisor.ts` [N]；`packages/plugin/plugin-host/src/rpc.ts` [N]；`packages/plugin/plugin-host/tests/isolation.e2e.ts` [N]。
- **MUST：** 默认第三方插件在独立进程或 microVM 中运行；只通过 capability-scoped RPC 注册工具、事件和 UI 描述。；禁止传递宿主 Context、raw credentials、任意函数或可变对象引用。；host 崩溃可重启，注册 effects 自动撤销。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 插件尝试直接读取宿主 home、process.env、socket、其他插件内存均失败。；插件 host 被 kill 后主 Harness 保持健康，相关工具变为明确 unavailable。；每个 RPC 调用具有 principal、capability token、deadline、trace id。
- **Validation：** 运行 malicious plugin isolation suite。；连续 kill/restart 100 次，检查无泄漏注册和僵尸进程。；测量 p95 RPC 开销并与基线比较，超过门槛必须记录 ADR。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 p95 RPC 开销“门槛”没有数值、基准机型或测量方法。

### P1-07 — 项目 Trust Boundary：未信任目录不加载项目级执行内容

- **Priority / Wave / 依赖：** P0 / W4 / `P0-02`、`P2-01`。
- **问题 → 目标：** 当前 agent-instructions 会读取 workspace 指令；插件化配置强大，但若没有项目信任状态，恶意仓库可通过指令和本地配置扩大行为。 → 防止打开陌生仓库时自动执行其 AGENTS、插件、hooks、skills、MCP 配置或 profile patch。
- **Files：** target `packages/workspace/workspace/src/entity.ts` [B]；`packages/workspace/workspace/src/index.ts` [B]；`packages/workspace/workspace/src/paths.ts` [B]；`packages/context/agent-instructions/src/index.ts` [B]；`packages/context/agent-instructions/src/files.ts` [B]；`apps/cli/src/profile-boot.ts` [B]；new `packages/workspace/workspace-trust/src/index.ts` [N]；`packages/workspace/workspace-trust/src/types.ts` [N]；`packages/workspace/workspace-trust/tests/trust.spec.ts` [N]。
- **MUST：** workspace 状态 `untrusted | trusted-read | trusted-execute`，绑定 canonical realpath 与 inode/volume identity。；untrusted 时只允许安全读取，不加载项目插件、hooks、MCP server、可执行 skill、home/profile patch 覆盖。；信任升级必须由宿主用户交互完成并写审计。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** clone 一个含恶意配置的仓库并打开，不产生任何子进程、网络或凭证读取。；目录被替换、symlink 改指、移动后信任不自动继承。；降级 trust 立即撤销项目能力。
- **Validation：** 运行 path swap、symlink、git checkout 攻击 fixture。；验证 trusted-read 只注入纯文本且经过 prompt injection 标记。；验证 headless profile 无交互时默认不信任。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10、S13；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P1-08 — 插件 ABI、Capability 与 Schema 兼容协商

- **Priority / Wave / 依赖：** P1 / W4 / `P0-06`、`P1-01`。
- **问题 → 目标：** 仓库处于预发布，当前 SDK 也没有正式版本协商；插件只声明 bundle 并不足以表达所需 service、事件 schema 和最小版本。 → 避免插件在 API 改动后静默加载并以错误语义运行。
- **Files：** target `packages/boot/app-boot/src/profile.ts` [B]；`packages/host/plugin-inventory/src/types.ts` [B]；`packages/schema/schema-registry/src/index.ts` [P]；new `packages/plugin/plugin-compat/src/index.ts` [N]；`packages/plugin/plugin-compat/src/solver.ts` [N]；`packages/plugin/plugin-compat/tests/solver.spec.ts` [N]。
- **MUST：** manifest 声明 runtime API range、schema ranges、required/optional capabilities、provider constraints。；boot 前求解整个插件图；冲突时输出最小 unsat core。；禁止靠 try/catch 静默降级安全能力。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 兼容图可确定性求解，同一输入产生同一 load plan。；缺少必需 capability 或 major schema 不匹配时不执行插件代码。；可选 capability 缺失时只禁用对应功能并明确展示。
- **Validation：** 构造 diamond dependency、版本冲突、optional provider 三类图。；运行 solver property tests。；将结果写入 `--dump-config` 和 plugin inventory。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 6 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P1-09 — Service/Tool/Event 命名空间与所有权冲突检测

- **Priority / Wave / 依赖：** P1 / W4 / `P1-01`、`P0-03`。
- **问题 → 目标：** Cordis effects 可逆，但生态扩大后，同名 tool/service/event 和加载顺序会造成 confused deputy、覆盖与不可预测行为。 → 防止两个插件注册同名能力、冒充官方工具或在卸载时删除他人 effect。
- **Files：** target `packages/core/tools/src/index.ts` [B]；`packages/extensions/cordis-host-runner/src/registry.ts` [B]；`packages/extensions/cordis-host-runner/src/lifecycle.ts` [B]；`packages/host/plugin-inventory/src/index.ts` [B]；new `packages/plugin/plugin-ownership/src/index.ts` [N]；`packages/plugin/plugin-ownership/src/types.ts` [N]；`packages/plugin/plugin-ownership/tests/ownership.spec.ts` [N]。
- **MUST：** 所有注册带 PluginIdentity、namespace、stable capability id 和 ownership token。；官方保留 namespace 不可被第三方声明；覆盖必须显式 replace contract 且经 policy。；卸载只撤销与 ownership token 匹配的 effects。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 同名工具、跨插件撤销、加载顺序攻击均 fail closed。；允许合法 provider replacement，但 Inventory 显示 replaced/replacing chain。；动态 Cordis 定义同样受规则约束。
- **Validation：** 运行 two-plugin collision fixture。；随机化加载/卸载顺序 1000 次，最终注册表一致。；验证未授权插件不能注册 `dsh.*` 保留 namespace。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P1-10 — 插件数据迁移、升级事务与回滚

- **Priority / Wave / 依赖：** P1 / W8 / `P1-03`、`P4-12`。
- **问题 → 目标：** 社区市场已有备份/更新体验，但 Harness 核心缺少统一 migration contract、兼容检查和原子回滚。 → 让插件升级失败时可以恢复代码、配置、schema 和数据，而不是只恢复 npm 包。
- **Files：** target `apps/cli/src/plugin.ts` [B]；`packages/storage/storage/src/backend.ts` [B]；`packages/storage/storage/src/registry.ts` [B]；`packages/settings/settings/src/index.ts` [B]；new `packages/plugin/plugin-migrations/src/index.ts` [N]；`packages/plugin/plugin-migrations/src/types.ts` [N]；`packages/plugin/plugin-migrations/src/transaction.ts` [N]；`packages/plugin/plugin-migrations/tests/rollback.e2e.ts` [N]。
- **MUST：** manifest 声明 migration DAG、preconditions、backup strategy、rollback support。；升级过程：freeze plugin → snapshot data/config → migrate in quarantine → validate → atomic switch → health check。；不可逆 migration 必须人工批准并提供 export。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 在每个迁移步骤注入 crash，重启后要么旧版完整可用，要么新版完整可用，不出现混合状态。；数据 digest 和 schema version 可对账。；失败升级不改变已批准权限。
- **Validation：** 运行 N-step migration fault campaign。；测试 downgrade、skip version、concurrent update。；把 rollback evidence 加入升级结果。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P1-11 — 把动态 Cordis 自修改改成 Extension Proposal Pipeline

- **Priority / Wave / 依赖：** P0 / W10 / `P1-05`、`P1-06`、`P2-06`、`P3-01`。
- **问题 → 目标：** 官方动态 runner 明确 node:vm 不是安全边界、定义只在内存、异步操作可能逃过同步超时；直接 `define/run` 无法用于生产。 → 保留模型生成新能力的上限，同时阻止模型直接在主进程挂载接近 Bash 权限的代码。
- **Files：** target `packages/extensions/tool-cordis/src/index.ts` [B]；`packages/extensions/tool-cordis/src/inspect.ts` [B]；`packages/extensions/tool-cordis/src/providers.ts` [B]；`packages/extensions/cordis-host-runner/src/index.ts` [B]；`packages/extensions/cordis-host-runner/src/guard.ts` [B]；`packages/extensions/cordis-host-runner/src/sandbox.ts` [B]；`packages/extensions/cordis-host-runner/src/registry.ts` [B]；new `packages/extensions/extension-proposal/src/index.ts` [N]；`packages/extensions/extension-proposal/src/types.ts` [N]；`packages/extensions/extension-proposal/src/pipeline.ts` [N]；`packages/extensions/extension-proposal/tests/pipeline.e2e.ts` [N]。
- **MUST：** `cordis_define/run` 在 production 改为生成 proposal artifact，不直接 mount。；流水线执行静态扫描、manifest 推断、隔离测试、权限 diff、签名、人工/策略批准、canary、promote。；定义持久化、版本化；rollback 时恢复前一版本。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 模型无法绕过 proposal 直接访问 host Context。；无人浏览器连接时不无限悬挂；所有 stage 有 deadline 和 durable state。；未批准 proposal 不出现在 active registry。
- **Validation：** 运行恶意 extension corpus：host helper escape、async timeout、network/secret access。；kill 每个 pipeline stage 后恢复。；验证 promote 后与普通签名插件拥有同一治理语义。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10、S12；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 11 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P1-12 — 官方 Plugin Verifier 与市场信任等级

- **Priority / Wave / 依赖：** P1 / W10 / `P1-01`、`P1-02`、`P1-05`、`P1-06`。
- **问题 → 目标：** GitHub topic、awesome list 和 dsh-market 能改善发现、仓库映射、提交审查和安装 UX，但它们自己都不应成为安全根。 → 把“可发现”与“可安全部署”分开，建立可机器验证的生态质量标准。
- **Files：** target `apps/cli/src/plugin.ts` [B]；`packages/host/plugin-inventory/src/index.ts` [B]；`README.md` [B]；new `apps/cli/src/plugin-verify.ts` [N]；`packages/plugin/plugin-certification/src/index.ts` [N]；`packages/plugin/plugin-certification/src/report.ts` [N]；`docs/plugins/trust-levels.md` [N]；`tests/plugin/certification.e2e.ts` [N]。
- **MUST：** 定义等级：discovered、metadata-checked、signed、sandbox-verified、official-reviewed。；发布 `dsh plugin verify`，输出 manifest、signature、SBOM、compat、scanner、isolation、tests 的独立报告。；市场只消费证明，不自行获得 kernel trust。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 任何等级都可解释具体通过/未通过项目，不能用模糊绿色徽章。；证明绑定插件 digest，升级后自动失效。；离线管理员可用组织 policy 选择最低等级。
- **Validation：** 对 dsh-agent-teams、dsh-context 类代表插件跑 verifier，只报告实际证据，不默认背书。；伪造旧报告对应新 tarball 必须失败。；验证 market metadata 不可提升 runtime trust。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E1；场景 S10；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。


## Phase 2 — 身份、权限、审批与人机边界

建立不可绕过的身份、Capability、Action、Policy 与审批语义。

### P2-01 — 统一 Principal / Tenant / Run / Actor 身份上下文

- **Priority / Wave / 依赖：** P0 / W3 / `P0-02`、`P0-06`。
- **问题 → 目标：** 当前 Session/Agent ID 足以标识会话，但不足以表达用户、组织、服务账户、子 Agent 委托链和跨进程身份。 → 让每个事件、工具、子 Agent、审批和外部动作都有不可混淆的责任主体与租户边界。
- **Files：** target `packages/core/agent/src/types.ts` [B]；`packages/core/agent/src/runtime-types.ts` [B]；`packages/core/session/src/types.ts` [B]；`packages/core/agent-loop/src/runtime-context.ts` [B]；`packages/sdk/protocol/src/types.ts` [B]；new `packages/identity/principal/src/index.ts` [N]；`packages/identity/principal/src/types.ts` [N]；`packages/identity/principal/src/chain.ts` [N]；`packages/identity/principal/tests/identity.spec.ts` [N]。
- **MUST：** 定义 UserPrincipal、ServicePrincipal、AgentPrincipal、TenantId、RunId、DelegationChain。；所有 SessionEvent envelope、ToolExecutionContext、SubagentRequest、SDK request 加 identity references。；禁止从可编辑 prompt 文本推断权限身份。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 任何 action 都能追溯 root user/tenant 与完整委托链。；跨租户 ID 混用在类型验证和 runtime policy 两层被拒绝。；匿名开发模式有独立受限 principal，不等价管理员。
- **Validation：** 运行 tenant-confusion、forged-agent-id、replay-old-token 测试。；检查所有新增事件的 identity 字段被持久化并 replay。；静态扫描禁止 tool provider 自己创建管理员 principal。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P2-02 — 可衰减 Capability Token 与子 Agent 委托

- **Priority / Wave / 依赖：** P0 / W4 / `P2-01`。
- **问题 → 目标：** 当前权限主要由 sandbox preset 与 approval policy 决定；缺少不可伪造、可衰减、可撤销的能力票据。 → 实现最小权限：父 Agent 只能把自身权限的更小子集、在更短时间内委托给子 Agent/插件。
- **Files：** target `packages/core/agent-loop/src/runtime-context.ts` [B]；`packages/core/tools/src/index.ts` [B]；`packages/subagent/subagent/src/child-agent.ts` [B]；`packages/subagent/subagent/src/descriptor.ts` [B]；`packages/kernel/trust-kernel/src/types.ts` [P]；new `packages/policy/capability-token/src/index.ts` [N]；`packages/policy/capability-token/src/types.ts` [N]；`packages/policy/capability-token/src/attenuate.ts` [N]；`packages/policy/capability-token/tests/token.spec.ts` [N]。
- **MUST：** token 包含 subject、tenant、capability、verbs、resources、constraints、expiry、nonce、delegationDepth、parent digest。；TrustKernel 签发/验证；普通代码只能 attenuate，不能扩大。；工具、插件 RPC、外部 Agent、ExecutionWorld 均要求 token。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 子 token 的资源/verb/金额/时间范围永不大于父 token。；撤销父 token 立即使所有 descendants 失效。；token 不写入模型可见文本、日志只记录 digest 和安全元数据。
- **Validation：** property-based 测试随机衰减链 10,000 次。；测试过期、重放、跨租户、扩大范围、签名篡改。；子 Agent 尝试请求父级未拥有权限时必须 fail closed。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S03、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P2-03 — 一等公民 ActionManifest

- **Priority / Wave / 依赖：** P0 / W4 / `P2-01`、`P0-06`。
- **问题 → 目标：** Tool call 只表达函数名和参数，无法统一覆盖 API、浏览器、shell、嵌套 code-mode、子 Agent 代执行和非工具型插件动作。 → 在任何有副作用的执行前，以规范化对象描述动作、目标、参数、预期状态变化、幂等与补偿。
- **Files：** target `packages/core/tools/src/types.ts` [B]；`packages/core/tools/src/index.ts` [B]；`packages/core/tools/src/code-mode.ts` [B]；`packages/core/agent-loop/src/tool-calls.ts` [B]；`packages/core/session/src/known-event-types.ts` [B]；new `packages/action/action-manifest/src/index.ts` [N]；`packages/action/action-manifest/src/types.ts` [N]；`packages/action/action-manifest/src/canonicalize.ts` [N]；`packages/action/action-manifest/tests/manifest.spec.ts` [N]。
- **MUST：** 字段包含 actionId/runId/actor/capability/target/argumentsHash/sideEffectClass/idempotencyKey/preconditions/expectedDiff/compensation/evidence requirements。；所有执行路径先生成并 durable append manifest，再做 policy/approval。；code-mode 内嵌工具和插件 RPC 不能绕过。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 任何外部写操作在事件日志中都存在先于执行的 ActionManifest。；参数规范化稳定，语义相同对象得到相同 hash。；无法分类副作用的动作默认高风险并要求审批。
- **Validation：** instrument 所有 tool providers，故意创建 bypass path，测试必须失败。；重放日志验证 manifest→decision→execution→result 完整配对。；fuzz canonicalizer，禁止 key order/Unicode/number 表示导致 hash 混淆。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S03、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 最终 spec/action-manifest.schema.json 无文件 owner。

### P2-04 — 通用副作用与风险分类体系

- **Priority / Wave / 依赖：** P0 / W5 / `P2-03`。
- **问题 → 目标：** 现有 ask/never 与文件 sandbox 粒度过粗，不能区分读取、本地可逆写、外部沟通、破坏性、财务、安全敏感和生命安全控制。 → 让不同垂直领域通过声明映射到同一 Harness 风险语言，而不是在核心写金融/法律/医疗特例。
- **Files：** target `packages/interaction/permission-presets/src/types.ts` [B]；`packages/core/tools/src/types.ts` [B]；`packages/action/action-manifest/src/types.ts` [P]；new `packages/policy/risk-taxonomy/src/index.ts` [N]；`packages/policy/risk-taxonomy/src/types.ts` [N]；`packages/policy/risk-taxonomy/src/classify.ts` [N]；`packages/policy/risk-taxonomy/tests/classify.spec.ts` [N]。
- **MUST：** 定义 read、local-reversible、internal-write、external-communication、destructive、financial、security-sensitive、safety-critical。；允许插件声明 domain tags，但最终映射必须由组织 policy 决定。；分类输出置信度和依据；未知默认为更高等级。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 同一动作分类跨 CLI/Web/SDK 一致。；插件不能自行把高风险动作降级。；组织可覆盖阈值但不能关闭 kernel hard-deny 类。
- **Validation：** 建立 200 个通用动作 fixture，不依赖某个垂直 Agent。；测试模糊/嵌套/批量动作取最高风险。；运行 adversarial description 测试，确认不根据工具自述盲信。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S03、S05、S06、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P2-05 — Policy Decision Service 与单调拒绝

- **Priority / Wave / 依赖：** P0 / W6 / `P0-02`、`P2-02`、`P2-03`、`P2-04`。
- **问题 → 目标：** 工具管线已有单调 guard 思想，但插件代码、外部子 Agent、SDK、动态扩展和后台 workflow 尚未统一到一个 kernel enforcement point。 → 把所有执行路径统一到不可绕过的 permit/deny/require-approval 决策，并保证 deny 不能被后置插件翻转。
- **Files：** target `packages/core/tools/src/index.ts` [B]；`packages/core/agent-loop/src/tool-calls.ts` [B]；`packages/extensions/cordis-host-runner/src/guard.ts` [B]；`packages/interaction/user-approval/src/index.ts` [B]；`packages/kernel/trust-kernel/src/index.ts` [P]；new `packages/policy/policy-engine/src/index.ts` [N]；`packages/policy/policy-engine/src/types.ts` [N]；`packages/policy/policy-engine/src/evaluate.ts` [N]；`packages/policy/policy-engine/tests/monotonic.spec.ts` [N]。
- **MUST：** Policy 输入为 identity、capability token、ActionManifest、ExecutionWorld、context facts；输出闭合 decision。；decision 由 TrustKernel enforce，插件只能增加约束或建议，不能扩大。；记录 explain trace，但对模型和普通插件隐藏敏感策略细节。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 同一 ActionManifest 无论从工具、workflow、SDK、插件、子 Agent 发起都经过同一 PEP。；任何一个 hard deny 即最终 deny。；Policy 服务不可被 Cordis replace/unmount。
- **Validation：** 构造五条 bypass 路径和后置 allow 插件，全部拒绝。；运行 policy order permutation 1000 次，结果不变。；用 audit replay 重新计算 decision，结果一致或明确标记 policy version drift。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S03、S05、S06、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P2-06 — 审批绑定完整规范化参数、资源与前置状态

- **Priority / Wave / 依赖：** P0 / W7 / `P2-03`、`P2-05`。
- **问题 → 目标：** 当前 ApprovalRequest 不携带完整工具参数，并主要绑定 open turn 的一次性请求，无法支撑高风险动作。 → 防止用户批准 A，执行时参数被替换成 B，或目标资源在审批后发生变化。
- **Files：** target `packages/interaction/user-approval/src/types.ts` [B]；`packages/interaction/user-approval/src/index.ts` [B]；`packages/interaction/user-approval/tests/approval.spec.ts` [B]；`packages/core/agent-loop/src/tool-calls.ts` [B]；new `packages/interaction/user-approval/src/canonical.ts` [N]；`packages/interaction/user-approval/src/preconditions.ts` [N]；`packages/interaction/user-approval/tests/argument-binding.spec.ts` [N]。
- **MUST：** ApprovalRequest 引用 ActionManifest digest，并展示经脱敏的完整参数、资源、风险、预期 diff、有效期。；执行前重新验证 digest、preconditions、capability token 和 policy version。；任何字段变化使批准失效并生成新请求。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 审批后替换参数、切换账户、改变文件 inode/远端对象版本均不会执行。；敏感值可 redacted 展示，但 hash 仍覆盖真实规范化值。；批准事件与最终 action 形成一一引用。
- **Validation：** 运行 TOCTOU、argument substitution、Unicode confusable、batch mutation 测试。；测试 code-mode 嵌套调用同样绑定。；审计查询能从 action 反查唯一 approval。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S04、S05、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P2-07 — 持久化、可跨 Turn/进程的 Approval Queue

- **Priority / Wave / 依赖：** P0 / W8 / `P2-06`、`P4-01`。
- **问题 → 目标：** 官方文档明确当前 approval 只在 open turn 内有效，没有持久 store 或 out-of-turn 语义。 → 支持跨天任务、后台 workflow、远程 SDK 和企业审批，而不是只在当前 turn 内等待。
- **Files：** target `packages/interaction/user-approval/src/index.ts` [B]；`packages/interaction/user-approval/src/types.ts` [B]；`packages/session/session-persistence/src/coordinator.ts` [B]；`packages/sdk/protocol/src/types.ts` [B]；new `packages/interaction/approval-store/src/index.ts` [N]；`packages/interaction/approval-store/src/types.ts` [N]；`packages/interaction/approval-store/src/sqlite.ts` [N]；`packages/interaction/approval-store/tests/recovery.e2e.ts` [N]。
- **MUST：** Approval 状态 requested/approved/denied/expired/revoked/consumed；持久化 request digest、policy version、actor、deadline。；workflow 可进入 `waiting_for_approval` 并释放 worker；批准后由 scheduler 唤醒。；多客户端订阅一致状态，消费用 compare-and-swap。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 进程在请求后、批准后、消费前任意崩溃，重启后状态正确。；同一批准最多消费一次。；过期/撤销批准永远不能执行。
- **Validation：** 对每个状态转换注入 crash。；并发两个客户端批准/拒绝，只有一个合法终态。；SDK reconnect 后能继续处理 pending approval。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S04、S05、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P2-08 — 可复用 Grant、范围规则、过期与撤销

- **Priority / Wave / 依赖：** P1 / W9 / `P2-05`、`P2-07`。
- **问题 → 目标：** 当前没有 allow-always/rule/revocation/store；一次性许可无法表达对白名单对象、金额、时间和动作类型的有限授权。 → 减少低风险重复询问，同时保证“总是允许”不是无限、不可撤销的全局后门。
- **Files：** target `packages/interaction/user-approval/src/types.ts` [B]；`packages/interaction/permission-presets/src/types.ts` [B]；`packages/settings/settings/src/index.ts` [B]；new `packages/policy/grant-store/src/index.ts` [N]；`packages/policy/grant-store/src/types.ts` [N]；`packages/policy/grant-store/src/match.ts` [N]；`packages/policy/grant-store/tests/grants.spec.ts` [N]。
- **MUST：** Grant 支持 actor/capability/resource predicates、金额/次数/时间窗口、environment、expiry、revocation。；Grant 由 policy 匹配，不由模型自由解释。；任何 grant 都可查看、撤销，并记录使用次数。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 不存在无作用域永久 grant。；规则边界外动作回到审批或拒绝。；撤销在分布式 worker 中有有界传播并默认 fail closed。
- **Validation：** property test 资源/金额/时间边界。；测试规则重叠时取最严格结果。；测试撤销竞态与离线 worker。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S04、S05、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 撤销的“有界传播”没有时间上限与离线 worker 处置 SLA。

### P2-09 — 多人审批与职责分离

- **Priority / Wave / 依赖：** P1 / W9 / `P2-01`、`P2-07`。
- **问题 → 目标：** 单一用户确认无法表达 maker-checker、两人规则、法务+财务等企业治理。 → 支持生产部署、资金、权限变更等需要双人或角色隔离的通用高风险动作。
- **Files：** target `packages/interaction/approval-store/src/types.ts` [P]；`packages/policy/policy-engine/src/types.ts` [P]；`packages/identity/principal/src/types.ts` [P]；new `packages/interaction/approval-quorum/src/index.ts` [N]；`packages/interaction/approval-quorum/src/types.ts` [N]；`packages/interaction/approval-quorum/tests/quorum.spec.ts` [N]。
- **MUST：** Policy 可返回 quorum spec：所需角色、人数、互斥关系、顺序、超时。；发起者不能同时满足独立审批角色。；批准签名绑定同一 ActionManifest digest。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 重复账户、同一身份不同 session、角色冒充不能满足 quorum。；Action 只在完整 quorum 且所有批准仍有效时执行。；任一关键批准撤销后未执行 action 立即失效。
- **Validation：** 测试 2-of-3、顺序审批、互斥角色、离职撤权。；并发批准与撤销竞态。；审计报告展示每个 approver 的身份和决策。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S04、S05、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 6 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P2-10 — Policy-as-Code、Explain 与 Dry Run

- **Priority / Wave / 依赖：** P1 / W7 / `P2-05`、`P0-05`。
- **问题 → 目标：** 如果 policy 只散落在插件 listener 和 preset 中，无法回答“为什么允许/拒绝”、无法模拟升级影响。 → 让组织能版本化、测试、审查权限规则，并在强制前观察影响。
- **Files：** target `packages/interaction/permission-presets/src/index.ts` [B]；`packages/settings/settings/src/index.ts` [B]；`packages/policy/policy-engine/src/index.ts` [P]；new `packages/policy/policy-language/src/index.ts` [N]；`packages/policy/policy-language/src/parser.ts` [N]；`packages/policy/policy-language/src/compiler.ts` [N]；`packages/policy/policy-language/tests/golden.spec.ts` [N]；`docs/policy/language.md` [N]。
- **MUST：** 定义有限、无任意代码执行的声明式 policy language。；支持 unit tests、shadow evaluation、version pin、diff explain。；Explain 输出命中规则和安全摘要，不暴露秘密。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** Policy 文件不能访问网络/文件/环境变量。；同一输入和版本确定性输出。；升级前可对历史 ActionManifest 重放并生成 impact report。
- **Validation：** 运行 parser fuzz、resource exhaustion、conflict tests。；对一万条历史 fixture 做 shadow replay。；错误 policy 加载 fail closed 并保留上一有效版本。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S03、S05、S06、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P2-11 — 把 Permission Preset 扩展为完整 Policy Profile

- **Priority / Wave / 依赖：** P1 / W9 / `P2-04`、`P2-05`、`P3-02`。
- **问题 → 目标：** 当前 preset 主要组合 filesystem sandbox 与 approval policy，未覆盖网络、进程、秘密、外部写、插件等级、预算和数据保留。 → 让用户选择的是完整安全姿态，而不只是 sandbox mode + ask/never。
- **Files：** target `packages/interaction/permission-presets/src/index.ts` [B]；`packages/interaction/permission-presets/src/types.ts` [B]；`packages/interaction/permission-presets/src/client.ts` [B]；`packages/bundle/base/cordis.patch.yml` [B]；new `packages/interaction/permission-presets/src/schema.ts` [N]；`packages/interaction/permission-presets/tests/profile.spec.ts` [N]。
- **MUST：** Profile 包含 execution world、fs/network/process/secrets、risk thresholds、approval rules、plugin trust、budget、retention。；预置 `observe-only`, `workspace-safe`, `team-standard`, `production-controlled`，但不写垂直逻辑。；切换 profile 前做 capability diff 和影响确认。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 所有 profile 可完整序列化并显示来源。；不存在 profile 把 kernel hard deny 关闭。；运行中降权立即生效；升权需审批。
- **Validation：** 对每个 profile 运行 capability matrix。；测试热切换时正在执行 action 的处理。；快照 UI 和 headless dump 输出。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S03、S05、S06、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 6 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P2-12 — 全局 Emergency Stop 与通用 Human Interaction Channel

- **Priority / Wave / 依赖：** P0 / W7 / `P2-05`、`P4-06`。
- **问题 → 目标：** 现有 approval 是一次性交互；SDK 也没有 server→client request。长任务需要明确的 pause/stop/question/resume 控制面。 → 让用户可立即停止所有新动作，并让后台任务在需要澄清/授权时安全挂起。
- **Files：** target `apps/cli/src/process-shutdown.ts` [B]；`packages/core/agent/src/dispatch.ts` [B]；`packages/core/agent/src/inbox.ts` [B]；`packages/sdk/protocol/src/transport.ts` [B]；`packages/sdk/protocol/src/types.ts` [B]；new `packages/interaction/human-channel/src/index.ts` [N]；`packages/interaction/human-channel/src/types.ts` [N]；`packages/interaction/control-plane/src/index.ts` [N]；`packages/interaction/control-plane/tests/emergency-stop.e2e.ts` [N]。
- **MUST：** 提供 `pause new actions`, `cancel run`, `kill execution world`, `ask question`, `resume`。；Emergency stop 由 kernel 广播并持久化；worker 获取新 lease/action 前必须检查。；Question 与 approval 分离，回答只作为输入，不自动授予权限。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 触发 stop 后无新外部副作用；在途动作按策略终止或标记 reconciliation-required。；重启后 stop 状态保持，必须显式解除。；所有 surface 的状态一致。
- **Validation：** 在工具启动前/中/后注入 stop。；模拟网络分区 worker，恢复后不得继续旧 token。；验证 question 回答不能被当作 approval。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E2；场景 S04、S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 与 P8-04 重复把 human-channel index/types 声明为 new；须唯一 owner。


## Phase 3 — Execution World、Sandbox、Secrets 与资源治理

把文件、网络、进程、IPC、设备、Secrets 和资源限制统一为可替换执行世界。

### P3-01 — 一等公民 ExecutionWorld Capability Seam

- **Priority / Wave / 依赖：** P0 / W7 / `P0-03`、`P2-05`。
- **问题 → 目标：** 现有 sandbox seam 主要描述同一世界中的文件执行策略；无法统一表达世界生命周期、身份、网络、秘密、快照、资源和 attestation。 → 把本地 shell、容器、microVM、远程 VM、浏览器等统一为可替换、可证明、受策略约束的执行世界。
- **Files：** target `packages/sandbox/sandbox/src/index.ts` [B]；`packages/sandbox/sandbox/src/escalation.ts` [B]；`packages/sandbox/sandbox/src/roots.ts` [B]；`packages/core/tools/src/types.ts` [B]；`packages/core/agent-loop/src/runtime-context.ts` [B]；new `packages/execution/execution-world/src/index.ts` [N]；`packages/execution/execution-world/src/types.ts` [N]；`packages/execution/execution-world/src/lifecycle.ts` [N]；`packages/execution/execution-world/tests/world.spec.ts` [N]；`docs/subsystems/execution-world.md` [N]。
- **MUST：** 定义 WorldSpec、WorldHandle、WorldAttestation、WorldSnapshot、execute/terminate/snapshot/restore 接口。；WorldSpec 覆盖 filesystem、network、process、IPC、devices、secrets、resources、lifetime、tenant。；旧 SandboxExecution 作为 local provider 的兼容适配层，不在 Agent Loop 硬编码。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 同一 ToolExecution 可在 local/container/microVM provider 间切换而不改变 ActionManifest/Policy 语义。；无 provider 能满足 policy 时 fail closed，不能静默降级。；WorldHandle 不能被模型或第三方插件伪造。
- **Validation：** 实现 fake world conformance suite，所有 provider 必须通过。；运行 provider swap composition test。；测试 world 被 kill、超时、失联时返回统一 typed outcome。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P3-02 — 扩展 Sandbox Policy 为全维度安全词汇

- **Priority / Wave / 依赖：** P0 / W8 / `P3-01`。
- **问题 → 目标：** 官方 Sandbox 文档明确当前主要覆盖文件副作用；Network、Process visibility 等不在统一策略词汇中。 → 从仅治理文件副作用扩展到真实 Agent 所需的网络、进程、IPC、设备、凭证和资源限制。
- **Files：** target `packages/sandbox/sandbox/src/index.ts` [B]；`packages/sandbox/sandbox/src/roots.ts` [B]；`packages/sandbox/sandbox/src/escalation.ts` [B]；`packages/sandbox/sandbox-local/src/profiles.ts` [B]；`packages/interaction/permission-presets/src/types.ts` [B]；new `packages/sandbox/sandbox/src/policy.ts` [N]；`packages/sandbox/sandbox/src/network.ts` [N]；`packages/sandbox/sandbox/src/process.ts` [N]；`packages/sandbox/sandbox/tests/policy.spec.ts` [N]。
- **MUST：** 引入 FileSystemPolicy、NetworkPolicy、ProcessPolicy、IpcPolicy、DevicePolicy、SecretPolicy、ResourcePolicy。；策略为闭合、显式 allowlist；未知 capability 默认 deny。；每个 provider 返回 supportedPolicyFeatures，solver 不允许弱语义冒充强语义。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 请求禁网时 DNS、IPv4/IPv6、localhost、Unix socket、代理均不可用。；请求不可见其他进程时 `/proc`、ps、debug attach 等受限。；策略序列化和审计不丢失字段。
- **Validation：** 运行跨平台 policy conformance suite。；构造 unsupported policy，确认 fail closed 或迁移到更强 provider。；对每个维度增加 negative tests。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P3-03 — 结构化 Out-of-Band Denial 与执行错误

- **Priority / Wave / 依赖：** P0 / W8 / `P3-01`、`P0-06`。
- **问题 → 目标：** 当前本地 sandbox 的部分拒绝依赖 stderr/退出码语义，容易被工具输出伪装或误分类。 → 让 Runtime、Verifier 和 UI 能可靠区分 policy denial、sandbox failure、tool failure、timeout 与 user cancellation。
- **Files：** target `packages/sandbox/sandbox-local/src/index.ts` [B]；`packages/sandbox/sandbox/src/index.ts` [B]；`packages/core/tools/src/types.ts` [B]；`packages/core/agent-loop/src/tool-calls.ts` [B]；`packages/llm/llm/src/error.ts` [B]；new `packages/execution/execution-world/src/errors.ts` [N]；`packages/execution/execution-world/src/outcome.ts` [N]；`packages/execution/execution-world/tests/denial.spec.ts` [N]。
- **MUST：** 定义 typed outcome：policy_denied、sandbox_unavailable、resource_exhausted、timeout、cancelled、tool_failed、world_lost。；provider 通过控制通道返回状态，不解析模型可控 stdout/stderr 决定安全语义。；保留原始输出为 artifact，但与控制状态分离。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 恶意程序打印伪造 denial 文本不能改变 outcome。；每类错误在 session/event、SDK、UI 中保持类型。；Retry policy 能基于类型做正确决策。
- **Validation：** 运行 forged-stderr fixture。；对所有 provider 做 error mapping conformance。；快照 SDK wire 和 web rendering。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P3-04 — 统一 Network Egress Proxy 与目的地策略

- **Priority / Wave / 依赖：** P0 / W9 / `P3-02`、`P2-05`。
- **问题 → 目标：** 没有统一 network policy 时，shell、插件、浏览器、MCP 和模型 provider 可通过不同路径出网。 → 控制 Agent 的外部访问，阻止数据外泄、SSRF、云元数据和绕过 API 审计。
- **Files：** target `packages/sandbox/sandbox-local/src/index.ts` [B]；`packages/core/tools/src/index.ts` [B]；`packages/plugin/plugin-host/src/supervisor.ts` [P]；`packages/execution/execution-world/src/types.ts` [P]；new `packages/execution/egress-proxy/src/index.ts` [N]；`packages/execution/egress-proxy/src/policy.ts` [N]；`packages/execution/egress-proxy/src/dns.ts` [N]；`packages/execution/egress-proxy/tests/ssrf.e2e.ts` [N]。
- **MUST：** 所有受控 world 出网经 proxy；策略支持 scheme/host/port/path/method、DNS pinning、TLS identity、带宽和响应大小。；默认阻断 localhost、RFC1918、link-local、cloud metadata、Docker socket bridge，除非显式授权。；记录目的地与字节计数，不记录秘密正文。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 直接 IP、DNS rebinding、IPv6、redirect chain、proxy env 绕过均失败。；允许列表访问成功且证据可追踪到 ActionManifest。；browser/MCP/shell 使用同一 egress policy。
- **Validation：** 运行 SSRF corpus 和 DNS rebinding test server。；测试 30x 跨域重定向。；断开 proxy 时 fail closed。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 prior_output supervisor.ts 的生产者 P1-06 未写入显式 dependencies。

### P3-05 — Process、Syscall、IPC 与 Device 隔离

- **Priority / Wave / 依赖：** P0 / W9 / `P3-02`。
- **问题 → 目标：** 文件根限制不能阻止 ptrace、process enumeration、Unix socket、device node 和 privileged syscall。 → 阻止 Agent 观察/操纵宿主进程、Docker、SSH agent、剪贴板、摄像头、GPU 或任意设备。
- **Files：** target `packages/sandbox/sandbox-local/src/index.ts` [B]；`packages/sandbox/sandbox-local/src/profiles.ts` [B]；`packages/execution/execution-world/src/types.ts` [P]；new `packages/execution/local-isolation/src/linux.ts` [N]；`packages/execution/local-isolation/src/macos.ts` [N]；`packages/execution/local-isolation/src/windows.ts` [N]；`packages/execution/local-isolation/tests/process-isolation.e2e.ts` [N]。
- **MUST：** Linux 组合 user/mount/pid/net namespaces、seccomp/Landlock/bwrap；macOS 使用 Seatbelt profile；Windows 使用 restricted token/job object/ACL。；显式控制 Unix sockets、named pipes、clipboard、camera/microphone、GPU、USB、Docker daemon、SSH agent。；平台能力不足时报告 unsupported，不提供伪安全。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 测试进程不可见、不可 ptrace、不可连接 Docker/SSH socket。；设备访问与 clipboard 默认 deny。；跨平台语义差异进入 attestation。
- **Validation：** 运行平台专用攻击 fixture。；CI 至少在 Linux/macOS/Windows 各跑受支持子集。；对 unsupported runner 验证 fail-closed path。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P3-06 — Secrets Broker：短期、最小范围、不可回显凭证

- **Priority / Wave / 依赖：** P0 / W8 / `P2-02`、`P3-01`。
- **问题 → 目标：** 现有 Credentials seam 以引用解析为主，provider 可从环境/本地文件取得记录；owner scope 与运行时隔离还不足以表达短期委托和使用目的。 → 避免长期密钥通过 process.env、prompt、日志或插件上下文传播。
- **Files：** target `packages/credentials/credentials/src/index.ts` [B]；`packages/credentials/credentials/src/types.ts` [B]；`packages/credentials/credentials/src/invariant.ts` [B]；`packages/llm/llm/src/api-key.ts` [B]；`packages/settings/settings/src/redact.ts` [B]；new `packages/credentials/secrets-broker/src/index.ts` [N]；`packages/credentials/secrets-broker/src/types.ts` [N]；`packages/credentials/secrets-broker/src/lease.ts` [N]；`packages/credentials/secrets-broker/tests/secret-leak.e2e.ts` [N]。
- **MUST：** CredentialRef 解析为短期 SecretLease，绑定 principal、ActionManifest、world、purpose、expiry。；优先通过 brokered request/FD/socket 注入，避免全局 env；使用后自动撤销。；日志、错误、artifact、模型上下文统一 secret taint/redaction。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 子 Agent/插件只能获得明确委托的 secret。；secret 不出现在 session log、stdout/stderr、crash dump、evidence package。；过期 lease 无法重放。
- **Validation：** 用 canary secrets 扫描所有产物。；测试 env inheritance、child process、error stack、LLM prompt 泄漏。；kill world 后 broker 撤销 lease。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S10、S11、S13；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P3-07 — 本地 Sandbox 跨平台 Fail-Closed 强化

- **Priority / Wave / 依赖：** P0 / W10 / `P3-02`、`P3-05`。
- **问题 → 目标：** 本地平台实现能力不同；若某个限制失败而仍继续执行，会形成隐蔽降级。 → 把 sandbox-local 从便利 provider 提升为可测量、可证明、语义一致的本地执行后端。
- **Files：** target `packages/sandbox/sandbox-local/src/index.ts` [B]；`packages/sandbox/sandbox-local/src/profiles.ts` [B]；`packages/sandbox/sandbox-local/src/invariant.ts` [B]；`packages/sandbox/sandbox/src/invariant.ts` [B]；new `packages/sandbox/sandbox-local/src/capabilities.ts` [N]；`packages/sandbox/sandbox-local/src/attestation.ts` [N]；`packages/sandbox/sandbox-local/tests/conformance.e2e.ts` [N]。
- **MUST：** 启动时生成 attestation；开发降级需显式 flag。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 故意移除 bwrap/权限或让 Seatbelt compile 失败时不执行命令。；attestation 绑定 OS/kernel/provider version。；安全 profile 在所有支持平台通过 conformance。
- **Validation：** 模拟缺失依赖和权限失败。；执行 escape corpus。；比较三平台 canonical policy fixtures。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P3-08 — Container ExecutionWorld Provider

- **Priority / Wave / 依赖：** P1 / W10 / `P3-01`、`P3-04`、`P3-06`。
- **问题 → 目标：** 长任务、未知依赖、第三方插件构建和测试需要独立 filesystem/process/network namespace；不能全部在用户机执行。 → 提供比本地 sandbox 更强、可复现的通用任务环境。
- **Files：** target `packages/execution/execution-world/src/index.ts` [P]；`packages/bundle/base/cordis.patch.yml` [B]；new `packages/execution/execution-world-container/src/index.ts` [N]；`packages/execution/execution-world-container/src/runtime.ts` [N]；`packages/execution/execution-world-container/src/images.ts` [N]；`packages/execution/execution-world-container/tests/provider.e2e.ts` [N]。
- **MUST：** 支持 OCI image digest、rootless、read-only rootfs、ephemeral overlay、egress proxy、secret leases、resource quotas。；禁止隐式挂载 Docker socket/host home。；provider 实现标准 snapshot/terminate/attest contract。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 相同 image digest 和 inputs 产生可重放环境。；容器逃逸 corpus 无法访问宿主。；cleanup 后无残留容器、volume、secret。
- **Validation：** 运行 conformance suite 和 crash cleanup test。；用固定镜像做 reproducibility hash。；检查 rootless/privileged 配置。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 6 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P3-09 — MicroVM / Remote ExecutionWorld 与 Attestation

- **Priority / Wave / 依赖：** P1 / W8 / `P3-01`、`P2-01`、`P4-07`。
- **问题 → 目标：** E2B 等 seam 有远程执行基础，但通用 Harness 需要 provider-neutral world lifecycle、远程身份和结果证明。 → 支持高风险、长时间、跨机器和弹性计算任务，同时保留统一治理语义。
- **Files：** target `packages/execution/execution-world/src/types.ts` [P]；`packages/e2b/README.md` [B]；`packages/sdk/protocol/src/types.ts` [B]；new `packages/execution/execution-world-remote/src/index.ts` [N]；`packages/execution/execution-world-remote/src/client.ts` [N]；`packages/execution/execution-world-remote/src/attestation.ts` [N]；`packages/execution/execution-world-remote/tests/reconnect.e2e.ts` [N]。
- **MUST：** 定义远程 create/attach/heartbeat/snapshot/terminate 协议，支持 microVM provider。；Attestation 证明镜像、policy、tenant、network proxy 和 secret injection。；网络分区时停止签发新 action lease，恢复后 reconciliation。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 客户端断线/重启可重新 attach，不重复已完成 action。；伪造或过期 attestation 被拒绝。；tenant A 不可 attach tenant B world。
- **Validation：** 运行网络分区、server restart、stale lease、wrong image tests。；对远程 world 执行同一 conformance suite。；验证销毁后数据不可再读。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S09、S11、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P3-10 — CPU/Memory/Disk/Time/Process/Network 资源配额

- **Priority / Wave / 依赖：** P0 / W8 / `P3-01`。
- **问题 → 目标：** 当前 timeout policy 主要是每次调用 deadline，不能统一控制进程树、累计 CPU、磁盘、带宽、并发和租户配额。 → 防止失控 Agent、插件或 workflow 耗尽宿主和预算。
- **Files：** target `packages/guard/timeout-policy/README.md` [B]；`packages/sandbox/sandbox-local/src/index.ts` [B]；`packages/workflow/workflow/src/types.ts` [B]；`packages/core/agent/src/types.ts` [B]；new `packages/execution/resource-budget/src/index.ts` [N]；`packages/execution/resource-budget/src/types.ts` [N]；`packages/execution/resource-budget/src/accounting.ts` [N]；`packages/execution/resource-budget/tests/budget.e2e.ts` [N]。
- **MUST：** BudgetSpec 支持 per action/run/tenant 的 wall time、CPU、memory、disk、processes、network bytes、tool calls、agents。；scheduler 预留资源，world provider enforce，telemetry 对账。；超限返回 typed outcome 并触发清理。；此项只定义 ExecutionWorld 资源计量/硬限额原语；P4-10 的调度公平性在其上层消费。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** fork bomb、disk fill、memory balloon、network flood 均被限制。；累计预算不能通过子 Agent 拆分绕过。；计量误差在声明范围内且可审计。
- **Validation：** 运行资源攻击 fixture。；测试 50 个子 Agent 共享父预算。；超限后检查无残留进程/文件/lease。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 计量误差“声明范围”没有数值与平台矩阵。

### P3-11 — ExecutionWorld Snapshot / Restore / Rollback

- **Priority / Wave / 依赖：** P0 / W11 / `P3-01`、`P6-09`。
- **问题 → 目标：** 仅依赖 Git 不能恢复进程、依赖缓存、数据库、浏览器状态和非 Git artifact。 → 让长任务、代码修改和高风险操作具备一致的检查点与恢复能力。
- **Files：** target `packages/compaction/compaction/src/checkpoint.ts` [B]；`packages/execution/execution-world/src/lifecycle.ts` [P]；`packages/workspace/workspace/src/entity.ts` [B]；new `packages/execution/world-snapshot/src/index.ts` [N]；`packages/execution/world-snapshot/src/types.ts` [N]；`packages/execution/world-snapshot/src/store.ts` [N]；`packages/execution/world-snapshot/tests/restore.e2e.ts` [N]。
- **MUST：** Snapshot 包含 world filesystem/content digests、provider metadata、running action boundary、secret references（不含 secret 值）。；只允许在安全 quiescent boundary 创建一致快照；非一致快照明确标记。；restore 生成新 world identity，旧 token 不继承。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 恢复后文件/依赖/数据库状态与快照 digest 匹配。；secret lease、network connection、process PID 不被错误复用。；rollback 事件和 artifact lineage 可追踪。
- **Validation：** 在 tool step 边界注入 crash 后 restore。；测试 snapshot corruption、provider version mismatch。；运行 100 次 create/restore/delete 泄漏检查。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P3-12 — Workspace 路径、附件准入与恶意输入边界强化

- **Priority / Wave / 依赖：** P0 / W8 / `P3-01`、`P2-01`。
- **问题 → 目标：** Workspace 已做 realpath canon，Attachment 有 admission 与内容寻址，但生产用途需要租户边界、扫描、解压限制和执行世界隔离。 → 封堵 symlink/TOCTOU/path traversal、恶意附件、MIME 欺骗和内容炸弹等通用入口。
- **Files：** target `packages/workspace/workspace/src/paths.ts` [B]；`packages/workspace/workspace/src/entity.ts` [B]；`packages/attachment/attachment/src/admission.ts` [B]；`packages/attachment/attachment/src/error.ts` [B]；`packages/attachment/attachment/src/types.ts` [B]；`packages/sandbox/sandbox/src/roots.ts` [B]；new `packages/attachment/attachment-security/src/index.ts` [N]；`packages/attachment/attachment-security/src/scanner.ts` [N]；`packages/attachment/attachment-security/tests/malicious.e2e.ts` [N]；`packages/workspace/workspace/tests/path-race.e2e.ts` [N]。
- **MUST：** 所有路径操作使用 openat/handle 风格或执行前重新验证 inode，禁止 symlink escape。；附件进行 MIME sniff、大小/像素/解压比/嵌套深度/恶意宏与可执行检测。；未信任附件只在隔离 world 解析，解析产物带 lineage。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** path swap、symlink、hardlink、case-fold、Unicode 路径攻击失败。；zip bomb、polyglot、伪 MIME、恶意文档不进入模型或宿主 parser。；跨租户 content hash 不导致引用泄漏。
- **Validation：** 运行路径与附件攻击 corpus。；对 TOCTOU 使用并发 stress。；验证 quarantine 清理与审计记录。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E3；场景 S13、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。


## Phase 4 — Durable Run、Workflow、恢复与外部对账

把一次聊天升级为可跨进程、跨天、可恢复、可对账的 Run。

### P4-01 — 一等公民 Run Service 与 Run Event Log

- **Priority / Wave / 依赖：** P0 / W4 / `P2-01`、`P0-06`。
- **问题 → 目标：** 当前 Session 很强，但 Workflow 由 holder 拥有且无 durable journal；SDK prompt receipt 也不代表完整 Run。 → 把一次跨 Turn、跨 Agent、跨进程的目标作为持久实体，而不是只依赖 Session 和 live handle。
- **Files：** target `packages/core/session/src/types.ts` [B]；`packages/core/agent/src/types.ts` [B]；`packages/workflow/workflow/src/types.ts` [B]；`packages/session/session-persistence/src/coordinator.ts` [B]；new `packages/run/run/src/index.ts` [N]；`packages/run/run/src/types.ts` [N]；`packages/run/run/src/events.ts` [N]；`packages/run/run/src/state-machine.ts` [N]；`packages/run/run/tests/state-machine.spec.ts` [N]。
- **MUST：** Run 状态 accepted/planning/waiting/running/paused/verifying/reconciling/succeeded/failed/cancelled。；Run event log append-only，引用 Session、Workflow、Action、Artifact、Approval、Verification。；Run owner 是服务而非 UI/turn holder。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 进程重启后可列出所有非终态 Run 并恢复。；非法状态转换被拒绝。；一个 Session 可关联多个 Run，一个 Run 可跨多个 Session/Agent。
- **Validation：** state-machine property tests。；在每个状态转换后 kill/restart。；验证 Run list 分页、tenant filtering 和权限。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P4-02 — 通用 TaskProfile 编译结果

- **Priority / Wave / 依赖：** P1 / W6 / `P4-01`、`P2-04`。
- **问题 → 目标：** 直接把用户文本交给 Agent Loop 容易遗漏约束，也无法让 Router、Policy、Budget 和 Verifier共享同一任务语义。 → 在执行前结构化目标、交付物、约束、风险、新鲜度、隐私和成功标准。
- **Files：** target `packages/core/agent/src/dispatch.ts` [B]；`packages/core/agent/src/types.ts` [B]；`packages/run/run/src/types.ts` [P]；new `packages/run/task-profile/src/index.ts` [N]；`packages/run/task-profile/src/types.ts` [N]；`packages/run/task-profile/src/validate.ts` [N]；`packages/run/task-profile/tests/profile.spec.ts` [N]。
- **MUST：** TaskProfile 只表达通用字段，不含销售/金融等垂直流程。；保留原始用户目标引用和所有推断的来源/置信度。；高风险或歧义字段缺失时产生 question，不擅自猜授权。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 同一输入在确定性 parser fixture 下输出稳定。；所有 hard constraint 可从 profile 追溯原始来源。；未知 side effect 不会被标为 none。
- **Validation：** 建立代码、研究、外部动作、个人计划四类通用 fixture。；测试冲突约束与缺失信息。；验证 TaskProfile 被持久化且可版本修订。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 最终 spec/task-profile.schema.json 无文件 owner。

### P4-03 — RunPlan：模型、Agent、工具、世界、预算与验证的可执行计划

- **Priority / Wave / 依赖：** P0 / W8 / `P4-02`、`P3-01`。
- **问题 → 目标：** 现有 workflow meta 中 phases 主要是观察信息，不施加执行结构；缺少统一计划对象连接 model route、context topology、agent graph、policy、world 和 verification。 → 把 Router 决策编译成可审计、可冻结、可恢复的运行规格。
- **Files：** target `packages/workflow/workflow/src/types.ts` [B]；`packages/core/agent/src/model-selection.ts` [B]；`packages/run/run/src/types.ts` [P]；new `packages/run/run-plan/src/index.ts` [N]；`packages/run/run-plan/src/types.ts` [N]；`packages/run/run-plan/src/compile.ts` [N]；`packages/run/run-plan/tests/compile.spec.ts` [N]。
- **MUST：** RunPlan 包含 objectives、constraints、modelRoutes、contextTopology、agentGraph、worlds、budgets、approvalGates、verification、recovery。；编译阶段做 capability/policy/budget satisfiability。；Plan 是数据，不包含任意可执行代码。；先定义 versioned `verificationContractRef` 扩展点；P7-01 在不破坏 RunPlan ABI 的前提下提供完整契约。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 无法满足的约束返回最小冲突集，不进入运行。；Plan 中每个 node 能追溯 TaskProfile requirement。；同一 normalized inputs 产生确定性 plan id。
- **Validation：** 运行 solver golden tests。；构造缺模型/缺世界/预算不足/政策冲突。；验证计划可序列化、持久化、SDK 传输。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 最终 spec/run-plan.schema.json 无文件 owner。

### P4-04 — RunPlan Freeze、签名与 Amendment Protocol

- **Priority / Wave / 依赖：** P0 / W9 / `P4-03`、`P2-05`。
- **问题 → 目标：** 动态 Agent 可以改变策略；若没有冻结与修订协议，审计无法判断实际执行与批准计划是否一致。 → 防止执行过程中模型悄悄扩大权限、预算、工具或目标。
- **Files：** target `packages/run/run-plan/src/types.ts` [P]；`packages/run/run/src/events.ts` [P]；`packages/kernel/trust-kernel/src/index.ts` [P]；new `packages/run/run-plan/src/freeze.ts` [N]；`packages/run/run-plan/src/amend.ts` [N]；`packages/run/run-plan/tests/amendment.spec.ts` [N]。
- **MUST：** 执行前 canonicalize+kernel sign；runtime 只接受已签 plan。；任何结构变化创建 PlanAmendment，重新做 policy/budget/approval。；允许运行时小范围参数 resolution，但字段必须预先声明 mutable。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 修改 plan JSON 任一字节签名失效。；Agent 不能自行提升 maxAgents、network、budget、approval mode。；所有 action 引用生效 plan revision。
- **Validation：** 运行 privilege-escalation amendment tests。；并发两个 amendment 使用 CAS，只能一个成为 active revision。；replay 可重建每个 revision 时间线。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 6 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P4-05 — 扩展 Agent Lifecycle 状态机

- **Priority / Wave / 依赖：** P0 / W5 / `P4-01`。
- **问题 → 目标：** 当前 Agent 主状态过于简单，无法可靠表达长任务和调度器所有权。 → 支持排队、等待审批、暂停、恢复、失败、回收和失联，而不只依赖 idle/running。
- **Files：** target `packages/core/agent/src/types.ts` [B]；`packages/core/agent/src/runtime-types.ts` [B]；`packages/core/agent/src/dispatch.ts` [B]；`packages/core/agent/src/inbox.ts` [B]；`packages/core/agent-loop/src/agent.ts` [B]；new `packages/core/agent/src/state-machine.ts` [N]；`packages/core/agent/tests/state-machine.spec.ts` [N]。
- **MUST：** 状态 queued/starting/running/waiting_tool/waiting_human/paused/cancelling/failed/completed/orphaned。；每个转换带 reason、runId、lease epoch。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 非法转换和 stale worker 更新被拒绝。；等待状态不消耗 LLM/worker 资源。；重启后 orphaned Agent 可被 reclaim 或安全失败。
- **Validation：** state transition property tests。；模拟 worker crash、UI disconnect、approval wait。；验证 Session status 向后兼容映射。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P4-06 — Durable Inbox / Outbox 与 Exactly-Once Effect Handoff

- **Priority / Wave / 依赖：** P0 / W5 / `P4-01`、`P2-01`。
- **问题 → 目标：** 内存 inbox 和直接 event dispatch 无法覆盖跨进程/网络故障；单纯 exactly-once 不现实，需要 inbox/outbox + 幂等消费。 → 保证消息、工具结果、审批和调度指令在崩溃与重试中不丢失、不重复。
- **Files：** target `packages/core/agent/src/inbox.ts` [B]；`packages/core/agent/src/dispatch.ts` [B]；`packages/session/session-persistence/src/write-behind.ts` [B]；`packages/session/session-persistence/src/coordinator.ts` [B]；new `packages/run/message-bus/src/index.ts` [N]；`packages/run/message-bus/src/inbox.ts` [N]；`packages/run/message-bus/src/outbox.ts` [N]；`packages/run/message-bus/tests/crash.e2e.ts` [N]。
- **MUST：** 事务性写入 domain event 与 outbox；dispatcher 发送后用 idempotent receipt 标记。；consumer 按 message id/epoch 去重。；支持 priority、deadline、dead-letter 和 backpressure。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 在 commit 前后、发送前后、ack 前后 kill，消息最终只产生一次业务 effect。；未送达消息可查询和重放。；跨租户消息不能被消费。
- **Validation：** 系统化 fault matrix 覆盖至少 12 个边界。；运行重复投递 10,000 次。；监控 dead-letter 产生明确告警。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 标题的 exactly-once 只能规范化为至少一次投递+去重，以及具备 idempotency/observe/fencing 时的 effective-once。

### P4-07 — Worker Lease、Heartbeat 与 Fencing Token

- **Priority / Wave / 依赖：** P0 / W6 / `P4-06`。
- **问题 → 目标：** 没有租约与 fencing 时，旧 worker 在失联后恢复可能继续写状态或重复外部动作。 → 防止网络分区或重启后两个 worker 同时执行同一 Agent/Action。
- **Files：** target `packages/core/agent/src/dispatch.ts` [B]；`packages/core/agent/src/consumed-work.ts` [B]；`packages/workflow/workflow-worker-thread/src/host.ts` [B]；`packages/workflow/workflow-worker-thread/src/runtime.ts` [B]；new `packages/run/lease/src/index.ts` [N]；`packages/run/lease/src/types.ts` [N]；`packages/run/lease/src/store.ts` [N]；`packages/run/lease/tests/fencing.e2e.ts` [N]。
- **MUST：** 每个 work item 由 epoch lease 所有；所有状态写和 action execution 携带 fencing token。；heartbeat 续租，过期后 scheduler 可 reclaim。；外部 idempotency ledger 拒绝 stale epoch。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 旧 worker 恢复后无法提交结果或执行新副作用。；clock skew 在容忍范围内不导致双主。；lease store 故障时停止新工作。
- **Validation：** 运行 split-brain 和 delayed packet tests。；模拟 100 workers 竞争同一 item。；验证 stale token rejection 写入审计。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 clock-skew 容忍范围与租约安全公式未定义。

### P4-08 — Workflow Journal 与步骤级 Resume

- **Priority / Wave / 依赖：** P0 / W7 / `P4-01`、`P4-06`、`P4-07`。
- **问题 → 目标：** 官方 Workflow 明确没有 durable journal/resume；当前 result 主要只有 value、stopReason、agentsStarted。 → 让模型生成的 workflow 在进程崩溃后从已完成步骤继续，而不是重新开始。
- **Files：** target `packages/workflow/workflow/src/types.ts` [B]；`packages/workflow/workflow/src/runtime-types.ts` [B]；`packages/workflow/workflow-worker-thread/src/host.ts` [B]；`packages/workflow/workflow-worker-thread/src/protocol.ts` [B]；`packages/workflow/workflow-worker-thread/src/session.ts` [B]；`packages/workflow/workflow-worker-thread/src/worker.ts` [B]；new `packages/workflow/workflow-journal/src/index.ts` [N]；`packages/workflow/workflow-journal/src/types.ts` [N]；`packages/workflow/workflow-journal/src/replay.ts` [N]；`packages/workflow/workflow-journal/tests/resume.e2e.ts` [N]。
- **MUST：** 记录 script digest、program counter/step id、input/output artifact refs、child agent receipts、side-effect receipts、phase。；恢复时跳过已完成且验证过的纯步骤；有副作用步骤先 reconciliation。；禁止序列化任意闭包；workflow DSL/worker API 需可 journal。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 在每个 agent() call 前后 kill，恢复不重复已完成 child work。；script digest 改变时不能盲目 resume，必须 migrate/restart。；journal 可压缩但原始证据保留。
- **Validation：** 运行现有 workflow tests 外加系统 fault injection。；24 小时虚拟时钟场景 100 次重启。；验证 resume 结果与无故障结果相同。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P4-09 — Detached、Saved、Versioned 与 Nested Workflow

- **Priority / Wave / 依赖：** P1 / W8 / `P4-08`、`P1-02`。
- **问题 → 目标：** 当前 workflow 由 holder 拥有，没有 saved/nested workflow；holder disposal 会结束运行。 → 支持后台长期工作、可复用编排和组合，而不把所有逻辑塞回主上下文。
- **Files：** target `packages/workflow/workflow/src/types.ts` [B]；`packages/workflow/workflow-worker-thread/src/meta.ts` [B]；`packages/workflow/workflow-worker-thread/src/runtime.ts` [B]；`packages/workflow/workflow-worker-thread/src/session.ts` [B]；new `packages/workflow/workflow-registry/src/index.ts` [N]；`packages/workflow/workflow-registry/src/types.ts` [N]；`packages/workflow/workflow-registry/src/version.ts` [N]；`packages/workflow/workflow-registry/tests/nested.e2e.ts` [N]。
- **MUST：** Workflow 定义作为签名 artifact 注册，版本固定；Run 引用 digest。；detached workflow 由 Run service 持有，UI/turn 断开不终止。；nested workflow 继承/衰减 budget、capability token、trace，并检测递归。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 保存/加载不会执行未验证代码。；父取消能传播；子失败按声明策略处理。；递归深度、总 agents、总 budget 受限。
- **Validation：** 测试 UI disconnect、parent restart、nested cancellation。；测试 workflow version upgrade 与旧 Run resume。；递归/循环定义必须在编译阶段拒绝。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P4-10 — Workflow 预算、Scheduler、Backpressure、公平性与资源锁

- **Priority / Wave / 依赖：** P0 / W9 / `P3-10`、`P4-07`。
- **问题 → 目标：** 当前 workflow 有 agent 数量上限基础，但缺统一 token/cost/time/resource vocabulary、全局 scheduler 和资源锁。 → 让多 Agent 并发可控，不因 1000 个子任务耗尽资源、冲突写文件或饿死其他租户。
- **Files：** target `packages/workflow/workflow/src/types.ts` [B]；`packages/workflow/workflow-worker-thread/src/runtime.ts` [B]；`packages/core/agent/src/dispatch.ts` [B]；`packages/guard/timeout-policy/README.md` [B]；new `packages/run/scheduler/src/index.ts` [N]；`packages/run/scheduler/src/queue.ts` [N]；`packages/run/scheduler/src/locks.ts` [N]；`packages/run/scheduler/src/fairness.ts` [N]；`packages/run/scheduler/tests/scheduler.e2e.ts` [N]。
- **MUST：** BudgetSpec 覆盖 tokens/cost/time/agents/tool calls/world resources；父子层级累计。；scheduler 支持 tenant fairness、priority aging、resource locks、exclusive tools。；backpressure 传播到 workflow script，禁止无限排队。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 50 个并发 Agent 下无死锁、无超预算、无跨租户饥饿。；两个写同一资源的任务被序列化或冲突检测。；取消会释放所有 lock/permit。
- **Validation：** 运行 deterministic scheduler simulation。；随机任务/锁 property test。；scale lane 测 1k queued / 100 active tasks。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P4-11 — 统一 Retry Classifier、Circuit Breaker 与 Retry Budget

- **Priority / Wave / 依赖：** P0 / W8 / `P4-01`、`P4-12`。
- **问题 → 目标：** LLM retry 文档指出多个有限 budget 可叠加，always 可重试永久失败，waterfall 排序也可能挂起；工具/workflow/remote provider 还有各自重试。 → 只对可重试失败重试，防止永久错误、重复副作用和多个 retry layer 相乘。
- **Files：** target `packages/llm/llm/src/adapter-failure.ts` [B]；`packages/llm/llm/src/retry-policy.ts` [B]；`packages/llm/llm-retry/src/index.ts` [B]；`packages/llm/llm-retry/src/history.ts` [B]；`packages/core/agent-loop/src/agent.ts` [B]；new `packages/reliability/retry/src/index.ts` [N]；`packages/reliability/retry/src/classify.ts` [N]；`packages/reliability/retry/src/budget.ts` [N]；`packages/reliability/retry/src/circuit.ts` [N]；`packages/reliability/retry/tests/retry.spec.ts` [N]。
- **MUST：** 统一错误 taxonomy 与 retryability；所有层消费同一 RunRetryBudget。；支持 exponential backoff+jitter、Retry-After、provider circuit breaker、hedge exclusion。；有副作用动作只有在 idempotency/reconciliation 保证下可重试。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 永久 4xx、policy deny、invalid input 不重试。；多个插件不能使总重试超过 Run budget。；provider 故障时 circuit 打开且可恢复。
- **Validation：** 运行 error matrix 与 virtual clock tests。；注入重复 retry listeners，验证预算单一。；测试 partial streaming 和 ambiguous completion。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P4-12 — 外部副作用 Idempotency Ledger

- **Priority / Wave / 依赖：** P0 / W7 / `P2-03`、`P4-06`、`P4-07`。
- **问题 → 目标：** Tool result 日志不能证明外部系统是否已提交；在请求发送后、结果持久化前崩溃会产生不确定状态。 → 保证邮件、数据库、CRM、部署、支付模拟等外部写在崩溃重试中不会重复。
- **Files：** target `packages/core/agent-loop/src/tool-calls.ts` [B]；`packages/core/tools/src/types.ts` [B]；`packages/session/session-persistence/src/write-behind.ts` [B]；`packages/action/action-manifest/src/types.ts` [P]；new `packages/action/action-ledger/src/index.ts` [N]；`packages/action/action-ledger/src/types.ts` [N]；`packages/action/action-ledger/src/store.ts` [N]；`packages/action/action-ledger/tests/idempotency.e2e.ts` [N]。
- **MUST：** ActionManifest 强制 idempotencyKey；ledger 状态 prepared/sent/confirmed/ambiguous/compensated。；provider 若支持原生 key 则透传；不支持时使用目标状态查询/本地 fencing。；执行前 CAS reserve，完成后记录外部 receipt digest。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 10,000 次随机 crash campaign 中 duplicate external effect 为 0。；ambiguous 状态不盲目重试，进入 reconciliation。；同 key 不同参数被拒绝。
- **Validation：** 使用可观测 fake external service 在每个网络边界注入 crash。；测试 provider timeout 但服务已提交。；对 batch action 验证逐项 ledger。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S03、S05、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P4-13 — Reconciliation Engine 与 Saga Compensation

- **Priority / Wave / 依赖：** P0 / W13 / `P4-12`、`P7-02`。
- **问题 → 目标：** Git rollback 只能处理代码；真实外部系统可能部分完成、不可撤销或需要反向操作。 → 在外部状态不确定或部分成功时查询事实、修复差异、回滚或请求人工接管。
- **Files：** target `packages/action/action-ledger/src/types.ts` [P]；`packages/run/run/src/state-machine.ts` [P]；`packages/core/tools/src/types.ts` [B]；new `packages/action/reconciliation/src/index.ts` [N]；`packages/action/reconciliation/src/types.ts` [N]；`packages/action/reconciliation/src/engine.ts` [N]；`packages/action/compensation/src/index.ts` [N]；`packages/action/reconciliation/tests/saga.e2e.ts` [N]。
- **MUST：** Tool/provider 可声明 observeState、compareExpected、compensate；Harness 编排而非垂直硬编码。；部分成功生成 StateDiff 和 repair options。；不可逆 action 标记 manual intervention，不伪造 rollback。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 对半成功 batch 能准确识别已完成项。；补偿本身也生成 ActionManifest、policy/approval、ledger 和 evidence。；重启后 reconciliation 可继续且幂等。
- **Validation：** 运行 multi-step saga with failure at each step。；测试 compensation 失败和二次补偿。；验证外部真实状态而非 Agent 自报。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S03、S05、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P4-14 — Partial-Turn Resume、Durable Schedule/Goal Trigger

- **Priority / Wave / 依赖：** P1 / W14 / `P4-08`、`P4-12`、`P4-13`。
- **问题 → 目标：** Session persistence 能修复损坏尾部，但不能恢复半完成 turn；Schedule/Goal 若依赖活进程也不足以支持长期个人/企业任务。 → 从“修复日志尾部并关闭 turn”升级为可安全恢复未完成工作，并支持跨时触发。
- **Files：** target `packages/core/session/src/repair.ts` [B]；`packages/core/session/src/preparation.ts` [B]；`packages/session/session-persistence/src/preparations.ts` [B]；`packages/core/agent-loop/src/agent.ts` [B]；`packages/schedule/README.md` [B]；`packages/goal/README.md` [B]；new `packages/run/turn-checkpoint/src/index.ts` [N]；`packages/run/turn-checkpoint/src/types.ts` [N]；`packages/run/trigger-service/src/index.ts` [N]；`packages/run/trigger-service/tests/resume.e2e.ts` [N]。
- **MUST：** 在模型请求、tool call、tool result、assistant commit 后写 checkpoint boundary。；恢复时根据 ActionLedger/WorkflowJournal 判定继续、重放纯步骤或 reconciliation。；Schedule/Goal 触发写 durable trigger event，由 scheduler claim。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 任意边界崩溃后不丢 user input、不重复副作用。；错过的 schedule 按 catch-up policy 明确处理。；时区/DST/clock jump 不产生重复触发。
- **Validation：** 故障注入覆盖 turn 全路径。；虚拟时钟测试 DST、跨时区、进程停机。；对旧 synthetic-close session fixture 保持可读。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E4；场景 S04、S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。


## Phase 5 — Router、多模型、Subagent 与协作原语

将不同模型和外部 Agent 作为受控执行单元，而不是只返回最终文本。

### P5-01 — Strategy Router：Direct / ReAct / Plan / Workflow / Multi-Agent

- **Priority / Wave / 依赖：** P1 / W9 / `P4-02`、`P4-03`、`P0-05`。
- **问题 → 目标：** 现有 Agent Loop、Subagent、Workflow 都是能力，但缺统一的策略选择合同；若由 prompt 临时决定，难以审计和评测。 → 根据任务复杂度、风险、可验证性和成本选择最小充分执行结构，而不是所有任务都创建团队或 workflow。
- **Files：** target `packages/core/agent/src/dispatch.ts` [B]；`packages/core/agent/src/model-selection.ts` [B]；`packages/core/agent-loop/src/agent.ts` [B]；`packages/workflow/workflow/src/types.ts` [B]；`packages/run/task-profile/src/types.ts` [P]；new `packages/router/strategy-router/src/index.ts` [N]；`packages/router/strategy-router/src/types.ts` [N]；`packages/router/strategy-router/src/rules.ts` [N]；`packages/router/strategy-router/tests/router.spec.ts` [N]。
- **MUST：** 输入 TaskProfile、available capabilities、policy、budget、historical outcomes；输出 StrategyDecision 和可解释依据。；策略包括 answer-only、single-agent-react、plan-execute、durable-workflow、multi-agent；不包含垂直角色。；Router 只提出结构，不能授予权限或绕过 VerificationContract。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 简单只读任务不创建不必要子 Agent。；长时/高风险/多交付物任务不会落到无恢复 single turn。；decision 被持久化并可重放。
- **Validation：** 建立 100 个通用 task profile fixtures。；测试预算/风险变化导致的边界决策。；运行 shadow mode 与人工 gold labels 比较。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S09；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P5-02 — Model Router：成功率、成本、延迟、隐私和工具能力联合选择

- **Priority / Wave / 依赖：** P1 / W10 / `P5-01`、`P2-05`。
- **问题 → 目标：** 当前 model-selection 能选择模型，但缺统一 outcome-driven routing、privacy/world constraints、模型能力注册和 regret 评估。 → 让 Harness 能在 DeepSeek、Codex、Claude、本地模型和其他 provider 之间做可审计分配。
- **Files：** target `packages/core/agent/src/model-selection.ts` [B]；`packages/core/agent/src/types.ts` [B]；`packages/llm/llm/src/index.ts` [B]；`packages/llm/llm/src/call-config.ts` [B]；`packages/run/run-plan/src/types.ts` [P]；new `packages/router/model-router/src/index.ts` [N]；`packages/router/model-router/src/types.ts` [N]；`packages/router/model-router/src/score.ts` [N]；`packages/router/model-router/tests/router.spec.ts` [N]。
- **MUST：** ProviderModelCapability 描述 context、tool calling、structured output、vision、streaming、data residency、price、latency。；Router 输出 primary/fallback/hedge 与置信度，受 policy/budget 硬约束。；先支持规则/统计 provider，再允许学习模型作为可替换 provider。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 敏感任务不会路由到不允许的数据区域。；预算和所需工具能力不满足的模型不会被选。；决策和实际 outcome 可用于离线 regret 计算。
- **Validation：** 使用 fake provider matrix 做 exhaustive tests。；注入价格/延迟/不可用变化。；real-model lane 按任务族比较成功率与成本。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S09；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P5-03 — 模型能力协商与 Provider-Specific Prompt Compiler

- **Priority / Wave / 依赖：** P1 / W11 / `P5-02`、`P0-06`。
- **问题 → 目标：** 不同 provider 对 system prompt、reasoning、tool schema、structured output 和 token accounting 的能力不同；直接复用同一 prompt 会造成隐性退化。 → 在保持上层 RunPlan 语义一致的同时，适配不同模型的工具、推理、内容块和上下文限制。
- **Files：** target `packages/llm/llm/src/content.ts` [B]；`packages/llm/llm/src/message.ts` [B]；`packages/llm/llm/src/assembler.ts` [B]；`packages/llm/llm/src/call-config.ts` [B]；`packages/core/session/src/request-header.ts` [B]；new `packages/llm/prompt-compiler/src/index.ts` [N]；`packages/llm/prompt-compiler/src/types.ts` [N]；`packages/llm/prompt-compiler/src/compile.ts` [N]；`packages/llm/prompt-compiler/tests/golden.spec.ts` [N]。
- **MUST：** 定义 provider-neutral PromptIR，包含 instructions、context slices、tool surface、output contract、policy notices。；Adapter compiler 只做语义保持转换；不擅自删除安全/验收约束。；编译结果与 capability negotiation 写入 EpochHeader，确保可重建。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 同一 PromptIR 在不同 provider 上保留所有 required clauses。；不支持能力时在规划阶段报错或显式降级，不静默忽略。；token estimate 与实际误差进入 telemetry。
- **Validation：** 为 DeepSeek/OpenAI/Anthropic-compatible adapters 建 golden snapshots。；使用 clause-preservation tests。；replay 旧 request header 验证可重建。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S09；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 token estimate 与实际误差没有验收阈值。

### P5-04 — Provider Fallback、Hedging、Rate Limit 与一致预算

- **Priority / Wave / 依赖：** P1 / W11 / `P4-11`、`P5-02`、`P4-12`。
- **问题 → 目标：** 单纯重试同一 provider 不能处理区域故障；并行 hedge 若不隔离 tool execution 则会重复副作用。 → 在 provider 故障和限流时提高可用性，同时避免双重答案、重复工具动作和成本失控。
- **Files：** target `packages/llm/llm/src/adapter-failure.ts` [B]；`packages/llm/llm/src/retry-policy.ts` [B]；`packages/llm/llm-retry/src/index.ts` [B]；`packages/core/agent-loop/src/agent.ts` [B]；new `packages/router/provider-resilience/src/index.ts` [N]；`packages/router/provider-resilience/src/hedge.ts` [N]；`packages/router/provider-resilience/src/rate-limit.ts` [N]；`packages/router/provider-resilience/tests/fallback.e2e.ts` [N]。
- **MUST：** 只在 pre-action reasoning 阶段允许安全 hedge；产生 tool call 后使用单一 winner/fencing。；支持 provider health、rate-limit bucket、regional failover、budget reservation。；fallback 记录原因，不把不同 provider 输出偷偷拼接。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** primary timeout 时 fallback 完成且只执行一组工具动作。；成本不超过 RunPlan 预算。；rate limit 不造成 thundering herd。
- **Validation：** 模拟 partial stream、late winner、双响应、429/5xx。；检查 action ledger 无重复。；并发 100 run 的 rate-limit simulation。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S09；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P5-05 — 扩展 Structured SubagentRequest Contract

- **Priority / Wave / 依赖：** P0 / W9 / `P2-02`、`P4-03`。
- **问题 → 目标：** 当前外部 provider 主要收到任务文本和工作目录；父上下文、persona、tool filter、深度、验证和 capability delegation 不完整。 → 让内部和外部子 Agent 接收一致的目标、上下文、权限、预算、世界和输出合同。
- **Files：** target `packages/subagent/subagent/src/descriptor.ts` [B]；`packages/subagent/subagent/src/descriptor-seed.ts` [B]；`packages/subagent/subagent/src/depth.ts` [B]；`packages/subagent/subagent/src/runtime-types.ts` [B]；`packages/subagent/subagent/src/client.ts` [B]；new `packages/subagent/subagent/src/request.ts` [N]；`packages/subagent/subagent/tests/request-contract.spec.ts` [N]。
- **MUST：** Request 包含 objective、deliverables、context refs、artifact refs、capability token、WorldSpec、budget、output schema、verification obligations、parent trace。；传引用而非复制全部父上下文；provider 决定如何 materialize。；所有字段进入 session/run event，敏感值仅用引用。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 内部、Codex、Claude、ACP provider 都通过同一 conformance tests。；子 Agent 无法看到未授权 context/tool/secret。；缺少 required capability 时 spawn 前失败。
- **Validation：** 运行 provider contract tests。；测试 context isolation 和 token attenuation。；SDK serialization round-trip。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S09；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P5-06 — 扩展 Structured SubagentResult 与完整证据回传

- **Priority / Wave / 依赖：** P0 / W11 / `P5-05`、`P6-09`。
- **问题 → 目标：** 当前外部 Agent 适配容易退化为最终文本 RPC，父级无法验证中间行为和真实结果。 → 让父 Agent/Verifier 接收 artifact、diff、trace、cost、evidence、checkpoint，而不是只相信最终文本。
- **Files：** target `packages/subagent/subagent/src/assistant-output.ts` [B]；`packages/subagent/subagent/src/types.ts` [B]；`packages/subagent/subagent/src/lifecycle.ts` [B]；`packages/workflow/workflow/src/types.ts` [B]；new `packages/subagent/subagent/src/result.ts` [N]；`packages/subagent/subagent/tests/result-contract.spec.ts` [N]。
- **MUST：** Result 包含 status、summary、structured output、artifacts、state diffs、action receipts、tool trace refs、usage/cost、verification hints、continuation token。；大结果存 Artifact Store，只在 Result 放内容寻址引用。；失败保留 partial artifacts 和明确 failure class。；先以通用 ArtifactRef/ActivityRef 回传原始证据入口；P7-02 再统一升级为 EvidenceRef。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 父级能独立验证 artifact，不依赖 summary。；所有 provider 字段缺失有明确 capability flag。；Result 与 child session/run id 一一对应。
- **Validation：** 用伪造 summary/错误 artifact fixture 验证父级不盲信。；测试大输出、partial failure、cancel。；检查 usage/cost 总和与 provider records 对账。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S09；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 6 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 依赖 P6-09，但其新建 result.ts 又被 P6-09 当 prior_output，形成文件合同循环。

### P5-07 — Codex Adapter：结构化流、继续执行、审批与证据映射

- **Priority / Wave / 依赖：** P1 / W12 / `P5-05`、`P5-06`、`P8-04`。
- **问题 → 目标：** 现有 `run.ts`/`wire.ts` 已有 app-server 集成基础，但需完整映射 thread/turn/item、approval、diff、tests、usage 和 continuation。 → 把 Codex 从一次性文本子进程提升为可治理的外部 Agent Provider。
- **Files：** target `packages/subagent/subagent-codex/src/index.ts` [B]；`packages/subagent/subagent-codex/src/run.ts` [B]；`packages/subagent/subagent-codex/src/wire.ts` [B]；`packages/subagent/subagent/src/request.ts` [P]；`packages/subagent/subagent/src/result.ts` [P]；new `packages/subagent/subagent-codex/src/map-events.ts` [N]；`packages/subagent/subagent-codex/src/continuation.ts` [N]；`packages/subagent/subagent-codex/tests/structured.e2e.ts` [N]。
- **MUST：** tool/approval 请求回到父 Policy。；支持 resume/fork，并保存 provider continuation identity。；收集 diff、test output、usage、artifacts，不只最终 answer。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 父取消在有界时间内中断 Codex。；Codex 不能自行扩大 sandbox/approval。；重连后不重复 turn。
- **Validation：** 用官方 app-server fixture 或可控协议 server 做 wire tests。；真实 Codex E2E 作为可选 lane。；测试 malformed/unknown item 类型。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S09、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 父取消的“有界时间”无数值；真实 Codex lane 的版本/样本/支持门未定义。

### P5-08 — Claude Code Adapter：结构化流、会话恢复、工具与 Artifact 映射

- **Priority / Wave / 依赖：** P1 / W12 / `P5-05`、`P5-06`、`P8-04`。
- **问题 → 目标：** 现有 `process.ts`/`run.ts` 具备进程封装，但通用 Harness 需要完整进度、tool、usage、checkpoint、worktree 和 continuation 语义。 → 让 Claude Code 作为受同一 RunPlan/Policy/Verification 管理的 provider。
- **Files：** target `packages/subagent/subagent-claude-code/src/index.ts` [B]；`packages/subagent/subagent-claude-code/src/process.ts` [B]；`packages/subagent/subagent-claude-code/src/run.ts` [B]；`packages/subagent/subagent/src/request.ts` [P]；`packages/subagent/subagent/src/result.ts` [P]；new `packages/subagent/subagent-claude-code/src/map-events.ts` [N]；`packages/subagent/subagent-claude-code/src/continuation.ts` [N]；`packages/subagent/subagent-claude-code/tests/structured.e2e.ts` [N]。
- **MUST：** 解析结构化输出/事件而非屏幕文本；映射 tools、subagents、diff、tests、usage。；支持 provider session resume/interrupt 和 worktree identity。；所有外部动作仍由父 policy/action ledger 管理。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** provider 崩溃可恢复或明确失败，保留 partial evidence。；工具权限不因 Claude 自有设置绕过父 policy。；结果符合统一 SubagentResult。
- **Validation：** 协议 fixture 覆盖 stream fragmentation、unknown events、process exit。；可选真实 Claude Code E2E。；测试取消/恢复/重复输出。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S09、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 真实 Claude lane 的版本/样本/支持门未定义。

### P5-09 — ACP Provider：远程可继续会话、Trace 枚举与安全身份

- **Priority / Wave / 依赖：** P1 / W18 / `P5-05`、`P8-01`、`P8-05`。
- **问题 → 目标：** 官方已知限制包括 ACP children one-shot、不可 trace-enumerable、缺 host-user continuation。 → 让 ACP 子 Agent 不再是一次性、不可枚举的远程黑盒。
- **Files：** target `packages/subagent/subagent-acp/src/index.ts` [B]；`packages/subagent/subagent-acp/src/run.ts` [B]；`packages/subagent/subagent/src/continuation.ts` [B]；`packages/sdk/protocol/src/types.ts` [B]；new `packages/subagent/subagent-acp/src/session.ts` [N]；`packages/subagent/subagent-acp/src/events.ts` [N]；`packages/subagent/subagent-acp/tests/continuation.e2e.ts` [N]。
- **MUST：** ACP handshake 协商 identity、capabilities、protocol version、resume token、event cursor。；远程 child 事件映射到可枚举 trace，artifact 使用内容寻址。；支持 authenticated continue/cancel/steer。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 断线重连后从 cursor 继续且不丢/重复事件。；远程 child 无法伪造 tenant/parent identity。；父级能列出、查询和取消 ACP child。
- **Validation：** 运行 reconnect/replay/out-of-order tests。；测试 forged continuation token。；与 SDK protocol compatibility matrix 联测。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S09、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 真实 ACP endpoint 的信任根、兼容版本与支持门未定义。

### P5-10 — Continuation、Steer、Human Input 与 Cancellation Convergence 修复

- **Priority / Wave / 依赖：** P0 / W7 / `P4-06`、`P4-07`。
- **问题 → 目标：** 当前 continuation 消息不一定 steer，host-user continuation 不完整，取消 convergence 有已知 wake gap。 → 确保用户和父 Agent 能可靠改变方向，并消除取消收敛期间的 wake gap。
- **Files：** target `packages/subagent/subagent/src/continuation.ts` [B]；`packages/subagent/subagent/src/lifecycle.ts` [B]；`packages/subagent/subagent/src/child-agent.ts` [B]；`packages/subagent/subagent/src/client.ts` [B]；`packages/core/agent/src/inbox.ts` [B]；`packages/subagent/subagent/src/control.ts` [B]；new `packages/subagent/subagent/tests/control-race.e2e.ts` [N]。
- **MUST：** 区分 continue、steer、inject、cancel、human-answer；每类定义优先级和状态前置条件。；所有 control message durable、带 epoch、幂等。；取消进入 convergence barrier，确认 child/world/actions 停止后才终态。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 在取消同时发送 steer/continue 不会唤醒已取消 child。；human answer 只送到指定等待点。；重复 control message 不产生重复 turn。
- **Validation：** 运行 race scheduler 10,000 seeds。；覆盖 cancellation wake gap 回归。；测试 parent crash during convergence。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08、S14、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 cancellation convergence 的时间/重试上限未定义。

### P5-11 — 通用 Taskboard、Mailbox 与 Blackboard 原语

- **Priority / Wave / 依赖：** P1 / W7 / `P4-06`、`P4-07`。
- **问题 → 目标：** dsh-agent-teams 展示 durable tasks、依赖、消息、调度价值，但其状态单进程序列化且模型可能不更新任务状态；这些需要核心原子语义。 → 把社区多 Agent 插件中有价值的通用协作能力上移为 Harness primitives，而不内置 captain/部门等垂直角色。
- **Files：** target `packages/core/agent/src/consumed-work.ts` [B]；`packages/core/agent/src/inbox.ts` [B]；`packages/subagent/subagent/src/list-children.ts` [B]；`packages/run/run/src/types.ts` [P]；new `packages/collaboration/taskboard/src/index.ts` [N]；`packages/collaboration/taskboard/src/types.ts` [N]；`packages/collaboration/taskboard/src/store.ts` [N]；`packages/collaboration/mailbox/src/index.ts` [N]；`packages/collaboration/blackboard/src/index.ts` [N]；`packages/collaboration/taskboard/tests/claims.e2e.ts` [N]。
- **MUST：** Task 支持 attempt、lease、owner、artifact outputs、verification status。；Blackboard 只存结构化 facts/artifact refs，带 provenance。；角色、组织图和 captain 保持插件/skill 层。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 多进程并发 claim 只有一个 winner。；模型未手动更新任务时，runtime 根据 receipts 推进状态。；循环依赖在提交时拒绝。
- **Validation：** 运行 100 worker claim stress。；测试消息去重、blackboard provenance、dependency release。；对社区插件做 adapter proof-of-concept，不复制其垂直 UI。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P5-12 — 多 Agent 协调安全、Worktree 隔离与 Router Regret 评测

- **Priority / Wave / 依赖：** P1 / W10 / `P5-01`、`P5-11`、`P4-10`。
- **问题 → 目标：** 多 Agent 并不自动提高结果；没有隔离和评测会增加 token、冲突与虚假进度。 → 限制 agent explosion、死锁、写冲突和协调开销，并量化多 Agent 是否真的优于单 Agent。
- **Files：** target `packages/workflow/workflow-worker-thread/src/runtime.ts` [B]；`packages/subagent/subagent/src/depth.ts` [B]；`packages/workspace/workspace/src/entity.ts` [B]；`packages/router/strategy-router/src/index.ts` [P]；new `packages/workspace/worktree-provider/src/index.ts` [N]；`packages/workspace/worktree-provider/src/merge.ts` [N]；`packages/collaboration/coordination-guard/src/index.ts` [N]；`packages/evaluation/router-regret/src/index.ts` [N]；`packages/collaboration/coordination-guard/tests/deadlock.e2e.ts` [N]。
- **MUST：** 每个写代码/文件的 child 获得隔离 workspace/worktree；merge 由显式 queue 与 verifier 控制。；检测等待图循环、消息风暴、重复任务、无进展循环和 agent budget。；shadow 比较单/多 Agent 的成功率、成本、延迟，计算 regret。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 并发修改同一文件不会直接覆盖。；死锁在阈值内被发现并产生可行动诊断。；Router 不因任务看似复杂就默认多 Agent；需证据支持。
- **Validation：** 运行冲突 merge corpus 和 wait-for graph tests。；50-agent scale test。；在 benchmark 中做 paired single-vs-multi runs。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E5；场景 S08；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 死锁检测“阈值”与 router regret 接受界限未定义。


## Phase 6 — Context、Memory、Session Data 与 Artifact

建立带来源、权限、预算、生命周期和隐私语义的数据平面。

### P6-01 — 原生 Memory Service Definition（Provider-Neutral）

- **Priority / Wave / 依赖：** P1 / W4 / `P0-03`、`P2-01`。
- **问题 → 目标：** 生态已有大量 memory 插件，证明需求强，但缺统一 schema、provenance、scope、forget、eval 和权限合同。 → 让长期记忆成为可治理的 Harness 能力，而不是散落在多个 MCP/社区插件中的不兼容实现。
- **Files：** target `packages/context/README.md` [B]；`packages/session-query/session-query/src/types.ts` [B]；`packages/core/agent-loop/src/runtime-context.ts` [B]；`packages/bundle/base/cordis.patch.yml` [B]；new `packages/memory/memory/src/index.ts` [N]；`packages/memory/memory/src/types.ts` [N]；`packages/memory/memory/src/invariant.ts` [N]；`packages/memory/memory/tests/conformance.spec.ts` [N]；`docs/subsystems/memory.md` [N]。
- **MUST：** 定义 propose/query/get/revise/forget/export 接口和事件，不指定向量库/图数据库。；Memory provider 可替换；consumer 通过 Service Definition，不 direct import。；所有读取受 principal、purpose、scope 和 context budget。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 至少 local reference provider 和 fake provider 通过 conformance。；不存在模型直接写入 durable memory 的旁路。；Memory 不等于 Session Query，二者边界文档明确。
- **Validation：** 运行 provider load/unload/replacement tests。；测试跨 tenant/scope 读取。；验证 model-visible memory 全部有 logged projection event。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S02、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P6-02 — MemoryRecord：来源、置信度、TTL、范围、用途与冲突

- **Priority / Wave / 依赖：** P0 / W5 / `P6-01`、`P0-06`。
- **问题 → 目标：** 仅保存文本/embedding 无法判断谁说的、何时成立、适用于谁、是否已被反驳。 → 防止错误、过期或越权记忆长期污染所有 Agent。
- **Files：** target `packages/memory/memory/src/types.ts` [P]；`packages/core/session/src/types.ts` [B]；`packages/identity/principal/src/types.ts` [P]；new `packages/memory/memory/src/record.ts` [N]；`packages/memory/memory/src/provenance.ts` [N]；`packages/memory/memory/tests/record.spec.ts` [N]。
- **MUST：** MemoryRecord 含 content artifact/ref、kind、subject、source events、created/valid time、confidence、scope、purpose、TTL、sensitivity、status。；冲突不覆盖旧记录，而是建立 supersedes/disputes relation。；敏感字段不进入 embedding/索引除非 policy 允许。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 每条记忆可追溯至少一个来源或明确标记 user-asserted。；过期/撤销记录不进入默认检索。；跨 scope 合并必须显式。
- **Validation：** 测试时间有效性、冲突链、source deletion。；fuzz record validation。；查询结果必须返回 provenance。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S02、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 6 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P6-03 — Memory Proposal、验证、合并、遗忘与导出

- **Priority / Wave / 依赖：** P1 / W7 / `P6-02`、`P2-05`。
- **问题 → 目标：** 自动记忆若无 proposal/verification 会把模型幻觉、一次性状态和敏感信息固化。 → 把“系统学到了什么”变成可审查、可撤销、可评测的变更，而不是隐式自动写入。
- **Files：** target `packages/memory/memory/src/index.ts` [P]；`packages/memory/memory/src/record.ts` [P]；`packages/interaction/human-channel/src/types.ts` [P]；new `packages/memory/memory-policy/src/index.ts` [N]；`packages/memory/memory-policy/src/proposal.ts` [N]；`packages/memory/memory-policy/src/conflict.ts` [N]；`packages/memory/memory-policy/tests/lifecycle.e2e.ts` [N]。
- **MUST：** Agent 只能提交 MemoryProposal，包含证据、预期用途、TTL、敏感等级。；Policy 决定 auto-accept/review/reject；高敏感默认人工。；支持 merge、supersede、forget、export、right-to-erasure，并传播到索引。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 伪造无证据 proposal 不进入 active memory。；forget 后主存、索引、cache、projection 在 SLA 内清除并留下合规 tombstone。；导出包含来源和冲突状态。
- **Validation：** 运行 hallucinated-memory corpus。；测试 erase propagation 与 backup policy。；在线 memory precision/utility 指标进入 eval。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S02、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 7 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 同 Wave 7 引用 P2-12 新建 human-channel/types.ts；且 erase SLA 无数值。

### P6-04 — Context Graph 与 Retrieval Planner

- **Priority / Wave / 依赖：** P1 / W11 / `P6-01`、`P6-09`。
- **问题 → 目标：** 现有 context 扩展和 session FTS 很有用，但缺统一 ContextTopology、跨源检索计划和信息价值评估。 → 在 Session、Memory、文件、代码图、Artifacts、关系和当前状态之间做有预算、有来源的检索规划。
- **Files：** target `packages/context/agent-instructions/src/index.ts` [B]；`packages/context/agent-instructions/src/render.ts` [B]；`packages/session-query/session-query/src/index.ts` [B]；`packages/session-query/session-query/src/tracing.ts` [B]；`packages/core/agent-loop/src/runtime-context.ts` [B]；new `packages/context/context-graph/src/index.ts` [N]；`packages/context/context-graph/src/types.ts` [N]；`packages/context/retrieval-planner/src/index.ts` [N]；`packages/context/retrieval-planner/src/budget.ts` [N]；`packages/context/retrieval-planner/tests/planner.spec.ts` [N]。
- **MUST：** ContextNode/Edge 引用原始 source，不复制真值；provider 可贡献 code/artifact/domain graph。；RetrievalPlan 指定 sources、queries、filters、token/time budget、rerank、stop conditions。；检索结果带 trace、score、policy decision 和被舍弃原因。；把来自 web、MCP、附件、仓库和外部工具的内容标记为 untrusted-data；不得把其中的指令提升为 system/developer policy。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 预算耗尽时确定性停止，不无限搜索。；敏感源在计划阶段被 policy 过滤。；同一 source 不因多个插件重复注入。；Prompt-injection canary 不能改变 Tool allowlist、Policy、Approval 或 RunPlan；只能作为待分析数据。
- **Validation：** 构造多源冲突/重复/超预算 fixtures。；测 precision/recall 与 token cost。；验证 session-query trace 与 context projection 对齐。；运行 indirect prompt injection、retrieval poisoning、malicious README/MCP resource fixtures。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S02、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P6-05 — Per-Agent Context Topology 与稳定 Context Telemetry Contract

- **Priority / Wave / 依赖：** P1 / W12 / `P4-03`、`P6-04`、`P2-02`。
- **问题 → 目标：** 社区 context 插件展示了可见性价值；但核心需要稳定、只读、带来源的 projection contract，而不是把内部 Context 暴露给 UI/插件。 → 让每个 Agent 只得到完成任务所需的上下文，并支持类似 dsh-context 的可视化而不暴露内部可变对象。
- **Files：** target `packages/core/agent-loop/src/runtime-context.ts` [B]；`packages/context/agent-instructions/src/state.ts` [B]；`packages/context/agent-instructions/src/render.ts` [B]；`packages/host/apiproxy/README.md` [B]；new `packages/context/context-topology/src/index.ts` [N]；`packages/context/context-topology/src/types.ts` [N]；`packages/context/context-telemetry/src/index.ts` [N]；`packages/context/context-telemetry/tests/isolation.spec.ts` [N]。
- **MUST：** RunPlan 为每个 Agent 声明 shared/private/retrievable context zones。；Telemetry 只发布 source ids、token counts、selection reasons、redacted previews。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 两个 child 的 private context 互不可见。；UI 插件卸载不影响实际 context assembly。；敏感内容不会通过 telemetry 泄漏。
- **Validation：** 运行 cross-agent leak tests。；对 context composition 做 golden snapshots。；使用 dsh-context 类插件作为 consumer 兼容验证。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S02、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P6-06 — Compaction 保真度、来源证明与 Tool Pairing 强化

- **Priority / Wave / 依赖：** P0 / W11 / `P4-01`、`P7-01`。
- **问题 → 目标：** 现有 compaction 架构方向正确并有 tool pairing，但通用长任务需要机器可验证的 summary coverage 与 provenance。 → 在缩短上下文时不丢失约束、未完成动作、审批、证据引用或 tool call/result 配对。
- **Files：** target `packages/compaction/compaction/src/index.ts` [B]；`packages/compaction/compaction/src/checkpoint.ts` [B]；`packages/compaction/compaction/src/tool-pairing.ts` [B]；`packages/compaction/compaction/src/types.ts` [B]；`packages/core/session/src/surface.ts` [B]；new `packages/compaction/compaction/src/coverage.ts` [N]；`packages/compaction/compaction/src/provenance.ts` [N]；`packages/compaction/compaction/tests/fidelity.e2e.ts` [N]。
- **MUST：** CompactionResult 标记覆盖 event ranges、preserved constraints、open actions、artifact/evidence refs、dropped categories。；对 hard constraints 和 unresolved items 使用结构化保留区，不只自然语言摘要。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** compaction 前后 VerificationContract、未完成 action、审批状态等价。；摘要中的每个关键 claim 可回链原事件。；多轮 compaction 不累计丢失关键事实。
- **Validation：** 使用长 session adversarial corpus。；连续 compaction 20 次比较 invariants。；随机 tool pairing event streams property test。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S02、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 8 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P6-07 — Session 生命周期：分页、过滤、删除、保留与 Partial Data Repair

- **Priority / Wave / 依赖：** P1 / W4 / `P2-01`、`P0-06`。
- **问题 → 目标：** 官方 persistence 已知 list 未分页/过滤、缺删除/retention；仅修复 crash tail 不等于完整生命周期。 → 让大量长期 Session 可管理，并满足隐私、存储和企业保留要求。
- **Files：** target `packages/session/session-persistence/src/index.ts` [B]；`packages/session/session-persistence/src/coordinator.ts` [B]；`packages/session/session-persistence/src/revision.ts` [B]；`packages/session-query/session-query/src/cursor.ts` [B]；`packages/session-query/session-query/src/filters.ts` [B]；`packages/core/session/src/repair.ts` [B]；new `packages/session/session-lifecycle/src/index.ts` [N]；`packages/session/session-lifecycle/src/retention.ts` [N]；`packages/session/session-lifecycle/src/delete.ts` [N]；`packages/session/session-lifecycle/tests/lifecycle.e2e.ts` [N]。
- **MUST：** 列表支持 tenant/workspace/status/time filters。；soft delete、legal hold、hard erase、archive 分离；删除传播到 query/attachments/memory/artifacts 按 policy。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 百万 session fixture 分页稳定且无遗漏/重复。；legal hold 阻止 hard erase；授权 erase 完整传播。；损坏日志读取返回最小可恢复范围和证据。
- **Validation：** 运行 pagination property tests。；测试 delete/retention across indexes。；corruption fuzz 与 recovery report。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S02、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P6-08 — 静态加密、租户密钥、Tamper-Evident Audit 与 Data Residency

- **Priority / Wave / 依赖：** P0 / W9 / `P0-02`、`P2-01`、`P3-06`。
- **问题 → 目标：** 现有 JSON/SQLite/附件本地存储提供持久化，但通用企业用途需要 envelope encryption、tenant isolation、hash chain 和区域策略。 → 保护本地/企业持久数据，检测日志篡改，并控制数据所在区域。
- **Files：** target `packages/storage/storage/src/backend.ts` [B]；`packages/storage/storage/src/index.ts` [B]；`packages/attachment/attachment/src/index.ts` [B]；`packages/session/session-persistence/src/write-behind.ts` [B]；`packages/workspace/workspace/src/entity.ts` [B]；new `packages/storage/storage-encryption/src/index.ts` [N]；`packages/storage/storage-encryption/src/keyring.ts` [N]；`packages/audit/audit-ledger/src/index.ts` [N]；`packages/audit/audit-ledger/src/hash-chain.ts` [N]；`packages/data/data-residency/src/index.ts` [N]；`packages/audit/audit-ledger/tests/tamper.e2e.ts` [N]。
- **MUST：** 每租户 envelope key；key 由 KMS/keychain provider 管理，不存同一明文文件。；关键 Run/Policy/Action/Approval/Verification 事件进入 append-only hash chain，定期签 anchor。；Storage/Model/World route 受 residency policy。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 磁盘拷贝无法直接读取明文。；删除/修改/重排 audit record 100% 被检测。；禁止区域外 provider 时没有数据出境。
- **Validation：** 运行 key rotation、lost key、cross-tenant ciphertext tests。；tamper corpus。；residency route integration test。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S02、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 11 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。

### P6-09 — 一等公民 Artifact Store、版本、内容寻址与 Lineage

- **Priority / Wave / 依赖：** P0 / W10 / `P2-01`、`P6-08`。
- **问题 → 目标：** Attachment 主要处理用户/模型二进制；Workflow/Subagent/Verification 还缺通用 artifact 类型、版本和 lineage。 → 统一代码 diff、文档、图片、测试日志、数据集、world snapshot 和子 Agent 输出，不把大对象塞进消息。
- **Files：** target `packages/attachment/attachment/src/index.ts` [B]；`packages/attachment/attachment/src/types.ts` [B]；`packages/storage/storage/src/backend.ts` [B]；`packages/subagent/subagent/src/result.ts` [P]；new `packages/artifact/artifact/src/index.ts` [N]；`packages/artifact/artifact/src/types.ts` [N]；`packages/artifact/artifact/src/lineage.ts` [N]；`packages/artifact/artifact-local/src/index.ts` [N]；`packages/artifact/artifact/tests/lineage.spec.ts` [N]。
- **MUST：** ArtifactRef 包含 digest、media type、schema、size、tenant、producer run/action、parents、retention、sensitivity。；不可变内容寻址；新版本创建新 digest 与 lineage edge。；支持 range/read streaming 和 signed access token。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** 相同字节去重但权限不跨租户泄漏。；所有 OutcomePackage/SubagentResult/Evidence 使用 refs。；lineage 可从最终交付物追溯输入、生成步骤和验证。
- **Validation：** 测试 digest collision handling、cross-tenant dedup、large streaming。；lineage DAG cycle rejection。；删除/retention 与 session lifecycle 联测。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S01、S02、S11；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。 Wave 10 引用 Wave 11 的 P5-06 result.ts；若补依赖会与 P5-06->P6-09 成环。

### P6-10 — Privacy Classification、Redaction、Fork/Snapshot Lineage 与导出/擦除

- **Priority / Wave / 依赖：** P0 / W11 / `P6-08`、`P6-09`、`P3-06`。
- **问题 → 目标：** 如果仅在 UI 做 redaction，数据仍可能进入日志、模型、artifact、telemetry、fork 和 backup；fork 也可能复制超出新用途所需的数据。 → 把敏感数据处理、会话 fork、world snapshot 和导出都纳入统一数据治理。
- **Files：** target `packages/settings/settings/src/redact.ts` [B]；`packages/core/session/src/types.ts` [B]；`packages/attachment/attachment/src/types.ts` [B]；`packages/workspace/workspace/src/types.ts` [B]；`packages/sdk/protocol/src/types.ts` [B]；new `packages/privacy/data-classification/src/index.ts` [N]；`packages/privacy/data-classification/src/types.ts` [N]；`packages/privacy/redaction/src/index.ts` [N]；`packages/privacy/data-lineage/src/index.ts` [N]；`packages/privacy/data-lineage/tests/privacy.e2e.ts` [N]。
- **MUST：** 数据标记 public/internal/confidential/restricted 与 purpose；传播到 events/artifacts/memory/context。；redaction 在边界执行：model request、logs、telemetry、export、plugin RPC。；fork/snapshot 记录 purpose filter，默认不复制 secrets/grants。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** YAML 来源缺失；规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- **Acceptance：** canary PII/secret 不出现在未授权 sink。；导出仅含用户有权数据并保留 provenance。；erase 能遍历 fork/snapshot/index/backup policy 并报告剩余 legal hold。
- **Validation：** 运行 taint propagation tests。；跨 10 个 sink 扫描 canary。；测试 fork privilege inheritance 和 purpose change。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E6；场景 S11、S13；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 YAML non_goals 为空，当前边界来自 Markdown 默认值。 缺项级可执行验证命令。


## Phase 7 — Assurance、Verification、Evaluation 与受控演化

把成功标准、证据、独立验证、修复、评测和演化组成闭环。

### P7-01 — VerificationContract：在执行前冻结可验证成功标准

- **Priority / Wave / 依赖：** P0 / W10 / `P4-03`、`P4-04`、`P0-06`。
- **问题 → 目标：** 当前 WorkflowResult 主要表达脚本结果与停止原因，Agent/Turn 也没有一个跨任务通用、在执行前冻结的验证契约；因此执行者可以在事后降低标准或只返回看似合理的文本。 → 把“Agent 说完成了”改成“系统按预先冻结的成功标准证明完成”。
- **Files：** target `packages/workflow/workflow/src/types.ts` [B]；`packages/core/session/src/types.ts` [B]；`packages/core/tools/src/types.ts` [B]；`packages/attachment/attachment/src/types.ts` [B]；new `packages/assurance/verification-contract/src/index.ts` [N]；`packages/assurance/verification-contract/src/types.ts` [N]；`packages/assurance/verification-contract/src/schema.ts` [N]；`packages/assurance/verification-contract/src/invariant.ts` [N]；`packages/assurance/verification-contract/tests/verification-contract.spec.ts` [N]。
- **MUST：** 定义 VerificationContract、Claim、CheckSpec、EvidenceRequirement、AcceptanceRule、VerifierIndependence 与 confidence policy。；把契约引用写入 RunPlan，并在 RunPlan freeze 后禁止执行 Agent 自行删除 required check、降低阈值或改为 self-attestation。；允许按任务类型组合确定性检查、外部状态检查、人工签署和统计检查，但协议本身保持领域无关。；所有契约、修订和批准写入 canonical Run/Session ledger，并带 schemaVersion 与 hash。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不把某个行业的 KPI 或代码测试框架硬编码进契约。
- **Acceptance：** 任何进入 executing 状态的 Run 都有不可变 VerificationContract；缺失时 fail closed。；执行者不能修改 required checks、evidence requirements 或 acceptance rule；修改必须走 PlanAmendment 和重新审批。；同一契约经 TS/Python 编解码、持久化和重放后 hash 完全一致。；契约可表达文件、API、外部系统、人工批准、统计测试和安全策略等通用检查，不包含垂直业务逻辑。
- **Validation：** 先写 tests/verification-contract.spec.ts 红灯测试：hash 稳定、非法降级、未知 schema、空 required check。；运行 pnpm test --filter dsh-verification-contract、pnpm typecheck、schema compatibility tests。；构造恶意执行 Agent 试图在结束前删除检查，确认 Run 被拒绝且审计事件完整。
- **验证命令：** `pnpm test --filter dsh-verification-contract`；`pnpm typecheck`；随后 G，阶段按适用项跑 R。
- **真实任务证据：** E7；场景 S01、S02、S03、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 最终 spec/verification-contract.schema.json 无文件 owner。

### P7-02 — EvidenceCollector：内容寻址、可追溯、不可伪造的证据层

- **Priority / Wave / 依赖：** P0 / W12 / `P6-09`、`P2-03`、`P5-06`。
- **问题 → 目标：** 现有 tool/result、attachment 与 session event 能保存输出，但没有统一 EvidenceRef、采集策略、来源链、完整性校验和 claim 绑定；子 Agent 的总结也可能丢失原始 diff、测试或外部状态。 → 让每个重要结论和动作结果都有机器可验证的来源，而不是依赖自然语言总结。
- **Files：** target `packages/core/agent-loop/src/tool-calls.ts` [B]；`packages/core/tools/src/types.ts` [B]；`packages/core/session/src/types.ts` [B]；`packages/attachment/attachment/src/index.ts` [B]；`packages/attachment/attachment/src/types.ts` [B]；`packages/subagent/subagent/src/assistant-output.ts` [B]；new `packages/assurance/evidence/src/index.ts` [N]；`packages/assurance/evidence/src/types.ts` [N]；`packages/assurance/evidence/src/collector.ts` [N]；`packages/assurance/evidence/src/store.ts` [N]；`packages/assurance/evidence/src/invariant.ts` [N]；`packages/assurance/evidence/tests/evidence.e2e.ts` [N]。
- **MUST：** 定义 EvidenceRef、EvidenceEnvelope、EvidenceType、producer、actionId、worldId、source URI、timestamp、contentHash、classification、freshness 和 retention。；在 tool completion、subagent result、artifact commit、external observation、test run 和 human approval 边界自动采集；大对象进入内容寻址 Artifact Store，ledger 仅保存不可变引用。；证据原文与模型渲染分离；模型只看经过权限和 token budget 过滤的 projection，但 Verifier 可读取授权原始证据。；为外部 API/浏览器结果保存请求摘要、响应摘要、状态码、ETag/版本和采集环境，避免只保存一段模型转述。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不让 EvidenceCollector 自己判断业务结论是否正确。
- **Acceptance：** 所有 required evidence 都能追溯到具体 producer、ActionManifest、ExecutionWorld 和原始 hash。；修改证据字节、元数据或引用后完整性校验 100% 检出。；同一证据重复采集去重，但不同权限/时间上下文不会被错误合并。；父 Agent 可以拿到结构化证据引用，不再只拿子 Agent 最终文本。
- **Validation：** 写 tamper、dedupe、large artifact、cross-agent provenance、redaction 和 TTL 测试。；运行故障注入：在写入 artifact、ledger、index 的每个边界 kill 进程，确认无悬空“已验证”引用。；使用假外部系统返回版本化状态，核对 EvidenceEnvelope 与真实世界状态一致。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E7；场景 S01、S02、S03、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 12 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P7-03 — Independent Verifier：与执行者隔离的验证 Provider Seam

- **Priority / Wave / 依赖：** P0 / W13 / `P7-01`、`P7-02`、`P2-02`、`P3-01`。
- **问题 → 目标：** 当前可以通过工具或子 Agent做 review，但没有强制的独立 Verifier 身份、只读权限、隔离 ExecutionWorld 和 fail-closed 语义；执行 Agent 可选择性展示证据或直接宣称测试通过。 → 把执行权和验收权分离，防止同一模型既做工作又给自己打分。
- **Files：** target `packages/subagent/subagent/src/index.ts` [B]；`packages/subagent/subagent/src/types.ts` [B]；`packages/sandbox/sandbox/src/index.ts` [B]；`packages/core/agent/src/runtime-types.ts` [B]；`packages/workflow/workflow/src/types.ts` [B]；new `packages/assurance/verifier/src/index.ts` [N]；`packages/assurance/verifier/src/types.ts` [N]；`packages/assurance/verifier/src/provider.ts` [N]；`packages/assurance/verifier/src/coordinator.ts` [N]；`packages/assurance/verifier/src/invariant.ts` [N]；`packages/assurance/verifier/tests/verifier-isolation.e2e.ts` [N]。
- **MUST：** 定义 VerifierProvider、VerificationRequest、VerificationReport、CheckResult 与 explicit abstain/unverified。；默认要求 verifier principal、model route、context projection 和 world 与执行者隔离；Verifier 获得只读 artifact/evidence 权限，不继承写权限和执行者 secrets。；Verifier 必须直接读取 EvidenceRef 和实际外部状态，不接受执行者传入的未签名“测试通过”字符串。；允许确定性 verifier、模型 verifier、人工 verifier 和 quorum provider 组合，但核心 gate 只消费统一报告。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不强制所有低风险、纯文本任务都调用昂贵模型 verifier。
- **Acceptance：** 高风险 Run 不允许 executorId == verifierId，除非策略明确批准并标记 degraded assurance。；Verifier 无法修改 workspace、外部系统、approval 或 evidence；越权尝试被 kernel 拒绝并审计。；恶意执行者伪造测试文本时，独立 verifier 仍能识别失败。；Verifier 超时、崩溃或 abstain 不得被解释为 pass。
- **Validation：** 写 adversarial executor fixture，返回伪造截图/日志，确认 verifier 读取真实状态并拒绝。；测试 capability token 不可继承写权限、secret 访问和 evaluator override。；分别运行 deterministic、model-backed、human-mock 三类 provider contract tests。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E7；场景 S01、S02、S03、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 11 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P7-04 — ClaimGraph：声明—证据—反证—不确定性的通用图

- **Priority / Wave / 依赖：** P1 / W14 / `P7-02`、`P7-03`、`P6-09`。
- **问题 → 目标：** 当前 Session/Tool 输出是时间序列，缺少把 final answer 中的 claim 与证据、反证、来源质量、时效和依赖关系连接起来的结构；模型容易把不确定推断写成事实。 → 让研究、分析、代码审查和外部操作报告都能明确区分已证实、冲突、过期和无法验证的结论。
- **Files：** target `packages/core/session/src/types.ts` [B]；`packages/session-query/session-query/src/types.ts` [B]；`packages/attachment/attachment/src/types.ts` [B]；`packages/feedback/message-feedback/src/index.ts` [B]；new `packages/assurance/claim-graph/src/index.ts` [N]；`packages/assurance/claim-graph/src/types.ts` [N]；`packages/assurance/claim-graph/src/projector.ts` [N]；`packages/assurance/claim-graph/src/consistency.ts` [N]；`packages/assurance/claim-graph/tests/claim-graph.spec.ts` [N]。
- **MUST：** 定义 ClaimNode、EvidenceEdge、ContradictionEdge、DerivedFrom、scope、freshness、confidence、status。；由执行和验证阶段提交 claim proposal；只有 Verifier/Acceptance Gate 能把 required claim 标为 verified。；当证据过期、撤销或冲突时自动使依赖 claim 进入 stale/conflicted，而不是保留旧 pass。；最终 OutcomePackage 渲染器必须显示 unverified/conflicted claim，不得静默删除反证。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不内置新闻可信度、医疗证据等级等垂直评分表；这些由 policy/skill provider 提供。
- **Acceptance：** 每个关键 final claim 可反向遍历到至少一个 EvidenceRef 或显式 `unverified`。；引入相互矛盾证据后，状态确定性变为 conflicted，并传播到派生 claim。；过期规则可按 evidence type 配置且不会修改原始证据。；图重放结果与在线投影一致。
- **Validation：** 构造支持、反对、过期、循环依赖、撤销和部分证据测试。；运行 property-based tests，确保没有无来源的 verified claim。；用研究/代码/外部状态三种通用 fixture 验证同一 Contract 可复用。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E7；场景 S01、S02、S03、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P7-05 — AcceptanceGate 与 OutcomePackage：只有被证明的结果才能完成 Run

- **Priority / Wave / 依赖：** P0 / W15 / `P7-01`、`P7-03`、`P7-04`、`P4-01`。
- **问题 → 目标：** 现有 turn/workflow `completed` 更接近执行过程正常结束，并不等于目标达成；也没有一个完整结果包统一保存 artifact、state diff、actions、policy、verification、cost 和失败。 → 建立统一的结束门，把“执行停止”与“任务验收完成”严格分开。
- **Files：** target `packages/workflow/workflow/src/types.ts` [B]；`packages/core/agent-loop/src/agent.ts` [B]；`packages/core/session/src/known-event-types.ts` [B]；`packages/sdk/protocol/src/types.ts` [B]；`packages/attachment/attachment/src/types.ts` [B]；new `packages/assurance/acceptance-gate/src/index.ts` [N]；`packages/assurance/acceptance-gate/src/types.ts` [N]；`packages/assurance/acceptance-gate/src/evaluate.ts` [N]；`packages/assurance/outcome-package/src/index.ts` [N]；`packages/assurance/outcome-package/src/types.ts` [N]；`packages/assurance/acceptance-gate/tests/gate.e2e.ts` [N]。
- **MUST：** 新增 run 状态 verifying、accepted、rejected、needs-human、compensating；execution completed 只能进入 verifying。；AcceptanceGate 纯函数式消费冻结的 VerificationContract、VerificationReport、ClaimGraph、policy 和 required approvals。；定义 OutcomePackage：finalAnswer、artifacts、stateDiffs、actionTrace、policyDecisions、verificationReport、costs、failures、compensations、memoryProposals。；OutcomePackage 内容寻址并签名；SDK/UI 以它为完成依据，不以最后一条 assistant message 为依据。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不要求所有输出都有自然语言 finalAnswer；机器工作流可只返回 artifacts/stateDiffs。
- **Acceptance：** 缺失 required check/evidence/approval 时 Run 不可能进入 accepted。；执行成功但验证失败时状态为 rejected/repairing，不得返回 completed=true。；OutcomePackage 可以从 ledger 完整重建，签名和 hash 稳定。；外部调用方可以只依赖 OutcomePackage 判断成功，而无需解析自然语言。
- **Validation：** 建立 truth table 覆盖 pass/fail/abstain/timeout/conflict/human-needed/compensation。；在每个 gate 输入写入点故障注入，确认不会产生半签名 accepted package。；SDK contract test 验证旧的 assistant final text 不再等价于 Run success。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E7；场景 S01、S02、S03、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 11 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。 最终 spec/outcome-package.schema.json 无文件 owner。

### P7-06 — Bounded Repair/Replan Loop：验证失败后的有限修复与计划修订

- **Priority / Wave / 依赖：** P0 / W16 / `P4-11`、`P4-12`、`P4-13`、`P7-05`。
- **问题 → 目标：** 当前 LLM retry 主要处理请求失败，Guard 主要处理循环卫生；缺少由 VerificationReport 驱动、受预算和幂等约束的任务级 repair/replan 状态机。 → 让系统能修复真实失败，同时避免无限自循环、重复副作用和偷偷降低验收标准。
- **Files：** target `packages/llm/llm-retry/src/index.ts` [B]；`packages/llm/llm-retry/src/types.ts` [B]；`packages/guard/repeat-tool-reminder/src/index.ts` [B]；`packages/core/agent-loop/src/agent.ts` [B]；`packages/workflow/workflow-worker-thread/src/runtime.ts` [B]；new `packages/assurance/repair/src/index.ts` [N]；`packages/assurance/repair/src/types.ts` [N]；`packages/assurance/repair/src/coordinator.ts` [N]；`packages/assurance/repair/src/policy.ts` [N]；`packages/assurance/repair/tests/repair.e2e.ts` [N]。
- **MUST：** 根据 failed checks 生成最小 RepairPlan，明确可重试 action、不可重复 external effects、预算、最大轮数和 escalation。；修复需要变更 RunPlan 时必须提交 PlanAmendment；不得修改原 VerificationContract 除非重新审批。；支持 alternate model/tool/world、局部重做、回滚后重做、人工接管；保留每轮 evidence 与差异。；使用 Action Ledger/Reconciliation 判断是否需要执行、验证、补偿或只读取现有状态。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不把普通 provider HTTP retry 混入任务级 repair 语义。
- **Acceptance：** repair 次数、token、时间、外部写次数全部有硬上限；达到上限进入 needs-human/rejected。；同一验证失败不会重复不可逆外部动作。；修复后必须重新运行受影响检查；未受影响且仍新鲜的证据可以复用。；执行者不能通过把失败 check 标为 optional 获得通过。
- **Validation：** 测试 transient、deterministic bug、external partial success、irreversible failure、budget exhaustion。；10,000 次 fault-injection 中重复 external side effect 数为 0。；构造恶意模型循环请求，确认硬预算和 emergency stop 生效。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E7；场景 S01、S02、S03、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 10 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P7-07 — Causal Trace、Policy/Evidence/Cost Trace 与 Durable Telemetry Outbox

- **Priority / Wave / 依赖：** P0 / W13 / `P4-06`、`P6-10`、`P7-02`、`P2-05`。
- **问题 → 目标：** 现有 Session Telemetry 明确是 best-effort、handoff cursor 而非 delivered cursor，默认无内置 redaction；它也主要围绕 Session event，缺少 Run/Action/Policy/Approval/World/Verifier 的统一因果图。 → 让一次 Run 的每个决定、动作、权限、证据、成本和结果能跨进程完整追踪且崩溃不丢。
- **Files：** target `packages/session/session-telemetry/src/coordinator.ts` [B]；`packages/session/session-telemetry/src/index.ts` [B]；`packages/core/session/src/types.ts` [B]；`packages/core/agent-loop/src/runtime-context.ts` [B]；`packages/interaction/user-approval/src/types.ts` [B]；new `packages/observability/causal-trace/src/index.ts` [N]；`packages/observability/causal-trace/src/types.ts` [N]；`packages/observability/telemetry-outbox/src/index.ts` [N]；`packages/observability/telemetry-outbox/src/store.ts` [N]；`packages/observability/otel-exporter/src/index.ts` [N]；`packages/observability/causal-trace/tests/crash-delivery.e2e.ts` [N]。
- **MUST：** 定义 trace/span/link vocabulary，覆盖 run/turn/step/tool/action/policy/approval/subagent/world/evidence/verifier/repair。；以 runId、actionId、parentSpanId 和 causationId 连接 Session ledger、Action Ledger、Evidence 和 OutcomePackage。；实现 per-sink durable outbox、ack cursor、at-least-once delivery、receiver dedupe 与 retention；不得阻塞 agent hot path。；默认挂载安全 redaction/classification policy；共享状态必须明确 full/feedback-only/disabled，并记录真实交付状态而非只记录 handoff。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不把 telemetry backend SDK 的内部实现写死在核心 Service Definition。
- **Acceptance：** 任意 OutcomePackage 可遍历到产生它的全部关键 actions、policy decisions、evidence 和 cost。；在 enqueue/flush/ack/shutdown 每个边界 kill 进程后，terminal events 最终送达且无逻辑重复。；未挂载 redaction policy 时共享 collector 默认拒绝启动，而不是裸数据外发。；Trace 不改变 canonical ledger 的事实语义，Telemetry 失败不使工作流状态失真。
- **Validation：** 运行 crash matrix、collector outage、duplicate ack、out-of-order ack、PII canary。；对 1,000-Agent synthetic run 验证 trace cardinality、存储增长和 p95 开销。；使用 OTel test collector 核对 parent/link 因果关系和 cost 汇总。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E7；场景 S01、S02、S03、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 11 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P7-08 — Deterministic Replay、Simulation 与 Decision Diff

- **Priority / Wave / 依赖：** P0 / W14 / `P0-06`、`P4-08`、`P4-12`、`P7-07`。
- **问题 → 目标：** 现有 Session 可重建模型可见历史，但缺少跨 Run、Workflow、Action、Approval、World 和外部 observation 的统一 replay；直接重放模型/工具会产生新随机性或重复真实动作。 → 让 Harness 的状态机、Policy、Router 和恢复逻辑可被离线精确重放，而无需重新触发真实副作用。
- **Files：** target `packages/core/session/src/repair.ts` [B]；`packages/core/session/src/surface.ts` [B]；`packages/session/session-persistence/src/coordinator.ts` [B]；`packages/llm/llm/src/assembler.ts` [B]；`packages/test-support/llm-replay/src/index.ts` [B]；new `packages/evaluation/replay/src/index.ts` [N]；`packages/evaluation/replay/src/types.ts` [N]；`packages/evaluation/replay/src/recorded-world.ts` [N]；`packages/evaluation/replay/src/normalizer.ts` [N]；`packages/evaluation/replay/src/diff.ts` [N]；`packages/evaluation/replay/tests/replay.e2e.ts` [N]。
- **MUST：** 定义 ReplayBundle，包含 schema fingerprints、RunPlan、events、model streams、external observations、policy inputs、clock/random seeds 和 artifacts refs。；回放模式禁止真实网络/写入，ExecutionWorld 由 recorded-world provider 提供确定性观察。；分别比较 normalized projection、policy decisions、action manifests、router choices、verification reports 和 outcome。；支持 shadow replay 新 Router/Policy/Prompt Compiler，产出 DecisionDiff 而不影响生产状态。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不宣称真实模型在重新调用时可位级确定；模型输出需作为已记录输入回放。
- **Acceptance：** 相同 ReplayBundle 重放 100 次，normalized projection、policy decisions 和 OutcomePackage hash 100% 一致。；回放不会产生任何真实外部 side effect，网络与写工具调用数为 0。；schema/adapter 版本不兼容时明确拒绝或经过登记迁移，不静默偏离。；可以准确定位首次 decision divergence 及其输入差异。
- **Validation：** 写 deterministic clock/random/provider/world tests。；用每个可恢复边界的 crash bundle 回放并对比在线最终状态。；对旧版本 fixture 做 forward compatibility 和 migration golden tests。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E7；场景 S03、S07、S14；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 11 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P7-09 — General-Purpose Capability Scenario Suite：用领域夹具验证 Harness，而非内置垂直 Agent

- **Priority / Wave / 依赖：** P0 / W16 / `P0-08`、`P7-05`、`P7-08`。
- **问题 → 目标：** 当前 BENCHMARK.md 只有启动方式，没有覆盖长任务、安全、审批、外部副作用、恢复、多模型、插件攻击、租户隔离和 SDK 重连的系统级验收矩阵。 → 证明底座具备支撑多类用途的通用能力，同时防止为了过测试把销售、金融或医疗逻辑写进核心。
- **Files：** target `BENCHMARK.md` [B]；`package.json` [B]；`docs/testing.md` [B]；`packages/test-support/README.md` [B]；`examples/jsonrpc-agent/README.md` [B]；new `tests/capability/README.md` [N]；`tests/capability/manifest.yaml` [N]；`tests/capability/runner.ts` [N]；`tests/capability/worlds/code-world.ts` [N]；`tests/capability/worlds/research-world.ts` [N]；`tests/capability/worlds/external-write-world.ts` [N]；`tests/capability/worlds/high-risk-world.ts` [N]；`tests/capability/worlds/long-run-world.ts` [N]；`tests/capability/worlds/malicious-plugin-world.ts` [N]；`tests/capability/worlds/multi-tenant-world.ts` [N]；`tests/capability/worlds/sdk-reconnect-world.ts` [N]。
- **MUST：** 建立 15 类通用场景：代码变更、证据研究、外部写、日程/消息、高风险财务模拟、医疗/法律安全策略、24h 虚拟长任务、50-Agent、Provider failover、恶意插件、租户隔离、自扩展、恶意附件、崩溃恢复、SDK 重连。；场景只提供目标、工具契约、世界状态、风险策略和验收条件；具体领域行为由 fixture Skill/Provider 提供，测试结束即卸载。；分为 deterministic scripted-model lane 与 real-model statistical lane，禁止把模型波动混入安全硬门。；每个场景输出完整 Evidence/Outcome/Trace，并检查资源清理和副作用。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不以“能跑一个销售 Demo”代替通用 Harness 验收。
- **Acceptance：** 所有安全、隔离、幂等、审计和恢复 hard gates 100% 通过。；scripted-model lane 的 deterministic capability success ≥99%，且连续 20 次无 flaky。；real-model lane 按模型/配置分别报告成功率、95% CI、成本、时延和 human intervention，不用单一总分掩盖差异。；核心 packages 中不存在为某个场景写死的行业关键词/业务规则。
- **Validation：** 新增 pnpm test:capability，CI 每 PR 跑 deterministic subset，每夜跑 full/real-model lane。；使用 architecture linter 检查 fixtures 不能成为生产依赖。；对每个场景注入 5–20 个 crash/policy/provider faults，验证 OutcomePackage 与真实 world。
- **验证命令：** `pnpm test:capability`；随后 G，阶段按适用项跑 R。
- **真实任务证据：** E7；场景 S01–S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 16 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 `deterministic capability success ≥99%`原文缺评分单元/分母：v1.1规划裁决为15×20=300个scenario-run verdict必须300/300 ACCEPTED；只有run内部预先冻结分母的非hard质量指标可用≥99%。真实模型95% CI门也需固定样本量、CI方法、失败/人工介入计分规则。

### P7-10 — Evaluation Plane、Chaos/Security/Scale Gates 与 Champion–Challenger 受控演化

- **Priority / Wave / 依赖：** P0 / W17 / `P1-11`、`P7-08`、`P7-09`、`P7-07`。
- **问题 → 目标：** 现有单元/覆盖率/E2E 纪律很强，但没有统一 Eval Registry、线上 outcome feedback、router regret、shadow run、canary 和自动回退；动态插件能力若直接修改生产会让演化速度超过验证速度。 → 建立持续量化改进机制，让 Router、Workflow、Prompt、Provider 和插件只能在证据充分时晋级。
- **Files：** target `package.json` [B]；`docs/testing.md` [B]；`packages/feedback/README.md` [B]；`packages/session/session-telemetry/src/index.ts` [B]；`packages/extensions/tool-cordis/src/index.ts` [B]；`packages/extensions/cordis-host-runner/src/registry.ts` [B]；new `packages/evaluation/eval/src/index.ts` [N]；`packages/evaluation/eval/src/types.ts` [N]；`packages/evaluation/eval-registry/src/index.ts` [N]；`packages/evaluation/eval-runner/src/index.ts` [N]；`packages/evaluation/champion-challenger/src/index.ts` [N]；`packages/evaluation/evolution-proposal/src/index.ts` [N]；`tests/chaos/runner.ts` [N]；`tests/security/runner.ts` [N]；`tests/scale/runner.ts` [N]；`.github/workflows/general-purpose-gate.yml` [N]。
- **MUST：** 定义指标：verified task success、policy violation、duplicate side effect、recovery、router regret、cost、latency、human intervention、memory pollution、evidence completeness。；支持 offline replay、shadow、A/B、canary、champion/challenger；候选只能读取复制流，不共享写 token。；动态 extension/prompt/router/workflow 改进必须形成 EvolutionProposal，经静态扫描、离线 eval、安全 eval、canary 和批准后签名发布。；建立自动回退阈值和不可自动演化清单：Trust Kernel、tenant boundary、audit integrity、root signing keys、不可逆审批政策。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不允许系统在生产主进程内即时自写、自测、自批准并自发布。
- **Acceptance：** 任何候选不能未经 gate 直接替换生产 provider/plugin/policy。；安全回归、成本超限或成功率劣化达到阈值时自动停止 canary 并恢复 champion。；Eval 结果可重放、可审计并绑定代码/config/schema/model 版本。；发布门同时检查 unit/coverage/architecture/security/recovery/capability/scale，不允许仅凭模型自评晋级。
- **Validation：** 运行故意劣化 router、恶意 plugin、泄密 prompt、成本爆炸 workflow 的 challenger 测试。；对 champion/challenger 使用同一 ReplayBundle，计算差异与置信区间。；验证 root-policy 文件变更只能走人工高权限 release gate。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E7；场景 S01–S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 16 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。 canary 自动停止/回退的安全、成功率与成本阈值未量化。


## Phase 8 — Protocol、Control Plane、Enterprise Governance 与发布可靠性

让外部系统和企业可以稳定控制、审计、升级与恢复 Harness。

### P8-01 — Protocol Version Negotiation 与 Capability Discovery

- **Priority / Wave / 依赖：** P0 / W5 / `P0-06`、`P4-01`。
- **问题 → 目标：** 当前 SDK protocol 没有正式版本协商和 feature negotiation；当 Run、Approval、Artifact 等资源扩展后，旧客户端可能静默忽略语义或调用不存在的方法。 → 让 SDK、Host、Agent Provider 和插件在升级时明确协商能力，而不是靠运行时报错猜版本。
- **Files：** target `packages/sdk/protocol/src/types.ts` [B]；`packages/sdk/protocol/src/transport.ts` [B]；`packages/sdk/protocol/src/index.ts` [B]；`packages/sdk/server/src/server.ts` [B]；`packages/sdk/client/src/client.ts` [B]；`packages/api/gateway/src/index.ts` [B]；new `packages/sdk/protocol/src/version.ts` [N]；`packages/sdk/protocol/src/capabilities.ts` [N]；`packages/sdk/protocol/src/schema-fingerprint.ts` [N]；`packages/sdk/protocol/tests/version-negotiation.spec.ts` [N]；`docs/subsystems/control-protocol.md` [N]。
- **MUST：** 在 initialize handshake 交换 protocolVersion range、schema fingerprints、methods、events、resource types、streaming/approval/replay capabilities。；定义 mandatory/optional capability 与 fail-fast 规则；未知 mandatory capability 必须拒绝连接。；支持 compatibility adapter 注册，但 adapter 必须显式记录降级项并进入 trace。；将协议 schema 生成物纳入 release evidence 和 golden compatibility fixtures。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不依赖 User-Agent 字符串或 package version 猜测能力。
- **Acceptance：** 新客户端连接旧服务端、旧客户端连接新服务端均有确定性协商结果，不出现静默字段丢失。；不兼容 mandatory capability 在执行任务前被拒绝，并返回机器可读原因。；相同构建的 schema fingerprint 稳定；任何协议行为变更都会触发 fixture diff。；协商结果写入每个 Run 的 provenance。
- **Validation：** 建立 N-2/N-1/N compatibility matrix tests。；故意删除 mandatory capability、改变 enum/required field，确认 CI fail。；TS 与 Python 客户端对同一 handshake fixture 产生相同 negotiated profile。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E8；场景 S11、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 11 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。 最终 spec/control-protocol.schema.json 无文件 owner。

### P8-02 — 一等公民 Remote Resources：Run、Agent、Action、Approval、Artifact、Verification、World

- **Priority / Wave / 依赖：** P0 / W16 / `P4-01`、`P7-05`、`P6-09`、`P8-01`。
- **问题 → 目标：** 当前 SDK 主要暴露 initialize、session/prompt、shutdown 和少量通知；外部客户端需要解析低层 Session event 才能推断 Run、Action、审批或验证状态，无法稳定治理长任务。 → 把 Harness 控制平面从“提交 prompt、看 session event”升级为可以精确管理真实工作的资源 API。
- **Files：** target `packages/sdk/protocol/src/types.ts` [B]；`packages/sdk/server/src/server.ts` [B]；`packages/sdk/client/src/api.ts` [B]；`packages/api/remotes/src/index.ts` [B]；`packages/api/remotes/src/types.ts` [B]；`packages/host/apiproxy/src/api-proxy.ts` [B]；new `packages/api/remotes/src/run.ts` [N]；`packages/api/remotes/src/action.ts` [N]；`packages/api/remotes/src/approval.ts` [N]；`packages/api/remotes/src/artifact.ts` [N]；`packages/api/remotes/src/verification.ts` [N]；`packages/api/remotes/src/world.ts` [N]；`packages/sdk/protocol/src/resources.ts` [N]；`packages/sdk/protocol/tests/resources.contract.spec.ts` [N]。
- **MUST：** 定义稳定资源 ID、summary/detail representations、pagination、filter、watch 和 optimistic concurrency token。；提供 run.create/get/list、agent.get/list、action.get/list、approval.get/list、artifact.get/list、verification.get、world.get/list。；Remote API 只读取各领域 Service Definition，不复制业务状态；遗留 API Proxy 逐项迁移并保留明确 compatibility route。；所有资源响应带 tenant、classification、revision、createdAt/updatedAt、provenance 和 allowedActions。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不把 Remote Resource 本身变成新的状态源；canonical domain ledger 仍是事实来源。
- **Acceptance：** 客户端无需解析 assistant 文本或 raw event 即可判断 Run 当前状态、待审批项、证据和产物。；分页、过滤和 revision 在 100k Runs/1M Actions 数据集上稳定且无全表内存加载。；资源访问经过 P2/P8 authorization，越权 ID 枚举不泄露资源存在性。；Typert Remote、JSON-RPC SDK 与 Host API 对同一领域状态返回语义一致。
- **Validation：** 运行 schema/contract/golden tests 和 100k-resource pagination load test。；跨租户 fuzz ID、cursor、filter，确认 404/403 语义不泄露。；迁移一个现有 Session API 作为 compatibility test，比较旧/新投影。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E8；场景 S11、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 14 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。 100k/1M 数据集的稳定性缺 latency、memory、I/O 数值预算。

### P8-03 — 远程生命周期控制：Pause、Resume、Cancel、Fork、Retry、Reconcile、Close

- **Priority / Wave / 依赖：** P0 / W17 / `P4-05`、`P4-07`、`P4-08`、`P4-13`、`P8-02`。
- **问题 → 目标：** 当前协议缺少完整 cancel/session close，且没有 Run 级 pause/resume/fork/reconcile；断线或客户端重试可能重复发命令，状态竞争也没有 revision precondition。 → 让外部控制平面能以幂等、可恢复方式管理跨天 Run，而不是只能关掉整个进程。
- **Files：** target `packages/sdk/protocol/src/types.ts` [B]；`packages/sdk/server/src/server.ts` [B]；`packages/sdk/client/src/api.ts` [B]；`packages/core/agent/src/dispatch.ts` [B]；`packages/core/agent/src/inbox.ts` [B]；`packages/subagent/subagent/src/lifecycle.ts` [B]；new `packages/api/remotes/src/run-control.ts` [N]；`packages/sdk/protocol/src/commands.ts` [N]；`packages/sdk/protocol/tests/run-lifecycle.e2e.ts` [N]。
- **MUST：** 实现 run.pause/resume/cancel/fork/retry/reconcile/close，并要求 commandId、idempotencyKey、expectedRevision 和 reason。；Pause 等待安全 checkpoint；Cancel 传播到子 Agent、Workflow、World、工具和审批，并进入 cleanup/compensation。；Fork 明确复制 RunPlan/context/artifacts 的哪些部分，不继承 secrets、grants、leases 和 mutable world。；每个命令返回 accepted/currentState/command resource，异步完成通过 event stream 通知。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不以 SIGKILL 整个 Harness 作为正常 cancel 实现。
- **Acceptance：** 重复提交同一 commandId 不会重复执行动作或补偿。；非法状态转换被拒绝且不改变 revision。；暂停后进程重启仍可 resume；cancel 后没有孤儿 Agent、process、world、lease 或 secret handle。；Fork 与父 Run lineage 可追踪，权限不扩大。
- **Validation：** 对每条命令运行 state-transition table 和 concurrent command race tests。；在 pause/cancel/fork 的每个边界 kill 进程并恢复。；断线后重发命令 1,000 次，验证幂等和最终状态。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E8；场景 S07、S14、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P8-04 — 双向 Server→Client Requests：持久审批、澄清、人工接管与 Quorum

- **Priority / Wave / 依赖：** P0 / W10 / `P2-06`、`P2-07`、`P2-09`、`P8-01`。
- **问题 → 目标：** 当前 SDK server-to-client requests 未实际使用，Approval 主要在 turn 内；客户端断线、审批超时、多个审批人、问题澄清和人工接管都没有正式协议。 → 让无人在终端前的长任务也能可靠等待人类决定，并支持多个授权客户端与职责分离。
- **Files：** target `packages/sdk/protocol/src/transport.ts` [B]；`packages/sdk/protocol/src/types.ts` [B]；`packages/sdk/server/src/server.ts` [B]；`packages/sdk/client/src/client.ts` [B]；`packages/interaction/user-approval/src/index.ts` [B]；`packages/interaction/user-approval/src/types.ts` [B]；new `packages/sdk/protocol/src/server-requests.ts` [N]；`packages/api/remotes/src/human-interaction.ts` [N]；`packages/interaction/human-channel/src/index.ts` [N]；`packages/interaction/human-channel/src/types.ts` [N]；`packages/sdk/protocol/tests/server-request.e2e.ts` [N]。
- **MUST：** 定义 approval.request、clarification.request、takeover.request、credential-consent.request（只请求同意，不传 secret 明文）。；请求有 durable requestId、runId、action hash、deadline、eligible principals、quorum、responses、resolution 和 cancellation。；支持客户端注册可处理的 request scopes；断线后请求保留并可由另一个授权客户端接管。；响应必须签名/认证并经过 expectedRevision；晚到或重复响应不会改变已解决结果。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不通过协议把实际 API key/password 发送给模型或普通客户端。
- **Acceptance：** 客户端离线 1 小时后重连仍能读取未决请求并安全回答。；多客户端并发响应按 quorum/policy 确定性解决。；审批展示内容与最终 ActionManifest hash 完全绑定。；未经授权客户端看不到请求细节，不能推断敏感 target。
- **Validation：** 运行 disconnect/reconnect、deadline、quorum、revocation、late response、duplicate response tests。；使用两人审批 fixture 验证 separation of duties。；测试服务重启后 pending request 完整恢复。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E8；场景 S04、S05、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 11 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。 重复声明 P2-12 的 human-channel index/types 为 new，且未依赖 P2-12。

### P8-05 — Resumable Event Streaming：Cursor、ACK、Replay、Dedupe 与 Backpressure

- **Priority / Wave / 依赖：** P0 / W17 / `P4-06`、`P7-07`、`P8-02`。
- **问题 → 目标：** 当前通知流缺少正式 cursor/ack/replay 语义；断线后只能重新建立连接并自行猜测遗漏，慢客户端也可能拖垮服务端。 → 保证客户端断线、网络抖动和高事件量下不丢关键状态，也不会无限占用内存。
- **Files：** target `packages/sdk/protocol/src/transport.ts` [B]；`packages/sdk/server/src/server.ts` [B]；`packages/sdk/client/src/client.ts` [B]；`packages/api/remotes/src/remote-events.ts` [B]；`packages/session/session-persistence/src/coordinator.ts` [B]；new `packages/sdk/protocol/src/event-stream.ts` [N]；`packages/api/event-stream/src/index.ts` [N]；`packages/api/event-stream/src/store.ts` [N]；`packages/api/event-stream/tests/reconnect.e2e.ts` [N]。
- **MUST：** 每个 tenant/stream 使用单调 cursor，事件带 eventId、resourceRevision、causationId 和 classification。；客户端 ACK durable cursor；重连时从 lastAck+1 replay，按 eventId 去重。；定义 retention、cursor expired、snapshot+delta recovery、max in-flight、slow-consumer disconnect。；关键控制事件来自 durable domain outbox，不依赖进程内 emitter；非关键高频 chunk 可明确标记 lossy。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不保证 token-level assistant chunk 永久保留；关键状态事件必须 durable。
- **Acceptance：** 在随机断线、重复、乱序和服务重启下，逻辑资源状态最终与服务端一致。；关键事件无遗漏；重复物理传输经 dedupe 后逻辑重复为 0。；慢客户端不会造成无限队列或阻塞 Agent 执行。；cursor 过期时客户端能通过 snapshot+delta 恢复，而不是静默跳过。
- **Validation：** 运行 network chaos：drop/duplicate/reorder/delay/reset。；10M events load test，验证 memory、disk、p95 replay 和 backpressure。；TS/Python 客户端在同一 fault trace 下得到相同最终资源投影。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E8；场景 S11、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 9 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。 retention、cursor expiry、p95 replay/backpressure 没有量化阈值。

### P8-06 — Authenticated Principal、Tenant Boundary、RBAC/ABAC 与 API Scope

- **Priority / Wave / 依赖：** P0 / W17 / `P2-01`、`P2-02`、`P8-02`。
- **问题 → 目标：** 官方 identity README 明确当前值不代表 authenticated account；Host/SDK/API 若只依赖进程或 workspace 身份，无法阻止跨租户读取、命令伪造和权限扩大。 → 把当前匿名相关 ID 升级为真正的认证与授权边界，使 Harness 可安全运行多用户和企业工作。
- **Files：** target `packages/identity/README.md` [B]；`packages/api/remotes/src/agent-lookup.ts` [B]；`packages/api/gateway/src/index.ts` [B]；`packages/host/webserver/src/index.ts` [B]；`packages/sdk/protocol/src/types.ts` [B]；`packages/workspace/workspace/src/entity.ts` [B]；new `packages/identity/auth/src/index.ts` [N]；`packages/identity/auth/src/types.ts` [N]；`packages/identity/tenant/src/index.ts` [N]；`packages/identity/authorization/src/index.ts` [N]；`packages/identity/authorization/src/policy.ts` [N]；`packages/api/auth-middleware/src/index.ts` [N]；`packages/identity/authorization/tests/tenant-isolation.e2e.ts` [N]。
- **MUST：** 定义 authenticated Principal、ServiceAccount、Tenant、Organization、Role、Attribute 和 scoped session。；API/SDK handshake 验证 OIDC/JWT 或可替换 Auth Provider；内部调用使用短期 service token 与明确 audience。；所有 resource lookup 先绑定 tenant，再做 RBAC+ABAC+CapabilityToken 检查；禁止先全局 lookup 后过滤。；Workspace、Run、Artifact、Memory、Approval、Plugin、World 和 Audit 全部携带不可为空的 tenant boundary。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不把匿名 telemetry correlation id 当作用户登录身份。
- **Acceptance：** 跨租户数据泄漏、resource existence leak 和 command execution 均为 0。；token audience、expiry、revocation、key rotation 和 clock skew 有明确行为。；管理员权限不能自动下放给子 Agent；delegation 受 CapabilityToken depth 限制。；匿名本地单用户模式仍可通过显式 local principal provider 使用，但不能冒充企业认证。
- **Validation：** 运行横向/纵向越权 fuzz、IDOR、confused deputy、token replay 和 key rotation tests。；至少 100 tenants × 1,000 resources 隔离 load test。；对每个 Remote method 自动生成 authorization matrix test。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E8；场景 S11、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 13 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P8-07 — Schema-Generated TS/Python SDK Parity 与 Contract Test Matrix

- **Priority / Wave / 依赖：** P0 / W18 / `P8-01`、`P8-02`、`P8-05`。
- **问题 → 目标：** 仓库已有 TS 与 Python SDK，但协议能力有限且手工实现较多；新增资源后若无单一 schema/codegen/parity gate，会出现客户端能连接却理解不同语义。 → 防止 TypeScript、Python、Host Remote 和 JSON-RPC 在字段、默认值、错误和生命周期上逐渐分叉。
- **Files：** target `packages/sdk/protocol/src/types.ts` [B]；`packages/sdk/client/src/api.ts` [B]；`packages/sdk/server/src/server.ts` [B]；`python/sdk/README.md` [B]；`python/sdk-runtime/README.md` [B]；`scripts/build-exe-for-python-sdk.ts` [B]；`scripts/build-python-release.py` [B]；new `packages/sdk/schema/control-protocol.json` [N]；`packages/sdk/codegen/src/index.ts` [N]；`packages/sdk/contract-tests/src/cases.ts` [N]；`python/sdk/tests/test_control_protocol_contract.py` [N]；`packages/sdk/client/tests/control-protocol.contract.spec.ts` [N]。
- **MUST：** 从 versioned schema 生成 TS/Python resource models、method clients、events、errors 和 enum；手写层仅保留 ergonomic wrapper。；统一 null/optional、integer、timestamp、binary/artifact ref、union、unknown field 和 error mapping。；生成双向 golden fixtures 与 wire snapshots，确保 TS encode→Python decode 及反向一致。；CI 同时构建源码 SDK、单文件 runtime 和 wheel，并运行相同 lifecycle/cancel/reconnect/approval scenarios。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不在两个 SDK 中分别手写一套事实模型。
- **Acceptance：** 所有公开协议类型 TS/Python 覆盖率 100%，不存在只在一端暴露的方法。；跨语言 round-trip 无字段损失，unknown optional fields forward-compatible。；错误 code/retryability/details 在两端语义一致。；协议 schema 变化未更新两端生成物时 CI 必须失败。
- **Validation：** 运行 generated contract matrix、property-based serialization、N-1 fixtures。；Python/TS 同时连接同一 server 完成 Run create→approval→pause→resume→verify→close。；发布产物安装 smoke tests 不依赖 monorepo 路径。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E8；场景 S11、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 12 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P8-08 — Operator Control Plane API 与 Run/Agent/Workflow 可视化

- **Priority / Wave / 依赖：** P1 / W18 / `P8-02`、`P8-03`、`P8-04`、`P8-05`。
- **问题 → 目标：** 当前 Web 主要围绕对话/Session，复杂 Run 的 Agent Graph、Workflow phases、预算、Action、Policy、Approval、Evidence、Repair 和 World 状态缺少统一操作界面。 → 让人类能看见系统正在做什么、为什么这样做、哪里阻塞，并能安全干预。
- **Files：** target `apps/web/src/main.ts` [B]；`packages/client/runtime/src/index.ts` [B]；`packages/client/modules/src/index.ts` [B]；`packages/api/remotes/src/client/index.ts` [B]；`packages/host/apiproxy/src/api-proxy.ts` [B]；new `packages/client/ui-run-control/src/index.ts` [N]；`packages/client/ui-run-control/src/store.ts` [N]；`packages/client/ui-run-control/src/components/RunList.tsx` [N]；`packages/client/ui-run-control/src/components/RunGraph.tsx` [N]；`packages/client/ui-run-control/src/components/ActionTrace.tsx` [N]；`packages/client/ui-run-control/src/components/EvidencePanel.tsx` [N]；`packages/client/ui-run-control/src/components/ApprovalQueue.tsx` [N]；`packages/client/ui-run-control/tests/run-control.e2e.ts` [N]。
- **MUST：** 展示 Run 列表、状态、Agent/Workflow DAG、当前阶段、预算、成本、阻塞、Action、Policy 决策、Evidence、Verification 与 artifacts。；Pause/cancel/resume/retry/approve/reject/takeover 操作调用 Remote command，UI 不直接篡改状态。；基于 server returned allowedActions 控制显示，但服务端仍强制鉴权；敏感参数按 classification 脱敏。；使用 resumable stream 更新，断线重连后从 snapshot+delta 恢复。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不把 UI 作为 Policy 或状态事实来源。
- **Acceptance：** 用户能在 3 次交互内定位等待审批、失败 verifier、超预算 Agent 和孤立 world。；所有危险操作显示绑定后的 ActionManifest diff 与影响范围。；断线、重启和 1,000 并发 Run 下 UI 状态最终一致且不冻结。；无权限用户既看不到按钮，也无法绕过 API 执行。
- **Validation：** 运行 Playwright real-browser E2E，覆盖 reconnect、approval、cancel、repair、artifact download。；测试 1,000 Run/10,000 Action 虚拟列表性能和内存。；做 accessibility、keyboard、screen-reader 和 sensitive-field snapshot tests。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E8；场景 S11、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 13 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。 1,000 Runs/10,000 Actions 性能没有 FPS/p95/memory 预算。

### P8-09 — Organization Governance：Policy Hierarchy、Quota、Retention、Legal Hold 与 Audit Export

- **Priority / Wave / 依赖：** P0 / W18 / `P2-10`、`P3-10`、`P6-10`、`P8-06`。
- **问题 → 目标：** 当前 settings/profile/permission presets 更偏本地用户配置，缺少 org→tenant→workspace→run 的不可弱化政策层、资源配额、保留/删除、legal hold 和标准化审计导出。 → 使企业能在组织层统一约束 Agent，同时保留项目级灵活性和完整审计。
- **Files：** target `packages/settings/settings/src/index.ts` [B]；`packages/interaction/permission-presets/src/index.ts` [B]；`packages/workspace/workspace/src/index.ts` [B]；`packages/storage/storage/src/index.ts` [B]；`packages/host/apiproxy/src/session-export.ts` [B]；new `packages/governance/org-policy/src/index.ts` [N]；`packages/governance/org-policy/src/types.ts` [N]；`packages/governance/quota/src/index.ts` [N]；`packages/governance/retention/src/index.ts` [N]；`packages/governance/audit-export/src/index.ts` [N]；`packages/client/ui-governance/src/index.ts` [N]；`packages/governance/org-policy/tests/hierarchy.e2e.ts` [N]。
- **MUST：** 实现 monotonic policy hierarchy：下层可收紧但不能放宽上层 deny、data residency、model/provider、plugin trust、budget 和 approval 要求。；定义 tenant/workspace/run 配额：并发 Agent、CPU、memory、network、token、cost、storage、artifact、workflow。；实现 retention、erase、legal hold、export jobs，并覆盖 Session/Run/Action/Evidence/Artifact/Memory/Telemetry outbox。；审计导出使用 versioned schema、完整性链、分页和增量 cursor，可送 SIEM 但默认脱敏。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不在 Harness 内实现某个国家/行业的全部法规；提供可验证 Policy Pack 接口。
- **Acceptance：** 项目配置无法绕过组织禁止项；冲突时 fail closed 并展示来源。；Quota 在调度前和运行中均执行，超额不产生未记录资源。；retention/erase/legal hold 对 fork、snapshot、backup 和 index 一致。；Audit export 可验证连续性和 hash chain，缺失/篡改 100% 检出。
- **Validation：** 运行 policy hierarchy property tests 和 100 组织配置组合。；做 quota race/overcommit、retention crash、legal hold override、audit tamper tests。；将导出喂给测试 SIEM schema validator 并核对 replay。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** E8；场景 S11、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 12 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 缺项级可执行验证命令。

### P8-10 — Config Provenance、Typed Dry-Run、迁移/回滚、ABI Compatibility 与 Disaster-Recovery Release Gate

- **Priority / Wave / 依赖：** P0 / W19 / `P0-01`、`P0-07`、`P1-03`、`P4-08`、`P8-01`、`P8-09`。
- **问题 → 目标：** 现有 Profile/Bundle/Patch 组合能力强，但 patch 替换整行且来源分层复杂；缺少完整 provenance/diff/dry-run、跨版本迁移计划、插件 ABI 门和包含 Run/Approval/Artifact 的灾难恢复演练。 → 确保配置、插件、协议和持久状态升级可预测、可解释、可回滚，真正达到生产发布标准。
- **Files：** target `packages/boot/app-boot/src/profile.ts` [B]；`packages/boot/app-boot/src/index.ts` [B]；`apps/cli/src/profile-boot.ts` [B]；`apps/cli/src/dump-config.ts` [B]；`packages/settings/settings/src/index.ts` [B]；`packages/bundle/base/cordis.patch.yml` [B]；`package.json` [B]；new `packages/boot/config-compiler/src/index.ts` [N]；`packages/boot/config-compiler/src/provenance.ts` [N]；`packages/boot/config-compiler/src/diff.ts` [N]；`packages/boot/config-migration/src/index.ts` [N]；`packages/compatibility/abi-gate/src/index.ts` [N]；`packages/backup/disaster-recovery/src/index.ts` [N]；`scripts/general-purpose-gate.ts` [N]；`tests/disaster-recovery/restore.e2e.ts` [N]；`.github/workflows/release-gate.yml` [N]。
- **MUST：** 编译最终配置时记录每个 row/field 的 profile、bundle、home patch、CLI patch 来源、schema version 和 shadowed value。；提供 `dsh config plan`：typed validation、capability graph、policy impact、plugin permissions、migration plan、diff 和 dry-run；不在 dry-run 执行插件代码。；所有持久领域定义 versioned migration，迁移前 snapshot，失败自动回滚；插件/协议/Service Definition 有 ABI compatibility checks。；建立加密 backup/restore 与 DR drill，覆盖 Run/Workflow Journal/Action Ledger/Approval/Evidence/Artifact/Memory/Policy/Plugin Lockfile；发布必须生成 evidence package。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不通过隐式 deep-merge 改变现有 row replacement 语义；先提供明确 typed diff 和迁移。
- **Acceptance：** 任何运行行为都能解释由哪一层配置决定；未知/冲突关键字段 fail closed。；旧版本真实 fixture 可以迁移到新版本并重放；失败后能恢复到旧二进制和旧状态。；破坏性 ABI/schema 变化未提供 migration/major version 时 release gate 失败。；在全进程、存储节点和 execution provider 故障演练后，RPO/RTO 达到声明目标且无重复外部副作用。
- **Validation：** 运行 config precedence golden tests、恶意 patch、unknown field 和 shadowed security policy tests。；用 N-2 production-like fixtures 做 migrate→run→rollback→run。；执行季度式 DR simulation：备份、删除工作目录、在新主机恢复、继续 pending approval/workflow 并核对 Outcome/ledger。；最终运行 `pnpm general-purpose-gate`，汇总所有阶段证据；任何 hard gate 失败都禁止 release。
- **验证命令：** `pnpm general-purpose-gate`；随后 G，阶段按适用项跑 R。
- **真实任务证据：** E8；场景 S07、S11、S14、S15；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 13 项 evidence pack；真实 provider/model 支持声明另需 live lane。
- **规格缺口 / Task 化：** Epic 声明 16 个文件（>5）；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。 RPO/RTO 仅称“声明目标”却未给数值；spec/release-gates.yaml 无 owner。


## 覆盖声明

- 条目：100/100；唯一 ID：100/100；Phase：9/9；Wave：19/19。
- 每项均含 title/priority、问题与目标、显式依赖、target/new files、MUST、不变量/失败规则、明确 non-goal、全部 acceptance、全部 validation、命令状态、真实任务证据和规格缺口。
- 无跳项、无实现状态断言；100行结构化记录完整，但**执行就绪仍为 BLOCKED**。来源中的 `pnpm plugin:verify <fixture>` 尚未绑定真实fixture路径，91/100项缺focused command，9个spec owner、若干阈值和manifest v1.1裁决仍须按本规划补齐。任何“来源缺失”均被标为blocker或最小边界，而不是猜测成已就绪。
