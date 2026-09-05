# First-100 需求矩阵扩展（第 101–109 项，P9）

> **性质与排序：** 本文件是 `first100-requirements-matrix.md` 的追加扩展，逐字段沿用原矩阵格式。原矩阵被 registry 生成器按"恰好 100 个 `### Pn-nn` 标题"校验，故扩展项**不得**写回原文件。排序：`W1–W19 → R10（First-100 关账门恰好 100 项，不变）→ W20–W22（本文件 9 项）`。P9-01…P9-07 不依赖 R10，经 maintainer 单独批准可提前并行执行，但不计入 100/100 门。
> **状态：** PROPOSED_PENDING_MAINTAINER（决策队列 C3）。批准前不生成 registry 行、不进 ledger。
> **Stage-0 前置（2026-08-30 晚可执行性审计新增，详见决策队列 C3 修订）：** 任何 P9 slice 开始前必须先做 registry extension——本文件 vendored 进 `spec/first100/sources/`（SHA 钉住）、解除 `extract-registry.mjs` 的"恰好 100 节 / wave 1..19"硬锁、生成 P9-01…09 的机器可读行（同 schema，或平行 `registry-extension.json`）+ wave-map W20–W22 节。否则 compact 后按 C2 协议重读 registry 会丢弃进行中的 P9 slice（registry 查无此项），且 command-freeze 的 files[] 校验无锚。
>
> **动机（全部一手实证，2026-08-30 代码级审计）：** 用户最终目标 = "直接连上任何 API、像 Codex 一样厉害的 harness"。原 100 项把 dsh 变成安全/可审计/可持久/可验证的企业级平台（多处超过 Codex 水位：steering、goal 持久、事件溯源 session、真实内核级沙箱、子代理体系），但以下 9 个"日常好用/能力锋利度"缺口在 100 项中无承载项：
> 1. 模型接入面**休眠**：`llm-pi-ai` 底层已支持 openai-completions / openai-responses / anthropic-messages 线协议 + 任意 baseURL/apiKeyEnv，但 `packages/bundle/base/cordis.patch.yml:95` 挂载为**零路由**，开箱只有 `deepseek-official` 可用（P5-02/03/04 是路由/协商/回退，不负责把通路配活）；
> 2. 编辑工具是精确字面匹配（`fs-local/fsio.ts` `applyLiteralEdit` 基于 indexOf，未命中/多命中即硬失败），无容错回退——直接压任务成功率；
> 3. token 计量是 4 字符/词固定启发（`token-meter/estimate.ts` `CHARS_PER_TOKEN=4`），compaction 阈值与上下文表全部骑在误差上（代码/中文/JSON 场景漂移大）；
> 4. `dsh --profile headless` 只接受一个任务位置参数：无 `--resume`/`--session-id`/`--output-format json`/stdin，脚本化能力远低于 `codex exec`；
> 5. 循环无硬预算：无 maxTurns/maxSteps/花费上限，无人值守只受上下文与钱包约束；
> 6. 出货系统提示词近空（`cordis.patch.yml:432` `persona: ''`），无编码代理行为准则（验证纪律/何时搜索/简洁性），全靠模型裸能力；
> 7. `BENCHMARK.md` 为 3 行占位：全仓无任务成功率评测（P0-08/P7-09 只建框架与夹具，无分数基线、无提升循环）；
> 8. adapter 行为契约只由 `llm-deepseek` 实现隐式定义，激活任何新通路无法证明"接对了"；
> 9. 无评测驱动的 prompt/工具描述迭代机制，"厉害"不可证明、不可回归。
> 网络出口沙箱缺失（read-only 仍可任意联网外传）**已由 P3-04 覆盖**，不重复立项，但建议 maintainer 将其视为 P3 内最高优先级。Plan-mode 非强制、MCP server 角色缺失为已知设计取舍，暂不立项。
>
> **上游避撞（基于 2026-08-30 上游热度实测）：** 上游月增 ~7,200 commits，`subagent`(377)/`llm`(206)/`client`(1,083)/`sandbox`(123)/approval-UX 为最热区，P9 各项刻意落在 fork 侧配置、测试、评测与小型工具强化上，不与上游热区重写同一实现；每个 wave 关账时按 BASE-ALIGN 惯例对 `docs/subsystems/` 与相关包做 upstream diff，命中即改"移植/适配"路线。

## Phase 9 — Model Reach 与 Capability Uplift

