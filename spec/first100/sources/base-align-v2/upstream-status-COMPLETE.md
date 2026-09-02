# BASE-ALIGN-v2 完整上游状态规格(109 + 新候选)——每个优化点对上游 4e84901e 的裁定

> **性质**: 这是"你 fork 同步到最新上游后,109 个优化点是否还正确/哪些部分覆盖/哪些全缺/有无新缺口"的**完整权威答案**,供 BASE-ALIGN-v2(W3 关账后重锚)时把 per-epic `upstreamStatus` + rescope delta 写进 registry。
> **来源**: gap 分析 workflow wf_de508756-1b2(100 base)+ P9 triage agent + 新-gap 扫描 agent + 我本人的 foundation-drift 机械穷举,全部只读核实、多处 gq-92 独立复验。
> **纪律**: 缩范围只删上游确实提供的、绝不丢真需求/绝不扩;新增 epic(P3-13)须用户批准(扩 109 范围=宪法级);重锚时逐条独立复审 + manifest-patch。
> **时机**: 现在只作 durable 可复核规格(不改 live registry);registry 变更在 BASE-ALIGN-v2 内做,不打扰执行会话当前 W3。
> **配套**: 23 base PARTIAL 的逐条 delta 见同目录 `base-align-v2-23-partial-rescope-spec.md`。

## 一、100 个 base epic(P0-01…P8-10)
- **0 个已被上游完整实现**(0 冗余)。
- **23 个部分覆盖 → 缩成 gap-over-upstream**(明细见 23-partial-rescope-spec):P3-03/05/07/12、P4-05/06/10/11/14、P5-07/08/09/10/11、P6-05/06/07/10、P8-02/03/05/07/10。
- **77 个仍全缺 → 原样照做**。
- **foundation 漂移(上游删了目标文件,需重新瞄准)**: 仅 **P3-07**(`packages/sandbox/sandbox-local/src/invariant.ts` + `packages/sandbox/sandbox/src/invariant.ts` 在上游已移除)——重锚时按 BLOCKED-012 重定位。其余 99 个 base epic 的 [B]/[P] 目标文件在上游仍在。

## 二、9 个 P9 扩展项(P9-01…09,对上游 triage)
- **P9-02(激活 pi-ai 多协议路由)≈ 冗余 → 大幅缩**: pi-ai 路由引擎(openai-completions/responses/anthropic-messages)+ web UI"添加自定义 provider"+ providers 文档**在基线就已 ship**;bundle 零路由是**故意默认**,非能力缺失。缩成薄可选项:默认路由模板 + conformance 门。**(纠正:这是我 8-30 版 P9 计划把 gap 高估了,与上游同步无关。)**
- **P9-01(conformance kit)= 部分**: 各 adapter 已有零散协议测试(llm-pi-ai/tests),缩成"抽可复用 kit + 注册门 + 补故障注入(SSE 单字节分帧/3 点 abort/超长拒绝/retry 分类映射)"。
- **P9-03(--model)= 部分**: 交互/web 切换已 ship,缩成只补 headless CLI `--model <route:model>` + CLI 选择的 session 事件。
- **P9-04/05/06/07/08/09 = 全缺,照做**(目标文件字节级即原计划描述,上游只有测试/tsconfig 微改):编辑容错回退 / 真 tokenizer / headless 脚本化 / loop 硬预算 / 任务成功率基准 / prompt 准则+A-B。

## 三、‼️ 新缺口(上游 414 commit 新造、109 未覆盖)——提案 **P3-13**,须用户批准
- **发现**: 上游把 CPython **code-runtime / PTC `run_code`** 从骨架建成了完整的**任意代码执行引擎**(~180 commit),且 **ptc preset 出货 = 一等模式**。
- **风险(已独立核实)**: 其 README 自认 **"not a security boundary, model code has bash-equivalent trust"**;`src/index.ts` 只 `child_process.spawn python3` + setrlimit,**无 Network/FileSystem/Process/Secret policy、无出口代理、无 unshare/sandbox**。程序体可直接 `import os/socket/subprocess` 触网触盘。而整个 P3 沙箱/ExecutionWorld 阶段(P3-01…12)**从没提过 code-runtime**(matrix 里 0 次命中),只 front `packages/sandbox` + shell。P0-05 只能开关它(kill switch 非硬化);P2 只 gate 其 nested tool 调用,**程序体的语言级 I/O 不经任何 gate**。
- **提案 P3-13 scope**: 把 code-runtime seam 纳入与 shell 同一套 ExecutionWorld 策略词汇——`run_code` 程序体必须在策略约束的 world 内执行(Network/FS/Process/Secret/Resource policy,非仅 rlimit),approval 策略化(非全有全无),JS worker-thread 变体的直接 module/IO 访问锁死。
- **状态**: PROPOSED — 扩 109 范围属宪法级,等用户批准;批准后作为 P3-13(或折进 P3-01 provider 集)在 W7/W8 附近排期。

## 四、范围扩展(delegate 可折入,非新 epic)
- **P3-04(网络出口代理)**: web-fetch 上游改为**默认开**,SSRF/出口面每会话都在;P3-04 acceptance 列了 browser/MCP/shell/plugin 出口但 files[] **不含** `packages/web/web-fetch-http`(一等 in-process HTTP 客户端)——重锚时把它显式纳入 P3-04 的受控出口。
- **P7-02 / P6-06**: PTC "只有外层 curated 结果进模型历史"——程序自我 curate 证据;P7-02(EvidenceCollector)/P6-06(tool-pairing)假设离散 tool 结果。已有 `PtcDispatchLog` 部分缓解,记 scope note 不单开 epic。

## 五、premise 需重新核对的既有 epic(重锚时验,非缺口)
- **P3-01(ExecutionWorld seam)**: 其"统一 shell/container/microVM/remote/browser 为一个可替换 policy-bound world"的前提**不含 code-runtime**;若照原样 ship 会把 code-runtime 留成未统一、未管控的 bash 通道——这正是 P3-13(或把 code-runtime 折进 P3-01 provider 集)的理由。
- **P5-10 / P5-05-06(subagent steer/continuation)**: 上游把相邻 agent 结果投递移到了 steer 通道(commit ec493c2db8),这些 epic 要扩展的 seam 被改过——重锚时重新核对其 files[] 目标。

## 六、呈现方式(不打扰执行会话)
1. 本文件 = 完整 durable 权威规格,vendored 进 `spec/first100/sources/base-align-v2/`(append-only,执行会话读得到、不撞它正改的 registry);
2. BASE-ALIGN-v2 时,执行会话据此给 registry 每个 epic 加 `upstreamStatus`(ALREADY/PARTIAL/MISSING)+ rescope delta 字段,并落 foundation-drift 重定位、范围扩展、premise 重核;
3. P3-13 待用户批准后加入 registry(新增第 110 项 / 或折进 P3-01)。
