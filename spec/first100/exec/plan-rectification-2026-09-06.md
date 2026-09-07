# First-100 计划整改令(2026-09-06)

**签发**:guanjieqiao-92(delegate,C7 常设委托 + C11 registry re-anchor 委托)
**执行**:dsh-first100-clean-ca,执行前按 C11 惯例向用户确认一次委托仍有效
**来源**:`First-100 造用账本`(artifact 2e874903,109 行 × 16 字段;**仓库镜像 `make-vs-use-ledger.json`**),2026-09-02 由 gq-92 用三路扫描(catalog 2937 / topic 13k / radar 17.5k)+ 扩展点实测生成
**对照**:`tests/first100/registry.json`(签发时 `dbeb6082a9`,21/101 ACCEPTED;之后的 registry 改动各带 provenance)

### 阅读指南(2026-09-06 14:09 EDT 加,只做导航,不改内容)

**流程入口是 `EPIC-LIFECYCLE.md`**(把所有规则按 epic 生命周期排序,只含指针)。本文件是**按日期追加的裁决日志**:§0–§6 是 09-06 上午签发的原令,§7–§9 是同日 13:10–14:05 EDT 的附录(先前误标"晚/深夜",已按提交时间改正)。**看某条 epic 该怎么做,不要读本文件——读 `make-vs-use-plan.md` 那张执行卡**,它把本文件所有适用于该 epic 的裁决叠加在一张卡上(派生生成,不会漏)。本文件只回答"为什么这么裁"。

| 要找什么 | 在哪 |
|---|---|
| 某条 planError 怎么改 registry | §2(29 条)+ §7.10(补漏 10 条) |
| 共用引擎 slice(Cedar / sandbox-runtime / OTel / attestation envelope) | §3.1–3.3 + §7.2 R1(= §3.4) |
| 执行顺序 | §4;开工第四问 §4.1 |
| 已验收 21 条的开源采用核验 | §7.1;裁决 §7.2 R1–R7;R6 判据 §7.9 |
| 标准词汇谁定形状 | §7.3 |
| P2-03 canonicalizer 终态 | **§7.8**(取代 §7.2 R2 与 §7.4 ①;§7.5 修正 §7.4 ⑤;§7.6 收敛归 R1) |
| 接一个开源库的步骤 | §8(九步 SOP) |
| 「可省代码」「社区覆盖」两列的用法 + 机械门 | §9 |

**引用约定**:§2 的七类写作 §2.A–§2.G(早期个别处写作 §A,同义)。

**已被后文取代的裁决**(原文保留,行内已标):§7.2 R2 与 §7.4 ① "换库" → §7.8 保留迭代实现 + 库作 oracle;§7.4 ⑤ "F 不动" → §7.5 F 也 supersede。

## 0. 这份文档做什么、不做什么

**做**:把造用账本里 29 条 `planError` 逐条落到 registry 的具体改动上,并把 3 个被多条 epic 共用的开源引擎定为"消费者到来之前先接入"的独立 slice。【14:15 EDT 标注:账本 planError 实为 **40** 条,补漏 10 条在 §7.10;共用引擎实为 **4** 个,第 4 个(attestation envelope)在 §3.4 → §7.2 R1】

**不做**:不改 110 的收录范围;不动任何已 ACCEPTED 的行;不预造任何 epic 的实现。【标注:"不动已 ACCEPTED 的行"指不重开格子、不改验收状态;R1(P0-07 attest.ts 改发 DSSE)与 R4(P1-01 校验缺陷在 P1-03 修)改的是代码,格子不动,与此不矛盾】

**为什么现在做**:P2-03 收后 P2-04 开,W5–W7 的 23 条随之进入管线。那 23 条里 11 条带 planError。**每条 planError 若在开工时才撞上,代价是一次 BLOCKED + 一次裁决 + 一次重锚(今天 P4-07 / P8-01 / P2-03 各花了 2–4 小时)。批量在此处裁完,是一天。**

## 1. 读原文后的分类(和账本的 planError 字段不完全一致)

账本标了 29 条。**对照 registry 当前措辞逐条读**后,29 条落成 7 类,其中 6 条已经解决、不需要动:

| 类 | 条数 | 动作 |
|---|---|---|
| A. 子句措辞要改 | 1 | P4-06 |
| B. 子句不动,加实现约束 | 4 | P3-09 · P3-11 · P1-06 · P2-07 |
| C. 缩范围(和上游/已有实现重复) | 6 | P5-07 · P5-08 · P5-03 · P4-14 · P7-07 · P2-10 |
| D. 热区改接法(files[] 变) | 5 | P3-01 · P3-05 · P3-07 · P5-05 · P5-06 |
| E. 代码级 must-fix(不改 registry) | 1 | P3-12 |
| F. 已解决,记录即可 | 6 | P8-02 · P8-08 · P8-09 · P5-10 · P2-03 · P4-05 |
| G. 开工前要定的设计决定 | 6 | P1-05 · P5-04 · P6-01 · P6-08 · P8-06 · P2-05 |

**分类判据**:改子句的条件是**子句字面要求了一个做不到的东西**;只加约束的条件是**子句字面没错,但实现路径里有一条会走错的岔路**。账本把这两类都标成 planError,registry 改动只落第一类。

## 2. 逐条整改

### A. 子句措辞要改

#### P4-06 · Durable Inbox / Outbox 与 Exactly-Once Effect Handoff(W5,BLOCKED_ON_ACCEPTANCE)

**账本 planError 原文**:P4-06 should say 'at-least-once + idempotent consumer' not 'exactly-once'; transactional outbox cannot use the storage KV seam (single-statement by design).

**registry 现状**:
- 标题含「Exactly-Once」
- must[0]「事务性写入 domain event 与 outbox」
- acc[0]「在 commit 前后、发送前后、ack 前后 kill,消息最终只产生一次业务 effect」

**执行者已在 BLOCKED-089 独立确认**:`commitWithOutbox` 是"一个 batch,弱于一个事务,而且这个缺口是真实的";恢复截断到最后一条完整记录,mid-batch 撕裂会留事件丢 outbox 行。**这正是 planError 说的"不能用 KV seam"的实证。**

**改动**:
```
标题    Durable Inbox / Outbox 与 Exactly-Once Effect Handoff
    →   Durable Inbox / Outbox 与 At-Least-Once 投递 + 幂等消费
must[0] 事务性写入 domain event 与 outbox
    →   domain event 与 outbox 行在同一 SQLite 事务(BEGIN IMMEDIATE)内写入,不经 storage KV seam
acc[0]  ……消息最终只产生一次业务 effect
    →   ……消息最终只产生一次业务 effect,由 consumer 按 (messageId, epoch) 幂等保证,不由传输保证 exactly-once
```
must[2]「consumer 按 message id/epoch 去重」不动——它就是幂等消费那一半,已经写对了。

**provenance**:`clauseProvenance` 记 `rewordedFrom`(原句)、`basis`(BLOCKED-089 + 本令 §A)。

**对锁的影响**:P4-06 现在的两把锁(agent-inbox 半边去重、后端批原子性)**第二把正是 must[0] 改措辞后的主体**——改完锁的解锁判据变成"BEGIN IMMEDIATE 事务落地且 mid-batch 撕裂用例证明事件与 outbox 行同生同灭"。

### B. 子句不动,加实现约束(写进 registry 的 `constraints[]` 或 epic note,不改 must/acceptance)

#### P3-09 · MicroVM / Remote ExecutionWorld 与 Attestation(W8)

**planError**:TPM/SEV-SNP attestation is not achievable with any keyless/local default — declare software attestation with explicit hardware:none.

**registry must[1]**:「Attestation 证明镜像、policy、tenant、network proxy 和 secret injection」——**字面没要求硬件**。

**约束**:attestation = provider 签名的 in-toto Statement(`predicateType: dsh/world-attestation/v1`),字段含 `hardware: "none"` 显式声明;acc[1]「伪造或过期 attestation 被拒绝」在软件签名上成立即可。**硬件证明(TPM/SEV-SNP)标为 provider 可选能力,不进本 epic 验收。**

**开源**:E2B SDK(已是依赖 2.29.1)作为 RemoteWorldClient 接口的镜像,不新造 wire protocol;microsandbox 作为 keyless 本地 microVM 的可选 provider。

#### P3-11 · ExecutionWorld Snapshot / Restore / Rollback(W11)

**planError**:CRIU process-state snapshots are not achievable as a keyless/local default — declare fs-only snapshots as the contract.

**registry must[0]**:「Snapshot 包含 world filesystem/content digests、provider metadata、running action boundary、secret references」——**已经是 fs-only**;"running action boundary" 是静默边界(must[1]),不是进程状态。

**约束**:确认 fs-only 是契约,写明"进程状态快照(CRIU)为 provider 可选能力,不进验收"。digest = git tree SHA(`write-tree` with private `GIT_INDEX_FILE`),不引入 folder-hash 类库。

#### P1-06 · 不可信插件 Out-of-Process Host(W8)

**planError**:isolated-vm / ShadowRealm / WASM (Extism, jco) do not fit npm-packaged Cordis plugins.

**registry must[0]**:「默认第三方插件在独立进程或 microVM 中运行」——**"独立进程"就是对的路径**;planError 警告的是三条会走错的岔路。

**约束**:隔离 = OS 进程 + `sandbox-local` 约束(landlock/seatbelt/bwrap 已在)+ `vscode-jsonrpc` over stdio(已在 lock 9.0.1)。**明确拒绝**:isolated-vm(维护模式,Node ≥20 要 `--no-node-snapshot`)、ShadowRealm(无 I/O 隔离)、`node --permission`(不限网络和 env,已实测)、WASM(不能宿主 Cordis `apply(ctx)` 插件)。

**另**:must[4]「插件 RPC 不能绕过 ActionManifest」是 2026-09-06 从 P2-03 must[2] 拆过来的(`splitFrom`),已带 provenance。

#### P2-07 · 持久化、可跨 Turn/进程的 Approval Queue(W8)

**planError**:Durable-execution engines cannot be P2-07's default (server/Postgres) — only optional P4-01 providers.

**registry files[]**:已是 `approval-store/src/sqlite.ts`,没有引擎依赖。

**约束**:默认实现 = `node:sqlite` 表 + CAS(`UPDATE … WHERE state='approved' AND revision=?` + `changes()==1`);Restate / Temporal / DBOS / pg-boss 一律不进默认、不进 CI,至多作 P4-01 的可选 provider。状态词汇采用 authzen access-request-approval profile。

### C. 缩范围(files[] 删重复项,子句不动或收窄)

#### P5-07 · Codex Adapter(W12,账本 deleted 65%)

**planError**:Lists 'new' continuation/map-events files for features the pinned SDK already ships.