让"任何 API"从休眠代码变成出货能力，并用可复现基准证明与持续提升实际任务成功率。

### P9-01 — LLM Provider Conformance Kit：把模型接入面变成可测契约

- **Priority / Wave / 依赖：** P9 / W20 / P0-06。
- **问题 → 目标：** adapter 可观测行为（streaming 分帧、tool-call 增量合并、abort、错误→重试分类、usage/cache 计量）只由 `llm-deepseek` 实现隐式定义；激活 pi-ai 路由或接任何新服务都无法证明"接对了"。 → 把 `LlmAdapter` 抽象（`packages/llm/llm/src/index.ts`）的全部可观测行为固化为可复用 conformance 套件；任何通路（含 pi-ai 各线协议路由）必须全绿才可注册为可用。
- **Files：** target `packages/llm/llm/src/index.ts` [B]；`packages/llm/llm/src/types.ts` [B]；`packages/llm/llm-deepseek/src/adapter.ts` [B]；`packages/llm/llm-pi-ai/src/provider.ts` [B]；new `packages/llm/llm-conformance/src/kit.ts` [N]；`packages/llm/llm-conformance/src/mock-server.ts` [N]；`packages/llm/llm-conformance/tests/deepseek.conformance.spec.ts` [N]；`packages/llm/llm-conformance/tests/pi-ai-routes.conformance.spec.ts` [N]。
- **MUST：** 覆盖六类行为：流式 tool-call 增量、并行多工具调用、中途 abort、错误→`llm-retry` 分类映射、usage/cacheRead/cacheWrite 计量一致、超长输入拒绝语义。；`llm-deepseek` 与 pi-ai 三线协议（openai-completions/openai-responses/anthropic-messages）各以 mock server 为被试全绿；发现的现存缺陷单独立案。；kit 不依赖真实 key。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不新写任何 wire-protocol 实现（pi-ai 已有）；不测模型输出质量，只测协议行为。
- **Acceptance：** kit 对 `llm-deepseek` + pi-ai 三协议路由全绿且总 case 数 ≥ 40。；对六类行为各注入一处夹具偏差（含 SSE 单字节切分/合并帧边界），kit 逐一红。；进入 CI：任何 `packages/llm/**` 改动触发。
- **Validation：** 全量 kit 运行；分帧边界注入；abort 时序（首 token 前/工具增量中/收尾）三点验证。
- **验证命令：** 实施前按决策 B4 规则冻结（预期 `pnpm vitest run packages/llm/llm-conformance`）。
- **真实任务证据：** E1；场景 S02 类（协议契约夹具）；保存原始 receipts 与 before/after。
- **规格缺口 / Task 化：** 拆分：kit 骨架+mock server → 六类行为用例 → deepseek 被试 → pi-ai 路由被试。abort 在 `LlmAdapter.stream` 上的精确语义在 C 阶段冻结。

### P9-02 — 激活 pi-ai 多协议路由：让"任何 API"成为出货能力

- **Priority / Wave / 依赖：** P9 / W20 / P9-01。
- **问题 → 目标：** "直接连上任何 API"的代码通路已存在但休眠：`cordis.patch.yml:95` 给 `llm-pi-ai` 挂零路由，无任何默认 catalog/模板。 → 提供受支持的路由声明面（openai-compat / openai-responses / anthropic-messages 三类模板 + 任意 baseURL/apiKeyEnv），默认 bundle 携带即开即用的路由模板（无 key 时显式 dormant 而非报错），全部经 P9-01 kit 门。
- **Files：** target `packages/llm/llm-pi-ai/src/provider.ts` [B]；`packages/llm/llm-pi-ai/src/catalog.ts` [P]；`packages/llm/llm-pi-ai/src/config.ts` [P]；`packages/bundle/base/cordis.patch.yml` [P]；new `packages/llm/llm-pi-ai/tests/route-activation.spec.ts` [N]；`docs/user/guide/providers.md` [N]。
- **MUST：** 路由声明含 protocol/baseURL/model/apiKeyEnv/超时；schema 校验 fail closed，错误信息指明字段。；key 只经 env/credentials 路径，不落日志与 session 事件。；三类协议模板各过 conformance；catalog 变更不破坏 `deepseek-official` 默认行为。；与 P5-02 Model Router 的接口保持：路由只提供可选项，不做选择策略。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不写新 wire protocol；不做 per-vendor 深度特化（能力差异走 P5-03 协商声明）；不动上游 `llm` 核心抽象（上游 llm 月 206 commits，避撞）。
- **Acceptance：** 只写一段 settings（无代码改动）即可让 headless 任务经 mock openai-compat 服务全链路完成（含 ≥3 次工具调用）。；三类协议模板 conformance 全绿。；无 key 时该路由状态为显式 dormant，`deepseek-official` 不受影响。
- **Validation：** mock 服务 headless E2E + 配置负例 5 类（缺字段/坏 URL/坏协议名/重复路由/key env 缺失）全部 fail closed + conformance 全量。
- **验证命令：** 实施前按 B4 冻结（预期 `pnpm vitest run packages/llm/llm-pi-ai`）。
- **真实任务证据：** E2；场景 S06 类（模型调用链路）；真实 endpoint 冒烟属 live lane，凭证按决策 A5 就位后另跑。
- **规格缺口 / Task 化：** 拆分：路由 schema（contract）→ catalog/激活（provider）→ bundle 模板（consumer）→ 负例与 E2E（fault）。默认模板列表（哪几家服务名）由 maintainer 在 C 阶段批。

### P9-03 — Provider/Model 选择面：零代码切换与 `--model`

- **Priority / Wave / 依赖：** P9 / W20 / P9-02。
- **问题 → 目标：** 有了活路由还需要产品级选择入口：当前无 `--model` 类 CLI 面，切模型=手工编辑 profile。 → 在既有 profile/settings 体系内提供 `dsh --model <route:model>`（含 headless 路径）与会话内切换命令，配置校验与可操作报错。
- **Files：** target `apps/cli/src/args.ts` [P]；`packages/boot/app-boot` [B]；`packages/llm/llm/src/call-config.ts` [B]；new `tests/e2e/model-switch.e2e.ts` [N]；`docs/user/guide/providers.md` [P]。
- **MUST：** `--model` 解析→路由存在性校验→不存在时列出可用路由 fail closed。；headless 与交互两路径均生效。；选择进 session 事件（可审计），不写死进代码。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不做自动选型（P5-02）；不做图形配置 UI；不改上游 args 框架结构。
- **Acceptance：** 同一 headless 任务，仅换 `--model` 参数分别经 2 条不同路由（mock）跑通，session 事件记录正确路由。；错误 model 参数 fail closed 且提示可用列表。
- **Validation：** e2e 切换 + 负例 + `--help` 文本与实际行为一致性检查（现有 `--help` 仍宣传已删除的 tui profile，顺带修正）。
- **验证命令：** 实施前按 B4 冻结（预期 `pnpm vitest run tests/e2e/model-switch.e2e.ts`）。
- **真实任务证据：** E2；场景 S06 类。
- **规格缺口 / Task 化：** 拆分：参数与校验（contract）→ boot 接线（consumer）→ e2e（fault）。`<route:model>` 语法在 C 阶段冻结。

### P9-04 — 编辑工具容错强化：从精确匹配到分级回退

- **Priority / Wave / 依赖：** P9 / W20 / 无。
- **问题 → 目标：** `applyLiteralEdit`（`packages/fs/fs-local/src/fsio.ts:655,750`）是 indexOf 精确匹配：未命中→`FS_EDIT_NOT_FOUND`、多命中→`FS_AMBIGUOUS_EDIT` 直接硬失败，无空白归一/容错回退，迫使模型反复重读重试——这是对任务成功率与 token 成本的直接税。 → 增加分级匹配回退（精确 → 行首尾空白归一 → 缩进整体偏移容忍），保持 fail-closed 语义：回退命中必须唯一且在 diff 中如实展示，绝不静默改错。
- **Files：** target `packages/fs/fs-local/src/fsio.ts` [P]；`packages/fs/tool-fs/src/edit.ts` [P]；new `packages/fs/fs-local/tests/edit-fallback.spec.ts` [N]。
- **MUST：** 三级回退逐级尝试，任何一级多重命中即 `FS_AMBIGUOUS_EDIT`。；回退命中时结果 diff 标注实际匹配层级。；版本守卫（现有 version-guard）语义不变。；错误消息包含最近似片段定位提示（行号+相似度），帮模型一次改对。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不引入模糊语义匹配/AST 匹配；不改 str_replace_editor 的对外 schema；不做 patch/hunk 新格式（避免与上游工具面撞车）。
- **Acceptance：** 夹具集：尾随空白差异、CRLF/LF 差异、整体缩进 +2/-2 三类均一次命中且 diff 标注层级。；歧义夹具（两处近似）仍 fail closed。；现有全部 fs 测试不回归。
- **Validation：** 夹具全量 + fs 包回归 + 一次 headless 真实编辑任务对比（改动前后各跑同一任务记录重试次数）。
- **验证命令：** 实施前按 B4 冻结（预期 `pnpm vitest run packages/fs/fs-local`）。
- **真实任务证据：** E2；场景 S03 类（文件编辑链路）。
- **规格缺口 / Task 化：** 拆分：匹配器（provider）→ tool-fs 接线与 diff 标注（consumer）→ 夹具（fault）。相似度提示的算法与阈值在 C 阶段冻结。