**账本核实**:钉住的 `@openai/codex` 0.149.1 已有 thread/resume、thread/fork、turn/steer、turn/interrupt、thread/list、item/*/requestApproval。

**改动**:files[] 里的 `[N] continuation.ts` / `[N] map-events.ts` 删除;residual 收窄为:requestApproval 路由到父级 policy/user-approval seam(不走 unattendedDecision)、持久化 threadId、turn/steer 接 steer、diff/test/usage 收进 SubagentResult。**must 不动**——它们描述的是行为,行为仍要做,只是实现靠 SDK 而不是新文件。

#### P5-08 · Claude Code Adapter(W12,deleted 65%)

同 P5-07。钉住的 `@anthropic-ai/claude-agent-sdk` 0.3.241 已有 resume/continue/forkSession/canUseTool/hooks。**改动**:删 `[N]` 重复文件;residual 收窄为 canUseTool → 父级 policy、持久化 session_id、query.interrupt() → cancel、SDK subagent messages → SubagentResult。

**注**:P5-07/08 的 files[] 引用 `subagent/src/request.ts` / `result.ts`——这两个是 P5-05/P5-06 的 `[N]` 文件,现在不存在。**前置关系要显式**:P5-07/08 predecessors 含 P5-05/P5-06。核 registry 确认,缺则补。

#### P5-03 · 模型能力协商与 Provider-Specific Prompt Compiler(W11,deleted 45%)

**planError**:Planned packages/llm/prompt-compiler/src/compile.ts per provider already exists as pi-ai compat + llm-pi-ai/src/context.ts toPiContext + llm-deepseek/src/translate.ts.

**改动**:files[] 删 `prompt-compiler/src/compile.ts` 那类 per-provider 编译;residual 收窄为 PromptIR 类型 + 一个 IR→Message[] lowering 函数 + 子句保留 golden 测试。**pi-ai 的 compat flags 就是 adapter compiler。**

#### P4-14 · Partial-Turn Resume、Durable Schedule/Goal Trigger(W14)

**planError**:P4-14's turn-checkpoint package is mostly redundant with upstream session events + repair.ts — collapse to a resume classifier.

**改动**:files[] 里 `turn-checkpoint` 包删除;residual 收窄为 resume classifier——把 `repair.ts` 的 `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` 和 ActionLedger / WorkflowJournal 联起来判 continue / replay-pure / reconcile;trigger 事件作为 P4-06 的 outbox 行。

#### P7-07 · Causal Trace 与 Durable Telemetry Outbox(W13,deleted 40%)

**planError**:Plan creates packages/observability/otel-exporter while packages/session/session-telemetry-otel already is the OTel backend — add a TracerProvider pipeline there instead.

**改动**:files[] 删 `packages/observability/otel-exporter/*`;改为在 `packages/session/session-telemetry-otel` 内加 TracerProvider pipeline(`@opentelemetry/sdk-trace-base` 2.10 + `exporter-trace-otlp-http` + W3C propagator);语义约定用 `@opentelemetry/semantic-conventions` 1.43 的 `gen_ai.*`(已在 lock)。**不发 openinference 属性**(竞争规范)。durable outbox ≈250 LOC over node:sqlite,per-sink 表 + ack cursor。

#### P2-10 · Policy-as-Code、Explain 与 Dry Run(W7,deleted 60%)

**planError**:Do not ship the planned packages/policy/policy-language/src/{parser,compiler}.ts — a homemade policy language.

**改动**:files[] 删 `policy-language/src/parser.ts` / `compiler.ts`;引擎 = Cedar(见 §3);residual 收窄为 policy-set 版本钉住(text + schema digest)、shadow 求值经 P0-05 gate、历史 ActionManifest 回放 harness + impact diff、fail-closed loader。**explain = Cedar 的 `isAuthorized` diagnostics;dry-run = `isAuthorizedPartial` residuals。**

### D. 热区改接法(files[] 里的 `[B]` 热区文件换成 `[N]` 新 rung/plugin)

**判据**:上游活跃开发的文件(`sandbox-local/src`、`agent-loop/src`、`subagent/subagent/src`)不直接改,新能力作为新的 rung / plugin / contribution 挂进去。**P5-10 已经这么做了**(barrier 用 `addParticipant`,不预造 world/actions 接口),四格已绿,证明可行。

| epic | 现 files[] 里的热区 `[B]` | 改为 |
|---|---|---|
| **P3-01** W7 | `core/agent-loop/src/runtime-context.ts` | world handle 经 sandbox-policy 的 runtime-context **snapshot contribution** 模式挂入,loop 零改动 |
| **P3-05** W9 | `sandbox-local/src/index.ts` · `profiles.ts` | 新 `sandbox-srt` rung(`@anthropic-ai/sandbox-runtime` 的 linux/macos/windows utils),device vocabulary → per-platform 映射在新 rung 内 |
| **P3-07** W10 | 同上两文件 | 同上;上游已有 functional probes + refuse-not-warn,本 epic 加的是 attestation predicate schema + `requested ⊆ supported` 检查 |
| **P5-05** W9 | `subagent/src/descriptor.ts` · `descriptor-seed.ts` · `depth.ts` · `types.ts` · `client.ts`(5 个) | request 契约扩展作为 **capability flags per new field**,新字段进 `[N] request.ts`,`[B]` 只留 `types.ts` 一处 re-export |
| **P5-06** W11 | `subagent/src/assistant-output.ts` · `types.ts` · `lifecycle.ts` | result 契约扩展进 `[N] result.ts`,`[B]` 只留 `types.ts` |

**P5-05 是最重的**——5 个热区文件。缩到 1 个,其余走新文件 + 声明。

### E. 代码级 must-fix(不改 registry,写进 epic 的 preFlight)

#### P3-12 · Workspace 路径、附件准入与恶意输入边界强化(W8)

**planError**:attachment-local 在 `image.ts:93/116`、`normalization.ts:74`、`request-image.ts:89` 四处传 `limitInputPixels:false`,关掉了 sharp 默认的像素炸弹护栏(本会话核实);P3-12 应显式设上限而不是保持 false。

**动作**:P3-12 开工三问时,这四处是 must-fix 清单第一项。**不是新子句**——它落在既有的「附件进行 MIME sniff、大小/像素/解压比/嵌套深度/恶意宏与可执行检测」里,只是明确了当前实现在这一项上是**主动关掉护栏**,不是没做。

### F. 已解决(账本标了,registry 已修,记录即可)

| epic | planError 摘要 | 现状 |
|---|---|---|
| P8-02 · P8-08 · P8-09 | files[] 引用已删的 `packages/host/apiproxy` | **BASE-ALIGN-v2 已修**,本令核过:三条 files[] 里 `[B]/[P]` 路径全部存在 |
| P5-10 | 热区,land upstream first | **已完成**:barrier 用 addParticipant,四格绿,must[3] scheduled-BLOCKED |
| P2-03 | tools/pre-execute waterfall 先于 durable record | **在飞已修**:`appendActionManifest` 在 `appendToolCall` 内、`tool/call` 事件之前,按构造继承 |
| P4-05 | 依赖 P4-07 的 lease epoch(晚一个 wave) | **P4-07 已 ACCEPTED**;P4-05 现在的锁是另一件事(持久 lease store) |

### G. 开工前要定的设计决定(写进 epic preFlight,开工时按此走)

| epic | 决定 | 依据 |
|---|---|---|
| **P1-05** W9 | 动态扫描不用 `node --permission`(不限网络/env,已实测);动态扫描 = P1-06 host 的 record mode。静态用 `@nodesecure/js-x-ray` 16.0 + `ossf/malicious-packages` 语料验证 | planError |
| **P5-04** W11 | `llm/fallback` 事件必须是 **core 事件类型**——`dsh-llm-fallbacks #52` 证明插件声明的事件类型加载不了。断路器用 `cockatiel` 4.0,限流用 `rate-limiter-flexible` 11.2(RateLimiterMemory) | planError |
| **P6-01** W4 | Mem0 / Zep / Letta 只作可选 provider,其写入变成 MemoryProposal——它们的自动抽取和 P6-01 must「不绕过」矛盾 | planError;P6-01 四格已绿 |
| **P6-08** W9 | 不用 SQLCipher(要 better-sqlite3,重开 node:sqlite seam)、不用 keytar(archived)。用 Node WebCrypto AES-256-GCM / HKDF + `@noble/*`(已在)+ `@napi-rs/keyring` 1.3 | planError |
| **P8-06** W17 | 策略引擎**一次定**:Cedar。P2-10 / P2-05 / P2-08 / P8-06 / P8-09 五条 epic 共用一个引擎 | 见 §3 |
| **P2-05** W6 | 账本 planError 原文是「gated on BLOCKED-011 which the wave-6 schedule does not show」——**BLOCKED-011 已于 2026-09-01 DE-ESCALATED 并关闭**(三向量 vendor-free 闭合 + 机械门,残留降级为 known-limitation),排期不再受它约束。P2-05 剩下的开工前决定同上一行:Cedar 作为它的引擎,且它是 Cedar 的第一个消费者(§3.1 的 slice 排在它开工之前) | planError 已过时;§3.1 |

## 3. 三个共用引擎:消费者到来之前先接入【14:15 EDT 标注:现为四个,§3.4 见下】

**原则**:一个开源引擎被 ≥2 条 epic 消费,且第一个消费者到来时它还没接入,第一个消费者会自造一个,后面的再迁——**两份实现在任一方改动的第一天就分叉**。所以在第一个消费者开工前,作为独立 slice 接入。

### 3.1 Cedar(`@cedar-policy/cedar-wasm` 4.12.0)

**消费者**:P2-05(W6,第一个)· P2-10(W7)· P2-08(W9)· P8-06(W17)· P8-09(W18)
**账本核实**:forbid overrides permit、default deny、matched-policy explain、no I/O、partial eval——本地验过。13 MB unpacked / 4.3 MB wasm。Lean 证明的 authorizer(cedar-spec)。
**被拒的替代**:OPA(npm 只 eval Go 编译的 wasm,2024-11 停更)、casbin(表达式字符串无 schema)、casl(应用级无 explain)、oso(库已弃用)、OpenFGA/SpiceDB/Keto(ReBAC server,违背本地默认)。

**slice 交付**:
1. `packages/policy/policy-engine-cedar`(provider)——`decide(policySet, schema, entities, request) → {decision, diagnostics, residual}`
2. `ctx.policy` Service Definition(定义层)——`decide(manifest, identity, token, world, facts)`,provider 中立
3. conformance:forbid > permit、default deny、explain 含 matched policy id、partial eval 返回 residual
4. **不做**:任何 dsh 的策略内容、PEP 接线(那是 P2-05 的)

**时机**:P2-03 收之后、P2-05 开之前。

### 3.2 sandbox-runtime(`@anthropic-ai/sandbox-runtime`)

**消费者**:P3-04(W9,egress proxy,deleted 65%)· P3-05(W9)· P3-07(W10)· 整个 P3 族(13 条,0 开工)
**账本核实**:linux(bwrap `--unshare-net` + seccomp unix-socket block)、macos(SBPL unix-socket allowlist、mach-lookup)、windows(srt-sandbox user + WFP + ACEs)。
**地基已在**:2026-09-06 CI runner 装了 bubblewrap + AppArmor sysctl,产品的 `sandbox-local` bwrap profile 在 CI 上能跑。

**slice 交付**:
1. `packages/sandbox/sandbox-srt`(新 rung,不碰 `sandbox-local/src`)——把 sandbox-runtime 的三平台 utils 作为一个 provider 挂进现有 runner 选择(`linux: ['bwrap','landlock']` 那张表加 `'srt'`)
2. `supportedPolicyFeatures` 声明(P3-13 规格已要求的那个声明制)
3. conformance:对 sandbox-runtime 自带的 e2e fixtures 跑一遍,作为 P3-07 的 escape corpus 种子

**时机**:W7 开之前(P3-01 在 W7)。

### 3.3 OpenTelemetry(用已有的 `packages/session/session-telemetry-otel`)【§7.11:落地时点由 W12 前改为 **W11 前**——P5-03/P5-06(W11)先于 P6-05/P7-07 发 gen_ai.usage.*】

**消费者**:P7-07(W13)· P6-05(W12)· P8-09 export(W18)
**不是新接入,是不新建**:计划里的 `packages/observability/otel-exporter` 删掉,TracerProvider pipeline 加在已有包里。

**slice 交付**:
1. `session-telemetry-otel` 内加 TracerProvider + OTLP HTTP exporter + W3C propagator(依赖 `@opentelemetry/sdk-trace-base` 2.10、`exporter-trace-otlp-http` 0.221、`context-async-hooks` 2.11)
2. 语义约定固定为 `gen_ai.*`(`@opentelemetry/semantic-conventions` 1.43 已在 lock)
3. **不做**:durable outbox(那是 P7-07 的)、任何 sink(Langfuse / Phoenix / LangSmith 都是部署级可选,不进依赖)

**时机**:W12 开之前。**最不急的一个**,但要在 §C 的 P7-07 缩范围时一并把 files[] 指向这里。

### 3.4 attestation envelope(in-toto Statement v1 + DSSE)——13:10 EDT 由 §7.2 R1 增设

正文在 **§7.2 R1**:`packages/attestation/envelope`(contract 层小包:Statement zod schema + DSSE PAE + verify 走 kernel signatureRoots,signer 可插);**P4-04 开工前落地**;P0-07 的 `attest.ts` 改发 Statement+DSSE、`canonicalJson` 收敛(§7.6);15 条消费者见 §7.3 第一行。SOP 见 §8。

### 其余 PROVIDER_ADAPT(各服务一条 epic,到 epic 自己开工时接,不需要提前)

pnpm(P1-03/P1-04)· js-x-ray(P1-05)· vscode-jsonrpc(P1-06)· E2B(P3-09)· dockerode(P3-08)· git plumbing(P3-11)· cockatiel + rate-limiter-flexible(P5-04)· WebCrypto + noble + keyring(P6-08)· cacache(P7-02)· jose + openid-client(P8-06)· zod(P8-07)· file-type + yauzl(P3-12)

### 账本建议已被事实超越的一条:P2-02(Biscuit,账本 deleted 65%)

账本 2026-09-02 建议 P2-02 接 `eclipse-biscuit/biscuit`。**P2-02 在本令签发时已四格全绿**(C/P/U 于 09-05,F 于 09-06),自有的 capability-token 实现经双向变异证明;它的锁在 vendored Cordis `Fiber` 修复(Option A),与 token 格式无关。**此时改接 Biscuit 是用一段未验证的接线替换一段已验证的实现,不做。** 记在此处是为了让"17 条 PROVIDER_ADAPT 里有 16 条在本令内"这个数字有出处——第 17 条不是漏,是过期。

## 4. 执行顺序

```
① registry 改动(一个提交,走 pinned source re-extract,verify-specs 过)
     A  P4-06 三处措辞
     C  六条 files[] 缩范围
     D  五条 files[] 热区换新文件
     B/G  写进各 epic 的 constraints / preFlight(registry 字段或 clause-subject-audit.json 的 preFlight)
     F  BLOCKED-QUEUE 记一条「planError 清账」,列六条已解决
   → C11 惯例:执行前向用户确认一次委托仍有效

② P2-03 收 → P2-04 开(管线动)

③ §3.1 Cedar slice(P2-05 开之前)

④ W5–W7 按波走;每条 epic 开工时四问(见 §4.1),preFlight 先读本令对应条目

⑤ §3.2 sandbox-srt slice(W7 开之前)

⑥ §3.3 OTel pipeline(W12 开之前)
```

**14:15 EDT 增补(原块保留,以下为现行顺序,与上块冲突处以此为准)**:

```
②′ P2-03:R2 整改(§7.8 终态)→ C+F 重观测 → 四谓词 → 签 → P2-04 开        ← 现在在这里
②″ P2-04 preFlight 之前:执行者建 §9.1 的 verify-make-vs-use 门(进 registry gate set)
③  §3.1 Cedar slice(P2-05 开之前;preFlight 已在 clause-subject-audit.json:SLICE-3.1-cedar)
④  W5–W7 按波走;每条 epic 开工:三问 + 第四问(§4.1)+ §8 SOP + §9.2 缺口核对
⑤  §3.2 sandbox-srt slice(W7 开之前;同时把 sandbox-local PLATFORM_CHAINS 改成 contribution point)
⑤′ §3.4 attestation envelope slice(P4-04 开之前;含 P0-07 attest.ts 改发 DSSE)
⑥  §3.3 OTel pipeline(W11 开之前——§7.11 由 W12 提前;P5-03/P5-06 是 W11)
已完成的一次性项:P9-08 路径修正(6b110e275a)、P2-03 manifest 层非 JSON 拒绝(6b110e275a)
```

### 4.1 开工第四问:这条 epic 账本判的是造还是用?(自 P2-04 起为标准动作)

前三问(BLOCKED-101):主体在不在执行路径上 / 冻结挂哪 / 每条子句的主体是什么。**第四问在三问之后、第一行代码之前**,答案写进 `clause-subject-audit.json` 该 epic 的 `preFlight.makeVsUse` 字段:`{ verdict, adopted: [...], residual }`【字段规范已扩,**唯一规范在执行卡 §0**,此处只是最初三字段】。

**来源**:造用账本(artifact `2e874903`;**仓库副本 `spec/first100/exec/make-vs-use-ledger.json`,`rows[].id` 索引,2026-09-06 13:40 EDT 落盘,此前只在 artifact 和 /tmp**)该 epic **整行 16 个字段**,不是两列。开工时必读并逐项回答的七个:`verdict` **和 `verdictSecondary`**(80/109 行有第二判定——"CONTRACT_WRITE + PROVIDER_ADAPT" 意思是契约自己写、provider 接开源,两半分开答)/ `oss[]` 里 `role: adapt` 的每一条**及其 `note`**(note 是接法,不是介绍)/ **`standards[]`**(71/109 行有;是绑定词汇,见 §7.3)/ **`risk`**(109/109 行有;里面有具体禁令,例:P2-03 "do not write a second canonicalizer")/ `residual`(接完还要自己写什么)/ `deletedPct` / `community`(只作设计参考,不接——CATALOG_ADOPT 为 0 已对抗复核)。**账本是判定不是建议**:三路扫描(catalog 2937 / topic 13k / radar 17.5k)+ 扩展点实测。开工时读它,不重判;**账本与 registry 冲突时先问 delegate,不自选。**(2026-09-06 13:10 EDT 修订:本段原只列四个字段,§7 记录了只读四字段造成的漏检。)

| verdict | 动作 |
|---|---|
| `PROVIDER_ADAPT` | **用。** 只接 `oss[]` 里 `role: adapt` 的那条,按其 `note` 接;`residual` 写的是接完还剩什么要自己写 |
| `PROVIDER_ADAPT` 但库有**有记录的硬约束**不能进运行时 | **oracle 形态**(§7.8):库进 devDependencies 作差分测试 oracle,手写实现"经测试与标准一致";硬约束必须能被一条冻结用例复现 |
| `PROVIDER_ADAPT` 但已验收且手写在跑 | **不重写**(§7.9 判据:AST 级覆盖 / 规则逻辑库不提供 / 无下游传播);记为"账本判 adapt 未采用",不算整改项 |
| `REUSE_UPSTREAM` | **先核上游,再决定。** 上游已有 → 只核缺口 + 接线(缺口在 `spec/first100/sources/base-align-v2/23-partial-rescope-spec.md`);上游经核实**没有**该原语(P5-11:agent-team 无 claim/lease,§7.10)→ 写,并把核实结果记进 preFlight。原文"不写"过于绝对,14:15 EDT 改 |
| `CONTRACT_WRITE` / `PROVIDER_WRITE` / `CONSUMER_WRITE` | **写。** 账本找过,没有合适的开源;契约和定义本来就没有 |
| `KERNEL_WRITE` | **写。** 仅 P0-02 |
| 无判定(P3-13 及任何后续收录) | 开工时补一次:**只有我们定义的 → 写;公认难题且失败模式静默 → 用**,用的话过下面四道过滤 |

**`role` 的含义**:`adapt` 接进依赖;`optional` 不进依赖,至多作可选 provider 且不进 CI;`reject` 不接(原因在条目里);`reference` 只读设计。**`reject` 的比 `adapt` 的多**,原因全是仓库自己的约束——外部 daemon 不当默认(keyless CI、自包含)、不开第二个 seam(SQLCipher 重开 node:sqlite、trpc 是第三个 RPC、BAML 是第二个 IR)、许可证(AGPL 不嵌入)、维护状态(archived / deprecated)。

**验收标准不因用开源而降。** 四谓词 + 双向变异验的是**我们写的接线**:fail-closed 有没有、配置从哪来、策略谁强制、降级路径有没有。**P1-02 是模板**——sigstore-js 做密码学,我们的用例测"未注册签发者拒不拒 / trusted root 从哪来 / 身份由 verifier 自己的 policy 强制 / 离线用 bundle 内含证明不降级"。**库的内部由库自己的套件验,不重验。**

**两个不许犯的错**:
1. **包一层库就叫做完。** 子句的主体必须在我们的代码里——adapter、fail-closed 检查、conformance 用例。"接了 Cedar" ≠ P2-05 做完;"`decide()` 在 forbid > permit 上 fail-closed 且 explain 带 matched policy id" 才是。
2. **接一个"第二份声明"。** 手写 schema 而 surface 是源(P8-01 的教训);Cedar 已是引擎再接一个策略语言 parser(P2-10 的 planError)。

**必须自己写的,不因"复用"动摇**:内核六样(根身份 / 签名根 / 策略执行入口 / 审计 append / secret broker / sandbox attestation)、全部 contract 与 definition(第 2 层)、账本判 WRITE 的 32 条。**没有开源,不是因为没找,是因为它们是这个程序的身份。**

## 5. 验证

- **registry 改动**:`first100:verify-specs` 9 产物字节一致;`extract-registry --check` 字节一致;每条改动带 `clauseProvenance`(`rewordedFrom` / `filesReducedFrom` / `hotZoneRelocatedFrom`,措辞由执行者按现有 provenance 形状定);`renderClauseCoverageReport` 100/100 不掉
- **三个 slice**:各自过独立 Reviewer(BLOCKED-010 五视角)+ conformance 用例 + 双向变异证明;**不挂任何 epic 的格子**,作为 infra slice 记在 EXEC-STATE
- **本令的落地本身**:执行者在 registry 提交里引用本文件路径;§0–§6 不再改写,后续只允许**追加带日期的附录章节**(§7 起),其余变更走 BLOCKED-QUEUE 追加

## 6. 本令不覆盖的【14:15 EDT 标注:本节写于 §7–§9 之前。下列各行现已被 §7.3(标准词汇所有权)、§8(SOP)、§9.2(缺口核对)**横向覆盖**——不覆盖的只是"不改它们的 registry 子句",不是"开工时没有规矩"】

- **REUSE_UPSTREAM 中无 planError 的 10 条**(P3-03 · P4-10 · P4-11 · P5-09 · P6-06 · P6-10 · P7-08 · P8-03 · P8-05 · P8-10):账本判定"上游已有部分实现",**BASE-ALIGN-v2(2026-09-03)已按 gap-over-upstream 逐条缩范围**(`spec/first100/sources/base-align-v2/23-partial-rescope-spec.md`),registry 现在的 must/files 就是缩后的缺口。本令不再动;开工三问时读 rescope spec 的对应条目即可。
- **CONTRACT_WRITE / PROVIDER_WRITE / CONSUMER_WRITE 中无 planError 的**:契约和 provider 要自己写,账本没有开源替代,计划没错,不在本令范围。
- **P3-13**(PTC 后端策略绑定,W7/W8):**不在造用账本里**——账本 2026-09-02 生成时 P3-13 同日才由用户批准收录(109→110)。它没有 verdict / oss / deletedPct。**开工三问时补一次单条 make-vs-use 判断**:它接的是 P3-01/02/04/08/10 已建的 ExecutionWorld + 策略设施(组合不是从头造),预期 verdict = CONSUMER_WRITE,依赖 §3.2 的 sandbox-runtime rung。
- **R10**(131 slice,W19 后串行)——另议
- **P9-08 / P9-09**(PREMATURE,R10 后)
- **7 条已验收行的灵敏度回填**(已下令,等冻结表稳定)
- **BLOCKED-124**(14 对双语文档,等用户 `/dsh-translate-docs`)

## 7. 附录(2026-09-06 13:10 EDT):台账全字段核验——只读两列造成的漏检

### 7.0 漏了什么

§1–§4 只用了账本的 `verdict` / `oss[]` / `deletedPct` / `residual` / `planError`。账本每行 16 个字段,漏读的四个各有后果:

| 漏读字段 | 覆盖 | 后果 |
|---|---|---|
| `verdictSecondary` | 80/109 行 | "CONTRACT_WRITE + PROVIDER_ADAPT"被我按主判定归为"写",副判定要接的开源没进 §2/§3 |
| `standards[]` | 71/109 行 | **标准词汇一条都没进整改令**。它们不是库,是字段名/信封形状/URI 格式——先采用者定了,下游 5–15 条 epic 照抄;先采用者没定,下游各自发明 |
| `risk` | 109/109 行 | 里面有针对该 epic 的具体禁令。P2-03:"**do not write a second canonicalizer**"——执行者写了第四份 |
| `community` | 47 行覆盖 ≥30% | 只作设计参考(CATALOG_ADOPT=0 已对抗复核);漏读无直接后果 |

用户先前问"前面的 20 个是不是不用管了",我答"不用"。**按全字段核,答错了两条(P0-01 / P0-07),另有八条词汇债、一条代码缺陷。**下面是逐条核验。

### 7.1 已验收 21 条逐条核验

方法:在 `fork/first100-exec@7993092f79` 上 grep **源码 import**(不是 package.json——根 `package.json` 用 `**/` 通配匹配不稳,已校准)和标准词汇;每组 grep 带阳性对照(`from 'vitest'`=957 / `export class`=389)。

| ID | 主+副判定 | adapt 级 OSS → 实际 | standards → 实际 | 结论 |
|---|---|---|---|---|
| P0-01 | CONSUMER_WRITE + CONTRACT_WRITE | in-toto Statement:**0** | ResourceDescriptor:**0** | **整改-传播**(§7.2 R1) |
| P0-02 | KERNEL_WRITE | `@noble/hashes` ✓ | SPIFFE URI:0 | 词汇债 → P8-06 |
| P0-03 | PROVIDER_ADAPT + PROVIDER_WRITE | dependency-cruiser:**0**(手写图检查器) | — | 沉没成本,不重写(R6) |
| P0-04 | PROVIDER_ADAPT + REUSE_UPSTREAM | dependency-cruiser:**0** | — | 同上 |
| P0-05 | PROVIDER_WRITE + CONTRACT_WRITE | 无 adapt(全 reject) | OpenFeature(optional):1 提及 | OK |
| P0-06 | CONTRACT_WRITE | zod ✓ · ajv ✓(2) | ~~2020-12/toJSONSchema ✓(5)~~【误归,命中在 typert/registry 与 plugin-manifest;schema-registry 无 JSON Schema 输出,见 §7.10】;Confluent 词汇:0 | **planError 未解决**(§7.10)+ 词汇债 → P8-07 |
| P0-07 | CONTRACT_WRITE + PROVIDER_ADAPT | in-toto/DSSE/SLSA:**0**;`@sigstore/sign`:**0** | 四项标准全 **0**;`scripts/first100/attest.ts` 自造信封 + 自写 `canonicalJson` | **整改-传播**(R1) |
| P0-08 | QUALIFICATION_REUSE + REUSE_UPSTREAM | fast-check ✓(9 文件);harbor:0 | — | harbor 归 P9-08(它的 adapt 也是 harbor) |
| P1-01 | CONTRACT_WRITE | semver:**0**——`dshVersionRange` 只查"是字符串"(`plugin-manifest/src/validate.ts:393`),任意垃圾串通过 | VS Code / MV3 词汇:0 | **代码缺陷**(R4) |
| P1-02 | PROVIDER_ADAPT + CONTRACT_WRITE | `@sigstore/verify`+`bundle` ✓;tuf-js:0(仅 README);CycloneDX:0 | Sigstore bundle ✓;in-toto/SLSA/CycloneDX:0 | 半做:SBOM 与 SLSA provenance 未建,账本 residual 已列;→ P1-03/P1-12 开工时接(R5) |
| P1-07 | PROVIDER_WRITE + CONTRACT_WRITE | realpath ✓ | 状态名 `untrusted/trusted-read/trusted-execute`(账本 residual 自己提的);safe.directory:0 | OK |
| P1-08 | PROVIDER_ADAPT + PROVIDER_WRITE | semver:**0** → 自定整数 `runtimeApiRange{min,max}`;fast-check ✓ | — | 设计偏离但自洽(API level 语义,非 semver);记录不改(R7) |
| P1-09 | CONSUMER_WRITE + QUALIFICATION_REUSE | fast-check ✓ | 保留 scope 词汇:0 | 词汇债(轻) |
| P2-01 | CONTRACT_WRITE | — | SPIFFE:0(`PrincipalId` 是裸 brand 串);RFC 8693 act:0;`enduser.id`:0 | 词汇债 → P8-06(SPIFFE)/ P7-07(OTel) |
| P4-01 | PROVIDER_WRITE + CONTRACT_WRITE | — | CloudEvents:0(字段 `id/runId/seq/occurredAt/fromState/toState`);A2A:0 | 词汇债 → P8-05 拥有映射层 |
| P4-07 | PROVIDER_WRITE + QUALIFICATION_REUSE | fast-check ✓;fake-timers:0 → 注入时钟(等价) | fencing ✓(8) | OK |
| P4-08 | PROVIDER_WRITE | 全 reject | — | OK |
| P5-11 | REUSE_UPSTREAM + PROVIDER_WRITE | `experimental/agent-team` 未复用 → 新建 `collaboration/{taskboard,mailbox,blackboard}`;**核实 agent-team 2452 行里 claim/lease/taskboard 0 提及,不是重复造** | PROV 词汇:0(blackboard 有 `provenance` 字段但内含 `author/source`) | 词汇债 → P7-04 |
| P6-02 | CONTRACT_WRITE + QUALIFICATION_REUSE | fast-check ✓ | PROV:0(`relations` 用 `'derived'/'supersedes'`);bitemporal 半(`validFrom/validUntil` 有,transaction-time 无);DPV:0(有 `purpose/sensitivity` 字段) | 词汇债 → P6-03 拥有 |
| P6-07 | REUSE_UPSTREAM + PROVIDER_WRITE | keyset ✓;fast-check ✓ | — | OK |
| P8-01 | CONTRACT_WRITE + REUSE_UPSTREAM | canonicalize:0(`schema-fingerprint.ts` 手排 name);semver:0;zod ✓;noble ✓ | `protocolVersion` ✓(25);JCS:0 | fingerprint 只 hash 自家 surface、不外发比对 → 可接受;记录(R7) |

**汇总**:OK 7 · 词汇债 8 · 整改-传播 2(P0-01 / P0-07)· 代码缺陷 1(P1-01)· 半做 1(P1-02)· 沉没成本 2(P0-03/04)· 设计偏离记录 2(P1-08 / P8-01)。

**P2-03(在途,未签)**:`action-manifest/src/canonicalize.ts` 手写第四份 canonical JSON(另三份:`attest.ts` / `session-snapshot/suite.ts` / `repeat-tool-reminder`),且对**值和 key**都做 NFC 归一化(`:76` `:89`)。RFC 8785 不归一化 Unicode。后果:macOS 路径是 NFD,`é`(NFC)与 `é`(NFD)是**两个文件**;归一化后同 hash → P2-06 把审批绑到 argumentsHash 时,批准一个路径等于批准另一个。这是 validation[2] 禁止的"hash 混淆",只是方向相反。P8-07 Python SDK 用标准 JCS 库(`rfc8785`)算出的 hash 也会和 TS 不一致。→ R2。

### 7.2 裁决

- **R1 · §3.4 新增共用引擎:attestation envelope(in-toto Statement v1 + DSSE)。** 传播最广的标准(15 条未开工 epic 消费:P1-11/12 · P2-03 · P3-07/09 · P4-04/09 · P6-08/09 · P7-01/02/04/05/10 · P8-10),本该由 P0-01/P0-07/P1-02 定下,三条采用数为 0。in-toto 是 spec 无 npm;DSSE PAE 编码十行。做法:contract 层小包 `packages/attestation/envelope`——`Statement` zod schema(`_type/subject[]/predicateType/predicate`,subject 用 ResourceDescriptor)、`dsseEnvelope(payloadType, payload, signer)` 按 spec 做 PAE、verify 走 P0-02 kernel `signatureRoots`;signer 可插(现在 kernel Ed25519,发布走 P1-02 的 Sigstore 验证器)。**P0-07 的 `attest.ts` 改为发 Statement+DSSE、`canonicalJson` 换 §R2 的库**——账本 risk 已判"reshape 可接受,evidence package 是 per-run 产物";P0-01 的 fingerprint 表示对齐 `subject[]`。**落地时点:P4-04 开工前**(最早要 DSSE 签名的消费者);不重开 P0-01/P0-07 的格子,作为 infra slice 记 EXEC-STATE,P0-07 的 evidence 用例随 slice 重观测。
- **R2 · P2-03 签发前整改(执行者动作,§7.4)。**【“换库”部分已由 §7.8 取代:保留迭代实现,库作 devDep 差分 oracle;其余(删 NFC / 措辞 / supersede)仍有效】 `canonicalizeArguments` 换 `canonicalize`(erdtman,RFC 8785 参考实现,已在 lock 里作 sigstore 传递依赖);去掉值与 key 的 NFC;fuzz 套件保留但改为**对库的 conformance**(性质:key 顺序 / 数字拼写 / `é` 与 `é` 字面等价 → 同 hash;NFC≠NFD → **不同** hash)。validation[2] 措辞按 C11 A 类由我改(§7.4 给原文)。C 阶段冻结用例 supersede,重观测;U/U.1/F 不动。另三份手写 canonicalJson:`attest.ts` 随 R1 换;`session-snapshot` / `repeat-tool-reminder` 不做安全绑定,不动,记 BLOCKED-QUEUE。
- **R3 · 词汇债不重开已验收行;"首个跨线消费者"拥有对齐。**【所有权归属四处有误,已由 §7.11 修订;规则本身不变】 规则:词汇在**第一次跨进程/跨语言/跨系统**时必须是标准名,内部字段名可保留但要有单向映射函数并冻结用例。所有权:SPIFFE → P8-06;CloudEvents → P8-05(P4-06 的 dedup-on-id 可直接用现有 `id`);PROV-DM → P7-04(ClaimGraph)与 P6-03;Confluent 兼容词汇 → P8-07;OTel `enduser.id`/`gen_ai.*` → P7-07。写进各拥有者 epic 的 `preFlight.makeVsUse.standardsOwned`。
- **R4 · P1-01 代码缺陷:`dshVersionRange` 未校验。** E 类(不改 registry)。挂到 P1-03(lockfile 本来要解析 range):加 `semver.validRange`,无效即 manifest 拒绝;冻结一个 `dshVersionRange: "not a range"` 被拒的用例。
- **R5 · P1-02 半做部分**(SBOM/CycloneDX、SLSA provenance、tuf-js 根更新)归 P1-03(lockfile 与 SBOM 同源)与 P1-12(信任等级要 SLSA level)。不重开 P1-02。
- **R6 · P0-03/P0-04 不重写。** 手写检查器在跑、有变异证明、无下游传播;为 deletedPct 重写等于拿工作的东西换风险。记录为"账本判 adapt 未采用"的两条,**不算整改项**。
- **R7 · P1-08 整数 API level、P8-01 手排 fingerprint:记录不改。** 前者是自洽的另一种版本语义(账本推荐 semver 是默认不是必须);后者只 hash 自家 surface 且不外发比对。若 P8-07 Python 端需要复算 fingerprint,届时换 JCS(R3 规则自动触发)。

### 7.3 标准词汇传播链(从账本算的,不是记忆)【历史:所有权列按 registry 顺序取,已被 §7.11 修订;**现行唯一所有权表是执行卡 §1**(数据驱动)】

"首个采用者"按 registry 顺序;**已验收采用者**列里的行是 §7.1 核过的:

| 标准族 | 首个采用者 | 已验收采用者(实际采用?) | 未开工消费者 |
|---|---|---|---|
| in-toto / DSSE / SLSA | P0-01 | P0-01 ✗ · P0-07 ✗ · P1-02 半 | P1-11 P1-12 P2-03 P3-07 P3-09 P4-04 P4-09 P6-08 P6-09 P7-01 P7-02 P7-04 P7-05 P7-10 P8-10 |
| RFC 8785 JCS | P2-03 | P8-01 △(自家 surface) | **P2-03(在途)** P4-03 P4-04 P7-01 P7-05 P8-09 |
| OTel semconv | P2-01 | P2-01 ✗ | P3-03 P3-10 P5-03 P5-06 P6-05 P7-07 P8-09 |
| JSON Schema 2020-12 | P0-06 | P0-06 ✓ · P1-01 ✓ | P2-11 P4-02 P5-03 P5-05 P7-01 P8-07 |
| MCP(ToolAnnotations / initialize / elicitation) | P2-03 | P4-01 ✓ · P8-01 ✓ | P2-03 P2-04 P2-12 P4-05 P8-04 |
| ACP | P2-06 | — | P2-06 P2-07 P2-12 P5-06 P5-09 P8-04 |
| OCI runtime-spec / image-spec | P3-01 | — | P3-01 P3-02 P3-08 P3-10 P5-05 P6-09 |
| A2A | P4-01 | P4-01 ✗ | P4-05 P5-05 P5-06 |
| CloudEvents | P4-01 | P4-01 ✗ | P4-06 P8-04 P8-05 |
| SPIFFE | P0-02 | P0-02 ✗ · P2-01 ✗ | P3-06 P3-09 P8-06 |
| AuthZEN | P2-03 | — | P2-03 P2-05 P2-07 |
| W3C PROV-DM | P5-11 | P5-11 ✗ · P6-02 ✗ | P6-09 P7-04 |
| RFC 6902 JSON Patch | P4-13 | — | P4-13 P7-08 |
| Idempotency-Key / K8s 资源模型 / W3C DPV / OpenFeature | P4-12 / P8-02 / P6-02 / P0-05 | — / — / ✗ / △ | P8-03 / P8-03 / P6-10 / P7-10 |

**规则(写进 §4.1 第四问)**:一条 epic 开工时,它 `standards[]` 里的每个词汇,先查这张表——**自己是首个采用者就定形状并冻结一个 schema 用例;不是就 import 首个采用者的定义,不得再声明一份**(这是 §4.1 "第二份声明"错误的标准版)。

### 7.4 P2-03 整改令(给执行者)

1. 【已由 §7.8 取代——不换库,保留迭代实现并删 NFC;库进 devDependencies 作差分 oracle】`packages/action/action-manifest/src/canonicalize.ts`:`canonicalizeArguments` 改为 `import canonicalize from 'canonicalize'` 后直接调用;删除 NFC 归一化、迭代栈实现、以及"retained copy of the recursive form"的等价测试(库的正确性由库自己的套件验,§4.1)。`canonicalize` 加进 `action-manifest/package.json` 直接依赖(已在 lock 作传递依赖,版本 2.1.0;账本注 4.0.0 ESM 亦可,由执行者按仓库 ESM 约定选,**理由写进 preFlight**)。
2. 值域声明:JSON only(`JsonValue`),非有限数与 bigint 在进入 `createActionManifest` 前拒绝(账本 risk:"JCS forbids non-finite numbers and big ints — define the argument value domain explicitly")。冻结一个拒绝用例。
3. conformance 用例(替换现 fuzz 里的等价断言):(a) key 顺序不同 → 同 hash;(b) `1.0` / `1` / `1e0` → 同 hash;(c) `"é"` 与 `"é"` 字面 → 同 hash;(d) **NFC `é` 与 NFD `é` → 不同 hash**(这条是安全边界,必须冻结并做变异:把 (d) 断言反向,套件必须红)。
4. registry P2-03 validation[2] 措辞(C11 A 类,delegate 裁决,`rewordedFrom` 记原文):
   - 原:「fuzz canonicalizer,禁止 key order/Unicode/number 表示导致 hash 混淆。」
   - 新:「canonicalizer 遵循 RFC 8785(JCS):key 顺序、数字拼写、JSON 转义拼写(`é` 与字面 `é`)不同的同一 JSON 值得到相同 hash;不同 code point 序列(含 NFC 与 NFD)是不同值,必须得到不同 hash。fuzz 覆盖以上四类。」
   - 计入 `planCorrectedClauses`(用户规则:reword 单独计数)。
5. 冻结:C 阶段受影响用例 **supersede**(替换,BLOCKED-103),不 supplement;`sensitivityProof` 记 (d) 的反向变异;U/U.1/F 的冻结不动【§7.5 修正:F 那条 Unicode fuzz 用例也 supersede 并反转】,但 U 的 `argumentsHash` 期望值若在 fixture 里写死,随之更新并说明。
6. 完成后 C 重观测 → 我跑四谓词 → 签。**在此之前不签 P2-03,P2-04 不开。**

### 7.5 P2-03 整改令的三处修正(执行者 preFlight 发现,2026-09-06 13:36 EDT)

执行者按令先列清单、未动文件,清单纠正了 §7.4 两处、补了一条测量规则:

1. **F 阶段也要 supersede**(§7.4 ⑤ 说"U/U.1/F 不动"——错)。F 里有一条 fuzz 用例「a Unicode form change never changes the hash, over generated strings that HAVE two forms」,断言的正是要禁止的行为,**且带变异证明(去掉 NFC 它变红)**——一个对错误要求的正确证明。supersede 为反向:生成器只取 NFC≠NFD(按 code point 序列)的串,断言 hash **不同**;反向变异(改成"相同")套件必须红。重观测范围:C + F;U/U.1 候选链仍有效(执行者核过 U fixture 未写死 argumentsHash)。
2. **`canonicalize` 版本定 2.1.0**(lock 里已作 sigstore 传递依赖,零新增图节点;一个库在树里只留一份,与"第二份声明"同一原则)。执行者用 2.1.0 实测四条性质全部成立(NFC≠NFD 不同 hash / key 顺序 / `1.0`·`1`·`1e0` / 转义与字面)。4.0.0 ESM-only 无行为差异,不为它多一个版本节点。sigstore 日后升版本时随之升。
3. **NFD 用例的测量规则**:源码里的 NFD 字面量会被 shell/编辑器归一化成 NFC,两个输入进 node 时已是同一个串——用例测的是"同一个串等于自己"。**NFD 一律用 `'é'` 转义构造,不写字面量**;`sensitivityProof.failureSummary` 记这条。这是当天第四次"仪器不回答问的问题",执行者自己抓住的。

**教训归档**:变异证明只证明"套件对这条要求敏感",不证明"这条要求对"。要求本身的对错由 registry 措辞 + 账本 `risk` + 安全后果推演定——本次三者都指向反方向,而 F 用例是在读账本前冻的。

### 7.6 canonical JSON 的收敛归 R1,不进 P2-03(执行者逐份核后,2026-09-06 13:38 EDT)

执行者按**行为**(排 key + stringify + 是否喂 hash + 是否喂授权)而非名字逐份核,找到 **5 份**(比我按 `function canonical*` 名字扫到的 4 份多 `scripts/release/collect-evidence.mjs:89`),并把两件事分开:

- **漏洞只有一份**:① `action-manifest/canonicalize.ts`——NFC 喂 hash 喂授权。R2 修。
- **重复四份,无安全问题**:② `scripts/release/baseline-fingerprint.mjs:57`(NFC 只作用于写盘排版,digest 在归一化前对原始字节算完;固定 ASCII 路径,无触发条件)③ `scripts/first100/attest.ts:20`(喂 hash,无 NFC)④ `session-snapshot/suite.ts:641`(测试支持)⑤ `collect-evidence.mjs:89`(喂 sha256,无 NFC)。另 `guard/repeat-tool-reminder/src/index.ts:103`(启发式去重,不喂授权)。

**裁决**:②③⑤ 全在 P0-01/P0-07 的脚本里,正是 **R1 §3.4 attestation-envelope slice 要改写的文件**,收敛归该 slice(它本来就要把 evidence/baseline 改发 Statement+DSSE),不挂 P2-03——否则 P2-03 重观测范围从 C+F 膨胀到五个包。④ 和 repeat-tool-reminder 不动,按 BLOCKED-126 的范围规矩:**下次有 stage 因自己的子句碰到该文件时顺手换库**,不为一条规矩去动没坏的文件。记 BLOCKED-QUEUE 一条 durable pointer。

**扫描方法归档**:找"第二份声明"按行为扫(`sort.*keys|sortKeysDeep|Object\.keys\(.*\)\.sort` + 后接 `stringify` + 喂 `createHash`),名字扫会漏。

### 7.7 账本落盘(2026-09-06 13:40 EDT,用户追问「每一点的接法你更新了吗」后)

账本的 **237 条 adapt 级 `oss[].note`(每条的接法:版本、体积、本地验过的行为、要避开的坑)此前只在 artifact 和 `/tmp`**,仓库里没有副本——§4.1 让执行者"开工时读账本那一行",而它手里没有带版本的一份。现在:`spec/first100/exec/make-vs-use-ledger.json`(109 行 × 16 字段,`source` 段记 artifact id / 生成方式 / 提取时间 / `oss.role` 语义)。**第四问从这个文件读,不从 artifact 读**;`preFlight.makeVsUse` 必须引用 `rows[].id` 和所用 `oss[].name`。账本本身若要修(例:§3 P2-02 Biscuit 已被 Fiber 事实超越),改这个文件并在本节追加一行,不改 artifact。

**状态说明(对用户)**:本附录的裁决 R1–R7 里,**代码层已修的是 0 条**——delegate 不改代码。R2(P2-03)执行者已按 preFlight 开工;R1(§3.4 slice)排在 Cedar 之后、P4-04 之前;R3–R7 是归属与规则,在各拥有者 epic 开工时兑现。

### 7.8 P2-03 R2 的最终形态:手写迭代实现 + 库作差分 oracle(2026-09-06 13:44 EDT,执行者实测后)

**事实**(执行者三库实测,未提交):`canonicalize@2.1.0` / `@4.0.0` / `json-canonicalize@3.0.0` 全是递归实现,depth 5000 栈溢出;code-mode dispatch 真会产生 depth 5000 的参数(`packages/core/tools/tests/ptc.spec.ts:1551` 钉的就是这条边界,BLOCKED-077 的来源)。换库当场把 077 的症状带回来。HEAD 的迭代实现去掉两处 NFC 后 depth 20000 可用、四条性质全过。

**两条路**:(A) 保留库 + 深度上限——是产品行为变更(合法深层调用变错误),且**深度上限的主体是 P3-12(恶意输入边界),不是 P2-03**;在 P2-03 里做等于替 P3-12 决定产品接受什么输入。(B) 保留迭代实现,只删 NFC——修真缺陷、不改行为、不引运行时依赖,但树里留一份手写 canonical JSON。

**裁决:(B),加一层——库作差分 oracle。** "四条性质过"证明的是四条性质,不是 RFC 8785 一致(JCS 还有 key 按 UTF-16 code unit 排序、数字按 ES6 Number::toString、`-0`→`0`、字符串按 JSON.stringify 转义等)。`canonicalize@2.1.0` 进 `action-manifest` **devDependencies**(不进运行时),加一条**差分 conformance 性质用例**:fast-check 生成 JSON 值(depth ≤ 200;字符串含 NFC/NFD/转义/代理对;数字含 `-0`、`1e21`、`1e-7`、大整数;嵌套数组/对象),断言 `canonicalizeArguments(x) === canonicalize(x)`。变异:让排序用 `localeCompare` 或去掉排序 → 差分用例必须红。**"retained recursive copy"等价测试删除**——对自己旧代码的等价证明弱于对参考实现的等价证明。`canonicalize.ts` 文件头写明:与 RFC 8785 参考实现差分等价(指向用例);手写仅因所有 JS JCS 实现递归、在 code-mode 产生的深度上溢出(指向 ptc.spec 行号)。

**规则(§4.1 `role` 语义补一条)**:`adapt` 级的库若因**有记录的硬约束**不能进运行时,但它定义了标准,则**以差分 oracle 形式接入 devDependencies**——手写实现由此成为"经测试与标准一致",不再是"第二份声明"。判据:硬约束要能被一条冻结用例复现(这里是 depth 5000 溢出)。

**给 P3-12 的 pointer**:参数深度上限(拒绝而非溢出)是它的主体,preFlight 时读本节。

其余不变:C 新增 (a)(b)(c)(d) + 非 JSON 值拒绝 + 差分 conformance;F 那条反转;validation[2] 措辞照 §7.4 ④(「遵循 RFC 8785」由差分用例担保);supersede 照 §7.4 ⑤。

### 7.9 R6 复审:账本 `leverage2` 明确建议退掉 P0-03 手写扫描器,推翻的判据

账本 META.leverage2 原文:"dependency-cruiser(MIT)做 P0-04 分层依赖/禁环,顺手可退掉 P0-03 里已写的约 700 行自造扫描器。删 60–70%"。R6 说不重写,**推翻账本要写判据**,不能只说"在跑":

1. **两个扫描器都是 TS 编译器 API 的 AST 实现**(`import ts from 'typescript'`),不是正则:`check-layer-deps.mjs`(954 行)按 must[2] 三通道找边——声明 `dependencies/peerDependencies` 图、TS path alias、动态 `import()`/`require()`;`check-capability-seams.mjs`(332 行)认 `isImportDeclaration / isExportDeclaration / import() / import = / require() / isImportTypeNode`。**架构门静默放行的风险(认不得某种 import 形态)不存在**——这是唯一能翻转 R6 的判据,核过为否。
2. 规则逻辑是 dsh 特有的,dependency-cruiser 不提供:dated allowlist(owner + removalDate)、ADR-required 豁免格式、kernel 对 vendored Cordis 只许 `Context` 一个绑定(layering.md 规则 4)、family roles 作规则生成输入、10 s 预算。换库后这些仍要写,可删的只是图遍历部分(估 ≤300 行),代价是两条已验收 epic 重观测。
3. 无下游传播:没有别的 epic import 这两个脚本的输出形状。
4. **不为行数重写在跑的门**——和 R2 的逻辑一致:缺陷才整改,重复只收敛,沉没成本不追。

若日后 P0-04 的规则要扩到 dependency-cruiser 已有的能力(orphans、circular 到文件级、`.d.ts` 边界),届时以 oracle 形式(§7.8 规则)引入比较两者的图,再决定替换。

### 7.10 planError 补漏:账本是 40 条,§1 只算了 29

§1 说"账本标了 29 条"——那是**未验收、非 P9** 的行数。账本 `planError` 非空共 **40** 条;漏的 10 条(7 条已验收行 + 3 条 P9)处置如下,同时写进执行表各 epic 的"裁决叠加":

| epic | planError 摘要 | 处置 |
|---|---|---|
| P0-02 | validation[1]「kernel 不依赖 Cordis 产品包」应由 P0-04 层规则机械强制 | **已解决**:`check-layer-deps.mjs` `KERNEL_PERMITTED_CORDIS_BINDINGS = {Context}` + `collectKernelVendorEdges` |
| P0-03 | 应为 PROVIDER_ADAPT(dependency-cruiser),实际手写 | §7.9 推翻,判据在上 |
| P0-06 | registry 只是 TS 类型(524 行),无机器可读 schema,golden 与 additive/breaking 检查手断言 | **未解决**。§7.1 给的 `toJSONSchema ✓(5)` 是误归——5 处命中在 `typert/registry` 与 `plugin-manifest`,不在 `schema-registry`。不重开格子;**P8-07 开工前 schema-registry 必须能发 JSON Schema 2020-12**(否则 SDK 无源可生成),写进 P8-07 preFlight 硬前置;P2-11 `--dump` 同源 |
| P0-07 | 自造信封 | R1 |
| P0-08 | 上游已有确定性 lane,勿重建 | `runner.ts:105` 接受外部 scenarios,框架未重建;13 个上游 golden 是否接入由 P7-09 接线时核 |
| P2-01 | files 已存在,缩到接线缺口 | 已按缺口验收;IdentityContext 的接线归 P2-05 PEP / P5-05 |
| P5-11 | 应提升 agent-team 的 DAG/mailbox,不该新建 collaboration/* | 核实 agent-team 2452 行 claim/lease/mailbox/DAG **0 提及**,前提不成立;taskboard 自带 `dependsOn`。不是重复 |
| P9-05 | V4 tokenizer 与公开 V3 资产 parity 待验 | must[0]「官方精确计数」尚未做(现仍 `estimate.ts` fixed-density heuristic,U/F SCHEDULED_BLOCKED);U 开工先验 parity 写 preFlight,不一致则 must[0] 限 V3 并记 known-limitation |
| P9-08 | `registry-extension.json:385` 路径失效,实际在 `apps/cli/tests/profiles/headless/tests/coding-task.e2e.ts` | **现在就改路径**(files[] 修正,provenance `pathCorrected`),不等 R10;不当缺失重建 |
| P9-09 | promptfoo 无显著性检验,Wilson 门是 dsh 代码 | 写进 preFlight;与 R10 Q3 Wilson 下界门同一实现 |

**教训**:我"验证所有 planError 都写了"时数的是我自己分类后的 29,不是账本的 40。**核"全覆盖"要拿源的计数对,不拿自己中间产物的计数对。**

## 8. OSS 接入标准作业程序(SOP)——每接一个 adapt 级库都走一遍

**触发**:第四问(§4.1)答 `adapt`(含 §7.8 的 oracle 形态)时;共用引擎 slice(§3.1–3.4)同样适用,外加 slice 自己的 conformance 套件和一个端到端接通的消费者作证明。**产物**:`clause-subject-audit.json` 该 epic 的 `preFlight.makeVsUse`。

| 步 | 动作 | 产物 / 判据 |
|---|---|---|
| 1 读账本行 | 执行表该 epic 卡:`oss[adapt].note`(版本 / 体积 / 本地验过的行为 / 坑)、`standards`、`risk`、`residual` | preFlight 引 `rows[].id` + `oss[].name` |
| 2 供应链核 | 许可(准:MIT / Apache-2.0 / ISC / BSD / BlueOak;**拒:GPL / AGPL / BSL / SSPL / ELv2**,账本 notUse 列)、维护状态(最近发布 ≤12 月且未 archived)、体积、ESM/CJS、Node 版本、传递依赖数、是否已在 lock | 任一不过 → 回到第四问改判 optional/reject,记 BLOCKED |
| 3 本树复验 | note 里"verified locally"的每一条**在本仓库 + 本 Node 版本上再跑一次**;用本程序真实产生的输入(不是玩具输入)——canonicalize 的递归就是这一步在 depth-5000 输入上抓到的 | 一个可重复的探针用例;硬约束 → BLOCKED + 裁决(oracle / optional / reject) |
| 4 接法定形 | 四种之一:**runtime dep**(默认)/ **devDep oracle**(有记录的硬约束,§7.8)/ **optional provider**(不进默认、不进 CI)/ **vendored**(只在必须 patch 时,过 vendor manifest guard)。版本:preview(0.0.x)一律 exact pin(账本对 sandbox-runtime 的要求);其余按仓库约定 | preFlight 写选哪种、为什么 |
| 5 落座 | 三角色:**Service Definition 自写、采标准词汇**(§7.3 所有权:自己是首个采用者定形状,否则 import)· **库只在 Provider** · Consumer 接线。库的类型**不得泄漏进 definition 接口**(用自有/branded 类型);fail-closed 默认;配置来源明确;降级路径明确;错误映射到 typed error(对外 RFC 9457) | 子句主体在我们的代码里,能指出文件:行 |
| 6 冻结用例三类 | (a) **conformance**:我们对库的用法在**我们的输入域**上成立(差分/性质用例);(b) **接线**:fail-closed / 配置来源 / 降级 / 错误映射;(c) **安全边界**:注入 / 绕过 / 混淆。变异只打我们的代码;**库内部不变异、不重验**(库的套件验它) | 每类至少一条;(c) 必带反向变异 |
| 7 供应链落地 | lock 更新、`third-party notices` hook 过、`vendor manifest guard` 过、P1-02 后 SBOM 自动 | pre-commit 全绿 |
| 8 记录 | `preFlight.makeVsUse`——**字段以执行卡 §0 的 jsonc 规范为准**(ledgerRow / card / verdict(+Secondary)/ adopted[] / rejectedAbsent / standardsOwned / standardsImported / residual / probes / gapCheck / expectedDeletedPct / recordedBeforeFirstLine / realized);硬约束进 BLOCKED-QUEUE | 缺任一字段 = UNRECORDED(§9.1 门) |
| 9 Reviewer 两问 | 「包一层就算做完?」——子句主体在不在我们代码里;「第二份声明?」——**按行为扫全树**(§7.6 方法),不按名字 | 任一答错 → 不冻结 |

**共用引擎 slice 的额外两条**:(i) slice 自己的 conformance 套件是消费者 epic 的前置,消费者不重验引擎;(ii) 第一个消费者必须在 slice 内端到端接通一次(Cedar → P2-05 的 `decide()`;sandbox-srt → P3-04 的 egress;envelope → P0-07 的 attest.ts;OTel → P7-07 的一个 span),证明 seam 真能坐人。

**接 OSS 不降验收**(§4.1 原话):四谓词 + 双向变异验的是我们的接线。**P1-02 是模板,P2-03 R2 是 oracle 形态的模板。**

## 9. 「可省代码」与「社区插件最高覆盖」两列怎么变成动作(2026-09-06 14:03 EDT,用户指出这两列的细节没用上)

账本表头六列里,我把「判决」「用什么」用足了,**「可省代码」「社区插件最高覆盖」只当展示**。它们各自是一个动作。

### 9.1 可省代码 → 验收时记"实现的复用",并机械化

账本的 `deletedPct` 是**预期**。已验收行里 ≥20% 的 8 条,实现值:P0-03 / P0-04 **0**(§7.9)、P0-06 / P0-07 **0**(自造 schema / 信封)、P1-02 部分(sigstore ✓,SBOM/SLSA ✗)、P0-08 半(fast-check ✓,harbor ✗)、P1-08 0(自定整数 range)、P5-11 不适用(非重复)。**没有任何字段记实现值,所以差距三天后才被人工核出来。**

- **记录**:F 阶段 `preFlight.makeVsUse.realized = { adoptedOnPath: [{ name, form, importedIn: [files] }], rejectedAbsent: true|false, expectedDeletedPct, note }`。
- **机械门 `verify-make-vs-use.mjs`**(执行者建,**P2-04 preFlight 之前**;与 `verify-cells-recomputable` 同族,状态三值 **VERIFIED / MISMATCHED / UNRECORDED**,UNRECORDED 不通过):对每条有 `preFlight.makeVsUse` 的 epic——
  (a) `adopted[].form = runtime` 的包,在该 epic registry `files[]` 的 `[N]/[B]/[P]` 文件里至少一处 `import`(阳性:P1-02 的 `@sigstore/verify` 必须 VERIFIED);
  (b) 该 epic 账本 `oss[role=reject]` 的 npm 名在其 `files[]` 里 **0** import(阴性;阳性对照用一个已知 import 的包);
  (c) `form = oracle` 的包只在 `devDependencies`,不在 `dependencies`(P2-03 的 `canonicalize` 必须以此形态 VERIFIED);
  (d) `standardsOwned` 非空时,冻结表里该 epic 至少一条用例标题含该标准名;
  (e)【2026-09-06 17:20 EDT 加,用户令「能用已有 OSS 就用,配合标准与备注」】**账本该 epic 每条 `oss[role=adapt]` 条目必须有下落**:出现在 `adopted[]`(任一 form),或出现在 `deviations[]`(`{ name, reason, ruling: "§x.y" }`,理由只能是三类:与 registry 冲突 / 实测硬约束(附复现用例)/ 账本被事实超越),否则 UNRECORDED。**没有第四类理由。** 同理每条 `standards[]` 必须在 `standardsOwned` 或 `standardsImported` 或 `deviations[]` 之一。
- **不做**:不按行数算"省了多少"。行数不是目标;**复用在执行路径上**才是——这正是 §4.1"包一层就叫做完"错误的机械版。

### 9.2 社区插件最高覆盖 → 四种用法

314 条社区条目里 **81 条带「缺口:」清单**,每条带 hook 形态标签(`cordis-plugin·进程内·无 key` 44 条 / `bundle` 9 / `外部产品` 9 / `需 key` 9 …)。它们不是"参考",是四种动作:

1. **缺口清单 = 必备项核对**。preFlight 把该 epic 全部 `community[].note` 的「缺口:」逐项对到 must / acceptance 子句;对不上的,要么写"超出本 epic(归 X)",要么就是子句缺口 → BLOCKED。缺口是社区试过、失败的地方,是最便宜的需求核对。
2. **hook 形态 = wire-compat 要求**。META.answer 第二张卡:29 个 seam 里 15 个单 provider、2 个零 provider——"很多地方只是理论上可插拔"。`handRolled` 七组是社区已经在手搓的位置,目标 epic 的 Service Definition **必须能接住社区现在挂的形态**,冻结一条"现有形态插件不改代码可作 provider 挂入 / 迁移只需 X"的用例:

| 组 | 社区现状(账本 handRolled) | 目标 epic | 必须接住的形态 |
|---|---|---|---|
| 记忆 | 136 个 memory 插件各自手搓 store;注入挂 `agent/pre-step` waterfall 或塞 `ctx.systemPrompt` 段;只有 dsh-memento 定义了 `ctx.memory` seam | P6-01 | 两种注入形态 wire-compatible;memento 的 provider 形态直接可挂;borrow 其 conformance suite + JSON schema + golden 模式 |
| 登录门 | ≥7 套各写 cookie/TOTP/RBAC,各自 wrap http server | P8-06 | AuthProvider seam 在 http server 之前;**provider 拿不到 core session secret**(@xgone/dsh-remote 的 seam 违规作负用例) |
| 权限规则 | 5 个挂 `tools/pre-execute` + approval answerer 链 | P2-05 | PEP 坐在 `tools/pre-execute` 位置;现有 YAML 规则可作 policy source 导入;**first-match 非单调语义转换为 forbid > permit**(dsh-permission-rules 作负用例) |
| 快照/回滚 | ≥5 个互相竞争,各定粒度与恢复语义 | P3-11 / P1-10 | 区分工作区检查点与执行世界快照,P3-11 只做后者,说清楚 |
| OTel/审计 | 4 个各接一遍 OTel 或自签 HMAC 链 | P7-07 | `session-telemetry-otel` 唯一 backend;插件只加 processor / exporter |
| 市场/安装器 | ~70 个 market 类走裸 `pnpm add`;一个自动批 build scripts;一个扫描器把 profile boot 搞崩 | P1-02 / P1-04 / P1-06 | 安装必须经 harness 的 lockfile / `--ignore-scripts` / 隔离;市场插件降为目录 provider;"自动批 build scripts"作 P1-04 负用例 |

3. **borrow 提示 = 复用测试资产**(QUALIFICATION_REUSE 的社区版):dsh-memento 的 suite/golden → P6-01;dsh-eval-harness 的 YAML case → headless overlay → session.jsonl 断言模式 → P0-08 / P7-09;P2-10 / P3-07 / P5-08 卡片各有一条。
4. **反模式 = 负用例**:社区已犯的错冻结成"必须拒绝"的用例(上表已列三条)。

**执行卡改动**:community 全列(不止 top-1),缺口不截断;上表目标 epic 加「生态迁移目标」叠加。**P2-04 是第一条按 §9 走的 epic**:preFlight 含缺口核对;§9.1 的门在其 preFlight 前建好。

### 7.11 标准词汇所有权修订(2026-09-06 14:55 EDT,按数据重算后)

§7.3 表按 registry 顺序取"首个采用者",没考虑三件事:已验收行是否**真采用**了、P2-03 是否会采用、所有者是否**晚于**某个消费者的 wave。重算(算法在执行卡 §1,数据驱动)后,R3 的四处归属要改,§3.3 时点要提前:

| 标准 | R3 原归属 | 修订 | 理由 |
|---|---|---|---|
| CloudEvents | P8-05 | **P4-06(W5)定形状**;P8-05 只拥有 P4-01 内部字段 → CloudEvents 的映射 | P4-06 是新 [N] 文件,直接用标准名比日后映射便宜;P8-05 W17 晚于 P4-06 十二个 wave |
| SPIFFE ID 格式 | P8-06 | **P3-09(W8)定形状**;P8-06 import 并做 ServiceAccount 映射 | P3-09 的 tenant/world 身份先要 ID 格式;P3-06 只借 SVID 生命周期规则(拆成两个子规范) |
| W3C PROV-DM | P7-04 与 P6-03 | **P6-09(W10)定形状**;P7-04 import | 一个标准只能一个所有者;P6-03 根本不在 PROV 涉及者名单里(R3 误列);P6-09 早于 P7-04(W14) |
| OTel semconv | P7-07 | **名字来自 `@opentelemetry/semantic-conventions` 常量包,无人定形状**;§3.3 slice 只接 pipeline,时点 **W11 前** | P5-03/P5-06(W11)先发 gen_ai.usage.*,P3-03/P3-10(W8)用 error.type/process.*——都早于 W12 |
| in-toto / DSSE / SLSA | P0-01 首个 | **SLICE-3.4**(R1,P4-04 W9 前) | P0-01 / P0-07 / **P1-02** 三条已验收行均未采用(P1-02 只用了 Sigstore bundle) |
| RFC 8785 JCS | P8-01 △ | **P2-03** | P8-01 是自家 surface 的手排 hash,不是 JCS 采用(R7) |
| MCP ToolAnnotations / AuthZEN | P2-03 | **P2-04 / P2-05** | P2-03 代码核过:两者均未采用——must[0] 定死了字段名(actionId/actor/capability/target…),这是 registry 决定,**不算债**;顺延到 taxonomy(P2-04)和 decide() 输入(P2-05) |
| semver | P1-01 | **P1-03**(R4) | 唯一涉及者 P1-01 已验收未采用 |

**规则补两条**:(a) 所有权按**子规范**算(MCP 四个、ACP 两个、OCI 三个、SPIFFE 两个、A2A 两个、OTel 两个互不相干);(b) 所有者 wave **晚于**某消费者时,早的消费者用内部名、不声明该标准形状,所有者落地时提供单向映射(卡片上已按 wave 自动标出)。**执行卡 §1 是唯一的所有权表**,§7.3 保留作历史。

## 10. 提速令(2026-09-06 15:25 EDT,用户令「加速且保质保量」)——重叠,不砍门

**数据**:21 ACCEPTED;**7 条四格全绿但上锁**(P2-02 / P6-01 / P1-03 / P4-05 / P4-06 / P4-09 / P5-10)+ P2-03 在观测。`generate-ledger` 不把 predecessors 当机械门(只展示),wave 是投影;真正的闸是**锁**和**文件面**。最便宜的 +8 不在造,在解锁。

### 10.1 三条 Writer lane(C5 预授权 2–3 条;文件面已核互不相交),即刻同时开

| lane | 内容 | 顺序 | 文件面 |
|---|---|---|---|
| **L1 关键路径** | P2-03 签 → **P2-04**(preFlight 现在写,签后立刻开;与 P2-03 共 `core/tools/src/types.ts`、`action-manifest/src/types.ts`,故签后再动)→ P2-05(需 §3.1 Cedar + §3.5 Fiber A) | 串行 | policy/risk-taxonomy、permission-presets |
| **L2 关键解锁** | **§3.5 SLICE-fiber-A**:vendored Cordis `Fiber.store` 修复(Option A,BLOCKED-011/050)+ P0-02 `signatureRoots` 真实密钥材料(见 10.3)→ P2-02 must[1] 的 supersession 用例 → P2-02 验收。**同时解锁 P2-05 的内核执行点** | 串行 | vendor/cordis、trust-kernel、capability-token |
| **L3 独立解锁** | P4-06:(b) `BEGIN IMMEDIATE` 事务(§2.A 重述后的 must[0])+(a) 去重信号(见 10.3)→ 验收;→ P4-05 acceptance[2] 用例(供给方 P4-07 已验收,按 BLOCKED-092 第二步写 supersession)→ 验收;→ P4-09 nesting 半题 | 串行(共 `agent/src/dispatch.ts`、`inbox.ts`) | run/message-bus、core/agent、workflow |
| **infra(L1 等观测时插入)** | §3.1 Cedar slice(preFlight 已在 clause-subject-audit:SLICE-3.1-cedar)→ P2-05 前落地 | — | 新包 policy-engine-cedar,零冲突 |

P1-03(10.3 裁决后,U 阶段 supersession:lock 生成 + `composeProfile` 调用点)排 L3 之后或任一 lane 空档。P6-01 残余锁归 P6-03(W8),不动。P5-10 的 actions 半在 P2-03 验收后按 10.3 钉住,world 半等 P3-01。

### 10.2 节奏(C5 已批,现在执行)

- CI **按 push 批处理**(一 push 多 slice),不按 slice 触发;本地只跑冻结命令 + typecheck + 相关包;全量只在 wave 边界。
- **delegate SLA**:preFlight 收到 30 分钟内答;观测绿 + 产物到手 30 分钟内跑四谓词并签;可批量签。
- **不变的门**:冻结先于写、RED 在 parent SHA、变异证明、独立 Reviewer、四谓词、锁。提速全部来自重叠,不来自跳过。

### 10.3 三个解锁所需的裁决(delegate 定,附判据)

1. **BLOCKED-094 · P1-03 未上锁 profile 的 boot 策略**【18:35 EDT 修订:执行者核出 `dsh plugin lock` 命令不存在,且 registry must[1] 已规定 lock 由 `plugin add/update/remove` 的事务生成——原文"新命令"撤回】。**明确裁决**:(a) 调用点读 **plugin-lock 的配置字段 `unlockedProfilePolicy`**(值 `refuse` | `warn-and-proceed`,**必填无默认**,按仓库规矩显式 resolve),该字段在每个出货 bundle 的 `cordis.patch.yml`([B],P1-03 files[])里声明;**今天所有出货 bundle 声明 `warn-and-proceed`**;P2-11 的 `production-controlled` 预置(W9)声明 `refuse`。(b) **有 lock 而 digest 漂移 → 一律拒绝**,与策略无关。(c) `warn-and-proceed` 下无 lock 的 boot 发 **typed boot 诊断 `PLUGIN_LOCK_MISSING`**(boot 早于 session,不是 session 事件,不动闭合事件表)。(d) **lock 的生成不新增命令**:就是 must[1]——`apps/cli/src/plugin.ts:260` 在 pnpm 退出 0 时已调用 `commitProfileLock`(完整事务:read → buildCandidate → planLockCommit → writeLockAtomically)【18:55 修订:执行者更正其先前“零调用点”的测量(grep 漏了 apps/),must[1] **已接好**,不是待办】;第一次 `dsh plugin add/update/remove` 之后 profile 就有 lock,过渡态由此结束。U 真正剩下的只有 must[2] 的调用点:`profile-boot.ts` 的 `composeProfile` 今天 0 次调用 `gateProductionBoot`。(e) 冻结:"有 lock 且漂移 → 拒"、"无 lock + warn → 诊断后继续"、"无 lock + refuse → 拒"三条 + must[1] 的"add 后 lock 存在且 digest 匹配"。(f)【18:55 加】**多层组合取最严者**:组合结果里任一层声明 `refuse` 即 `refuse`(fail-closed,让 `production-controlled` 预置真能强制),冻结“一层 warn + 一层 refuse → refuse”。(g)【18:55 加,19:40 修订】**字段落点走 (A)**:`profile-boot.ts` 自己从已组合的层里读该键(boot 早于 Cordis 上下文,此刻没有插件 Config 实例),类型 import `plugin-lock/src/gate.ts:24` 已有的 `UnlockedProfilePolicy`(C 阶段契约),值不合法或缺失 → typed boot 错误(必填无默认);不动 `plugin-lock/src`。**键的位置**:执行者核出 `cordis.patch.yml` 是补丁操作的 YAML 列表(vendored 修改 8:非数组即无效),放不下标量键——**改为每个 bundle 的 `package.json` 的 `dsh.pluginLock.unlockedProfilePolicy`**,与 `partitionProfileLayersByAdmission` 已读的启动期元数据(`readPluginDeclaration`)同处;U 的 files[] 把 `packages/bundle/base/cordis.patch.yml` 换成 `packages/bundle/base/package.json`,provenance `filesReplaced(BLOCKED-133 后续)`。**边界**:该键落在出货 bundle 的 package.json 即是发布物的一部分,改动按发布面对待。多层各自声明时仍最严者胜。**测试文件名** `apps/cli/tests/plugin-lock.spec.ts`(非 `.e2e.ts`——`vitest.config.ts` 的观测 lane 只收 `*.spec.ts`,e2e 后缀只跑在 real-API lane,冻结标题会永远观测不到),provenance 已记偏离理由。**这是产品可见的 boot 策略,在 delegate 授权内(C7 技术裁决 + C11),记 decisions-approved 供用户可见。**
2. **P4-06(a) 去重信号**【15:50 EDT 修订——原裁决"用既有 `turn/end`"经执行者三问核否:`classifyIntake(message, seen, tenant)` 是纯决策函数,签名里没有 session,`seen` 只含 `(id, epoch)`,且**生产调用点为零**(只有 `fault-matrix.spec.ts` 三处)。原裁决撤回】。**改为**:(a) 与 (b) 合并成一个设计——`seen` 的来源是 **P4-06 自己的 durable inbox 表**(SQLite,与 must[0] 重述后的 outbox 同库):行 `{messageId, epoch, claimedByTurn, state: claimed | consumed | released}`;消费者在**同一 `BEGIN IMMEDIATE` 事务**里写 domain event、outbox 行、并把 inbox 行置 `consumed`——"认领 turn 已提交"就是这一行状态,不读 session 日志,**不新增事件类型**;崩溃 → 行停在 `claimed`,恢复扫描按 lease/epoch 过期置 `released`,goal-round-driver 的恢复即合法。`classifyIntake` **保持纯函数不动**(选项 ②),调用点用 `state=consumed` 的键集构造 `seen`。**生产调用点 = `packages/core/agent/src/inbox.ts` 的 intake 路径,归 P4-06 的 U 格**:U 现有绿格证明的是 message-bus 半,agent-inbox 半按 BLOCKED-103 判 supersede(若 U 现有用例断言了被 BLOCKED-088 撤回的那条规则)或 supplement(若只是缺),由执行者按用例原文定并写明。判据:纯函数可测性不变;事务边界与 (b) 同一处;"写了没人读"由生产调用点 + 冻结用例"一条真实 intake 经 classifyIntake 拒绝重复"关闭。
3. **P0-02 `signatureRoots` 真实密钥材料**(P2-02 前置):内核签名根 = **每安装一份 Ed25519 密钥对**,首次 boot 由内核生成,私钥只在内核私有状态,持久化经 credentials provider(P6-08 keychain 落地前:dsh home 下 0600 文件,profile 标 `dev`,`production-controlled` 拒绝文件后端);公钥进 `signatureRoots`,可轮换(旧根保留验证到 expiry)。**不引入任何长期公网密钥**(用户规则);发布签名仍走 P1-02 Sigstore keyless。P2-02 must[1] 的用例对这套材料写。
4. **P5-10 actions 半的供给方钉为 P2-03**:in-flight action = 已 append manifest 而无配对终态记录;cancel 后 barrier 观测"不再接纳新 manifest 且每个已 append 的 manifest 得到配对终态记录"再进终态。P2-03 验收后 P5-10 写此用例;world 半等 P3-01。

### 10.4 §3.5 SLICE-fiber-A(新增共用前置)【16:05 EDT 修订:验收目标收窄,vendored 改动降为条件路径】

**执行者读完 `store` 全部读写面后的事实**:跨类写只有 `reflect.ts:293/302` 两处;`packages/kernel/trust-kernel/tests/pin-hardening.spec.ts:79` 已绿——P0-02 用 `Object.defineProperty` 把 **root fiber 的 `trustKernel`** 锁住了;残留是"非 root fiber / 其他服务名"的跨插件 property-access 中毒,`docs/architecture/trust-kernel-boundary.md` 已记为 known-residual;**BLOCKED-011 于 09-01 由用户终裁 DE-ESCALATED:三向量 vendor-free 闭合,残留降为 known-limitation**(§2.G)。

**裁决**:本 slice 的验收目标是 **P2-02 must[1] 的可断言内核执行点**——"任何 fiber 上的任何插件都不能用伪造物替换内核服务",**不是**关掉全名残留(那条已由用户终裁降为 known-limitation,且 P1-06 进程外 host 从结构上解决不可信插件)。据此:
1. **先走 dsh 侧最小路径**:内核句柄的解析**不经任何 fiber store**——`ctx.trustKernel` 在任意 fiber 上都解析到 `pinTrustKernel` 的模块级冻结引用(内核本就"在 Cordis Context 之前初始化、不可注册为可替换服务")。探针:在**非 root** fiber 上执行 `ctx.fiber.store['trustKernel'] = forged`,该 fiber 及其子树的 `ctx.trustKernel` / `ctx.get('trustKernel')` 是否返回伪造物。**不返回 → 不改 vendored 源,slice 更名 SLICE-kernel-resolution**。
2. **只有当子 fiber 的解析(`reflect.ts:157` 先查本 fiber store)无法在 dsh 侧覆盖时**,才做最小 vendored 改动:`reflect.ts:293/302` 两处跨类写经受控 `provide/revoke` 入口,**对内核服务名在任何 fiber 上拒绝**;`store` 私有化但 `fiber.ts:324/647/687` 的生命周期自写不受影响;登记 `vendor/README.md` local modifications,过 `check-vendor-manifest`。
3. conformance 按执行者的形状:正(provide/get/撤销正常路径不破)、负(非 root fiber 直写内核名不生效且可观测;P0-02 vector-2 仍绿)、范围(非 root、内核名——这是比 pin 多出来的那一块)。**"其他服务名"不进本 slice 验收**。
4. **P2-02 端到端**:key material(§10.3-3)+ 本 slice → must[1] 一条真走内核签发/验证的用例(伪造 token 被拒;非 root fiber 中毒后验证仍走真内核),不是两个半边各自绿。

**§10.3-3 与 P0-02 冻结「signatureRoots 恰好一个成员」不冲突**:密钥材料进**内核私有状态**,句柄的单成员接口不变——P1-02 的 anchors 就是这么落的(registered/revocable in kernel private state)。执行者仍需核该冻结用例的标题原文与之一致。

### 10.5 P2-04 preFlight 裁决(2026-09-06 16:15 EDT)

**事实**(执行者三问):三套副作用枚举互不相同——P1-01 `SideEffectClass` 6 类(声明)、P2-03 `ActionSideEffectClass` 5 类(manifest 记录,`classifySideEffect(undefined)` 硬编码 `destructive`+requiresApproval)、P2-04 must[0] 8 类;P2-04 的 `[P]` 文件 `action-manifest/src/types.ts` 与 P2-03 共用,P2-03 未签。

**裁决:(丙)两套并存,权威在 taxonomy,加单调性。**
- **manifest 的 `sideEffectClass` 是声明输入**(来自 P1-01 声明经 P2-03 记录),不是分类结果;**不扩枚举、不动 P2-03 的文件与冻结**。
- **P2-04 risk-taxonomy 的输出 `{class(8), confidence, evidence[]}` 是唯一权威分类**,以 `actionId` 为键作为独立记录(risk assessment)附在 manifest 之后,不改 manifest schema;P2-05 `decide()` 读它,CLI/Web/SDK 都经同一纯函数 `classify(manifest, declaredDomain, orgOverrides)` → acceptance[0] 的一致性由构造保证(同输入同输出,冻结一条跨三个 surface 的用例)。
- **单调性(必须冻结)**:(i) 声明类映射到 8 类后是**下限**——插件声明 `destructive`,分类结果不得低于 destructive;(ii) 由 P2-03 未知默认而来的 `destructive` **不是声明**,分类器有 `confidence ≥ 阈值` 的证据可给出自己的类,证据不足则保持最高类(must「未知→更高类」);(iii) org override 只能上调,kernel hard-deny 是地板。
- **给 P2-06 的 pointer**:审批必须同时绑 manifest digest **和** assessment digest,否则分类在批准与执行之间可变。写进 P2-06 卡片。
- **`@modelcontextprotocol/sdk` 的接法**:`form: runtime`,注明 **type-only import**、包已是 workspace 依赖(mcp-client)、零新增图节点;**不 vendor 一份类型定义**——那是 MCP 形状的第二份声明(§7.3)。四个 hint 永远只作输入(账本 risk 原话)。
- 其余 preFlight 字段按执行者所写;`[P]` 文件在 P2-03 签后再动;probes 在本树复验 hint 名与语义后填。

### 10.6 两条裁决记录(2026-09-06 16:45 EDT)

**P2-03 签发暂缓(机械原因)**:观测 run 34051669730 @ `144d41cb76` 的 vitest report 四处 sha256 一致、20189/0 failed、四格冻结标题逐条在场;但 run 结论 `failure`——scoped lint 7 条错中 **6 条在 P2-03 自己的 `manifest.spec.ts`**(`as never` ×6),修复 `da94ed35ff` 在**观测之后**。候选不可变 + BLOCKED-014 slice gate set 不许选子集 → 在 tip 重观测后签,candidate 记新 SHA。另:`accept-blocked: P2-03` 未解——两个解锁信号已满足(code-mode 半:U.1 三条 + ptc deep-arguments passed;plugin-rpc 半:C12 拆到 P1-06 must[4]),执行者记 LIFTED 后签。snapshot `persistent-pwsh-tool-turn` 红不在 P2-03 范围,需 flake-registry 引用或 BLOCKED 根因。

**Fiber-A → 裁 2(最小 vendored 改动)**:探针实测非 root fiber 上 `ctx.fiber.store['trustKernel'] = forged` 后 `ctx.trustKernel` 返回伪造物(`ctx.get` 不返回)——P0-02 的 pin 只护 root + `ctx.get`,dsh 侧覆盖不到每个 fiber 的属性读路径(`reflect.ts:157`),§10.4 ① 的"dsh 侧最小路径"是**待做的工作而非现状**,且 P0-02 已试过。不选 3(收窄 must[1] 为 `ctx.get` 语义 = 来源附和消费者)。形状二选一按 diff 最小实测:(A) `store` 私有 + `reflect.ts:293/302` 受控 provide/revoke 并对内核名在任何 fiber 拒绝;(B) `fiber.ts:324/647` 建 store 处加 `storeGuard` 契约点,dsh 侧注册守卫将内核名 defineProperty 不可写——不改 `store` 类型。判据:探针翻转、P0-02 vector-2 仍绿、fiber 生命周期不变。登记 `vendor/README.md`,过 vendor manifest guard;**re-vendor 必须带补丁**(BLOCKED durable pointer)。characterization 落 slice:现在断言伪造成功 = RED,修好翻绿。

## 11. 冻结先于观测的链条断了 19 处(2026-09-06 19:30 EDT,BLOCKED-132 追查,delegate 亲核)

**发现链**:执行者想把 BLOCKED-095(P1-03.C 事后冻结)机械化,发现账本 `capturedAtUtc` 是记账时间;我指出 vitest 报告顶层 `startTime` 是离线可得的观测时间;执行者用它跑出 38 格"冻结晚于观测";我再用两个**机器时间**核:冻结记录首次进 git 的提交时间 vs 观测 run 的创建时间——59 条 `frozenAtUtc` 晚于观测里,**真正记录晚于观测进 git 的只有 12**(其余 47 条是手写字段补录,执行者的读法 2)。最后用最干净的判据——**被引用观测的候选 SHA 的树里是否含该条 live 冻结记录**——得 **114 组中 19 组不含**:P0-01.F · P0-02.C · P0-02.F · P0-05.C · P0-06.U · P0-07.C · P0-07.F · P1-03.F · P2-01.F · P4-01.P · P4-06.C · P4-07.F · P4-08.F · P5-11.C · P5-11.F · P6-01.C · P6-02.F · P6-07.P · P8-01.C。成因两类:记录在观测后才写;或 supersede 后未重观测。

**它意味着什么(不夸大也不缩小)**:这 19 格的实质证据仍在——标题在候选上真跑真过、coverage 100/100 使"挑选过的标题"无法漏掉子句、recompute 门 VERIFIED、部分有变异证明。**缺的是"先承诺后观测"这一属性**,它防的是"看着结果写用例"(空洞用例)——coverage 闭合挡住"少写",挡不住"写空";空洞由变异证明挡,而已验收行的变异回填还没做(§6 已列)。所以这 19 格是**证据链缺一环**,不是"结果是假的"。

**裁决**:
1. **新谓词 (v),机械化,不用时间戳**:`verify-freeze-in-candidate-tree.mjs`——对每个 GREEN 格,其每条 live 冻结记录(按 epic/stage/expectCases 全集)必须存在于 `candidateSha:spec/first100/exec/command-freeze.json`;状态 VERIFIED / MISSING;MISSING 不通过。进 registry gate set 与 `--accept`。`frozenAtUtc` 降为信息字段,不再被任何门读。
2. **一次重观测修 19 格**:run `34063737869` @ `d4034a8f4c` 的树含全部 live 记录;若它对这 19 格的标题全过,执行者从该报告重绿这 19 格,candidate 记 `d4034a8f4c`,行上记 `reattested: {candidateSha, ciRunUrl, reason: "§11"}`;**验收状态不撤**(实质证据在,链条补齐)。若任一标题不过 → 该行 `--conclusion WITHDRAWN`,修好再签。
3. **变异回填提到最前**(§6 那条):这 12 条已验收行的每条 live 冻结记录补 `sensitivityProof`,期限 P2-05 开工前;没有变异证明的格,重观测也只补了一环。
4. **supersede 规则补一条**(BLOCKED-103):supersede 之后该格**自动降为 NOT_RUN**直到用含新记录的树重观测——由谓词 (v) 机械保证,不靠人记得。
5.【19:20 补】19 格中 P0-05.C 暴露的是**工具缺陷**不是记录缺陷:其标题在 BLOCKED-040 登记过改名(`frozen-title-renames.json`),但 greening 路径与 `verify-cells-recomputable` 都不读那张表(只有 resolvable / in-tree 读)——四个读冻结标题的工具须共用一个精确的 `resolveFrozenTitle()`。执行者已修 greening,recomputable 待修。BLOCKED-095 改记为"19 分之一",BLOCKED-132 记本节结论;执行者的两次自纠(先说不可建、再说 38)都留在记录里——**方法比结论重要,三次判据一次比一次硬**。

**P1-03 BLOCKED-133 一并裁**:解锁信号保持端到端,不改写成单元替身。U 的 files[] 加 `[N] apps/cli/tests/profiles/plugin-lock.e2e.ts`(能驱动 `dsh plugin` 与 profile boot 的 e2e,与 headless e2e 同形),provenance `testFileAdded(BLOCKED-133)`;调用点代码与这个测试文件同一 slice 落地,RED 先于 GREEN。

### 11.1 先例:fixture 与实现同错(P1-03 U,2026-09-06 20:05 EDT)

执行者写 `composeProfile` 调用点时第一版把 `integrity` 写成 `sha512-${manifest.name}`(从包名合成),而 `admitBoot` 真比较 integrity(`plugin-lock/src/index.ts:105`)——一个被替换的归档只要 package.json 不变就能通过全部检查;**且当时没有任何用例会红,因为 fixture 用同一个假 integrity,两边同错互证**。自纠:读安装器记录的 `dsh.provenance.integrity`,缺失回落到 `buildCandidateLock` 写的同一 `unavailable:` 标记,有 provenance 的真比较;补用例「recorded integrity 变了、manifest 一字未动 → 拒绝」,合成写法放回去正是这条挂。**规则**:安全边界用例的 fixture 数据必须来自与生产同一条路径(安装器/记录),不得在测试里合成;Reviewer 两问加第三问——"fixture 和实现是不是同一个人用同一个假设写的"。