### P9-05 — token-meter 真实分词：替换 4 字符/词启发

- **Priority / Wave / 依赖：** P9 / W20 / 无。
- **问题 → 目标：** `token-meter/estimate.ts` 固定 `CHARS_PER_TOKEN=4`；compaction 触发（0.8 阈值）、上下文表、pruning 决策全骑在误差上，代码/中文/JSON 会双向漂移（过早压缩或溢出惊喜）。 → 官方模型用精确 tokenizer（DeepSeek 公开 tokenizer；pi-ai 路由按协议带 usage 回填校准），无 tokenizer 的路由用按内容类别校准的启发 + 真实 usage 反馈闭环，p95 相对误差 ≤ 冻结阈值。
- **Files：** target `packages/llm/token-meter/src/estimate.ts` [P]；`packages/llm/token-meter/src/index.ts` [B]；new `packages/llm/token-meter/src/tokenizer-deepseek.ts` [N]；`packages/llm/token-meter/src/usage-calibration.ts` [N]；`packages/llm/token-meter/tests/accuracy.spec.ts` [N]。
- **MUST：** 官方 DeepSeek 路径精确计数。；每次真实响应的 usage 与预估对比进校准状态（会话内自适应）。；无 tokenizer 路由 p95 相对误差 ≤ 阈值（对照夹具：TS 代码/中文散文/JSON/混合 4 类语料）。；估计接口保持同步纯函数（不阻塞循环）。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不为每家第三方模型 vendor 打包 tokenizer；不改 compaction 策略本身（P6-06 域）。
- **Acceptance：** 4 类语料夹具上 DeepSeek 精确路径误差=0；启发路径 p95 ≤ 冻结阈值。；校准闭环在含 3 次真实（mock usage）响应的会话内把误差单调收窄。；compaction-basic 现有测试不回归。
- **Validation：** 语料夹具 + 校准收敛测试 + compaction 触发点前后对比。
- **验证命令：** 实施前按 B4 冻结（预期 `pnpm vitest run packages/llm/token-meter`）。
- **真实任务证据：** E1；场景 S07 类（上下文管理）。
- **规格缺口 / Task 化：** 误差阈值数值 maintainer 批。拆分：deepseek tokenizer（provider）→ 校准闭环（provider）→ 语料夹具（fault）。tokenizer 依赖体积若超包预算，在 C 阶段决定 lazy-load 方案。

### P9-06 — Headless 脚本化：`--resume` / `--output-format json` / stdin

- **Priority / Wave / 依赖：** P9 / W20 / 无。
- **问题 → 目标：** `dsh --profile headless` 只接受一个任务位置参数、打印最后消息（`packages/bundle/headless/src/startup.ts`），无 resume/会话指定/结构化输出/管道输入；作为"像 codex exec 一样"的自动化底座不合格，也直接阻碍 P9-08 基准套件复用。 → 补齐 `--resume <sessionId>`、`--output-format text|json|stream-json`、stdin 任务输入三件套（session 层 `agents.resume()` 已存在且有 e2e，纯接线）。
- **Files：** target `packages/bundle/headless/src/startup.ts` [P]；`packages/bundle/headless/src/index.ts` [P]；`apps/cli/src/args.ts` [P]；new `packages/bundle/headless/tests/scriptability.e2e.ts` [N]；`docs/user/guide/headless.md` [N]。
- **MUST：** `--resume` 恢复既有会话继续任务（复用 session 层既有恢复语义与崩溃修复）。；`stream-json` 逐事件行输出与 SDK 既有 `stream-json.expected.jsonl` 口径一致。；stdin 输入与位置参数互斥且报错清晰。；退出码：任务完成=0，`BLOCKED`/失败=非 0 且 JSON 里带 typed 原因。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不做 TUI；不改 session 存储格式；不做多任务队列（P4 域）。
- **Acceptance：** e2e：任务 A 运行→中断→`--resume` 完成，全程 stream-json 可逐行 parse 且事件序完整。；`echo task | dsh --profile headless --output-format json` 输出可 parse 且含最终消息与 usage。；退出码矩阵 4 类夹具全对。
- **Validation：** e2e 三件套 + 与 SDK expected.jsonl 口径 diff + 崩溃中断恢复夹具。
- **验证命令：** 实施前按 B4 冻结（预期 `pnpm vitest run packages/bundle/headless`）。
- **真实任务证据：** E2；场景 S04 类（会话生命周期）。
- **规格缺口 / Task 化：** 拆分：args/stdin（contract）→ resume 接线（consumer）→ stream-json 输出（provider）→ 退出码与崩溃夹具（fault）。
- **上游避撞：** `apps/cli` 月 374 commits，改动限于 headless bundle 与最小 args 增量；实施前 diff 上游 headless 是否已自带同类 flags，已有则转"移植+测试"。

### P9-07 — Agent Loop 硬预算：maxTurns / 花费上限 / 超限语义

- **Priority / Wave / 依赖：** P9 / W20 / 无。
- **问题 → 目标：** 循环无 maxTurns/maxSteps/花费上限（`packages/core/agent-loop/src/agent.ts` 全文无 ceiling；guard 只有软提醒与超时策略），无人值守时只受上下文与钱包约束——与 P4-10 的 workflow 预算不同层：这里是单 agent 回路的最后保险。 → 在 agent-loop 加声明式硬预算（turns/steps/estimated cost），超限触发 typed 停止事件并落盘可恢复状态，headless 暴露参数。
- **Files：** target `packages/core/agent-loop/src/agent.ts` [P]；`packages/core/agent-loop/src/constants.ts` [P]；`packages/bundle/headless/src/startup.ts` [P]；new `packages/core/agent-loop/tests/budget.spec.ts` [N]。
- **MUST：** 预算在 loop 内强制，非 prompt 建议。；超限=typed `budget-exceeded` 事件 + 当前候选状态完整落盘（可 `--resume` 续），绝不静默截断。；默认值保守且可 profile 覆盖；`0/undefined`=不限（显式）。；成本预算基于 token-meter 计量（P9-05 落地后自动变准）。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不做多 agent 全局调度预算（P4-10）；不做计费系统（P3-10 资源配额域）。
- **Acceptance：** 夹具：maxTurns=3 的循环在第 3 turn 边界停且事件/落盘齐全，`--resume` 可继续。；花费上限夹具同理。；不设预算时行为与现状 bit-for-bit 一致（回归）。
- **Validation：** 预算夹具 + 恢复续跑 + 无预算回归对照。
- **验证命令：** 实施前按 B4 冻结（预期 `pnpm vitest run packages/core/agent-loop`）。
- **真实任务证据：** E1；场景 S05 类（循环控制）。
- **规格缺口 / Task 化：** 默认值（turns/cost）maintainer 批。拆分：预算状态与事件（contract）→ loop 强制点（provider）→ headless 参数（consumer）→ 夹具（fault）。
- **上游避撞：** `packages/core` 月 303 commits——本项是小增量而非重构；实施前 diff 上游 agent-loop 是否已加 ceiling，已有则转移植。

### P9-08 — 任务成功率基准 v1：给"厉害"一个可回归的数字

- **Priority / Wave / 依赖：** P9 / W21 / P0-08、P7-09、P9-06（复用其 stream-json/退出码）。
- **问题 → 目标：** `BENCHMARK.md` 为 3 行占位；全仓无 pass-rate 基础设施（仅 1 个精心设计的反作弊单任务 e2e：`examples/headless-agent/tests/coding-task.e2e.ts`）。"像 Codex 一样厉害"当前不可证明、不可回归。 → 在 headless/SDK 之上建 20–50 个自动判分任务（真实 repo 修复/测试驱动/终端操作；可抽样 SWE-bench-lite、terminal-bench + 自建，以现有 coding-task e2e 的反作弊设计为模板），产出成功率/成本/时长基线报告并入 nightly。
- **Files：** target `BENCHMARK.md` [P]；`examples/headless-agent/tests/coding-task.e2e.ts` [B]；new `benchmarks/tasks/` [N]；`benchmarks/judge/` [N]；`scripts/benchmark/run.mjs` [N]；`scripts/benchmark/report.mjs` [N]；`.github/workflows/benchmark-nightly.yml` [N]。
- **MUST：** 判分确定性（测试通过/文件断言/exit code），禁 LLM-as-judge 做主判。；报告含 per-task 原始输出+判分依据+成本（token-meter）。；同一 SHA 双跑成功率方差 ≤ 冻结阈值。；无 key 时全套件显式 `BLOCKED` 不伪造；预算上限走决策 A5。；沿用 coding-task e2e 的反作弊要点（判分器对执行者不可见、防直接改判分文件）。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不追公开榜单可比口径；不在本项内做提升（P9-09）；不测安全/混沌（P7-10 已有）。
- **Acceptance：** 固定 SHA + 固定路由/模型上产出 ≥20 任务基线报告，双跑方差达标。；判分器负例（伪造输出/改判分文件）必须判 FAIL。；nightly 在 fork 真实跑通一次（成功或显式 BLOCKED-无 key，均为合法结果）。
- **Validation：** 双跑对比 + 判分负例 + 成本与 token-meter 核对。
- **验证命令：** 实施前按 B4 冻结（预期 `node scripts/benchmark/run.mjs --suite v1`）。
- **真实任务证据：** E6；场景 S13 类（评测面）；live lane 依预算批准。
- **规格缺口 / Task 化：** 任务集构成、方差阈值、预算上限三个数值 maintainer 批。拆分：runner+judge → 任务夹具（5–10 个/子任务分批）→ nightly 接线。

### P9-09 — 系统提示词准则 v1 + 评测驱动迭代（Champion–Challenger）

- **Priority / Wave / 依赖：** P9 / W22 / P9-08、P5-03、P7-10。
- **问题 → 目标：** 出货 persona 为空字符串（`cordis.patch.yml:432`），行为准则只散落在 per-tool 一句话提示；且没有机制证明任何 prompt 改动是变好而非变坏。 → 先写编码代理准则 v1（验证纪律、何时搜索、编辑策略、简洁性、失败上报诚实性——对齐 Codex/Claude Code 水位），再用 P9-08 基准做 champion–challenger：变体受版本控制、A/B 报告带显著性口径（沿用 Q3 Wilson 下界式规则）、按 P7-10 受控演化门晋级、回归即回滚。
- **Files：** target `packages/preset/persona` [P]；`packages/bundle/base/cordis.patch.yml` [P]；`packages/core/system-prompt` [B]；`packages/core/agent-tool-presentation` [B]；new `benchmarks/ab/` [N]；`scripts/benchmark/ab-compare.mjs` [N]；`benchmarks/ab/tests/ab-gate.spec.ts` [N]；`docs/engineering/prompt-iteration.md` [N]。
- **MUST：** 准则 v1 是受版本控制的完整声明，进默认 bundle。；每个 challenger 是完整 prompt/工具描述变体声明，禁运行时手改。；A/B 显著性达标才可晋级；晋级/否决与证据入 Evidence Package（P0-07 门）。；准则改动必须过 P9-08 基准回归门（分数不得显著降）。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 不做在线自动 prompt 演化（每次晋级人批）；不动模型参数策略（P5-02/04）；不做 per-vendor prompt 编译管道（P5-03 已有，本项产出作为其输入内容）。
- **Acceptance：** 准则 v1 落进默认 bundle 且 headless 冒烟不回归。；完成至少一轮真实 champion–challenger：变体/双方分数/显著性/决定记录齐全。；注入已知更差变体，门必须拒绝晋级。
- **Validation：** A/B 全流程演练 + 更差变体负例 + 报告复算 + 基准回归。
- **Validation 补充：** `ab-gate.spec.ts` 以 vitest 覆盖晋级门负例（更差变体拒晋、显著性不足拒晋、报告篡改检出），使本项具备标准 RED→GREEN 落点。
- **验证命令：** 实施前按 B4 冻结（预期 `pnpm vitest run benchmarks/ab/tests/ab-gate.spec.ts` + `node scripts/benchmark/ab-compare.mjs`）。
- **真实任务证据：** E6；场景 S13 类；live 预算另批。
- **规格缺口 / Task 化：** 显著性数值与单轮预算 maintainer 批。拆分：准则 v1（contract/内容）→ ab-compare（provider）→ 一轮真实演练（qualification）。
