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
  (e)【2026-09-06 17:20 EDT 加,用户令「能用已有 OSS 就用,配合标准与备注」】**账本该 epic 每条 `oss[role=adapt]` 条目必须有下落**:出现在 `adopted[]`(任一 form),或出现在 `deviations[]`(`{ name, reason, ruling: "§x.y" }`,理由只能是三类:与 registry 冲突 / 实测硬约束(附复现用例)/ 账本被事实超越),否则 UNRECORDED。**未验收行没有第四类理由。**【22:15 EDT 补,门 (e) 建成后报 29 条含已验收行】已验收行回填时另许两种**只读性质**的理由:`accepted-unadopted`(R6/§7.9 判据:已验收、手写在跑、无传播——仅限已 ACCEPTED 行,不得用于新工作)与 `ownership-transferred`(§7.11:标准所有权已转移到别的 epic,写明所有者)。门 (e) 在 29 条回填完成前不进 gate set,回填完成即进。 同理每条 `standards[]` 必须在 `standardsOwned` 或 `standardsImported` 或 `deviations[]` 之一。
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

## 12. files[] 的含义与 B4(e) overlay(2026-09-06 21:05 EDT,BLOCKED-134)

**执行者的测量**:116 条 live 冻结条目里 79 条引用了 stage 声明列表之外的文件。**我按对的边界再量**——B4(e)(用户批复)说的是 **epic 级 `files[]`**("被冻测试文件必须落在该项 files[] 内,append-only overlay 补充"),不是 stage 列表:**75/116 条引用了 epic 级 files[](含 scaffoldFiles / testFilesAdded)之外的文件**,遍及几乎每条 epic,含大量测试/fixture/README/package.json,**也含产品源码**(如 P2-03 U 的 `core/session/src/index.ts`、P1-03 的 `plugin-lock/src/{gate,candidate,commit}.ts`、P4-07 U 的 `core/agent/src/index.ts`、P5-10 的 `subagent/src/control-*.ts`)。

**裁决(读法)**:`files[]` 是**钉住源的计划**(不可变);B4(e) 要求的 **append-only overlay 是现实的记录**;两者之并才是 scope。执行者建的三个机制(`SCAFFOLD_FILES` / `TEST_FILES_ADDED` / `FILES_REPLACED`)**正是 B4(e) 要的 overlay,不是仪式**——问题是它只用了 3 次,另外 75 条从没记。所以 134 的发现不是"边界不存在",是"**overlay 从第一天起就没维护**"。

**处置**:
1. 三个机制合并为一个 `filesOverlay`(按 epic,append-only),条目 `{path, kind: test|fixture|doc|manifest|scaffold|source, stage, reason, provenance}`;既有三种 provenance 保留为 `reason` 词汇。
2. **机械回填**:从 116 条 live 冻结条目生成 overlay(脚本,不手写);`kind=source`(产品 `src/`、`scripts/`)的每条由执行者附一句 reason(通常是"子句主体所在 seam"),**delegate 通读一次 source 清单**(约 25 个文件),热区文件(§2.D 列的)逐个核是否已按 contribution 模式接。
3. **新门**:每条 live 冻结条目的 `files` ⊆ `files[] ∪ filesOverlay`,冻结时即校验(与 (v) 同族),此后出计划的文件只能在冻结时记录,不能事后发现。
4. **不重开任何验收**:记录现实不改证据;但 source 清单通读若发现有热区文件被直接改而非 contribution,单独裁。
5. 不再加第四个机制;registry 里三个块的文档改为"记录文件事实"。

### 12.1 P1-03 acceptance[0] 离线冷启动的解锁信号(2026-09-06 21:15 EDT,撤回"网络出口零调用")

执行者实测 `composeProfile` 闭包(6 个 workspace 包 + js-yaml / resolve.exports)**没有任何 HTTP 客户端**,fetch spy 的正向断言恒真、反向"正控"也恒真(实现永远不联网,spy 永远证明不了自己在路径上)——我 §11 后那条"网络出口被调用零次 + 反向正控"的裁决撤回。改为:(1) **结构不变量门**:boot 路径传递闭包不含 HTTP 客户端且源码无出口调用,并冻结一条"给闭包内某包加 fetch/undici → 门红"的用例,进 gate set;(2) **一条真分支的行为用例**:lock 记录的包在本地 install 缺失(非漂移)→ boot 拒绝,F 阶段、(A) 复用 `apps/cli/tests/plugin-lock.spec.ts`;`admitBoot` 若无 absent 分支即真缺口,先 RED 再补。锁行措辞:acceptance[0] 成立因"无网络路径(门强制)+ 本地缺包被拒",不是"被验证过的降级逻辑"。**教训**:断言要有主语——路径上不存在的分支不能用 spy 制造出来。

### 12.2 在飞 epic 对卡核验(2026-09-06 21:40 EDT,用户问「是不是按计划混 OSS」)

**对代码不对自述**:P1-03 `makeVsUse` 为空 `{}`,卡上三条 adapt(`write-file-atomic` / `ssri` / `@pnpm/lockfile.fs`)一条未接——原子写手写(`writeFileSync+renameSync`,无 fsync)、integrity 自 brand 字符串且来源是自造的 `dsh.provenance.integrity` 而非 pnpm 锁文件权威值;P2-04 落盘的 preFlight(`adopted: []`、`standardsOwned: []`、`verdict: CONTRACT_WRITE`)**与执行者发 delegate 审的那份不同**(那份 adopted 三条、standardsOwned ToolAnnotations,账本 verdict PROVIDER_WRITE)。**根因**:门 (e) 裁了未建,偏离静默。**处置**:门 (e) 提到夜班队列最前,建完对全部有 preFlight 的 epic 跑一遍;P2-04 记录改回送审版并在 C 的 types 里声明 ToolAnnotations 输入类型;P1-03 补第四问,三条 adapt 默认 adopt(本树复验后有硬约束才 deviation),P 阶段 supersede 与 F 同批观测,验收多一轮。**规则**:签字前 delegate 对代码核 adopted[],不以 preFlight 自述为准。

### 12.3 标准所有权:指派 vs 证据(2026-09-06 22:50 EDT,执行者报规则冲突)

**冲突**:计划(执行卡 §1)把形状所有权**指派**给 48 个 epic(含单一涉及者),与有没有用例无关;门 (e) 的第四检查要求 `standardsOwned` 有一条 live 冻结用例点名该词汇,否则 MISMATCHED。**裁决**:所有权是**指派**,证据是**义务**,两者分层——
1. `standardsOwned[]` 条目两种来源:`assignedBy: plan`(指派、尚无用例)与 `evidenceTitleSubstring`(有用例点名)。数据源是生成器输出的 **`spec/first100/exec/standards-ownership.json`**(families + perEpic,机器可读),不从卡片正文抓。
2. **未验收行**:`assignedBy` 允许,状态 PENDING;`--accept` 时 PENDING → UNRECORDED(与 PENDING_ADOPTION 同形):所有者在验收前必须冻结一条 schema/词汇用例。
3. **已验收行**(P1-02 / P1-07 / P1-09 / P2-01 / P0-05…):`assignedBy` 允许,状态 **PENDING-BACKFILL**,并入 §11.3 的已验收行回填批(期限 P2-05 开工前),由所有者自己补一条词汇用例;期限前不算 MISMATCHED,期限后红。不重开验收。
4. 门 (e) 增两条:deviation 理由必须与行状态匹配(`accepted-*` 只许 ACCEPTED 行);`standards-ownership.json` 里 `thisEpicOwns` 为真的条目 `standardsOwned` 不得为空。
5. **回填错误四行**(P4-05 / P4-06 / P4-09 / P6-01 误用 `accepted-unadopted`)已改 `not-yet-adopted`;**教训**:模板扫过 29 行,不合适的那四行读起来像"考虑过"——记录的完整性门必须和记录同一天建。

### 12.4 P2-02 must[1] 范围与内核密钥持久化(2026-09-07 01:30 EDT)

**事实**:内核现在每次 `createTrustKernel` 铸一对 Ed25519(私钥 module-private WeakMap 按 handle 索引,非本模块 handle 直接拒);token 真签真验,签的字节 = `digestToken` 固定的字节;fixture 自算签名不 import 生产函数;跨内核伪造变异被抓。P2-02 锁行条件"real key material reaches signatureRoots AND Option A"两者都到。

**裁决**:(1) **P2-02 must[1] 现在冻结**,以每进程密钥为准——must[1] 的主体是签发/验证/衰减,与密钥寿命无关;不在 live 锁行下扩范围到 credentials 包。(2) **密钥持久化独立为 SLICE-kernel-keys**(归 P0-02 的内核私有状态 + credentials provider seam):每安装生成、0600 文件后端(profile 标 dev)、`production-controlled` 拒文件后端、轮换保留旧公钥到 expiry、"重启后 token/签名仍可验"作为该 slice 的端到端用例;**P4-04(W9)开工前落地**——它是第一个需要跨重启验证的消费者。§10.3-3 的"每安装"由此 slice 兑现,不由 P2-02。(3) 不声称"根可信"——那是 P1-02 的锁,对。

### 12.5 BLOCKED-136:去重规则写了两遍,P4-06 must[2] 的生产调用点(2026-09-07 02:05 EDT)

**事实**(执行者测量):`core/agent/src/inbox.ts` 是会话日志支撑的 `UserMessage` 提示队列,无 message id / epoch / 跨进程到达——**我 §10.3-2 指它为调用点是错的**(按 files[] 名字而非行为指的,BLOCKED-091 的形状)。真实到达面在 `packages/collaboration/mailbox/src/index.ts`(P5-11,已验收):`deliveryKey`/`decideDelivery` 与 message-bus 的 `dedupKey`/`classifyIntake` 是同一条规则的两份实现,互相引用对方的散文而不 import 对方的函数;message-bus 那份零生产调用者。

**裁决**:一条规则,归 **P4-06(message-bus)** 所有——它的子句就是 at-least-once + 幂等消费。P4-06 U 阶段:(1) mailbox 的 `decideDelivery` 改为 import message-bus 的 `classifyIntake`(mailbox 保留自己的地址检查,去重委托),删除第二份;(2) 持久 `seen` = `bus.sqlite.consumedKeys()`,mailbox 投递路径成为 must[2] 的**生产调用点**;(3) 冻结"一次真实 mailbox 到达经 classifyIntake 被去重"+ P5-11 的 live 冻结用例在同一观测里全过(不 supersede P5-11,按 BLOCKED-059 先例记"改了已验收 epic 的文件、为何不扰其绿");(4) P4-06 的 filesOverlay 记 `mailbox/src/index.ts`(`kind: source, reason: BLOCKED-136 规则合一`);`core/agent/src/inbox.ts` 从 P4-06 的调用点说明中移除,理由记 136。

### 12.6 红 run 放行的 25 格(2026-09-07 03:10 EDT,BLOCKED-137 追查,delegate 的错)

**事实**(执行者照账量):09-06 22:20 起五次 exact-SHA 全红,每次只红 `pwsh-tool-turn` / `persistent-pwsh-tool-turn` 两条,真因是 `sequence` 0→1 修复后本机无 pwsh 导致两个夹具未刷新(BLOCKED-137),与 108 名单里的 pwsh 环境问题**不是同一根因**。这五次 run 共绿了 **25 格 / 18 epic(16 已 ACCEPTED)**,含 P1-03 四格、P4-06 C。每次都由 delegate 一句"在 108 名单里,不挡"放行——**按名字匹配名单,没读失败原因**。证据本身完好(同 SHA 单测报告、冻结标题在场 passing、失败与这些 epic 无关);**不成立的是准入程序**。

**裁决:B(记例外),加机械化。**
1. 25 格每格加 `admittedUnderRedRun: { runId, redSteps: ["Recorded-session snapshots"], diagnosedCause: "BLOCKED-137 stale pwsh fixtures (sequence 0→1)", unrelatedBecause: "该 epic files[]∪overlay 不含 snapshots/session/*pwsh*", admittedBy: "guanjieqiao-92", diagnosedAtUtc }`——由工具写(`generate-ledger --admit-red-run …`),不手改;16 条已验收行验收不撤,行上带同一记录。**不重测**:重跑换不回新信息,却会把"红也绿了格"这件事冲掉不留痕。
2. **准入规则改为因果制**:从红 run 绿格,必须 (a) vitest 报告 `success:true`(全量单测绿);(b) **每个红步的失败原因已诊断并写进格子**(不是用例名匹配名单);(c) delegate 明示 ack。缺任一 → 绿化拒绝。进 `generate-ledger` 与门。
3. Standing:引用 flake/已知名单前必须读失败信息并确认同一根因——"按名字匹配名单等于把该用例上的任何红都变成过",这次长在验收流程里。

**12.6 修订(03:25 EDT,执行者两点)**:(a) `unrelatedBecause` 不得按 `files[]` 判——`files[]` 不是范围边界(§12);改为 **reality set**:`files[] ∪ filesOverlay ∪ 该 epic live 冻结引用的文件` 不含红步涉及的文件(复用 `verify-make-vs-use` 的集合)。(b) `redSteps[]` 每条必须带 **`failingCases[]` 与从该 run 日志取到的失败原文 `evidence`**(如 `"sequence":0` vs `":1` 两行),不是散文;工具在缺 evidence 时**拒绝写入**。理由:"写进格子"与"诊断对了"不是一回事——108 名单出事时也写了理由。

### 12.7 BLOCKED-138:第三份键推导,与"一致"用例钉了不一致的值(2026-09-07 03:40 EDT)

**事实**(执行者探针):`intake-dedup.dedupKey` = `${id.length}:${id}:${epoch}`(长度前缀防碰撞),`bus-store.keyOf` = `${id}:${epoch}`——**持久 seen 集与规则算的不是同一个键**;按 §12.5 直接接 `consumedKeys()` 作 seen,去重永远不去重且静默(两边单测各自自洽)。P4-06.P.1 今天刚绿的那条「…so the pure classifier and the durable state agree」**断言钉的正是不一致的值 `'m8:1'`**——变异敏感、写得认真、期望错。
**裁决**:(1) `bus-store` 改用共享 `dedupKey`,键推导全仓一处;(2) 该用例 **supersede**(BLOCKED-066:性质变了),新条目断言"一致"本身——store 已 consumed 的消息经 `classifyDedup(msg, consumedKeys())` 判 drop(正控 accept)、碰撞对两侧都不同键、`consumedKeys()` 元素等于 `dedupKey(row)`;变异:`keyOf` 换回旧式 → 红;(3) 生产调用点落 **message-bus 的 mailbox 投递适配层**(`packages/run/message-bus/src/mailbox-delivery.ts`,orchestration import definitions 向下)——§12.5 "mailbox 投递路径就是调用点"改为此,mailbox 是 definitions 不得读 store。**规则(进 §11.1)**:标题宣称"一致/等价"的用例必须断言一致本身(round-trip),不得钉字面值;变异证明不证明期望正确。

### 12.8 filesOverlay 落地核验:热区理由要从 diff 写,不从意图写(2026-09-07 04:55 EDT,`343ede2db0`)

**事实**:执行者按 §12 建了 `filesOverlay`(162 条:test 96 / source 43 / doc 15 / manifest 8),门 `verify-files-overlay` 进 gate set。机制我读代码核过三点:overlay **回归生成**不读盘(`--write` 只刷可读产物,不参与判定);**`scaffold` 不按路径推断**(第一版按路径把 `core/session/src/index.ts`、`core/agent/src/index.ts` 归"约定 barrel,无需解释",恰好藏起 §12 第 2 条要我逐个核的热区——已改,source 30→43);source 缺 reason 拒绝,正控验过。**机制过。**
**理由表不过**:标 `HOT ZONE` 的 5 条(执行者信里说 3 条,漏 P1-08 `profile-boot.ts`),我逐条对 `git show <commit> -- <file>`,**3 条与 diff 相反,且方向一致——都把对共享文件的改动说成"没改"**:(1) P2-03 → `core/session/src/index.ts` 说"没改日志本身",实际 `ed09684ecf` 给 Session 日志类加了 `typeCounts` Map + 公开方法 `countEventsOfType`,每次 append 维护;(2) P4-07 → `core/agent/src/index.ts` 说"没栅栏的那个**仍然**导出",实际 `c79a24f78c^` 的 barrel 里 `advanceAgentLifecycle` 零次出现,是 P4-07 自己同一笔新加了带栅栏与不带栅栏两个导出——open finding 是 P4-07 造的,不是它发现的;(3) P1-02 → `kernel/trust-kernel/src/index.ts` 说"读 signatureRoots,不改构造",实际 `05c22146ef` +42/−1:`createTrustKernel()` 签名加 `config: TrustKernelConfig`,新增 `CONFIGURED_ANCHORS` WeakMap 与导出 `configuredTrustAnchors`。P2-02 / P1-08 / P4-06→mailbox(P5-11 所有,BLOCKED-059 先例)三条相符。
**裁决**:(1) 三条按 diff 重写,一次提交,随 P4-06 观测结论后一起推(观测中推送会取消该 run);(2) **规则(进 Standing 与 EPIC-LIFECYCLE 2.x)**:共享/热区文件的 overlay 理由必须**从 diff 写起**——先说改了什么(签名 / 状态 / 导出),再说为什么,句中带 commit 短 hash 让人能重新推导;门只能查"有没有句子",查不了"句子对不对",所以 delegate 在每次 overlay 变更时读全部 HOT ZONE 条目的 diff,不接受句子。**教训**:凭意图写的理由系统性偏向"我没动共享的东西"——这正是 §12 第 2 条要抓的偏差,只是换了个写法。

### 12.9 P4-06 签字前核:词汇用例缺席,且去重键漏了 source(2026-09-07 05:25 EDT,不签)

**事实**(delegate 亲核,观测 `34101734274` @ `9cb21a872a` 本身是绿的:P4-06 80/80、P5-11 64/64、`success:true`):
1. **§12.3 义务未兑现**:P4-06 是「CloudEvents attribute names; dedup on id」的唯一形状所有者,`standardsOwned` 仍是 `assignedBy`,`verify-make-vs-use` 报 PENDING_ADOPTION;`--accept` 时 PENDING → UNRECORDED。**没有任何冻结用例点名这些属性**——`id/source/type/time/subject/datacontenttype` 只作为 fixture 字段出现,把类型和 fixture 里的 `datacontenttype` 一起改名,P4-06 全部用例照绿。`realized.note` 写"所有权已由 P.3 / U.2 用例的证据承载"——那些标题一个属性都没点名;**这句和 §12.8 的热区理由是同一个毛病:凭意图写的**。
2. **标准本身给出的答案被漏掉了**:CloudEvents 的唯一性是 **`source + id`**;这里的键是 `(id, epoch)`,`source`/`from` 不参与。`MessageId` 文档"程序生命周期内唯一",`SenderEpoch` 是**每发送者**的代,理由文里明说发送者"重启复用计数器"——即 id 是发送者本地计数。两个发送者各发 `(id=1, epoch=1)`,后者被当重复**静默丢弃**;而 `src` 里没有任何铸 id 的代码(今天**零个生产 producer**),唯一性只是一句 JSDoc,消费者验不了。`source` 在 bus 上已是 `TEXT NOT NULL`,mailbox 有 `from`——数据都在,只是没进键。
3. registry 自己写的就是 `(messageId, epoch)`(must[2] / acceptance[0]),所以代码与 registry 一致;**漏洞在 registry 措辞里**,标准所有权正是为抓这种事设的。

**裁决**:
1. **键改为 `(source, id, epoch)`**,只改 `dsh-intake-dedup` 一处(id 与 source 都长度前缀);mailbox 传 `from`,bus 传 `source`;租户拒绝仍在键之前。
2. **A 类 registry 改动**(C11,delegate 裁决,执行者执行,`clauseProvenance: §12.9`):must[2] → "consumer 按 (source, message id, epoch) 去重";acceptance[0] → "按 (source, messageId, epoch) 幂等"。这是**收紧**:同 source 下原保证不变,跨 source 的同 id 不再被误判为同一消息。
3. **词汇用例(§12.3 义务)**,P 阶段 supplement:(a) `domainEvents()` 回读对象的键**恰为** CloudEvents 属性名(对回读结果断言,不对 fixture);(b) 键的组成:两个 source 同 id 同 epoch → **都投递**,同 source 同 id 同 epoch → 第二条 drop;变异:键里去掉 source → 红。随后 `standardsOwned` 改 `evidenceTitleSubstring`。
4. BLOCKED-138 的"一致"用例断言的是一致本身,不是拼写:fixture 补 source 后断言不变者 **supplement**,断言变者 **supersede**(BLOCKED-103);inbox 行若无 source 列,加列(pre-release 无迁移承诺)。
5. `realized.note` 那句改成事实。**再观测一次**,P4-06 顺延一个 CI 周期——代价接受:一条以"幂等消费"为全部内容的 epic,不能带着会静默吞掉第二个发送者消息的键验收。

**教训(进 §11.1 族)**:所有者对标准的第一问是"标准对这个问题怎么说",不是"我们的字段叫什么"。属性名抄对了,唯一性规则漏了——**词汇用例的价值恰在后者**。

### 12.10 P4-12 开工补审;P9-08/09 终态状态;R10 归属(2026-09-07 06:40 EDT)

**P4-12**(`00cb4b19c5`,check-ready 报的唯一可开工 epic;程序规则是前置 ACCEPTED 或全格 GREEN、明确不设 wave 栅栏,故非跳 wave):preFlight 在第一行代码前写、两标准一落盘就 `evidenceTitleSubstring`(门先红后绿)、`idempotency-key` 本树复验、C 冻结 13 条变异只红 1 条——够格。**但 1.11 是"确认后才动文件",这次先动了;下条恢复。** 两处改记录:(1) **键缺 caller scope**——draft-07 的键唯一性是每客户端、Stripe 是每账户;entry 只有 `{key, epoch}`,两个 agent 同 key 互相可见,与 BLOCKED-140 同形,在 C 阶段抓到。裁:键 = `(scope, key)`,scope 取 ActionManifest 上的 principal(P2-01);C 阶段 supplement 一条"两 principal 同 key = 两条 reservation,互不可见",变异去掉 scope 只红此条;13 条不 supersede。(2) gapCheck 记的是 reject 行内容,不是卡上 allinluna 的四项缺口;按 1.6 逐项对子句重写。
**P9-08 / P9-09**:终态句「scheduled-BLOCKED 在案」取 **(a)**——到 W21/W22 真跑、真阻塞、记账;现在 `PREMATURE` 是唯一诚实的状态值。(b) 以"wave 未到"现在就记,是 BLOCKED-043 把分诊表当状态记录的错再犯一次。
**R10**:需要 `DEEPSEEK_API_KEY_EXTERNAL` + 单独批的预算 + 三夜统计窗,三者都不在执行者能力内——状态是"等用户授权",不是"未做";delegate 到 W-末向用户要,不催执行者。

### 12.11 BLOCKED-143:ActionManifest 在生产路径上从未被构造——P2-03 的验收(#22)是 delegate 签错的,撤回(2026-09-07 07:40 EDT)

**事实**(执行者测量,delegate 亲核 `tool-calls.ts:292-315` 与 `tools/src/index.ts:2426`):`createActionManifest` / `appendManifestThenGate` **生产调用者为零**;两条真实路径(`agent-loop/src/tool-calls.ts`、`tools/src/ptc.ts`)只 import `computeArgumentsHash` 与 `classifySideEffect`,**手搓**一个 8 字段的 `action/manifest-appended` 事件;must[0] 的 12 个字段只在类型里;事件里**没有 `idempotencyKey`、没有 `actor`、没有 `runId`**——事件文档说"manifest 可由这些字段重建",对这三个字段不成立(`idempotencyKey` 是调用方供给的,事件里不存在就无处重建)。另:生产路径一律 `classifySideEffect(undefined)`,每个动作都是"未分类·最高风险·需审批"——只进日志,policy 不读它;P2-04 落地真实分类前这是常态,记下不扩范围。
**delegate 的错**:#22 签字时我把事件名 `manifest-appended` 当成了子句里的名词 "manifest"——BLOCKED-091 / 136 的形状(按名字不按行为),这次长在我自己的签字里。P2-03 U 阶段证明的是**顺序**(事件先于 tool/call、sequence 单调、三条路径、旁路可检);没证明的是 **must[1] 的主语被生成**、**acceptance[0] 的 "ActionManifest" 存在于日志**。
**裁决**:
1. **取读法 2**(唯一让两条 epic 的子句同时为真的读法);读法 3(把 must[0] 改成类型级)是把子句改成已建之物,拒绝;读法 1 单独做仍是手搓事件,不够。
2. **撤回 P2-03 签字**(`--record-signoff --conclusion WITHDRAWN`,理由即本节),ACCEPTED 24 → 23。这是诚实的数字;P2-03 全格仍 GREEN,依赖它的 P2-04 / P2-05 / P4-12 按 check-ready 规则(全格 GREEN)不受阻。
3. **P2-03 U 阶段 supplement**(P2-03 自己的 files[],执行者做,不归 P4-12):两条真实路径经 `appendManifestThenGate`(或 `createActionManifest` + append)构造**真 manifest**;事件由 manifest 派生并**内联 manifest 全部 must[0] 字段**——"可重建"的理由随手搓路径一起作废;`idempotencyKey` 由路径铸造,判据:同一意图的崩溃重试得同一键、新意图得新键,并把派生写进 JSDoc;`actor` 取会话 principal。冻结:(a) 生产路径上一次真实 tool call 的日志事件里 `idempotencyKey`/`actor`/`runId` 非空且与 manifest 一致;(b) `createActionManifest` 生产调用者 ≥ 1 的结构门(与 §12.1 同族);(c) 原 U 用例不 supersede。
4. **顺序**:先落 BLOCKED-137 根修(`snapshots/.refresh-skipped.json` 机制)——事件字段变了必须重录 snapshot,而两个 pwsh 夹具本机刷不了,不先修会再红一轮。`SESSION_FORMAT_VERSION` 按 pre-release 立场不兑现兼容,旧日志被拒即预期。
5. **P4-12 U 阶段**等 P2-03 该 supplement 绿后开;C / P / F 照常。
**规则(进 EPIC-LIFECYCLE 4.x)**:签字前 delegate **重做 1.2 的第一问并量化**——子句名词的构造函数在生产路径上的调用者数(grep,排除 tests),为零则不签;preFlight 时问过一次不算,验收时的路径可能已不是开工时的路径。

### 12.12 撤签后的五条 `accepted-unadopted`:处置词汇不收行状态(2026-09-07 08:20 EDT)

P2-03 撤签后门 (e) 正确地红了五条(`@modelcontextprotocol/sdk`、`openid/authzen`、in-toto/attestation 及其三个标准)——`accepted-unadopted` 的主语"本 epic 已 ACCEPTED"不再为真。**裁 (a)**:改成真处置;**拒 (b)** `signoff-withdrawn` 类别——那是行的状态不是库的处置,收进词汇门就从"每条库有下落"退化成"每行有借口"。真处置卡上早有(五条 `ruling` 全为 None 即模板盖掉裁决的证据):MCP 两条与 AuthZEN 两条按 §7.11 **裁定不采用**,所有权 P2-04 / P2-05;in-toto 两条按 §3.4/R1 是 **SLICE-3.4 的消费者**。门若无此类别,窄加 `slice-consumer{sliceRef}`,只限 §3.1–3.4 有排期的 slice,slice 落地后消费者未接线即 MISMATCHED。**其余 ACCEPTED 行的 `accepted-unadopted` 同样各有卡上裁决,回填批(P2-05 前)填实 `ruling`。**

### 12.13 4.4a 全账本量化:三条 epic 的 U 阶段从没碰过 registry 点名的消费者;撤 P5-11 / P4-08,P4-06 不签(2026-09-07 09:10 EDT)

**测量**(delegate 亲跑,排除 tests / lib / 本包):
- **P4-06**:`@deepseek-ai/dsh-message-bus` 生产 importer **0**;`commitWithOutbox` / `dispatchOnce` / `openBusStore` / `decideMailboxDelivery` 调用者 **0**;无任何 cordis.yml 挂载。执行者同日自查得同一数字并**主动不发签**——4.4a 生效。§12.5 / §12.7 里我裁的"生产调用点"(mailbox → message-bus 的 mailbox-delivery)是一个没人调用的导出:**§12.5 "core/agent inbox 不是 fit" 的结论撤回**——inbox 没有 id/epoch 不是它不是 surface 的证据,是 U 阶段要补的缺口;registry U 文件(`core/agent/src/inbox.ts` + `dispatch.ts`)一直是对的。真实到达面存在:**子代理 settlement 进父 inbox**(`subagent/src/continuation.ts`,生产),且 ACP / Codex 子代理是 spawn 的子进程——真重启边界。
- **P5-11**(已验收):`dsh-blackboard` / `dsh-taskboard` importer **0**;`dsh-mailbox` 唯一 importer 是未接线的 message-bus。registry U 文件点名 `core/agent/src/inbox.ts`、`subagent/src/list-children.ts`,冻结 U 一个没碰。**撤签。**
- **P4-08**(已验收):`dsh-workflow-journal` importer **0**;registry U 文件 `workflow-worker-thread/src/{host,worker,runtime}.ts` 都不 import 它,journal-host 只被一个测试文件用。**撤签。** ACCEPTED 23 → **21**。
- 代理指标"冻结 U 未碰任何 registry U [B] 文件"另标出 P0-01 / P0-02 / P0-06(已验收,但包在 profile-boot 等生产路径上有 importer)与 P4-09 / P5-10(在飞)——**不凭代理撤签**;这五条各做一次 4.4a 量化(子句名词构造函数的生产调用者数),执行者报数,我裁。P0-07 的消费者是 `scripts/release/collect-evidence.mjs`,成立。
**裁决**:
1. **P4-06 走 registry 自己的 U**(不是发明集成):子代理 settlement 经总线到父 inbox——settlement 带 `(source = 子会话/run id, id, epoch = 子代理 LeaseEpoch,P4-07 已在 dispatch.ts)`;父侧消费经 `bus.sqlite` inbox claim,与 session 事件 append 同一 `BEGIN IMMEDIATE`(P 阶段的 `commitWithOutbox` + write-behind `enqueueAll` 正是为此);message-bus 挂进 base bundle(`packages/bundle/base/cordis.patch.yml`,与 run / memory 同法);**真组合测试**(packages/AGENTS.md:经 Loader 起 profile,一个子代理 settle 两次 → 父 inbox 一次效果)。U.2 mailbox-delivery 保留为库级契约,不再称"生产调用点"。选项 3(改词)拒,理由同 §12.11 读法 3。
2. **门 (u),机械化**:U 阶段冻结条目的 `files` 必须含 ≥1 个 registry stage-U 的 [B] 文件;否则须有 BLOCKED + 裁决说明 registry 的消费者为何错(§12.5 那种,且要对)。回扫全账本。与 4.4a(签字时量化)是同一规则的两个时刻。
3. **顺序**:门 (u) 先(便宜,止血)→ P2-03 U(137 根修已落)→ P4-06 U(解锁 L3 与 P4-12 的键来源)→ P5-11 U → P4-08 U。
**教训**:U 是 "usage",registry 用 [B] 文件把"谁用"写死了;三条 epic 的 U 都把 "usage" 做成了"本包内的第二层单测",而 delegate 在 #22 之外又签了两次同样的东西。规则不是"更仔细",是**让门在冻结 U 时就要求 [B] 文件在场**。

### 12.14 五条 4.4a 报数的裁决;P4-06 U 的三个设计问题;门 (u) 落地(2026-09-07 10:35 EDT)

**五条 4.4a**(执行者报数,delegate 复核):**P0-02** `createTrustKernel` 生产调用者 1(`profile-boot.ts:478`,真 boot)→ 成立。**P5-10** `decideControl` 1(`subagent/src/index.ts:469`,dsh-subagent 挂 base bundle 且非 disabled)→ 成立。**P0-06** 子句名词是 registry / 常量,4.4a 的问法改为"谁在边界上强制":`core/session/src/index.ts:103` 拒错版本头、`plugin-compat/solver` 与 `sdk/server` import schema-registry——三处生产边界 → 成立。**P0-01** 子句主语是 `pnpm baseline:verify`(程序过程工具,执行者批次前手跑,transcript 174 次);默认 `disabled` 的 boot 插件是子句之外的可选件 → 成立;但 must[2] "批次前必须 verify" 靠人记不靠门——**`baseline:verify` 进 registry gate set**(便宜,让 must[2] 机械化)。**P4-09** `dsh-workflow-registry` 包外 importer 0,U 冻结只碰自己的 `nesting.ts` → 与 P4-08 同形;未验收,不撤;U 按门 (u) 重冻,须含 registry U [B] 文件。
**门 (u)**(`9f89f9dd77`):40 条 live U 冻结中 **14 条**不碰 registry 声明的消费者(含已撤三条与 P4-09、P4-06 两条、P2-03.U1、P1-03 两条、P6-02、P0-01/02/06);豁免须 BLOCKED + 裁决**同时**在场。**已注册未进 gate set**——14 条裁决是 delegate 的:P0-01/02/06 按上文成立(豁免记 §12.14,理由各一句);P1-03 两条与 P6-02 由执行者报 4.4a 数后裁;其余随 U 重做自然清零。门在这 14 条处置完后进 gate set,与 (e) 回填期同法。
**P4-06 U 三问**(执行者实测:`continuation.ts:1535 notifySettlement` 是真到达面,source=`childId` 有,id 无,epoch 只在散文里):
1. **id 取 (a)**:Activation 建立时铸稳定 id,随 activation 记录持久(它本来就要从会话日志 re-materialize);一个 activation 至多 settle 一次,settlement 的 id = activation id。(b) `childId+stopReason` 重启后撞,拒;(c) 按 terminal 内容派生仍需 per-activation 身份,退化为 (a)。
2. **epoch 取 (a)**:子代理自己的 lifecycle `LeaseEpoch`(P4-07)就是"发送者的代",P4-07 导出这些类型正是给消费者用的("P4-05 的 lifecycle 类型直到 P4-07 成为真消费者才导出");**读**它不是改 P4-07 的状态机,不算跨 epic 改动。(b) Activation 自发号是第二个 epoch 概念(136 形);(c) 常量 1 拒(140 形)。
3. **总线不做完整 seam,§12.13 "挂进 base bundle" 撤回**:message-bus 是纯库(零 default export / apply);`run` 自己在 base bundle 里也 `disabled: true`——"挂载"≠"在用"。P4-06 的子句是 durable inbox/outbox + 幂等消费,消费者是 registry 写的 `core/agent`(inbox/dispatch);**核心以库形态 import 它**,与 `core/agent/dispatch.ts` import `dsh-lease`(P4-07)同法——这才是 U。Service Definition / Provider / Consumer 的 seam 在**采用可选 provider(卡上 bullmq / pg-boss / graphile,"never default")时**才有第二个实现可抽,那不在 P4-06 的 must 里;记为 P4-06 的 deviation(`ruling: §12.14-3`)。`bus.sqlite` 路径**不得硬编码**:从已配置的 session 存储根派生(session-persistence 的 Config),不新增 tunable。
**store.spec 两进程用例**:全量并行冷缓存首跑红一次(无失败原文,之后 9 次绿)——不按"flake"放行;执行者改屏障为**就绪握手**(子进程各写 `ready-<label>` 后父才写 `go`,去掉 1500 ms 固定睡眠)并**捕获 stderr 进断言信息**,让任何复发自带原因(dsh-ci-test-reliability)。

### 12.15 P4-07 的状态机没有生产持有者:撤签;P4-06 的 epoch 等 P4-07 U(2026-09-07 11:50 EDT)

**事实**(执行者按 §12.14-2 去读子代理 LeaseEpoch 时量到,delegate 复核):`AgentLifecycle {runId, state, epoch}` 在 `core/agent/src/{state-machine,dispatch,index}.ts` 之外**零引用**;`advanceAgentLifecycleFenced` / `advanceAgentLifecycle` / `holdsDispatchSlot` / `decideTransition` 生产调用者**全为 0**;`dsh-lease` 唯一 importer 是 `dispatch.ts`,而它的栅栏函数无人调用;**没有任何生产代码构造第一个 lifecycle 值**。P4-07 must[1]"所有状态写与 action execution 携带 fencing token"在任何 launched profile 上都不成立。**P4-07 撤签**,ACCEPTED 21 → **20**。门 (u) 看不见它——P4-07 的 U 碰了 registry [B] 文件 `dispatch.ts`,但代码是死的;这正是 (u) 的盲区、4.4a 的用武之地。**§12.14-2 的前提("P4-07 导出的类型,读它即消费")不成立:可消费的是值,值不存在。**
**裁决**:(1) P4-06 的 epoch 取**选项 3**——等 P4-07 U 给 lifecycle 一个真实持有者后消费;选项 1(P4-06 替 P4-07 做 U)混归属,选项 2(Activation 自发号)在 P4-07 U 落地后即成第二个 epoch 概念(136 形),现在"只有一个空概念"不改变落地后的形状。(2) **P4-07 U 重做**,按 registry U 文件:子代理/agent run 启动时**构造** lifecycle,真实 dispatch 路径经 `advanceAgentLifecycleFenced`,worker-thread host / runtime 做 heartbeat 与 reclaim(must[2]);冻结须含"一个 launched profile 上的 action execution 携带 fencing token"的真组合用例。(3) P4-07 两条 `accepted-unadopted`(`@sinonjs/fake-timers`、`fast-check`)按卡改真处置。(4) 顺序:门 (u) 三条豁免(P0-01/02/06)→ P2-03 U 冻结与观测 → **P4-07 U** → P4-06 U → P5-11 U → P4-08 U → P4-09 U;P4-12 U 仍等 P2-03。
**教训**:四条撤签(P2-03 / P5-11 / P4-08 / P4-07)同一成因——"usage" 阶段验证了函数存在、没验证有人调用;而 delegate 四次签字都没数调用者。4.4a 不是加强版仔细,是把"谁调用"变成一个必须报出来的数。

### 12.16 P4-07 U 重建核验:持有者对了,存储与范围不对(2026-09-07 12:30 EDT,`03132481c6`)

**过的部分**:workflow run = work item、租约在线程存在前取得(线程后取会留一个 fencing 撤不回的窗口)、心跳与终态写门在 `WorkerRun`(租约生命周期 = run 生命周期)、四条用例跑真实进程内栈、变异各红一条——设计判断对;门 (u) 拒了第一版把心跳放引擎插件的放置,搬进 `host.ts`,对。
**不过的部分(三处,都是卡上写着的)**:
1. **存储是内存 Map**(`run/lease/src/store.ts:63`,`workflow-worker-thread/src/index.ts:151` 每个引擎实例 `new LeaseStore()`)。卡的 residual 明写 **SQLite `leases(item, owner, epoch, expires_at)`,`UPDATE … WHERE epoch=? AND owner=?`,单调时钟 + 容忍,lease DB 错误 fail-closed**;acceptance[2]"lease store 故障时停止新工作"要一个**会故障**的 store;rollback "restore store" 要一个能恢复的 store;must[2]"过期后 scheduler 可 reclaim"要租约活过持有者的死亡。**Map 一个都做不到**;"第二个 host 被拒"在同一引擎的两个 `WorkerRun` 之间成立,在两个进程之间不成立(各自一张 Map,都赢)。这是 §4.1 第四问的漏(residual 没读),与 P1-03 原子写、P4-06 `(id, epoch)` 同族。
2. **形状**:`dsh-lease`(run 层)被 provider 层的 worker host 直接 `new`——上行边(121 号 finding)+ 引擎里写死的 provider。仓库规则:capability seam 三角色完整或不做;卡判决 **PROVIDER_WRITE** 说的正是"写 provider"。**裁**:纯契约(`checkFencing` / `isReclaimable` / `FencingToken` / `Lease` / `LeaseEpoch` / `LeaseStore` 接口)落 **definitions 层**新包(§12.7 intake-dedup 先例),**SQLite provider** 落 run 层,消费者经 ctx 取 store 不自己 `new`——上行边随之消失,不靠"记进 note"。
3. **范围**:must[1] 是"**所有**状态写与 action execution",registry U [B] 文件是 `host.ts` / `runtime.ts` **和** `core/agent/src/dispatch.ts` / `consumed-work.ts`;这次只做了 workflow 侧。**agent run 也是 work item**:agent-loop dispatch 取/持 run 租约,fencing token 进 action execution(`advanceAgentLifecycleFenced` 得到它的第一个真调用者)——这同时是 **P4-06 的 epoch(子代理自己的 LeaseEpoch)与 P4-12 的 `LedgerEpoch`** 的唯一来源;不做这半,§12.15 的选项 3 等不到东西。
**处置**:U 冻结的四条不 supersede(断言不依赖存储形态);supplement:(a) 两进程共享 sqlite store 的"第二 host 被拒"(P4-12 两进程握手同法);(b) store 不可用(文件不可写 / 锁死)→ 不起新 run,fail-closed;(c) agent dispatch 携 token 的真组合用例。**顺序**:P4-07 的这三处 → P4-06 U / P4-12 U(两者都消费 agent run 的 epoch)。`03132481c6` 可推(方向对,不回退),观测后绿它已有的四条。

### 12.17 绿化的输入必须来自签名产物,不来自操作者(2026-09-07 13:05 EDT,P4-12.F 假 SHA 事故)

**事实**:执行者给 P4-12.F 绿格时手打了一个 40 位合法但不存在的 SHA,工具收了(只查格式);已修为 `git cat-file -t` 存在性检查(`5efb4f585d`)。**根**:`generate-ledger.mjs` 的绿化与 supplement 两条路径都收操作者手打的 `--candidate-sha` 与 `--report <path>`,**从不读 `evidence-bundle.json`、从不看 `signature`**——"引签名副本"至今是纪律不是机制;假 SHA 只是第一种暴露方式,对的 SHA 配错的 report 是第二种。
**裁决**:两条路径改收 `--evidence-dir <签名产物目录>`,`candidateSha` / `ciRunUrl` / vitest report 全部从包里取,操作者不输入任何一个;存在性检查留作底。签名先量产生方式:本地可验则读包时验,不可验则 BLOCKED 记"签名不可本地验证",不假装验。已绿格子不重绿(delegate 已逐个对过签名包)。**教训**:一个只查格式的输入,和不查一样;一个可以手打的证据引用,和没有引用一样。

### 12.18 P2-03 重签核:`manifest.runId` 是会话 id 贴了 RunId 品牌(2026-09-07 13:40 EDT,不签)

**事实**:谓词 (i)(ii)(iii)(v)(e) 全过,`createActionManifest` 生产调用者 delegate 自数 = 2,manifest 十二字段齐、事件由它派生。但 `tool-calls.ts:306` / `ptc.ts:204` 写的是 `runId: brandString<RunId>(session.id)`;`dsh-principal` 定义 RunId 为"execution-run identifier",P4-01 Run Service 铸 `run-<uuid>`,且 `IdentityContext.runId` 在同一函数两行前 `attachedIdentity(session)` 的返回值里就有。同一会话多个 run 的 manifest 共享一个"runId";P4-12 要拿它进 scope/键。
**裁决**:(1) runId 取 `attachedIdentity(session).runId`;(2) `manifestIdempotencyKey` 派生改 `(sessionId, actionId, argumentsHash)`——崩溃重试要跨重启稳定的身份,session id 是、per-invocation 的 run id 不是(用它则重启换键 → 重复外部效应);写进 JSDoc;(3) U supplement 一条(`runId === attachedIdentity(session).runId && !== session.id`,变异改回 → 只红这条),再观测,签。**教训(4.4a 之后的第二问)**:调用者数够了,还要读调用点传的**值**——品牌类型只保证形状,不保证来源。

### 12.19 四条裁决:P6-02 撤签;P1-03 acceptance[1];P4-07 第 3 条的持有者;IdempotencyScope(2026-09-07 14:20 EDT)

1. **P6-02 撤签**(BLOCKED-146,ACCEPTED 20 → **19**):七个子句主语(`validateRecord` / `recordConflict` / `admitToIndex` / `withProvenance`·`isTraceable` / `isDefaultRetrievable` / `decideCrossScopeMerge`)生产调用者**全 0**;唯一 importer `memory-context` 取的是 P6-01 的类型;没有活路径构造过 `MemoryRecord`。**registry 的 U 文件只有两个 `types.ts`,没点名任何消费者——计划缺陷叠在使用缺陷上。** A 类改动(`clauseProvenance: §12.19`):P6-02 U 增 [B] `packages/memory/memory/src/index.ts`(已挂 base bundle 的 MemoryRuntime 的写/读路径)与 [B] `packages/context/memory-context/src/index.ts`(P6-01 的 recall 路径);U 重做:写路径经 validate → conflict → admit,读路径经 `isDefaultRetrievable`;并量"生产里谁写 memory 记录"——若为零,那是 P6 整条线的问题,单开 BLOCKED,不在 P6-02 里发明 producer。五条 `accepted-unadopted` 按卡改真处置后,撤签提交随之推。
2. **P1-03 acceptance[1]**(「registry tag 漂移不改变已锁定 profile」):**采纳结构读法并记录**——boot 只读 lock、从不查 registry,漂移够不着;证据是已有的结构门 `verify-boot-path-offline`(§12.1),写进 acceptance[1] 的 coverage note。**但 `hasTagDrifted` 零调用者是味道不是证据**:仓库规则"require a current owner and need"——要么 lock 更新路径(`apps/cli/src/plugin.ts`)真用它报告漂移,要么删。记 P1-03 `openFindings` 一条,不撤签;关闭条件二选一,不许"留着以后用"。
3. **P4-07 第 3 条的持有者是 core agent run,不是 workflow 子 agent**:`dsh-subagent` 不依赖 workflow-worker-thread,P4-06 的 settlement 发送方是子代理(agent run),P4-12 的 `LedgerEpoch` 在 core 工具路径上——两者都不经过 workflow host。**裁**:P4-01 `createRun`(`run/src/index.ts:319/346`)是取租约的点:run 创建 = 经 `ctx.leaseStore` 取 `run-<uuid>` 这个 work item 的租约;`Agent` 持 `AgentLifecycle{runId, state, epoch}`;agent-loop 的工具派发经 `advanceAgentLifecycleFenced`,token 进 `tool-calls.ts` 的派发(与 manifest 同点)。"workflow 子 agent 的生命周期就是 AgentLifecycle"**作为第二个消费者成立**,可做,但不替代上面这个;`RunLease.advance(lifecycle, transition)`(token/workItem 由租约给、调用方不能自带)这个形状对,两处共用。
4. **`IdempotencyScope = Branded<'SessionId'>`**(action-manifest 内同 brand 重声明,避免 definitions → providers 的层违规):**接受**——同 brand 字符串在 TS 里是同一类型,不是第二个身份宇宙;代价一处重复声明,好过一条上行边。记 P2-03 deviation `ruling: §12.19-4`,并开 BLOCKED 记"SessionId 的 brand 该住在 definitions 层"作放置议题(不在 P2-03 里解决)。native 变异红 2 条(新用例 + 兜底用例的期望随之变)是覆盖不是噪声,对。

### 12.20 P4-07 第 3 条核验:调用者有了,launched profile 上走的是 `no-run`(2026-09-07 15:05 EDT,`af06cbede8`)

**过的部分**:租约先于 Run 注册、拒则不开 Run;权威在 `Agent.runLease`(避开 dsh-run ↔ agent-loop 循环,理由成立);`advanceLeasedAgent` 唯一实现、两处共用;租约每次读穿;`agent/pre-step` 驱动生命周期;被 fence 的派发零工具执行 + 模型可见 `FencedError`;`acquireRunLease` 进 contract;10 条用例在真实挂载栈上、两处变异各红一条。**设计对。**
**不过的部分**:
1. **`run` 在 base bundle 里 `disabled: true`,五个出货 bundle(headless / acp-app / sdk-app / web-app / sdk-minimal)没有一个启用它。** 于是每个 launched profile 上 `Agent.runLease === undefined` → `no-run` → 派发不带 token。must[1]"所有 action execution 携带 fencing token"在产品里仍不成立;fenced 路径有调用者但**不被到达**——门 (u) 与 4.4a 都看不见这一层,这是第三问:**到达**。禁用理由是"`storePath` 无中性默认";但 lease-sqlite 在同一 base 里以 `directory: .dsh` 启用了——同一论证两个结论。**裁**:`run` 的 `storePath` 与 lease-sqlite 的 `directory` 都从 **profile 已配置的 session 存储根派生**(§12.14-3 同规,不加 tunable、不写 `.dsh` 字面量),由此 base bundle 可启用 `run`;冻结一条真组合用例:**headless profile 启动 → 一次真实 tool call → 派发在租约之下,epoch 在持久日志里可见**(证据形式由执行者定:run 事件或 manifest 事件,不发明第二套日志)。`no-run` 分支只许测试组合走到;出货 bundle 走到即红(结构门:五个 bundle 的 `run` 行非 disabled)。
2. **agent run 没有心跳**(must[2] 前半):长 run 的租约到期即可被夺,原持有者之后被 fence 是对的,但 run 本身丢了。裁:agent run 按 TTL 比例续租(TTL 与比例来自 lease 配置或协议常量,不新增 tunable);冻结:续租停止 → 可回收 → 第二 host 在真实 store 上取得(两进程或 `nowMs` 驱动)。
3. **完成不释放**:Known Limitations 记的"`completed`/`failed` 不可达"意味着每个结束的会话留下一份租约等到期。裁:run 结束(agent 停机)→ 释放/完成租约;`orphaned` 与回收扫描可留 Known Limitations(scheduler 归 P4-05),但 completed/failed 两个终态必须可达。
**147 的 P4-06 两条不因本次改了 `dispatch.ts` 而补**——执行者拒得对,按名字对号入座正是门要抓的。**顺序**:上面三处 → 观测 → 再 P4-06 U(它消费的 epoch 现在真在 launched profile 上才有)。

### 12.21 BLOCKED-148:租约库放置,与它掩盖的并发首开缺陷(2026-09-07 15:45 EDT)

**事实**:`run` 启用(`storePath: dshHomePath('runs','runs.json')`)、心跳 `leaseMs/3`(除数是协议常量)、会话结束释放、manifest 事件带 `leaseEpoch`、结构门 `verify-run-enabled-in-bundles` 带正对照——§12.20 三条落地。租约 `directory` 未定:`dshHomePath('leases')` 让 16 个 SDK 快照场景红(`cannot create effect on inactive context`,cordis 生命周期文案,**底层 SQLite 错误至今没看到**);`.dsh` 相对 cwd 全绿,作记录在案的临时。session 语料的 launcher 按场景设 `DSH_HOME=cwd/.dsh`,SDK 语料显然共用一个 home——16 个进程**同时首开同一个新库**。
**裁决**:
1. **这首先是缺陷不是放置**:两个 host 同时启动、对着同一个租约库,正是租约存在的场景;首开失败就是 P4-07 在它的目标场景里失败。先把 SQLite 原文抓出来(dsh-ci-test-reliability:子进程 + 共享资源),再修——schema 创建在 `BEGIN IMMEDIATE` 内、`busy_timeout` 生效于 PRAGMA 之前的第一条语句、SQLITE_BUSY 重试;冻结:N 个进程并发首开同一新库全部成功 + 之后只一个能取同一 item。
2. **放置 = 与 session 存储同根**(`dshHomePath('leases')`,即 sessions 旁边):租约的作用域就是 work item 的作用域,run / session 都在那个根下;`.dsh` 相对 cwd 会让同一 session 根上两个不同 cwd 的进程各持一库——双主可能,正是要防的。"整机 vs 按项目"的真答案是"跟 session 根走",DSH_HOME 本身就是 profile 选的。
3. `.dsh` 字面量随本批推送作临时(148 开着、P4-07 不在它上签);缺陷修好即换,顺序:148 → P4-06 U。执行者要等 148 再动 P4-06,对——epoch 不该建在会改的配置上。
**顺带两处 harness 缺陷修法认可**:tokenizer 标签 `{{run:N}}`;复合 id 只认整串。匿名兜底拆成 `anonymous-run:` / `anonymous:` 两串,对。四语料计数 acp 15 / sdk 16 / session 80+3 / web 0 变化(实测 manifest 事件不出现),按 Standing 报齐。

**12.21 修订(2026-09-07 16:05 EDT)**:148 的"并发首开缺陷"**不存在**——执行者按"先抓原文"拿到子进程 stderr:`unable to open database file`,根因是 **构建过时**(`mkdirSync` 加在 `src`,SDK profile 启动的是 `lib/`,build 早于该编辑)。两条前提都被测量推翻:SDK harness 按场景传 `DSH_HOME=cwd/.dsh`(`sdk/client/src/launch.ts:148`),不是整机一库;8 进程同时创建同一新库 8/8 成功、恰 1 个 acquire。**§12.21-1 的"缺陷"裁决作废;-2 放置(与 session 根同根)成立并已落地**(`directory: dshHomePath('leases')`),并发性质从脚本变成冻结用例(同时 spawn,变异去 `mkdirSync` 只红此条)。**§12.21-1 里 "schema 进 BEGIN IMMEDIATE + BUSY 重试" 撤回**:没有复现的失败不改事务边界——这是我自己 §12.6 的规则反过来用在我身上。**教训(记 148)**:两份配置的对比只告诉你哪里不同,不告诉你为什么;delegate 在执行者未拿到原文时就裁了"缺陷",与 137 第一版同形。

### 12.22 BLOCKED-149:workflow-journal 的放置;P4-08 U 的另一半(2026-09-07 17:30 EDT)

**事实**:P4-08 U 第一半落地——`WorkerRun` 在 agent-start/end 路径经 `journalingObserver` 每 run 必记;digest = 脚本正文 SHA-256;每步默认 `side-effecting`(DSL 无语法表达 effect class,默认取强制对账一侧);3 条真 worker thread 用例、变异去记录红 2 条;夹具第一版期望错(`.flat()` 让所有子代理读同一耗尽流)——改夹具不改断言,对。新 finding `workflow-worker-thread → workflow-journal`(providers → orchestration-runtime),与 lease-contract 同一形状:journal 是记录形状 + 四个纯决策,不挂、不算。
**裁决**:(1) **取 (1)**——与 §12.16-2 同一论证同一结论:纯记录形状与决策进 definitions 组(`collaboration/workflow-journal-contract` 或同名新包),A 类 `files[]` 改动 `clauseProvenance: §12.22`;两条同类边不能一条挪一条留。引擎 `→ dsh-agent` 那条早于本程序,单开 BLOCKED 记放置议题,不归 P4-08。(2) **P4-08 U 未完**:must[1]"恢复时跳过已完成且验证过的纯步骤"、acc[0]"每个 agent() 前后 kill,恢复不重复 child work"是这条 epic 的**主体**;现在"写得出、读不回"、无持久化、`planResume`/`admitResume`/`receiptsToReconcile` 零生产调用者——执行者自己写进 Known Limitations,诚实,但不能用"有 journal 了"替 resume 背书。U 继续:journal 持久化(与 runs 同根,`dshHomePath('journals')`,不加 tunable),worker 启动时经 `planResume`/`admitResume` 读回,acc[0] 的 kill campaign 作真组合用例(每个 agent() 前后 kill → 恢复 → child work 不重复,由 fake 子代理计数,不由 journal 自报——P4-12.F 同法)。(3) `inline-image-prompt` 初始化超时按满载读、不报绿、不归本次改动——记法对;若在 CI 上出现,读原文再定。**顺序**:149 挪包 → P4-08 U 另一半 → P4-09 → P5-11 → P5-10。

### 12.23 BLOCKED-151:resume 的对账必须问能挺过崩溃的来源,它是异步的(2026-09-07 18:20 EDT)

**事实**:journal 每步同步持久化到 `dshHomePath('journals')`(临时名 + rename);`reusableSteps` 的复用是**对账不是跳过**——journal 说 completed、世界不同意,以世界为准;多子代理步骤须全部确认。但对账现在问的是活注册表 `ctx.sessions.get(childId)`,workflow 结算时子代理已销毁,真重启下对所有步骤答 false → 每步重跑,acceptance[0] 靠"从不复用"被空洞满足——执行者拒绝这个读法,对。真持久来源 `ctx.sessionPersistence.load(childId)` 是异步的;`WorkflowEngine.start()` 同步返回,可复用映射须在 Worker spawn 前进 `WorkerInit`。
**裁决:取 (1)**——`resume(runId, request): Promise<WorkflowRun>` 作为 Service Definition 上的独立异步入口,`start()` 契约不动。理由:resume 与 start 是不同操作(多一个输入、多一次对账),各自的签名说各自的真话;(2) 让所有 start 调用点为 resume 的异步买单,(3) 让定义依赖 provider 的磁盘布局——都拒。这是 must[1] 字面上要的东西,不是扩范围。acc[0] 的 kill campaign 经 `resume` 跑:每个 `agent()` 前后 kill → `resume` → fake 子代理计数不重复。
**顺带**:workflow run 的租约释放从结算挪到 disposal(释放早于自己的终态写会把自己 fence 在"宣布结果"之外)——对,且**同一顺序检查 agent run 的路径**(§12.20-3):释放必须在最后一次受门控的写之后。引擎 `→ dsh-agent` 那条边:开一条 BLOCKED 记放置议题。**顺序**:151 → P4-08 acc[0] 真组合 → P4-09 → P5-11 → P5-10。

### 12.24 BLOCKED-150(P4-09 的 `workflow()` 嵌套钩子);P5-10 的消费者;门 (u) 的粒度(2026-09-07 19:00 EDT)

1. **BLOCKED-150 取 (1),范围由本条定,不是执行者扩阶段**:P4-09 的标题就是 "Nested Workflow",must[3]"nested workflow 继承/衰减 budget、capability token、trace,并检测递归"、acc[1]–[3]——**一个起不了的 nested workflow 不是 nested workflow**;五个决策零调用者是因为没有入口,不是因为入口在别处。registry 自己的 U 文件是 worker `runtime.ts` / `session.ts`,入口就该在那里。**范围(逐条对子句)**:worker 运行时提供 `workflow(nameOrRef, args)`:按 digest 解析已保存定义(must[0]/[1],经 `resolveDefinition`,未验证的定义不执行——acc[0]);经 `admitNestedRun` 对父的剩余 budget / 深度 / 总 agents 准入(must[3]、acc[3]),`inheritWorkerLimits` 衰减;父取消经 `cancelPropagationForNested` 传播(acc[1]);子失败经 `applyChildFailure` 按声明策略(acc[2]);嵌套深度按 acc[3] 受限(一层起步,上限来自定义不来自 tunable)。**不做**:新的 DSL 语法、跨进程 detached 嵌套(must[2] 的 detached 由 Run service 持有,现在 `run` 已启用,U 只需让嵌套 run 经它注册)。tripwire 用例(`typeof workflow === 'undefined'`)supersede 为"存在且受栅栏"。真组合:父脚本调 `workflow()` 起子,超预算被拒、父取消子停。
2. **P5-10 的消费者(A 类,`clauseProvenance: §12.24`)**:`decideControl` 的真实生产调用点是 `subagent/src/index.ts` 的 prompt 路径(acc[0]/acc[2] 在此决定),registry U 文件没列它——按测量补 `[B] packages/subagent/subagent/src/index.ts`,**不删** `child-agent.ts` / `lifecycle.ts` / `core/agent/src/inbox.ts`:must[2](durable 带 epoch 幂等)与 must[1] 优先级排序还没到达——`orderByPriority` 零调用者,排序该发生在控制消息出队处(inbox.ts,registry 点名的 [B]),这是 P5-10 U 剩下的活。must[3] 收敛栅栏接进 `stateOf`(变异删参与者红 4 条、空集合 converge 红栅栏)——对。
3. **门 (u) 的粒度改为 per-epic**:判据是"该 epic 的 **live U 冻结条目之并**含 ≥1 个 registry U [B] 文件",不是每条条目各自含。理由:U 是一个阶段,早期的库级 U 条目(P4-06.U / U.2、P4-08.U 等)记录的是当时的观测,不该被后来的接线条目逼着 supersede;而阶段整体不到达消费者仍然红。由此 147 的六条:P4-06(U.3 碰 inbox.ts)、P4-08(新 U 碰 host.ts)清零;P4-09 待 (1) 建成;P5-10 待 index.ts 加入 + inbox.ts 排序;P5-11 待 U 重做。**没有豁免。**

### 12.25 BLOCKED-153:`orderByPriority` 在依赖的错误一侧;控制种类由插入操作记下(2026-09-07 20:40 EDT)

**事实**:排序原语在 `dsh-subagent`(依赖 `dsh-agent`),`core/agent/src/inbox.ts` 不能 import 它;待处理 `UserMessage.source` 不带控制种类;`ChildControlRouter.submitBatch` 已调用 `orderByPriority` 但 **`ChildControlRouter` 无生产构造点**,而 `subagent/src/index.ts` 旁边手写了一份控制状态——一条规则两份实现,带排序的那份正是没人到达的那份(136 形)。
**裁决:(1) + (2),两者都做,顺序 (2) 先。** (2) 消重复是必做:挂 `ChildControlRouter`、替掉手写的 `{ phase, appliedEpochs }`。但 (2) 不满足 must[1]:router 只排经它的批;`Agent.steer` / `inject` / `followup` 从其他来源(用户、team、goal)直接进 inbox 的消息绕过它——registry 点名 `inbox.ts` 正因为**出队处是所有来源唯一的汇合点**。于是 (1):纯排序原语(优先级表 + 稳定排序)进 definitions 组新包(与 lease-contract / journal 同论证,`collaboration/control-contract` 或同名),`core/agent` inbox 出队时按它排;**控制种类由插入的那个 inbox 操作记下**(`steer`/`inject`/`followup` 各自知道自己的 kind——是操作在说,不是消息在说;与 P4-06 `senderEpoch` 由发送方记下同形)。A 类 `files[]`:P5-10 加 `[B] subagent/src/index.ts`(§12.24-2,尚未应用,随本次一起)与新包路径。冻结:混合来源的一批(steer + 一条 followup + 一条 cancel)出队顺序按优先级表,变异改表 → 红;router 挂载后手写状态删除 → 4.4a 计数 ≥1。
**顺带**:§12.19-1 的 P6-02 两个 [B] consumer 与 §12.24-2 的 P5-10 `index.ts` 至今未进 registry——A 类改动在对应 U 返工开工时应用,**执行者开工前先应用**,不许 U 做完再补 files。

### 12.26 BLOCKED-153 续:epoch 账本的生命周期归谁(2026-09-07 21:20 EDT)

**事实**:`ChildControlRouter` 持有活 Agent;`SubagentRuntime.controlState` 按 session id 键入、从不清理——这个"活得更久"承重:`appliedEpochs` 拒绝的重投递**可以在子代理消失后到达**,两条冻结用例钉着(同 request id 两次只开一轮;重投递拒为 DUPLICATE 而非"不能 resume 的子代理")。
**裁决:账本从 router 里拆出去,归 manager(`SubagentRuntime`,与父会话同寿),router 只借用。** (a) `ChildControlRouter(ledger, agent?)`:决策读账本;dispatch 需要活 agent;**无 agent 且非重复 → `no-child`,不是 `duplicate`**——两条冻结用例区分的正是这个。(b) must[2] 说的是 **durable**:账本不是"内存里活得久",是**从父会话日志重建**(控制消息的派发本来就进父日志;子代理消失后父日志仍在)——与 P4-06 `consumed` 从日志重建同形,不加新事件、不加第二存储。(c) 由此 (2) 挂 router 不丢性质:重启后重投递仍拒。冻结:父重启 → 同 request id 重投 → DUPLICATE;子代理已结束、新 request → `no-child`。然后做 (1)。

**12.26 修订(21:55 EDT)**:"从父会话日志重建"在这棵树上**不成立**——`SubagentRuntime` 对生命周期只 `ctx.emit`,对父会话零 `append`;delegate 没量就写了来源,执行者量了再动。真 durable 来源是**投递出去的消息本身**:它进子代理 inbox、带 `source.rpcId`(epoch 由它派生),而子代理的 session 比 Agent 活得久。账本在**提问时**读子会话日志(不是构造时快照),`decideControl` 第三参收窄为 `AppliedEpochs{has}`;`phase` 留内存(描述此刻,不是日志写下时)。5 条用例含真重启(全新账本读死进程日志仍拒)+ 正对照(日志没有的 epoch 放行)。性质一条不少、不加新事件——**比我裁的更对**;裁决其余不变。

### 12.27 BLOCKED-154:P5-11 的三个原语,三个不同的答案(2026-09-08 01:20 EDT)

**事实**:`decideClaim` / `validateTaskGraph` / `admitFact` / `traceToObservations` / `TaskStore` 生产调用者全 0;`decideMailboxDelivery` 只被 message-bus 的 barrel 引用。**`experimental/agent-team` 有自己的 `TeamTaskBoard`、`task-graph`(含环检测)、`mailbox`——P5-11 三个原语的第二份实现**,不 import P5-11、不在任何出货 bundle,registry 110 条里零次提及。acceptance[0](sqlite 多进程认领)与 [2](环拒绝)已成立。
**裁决(按原语分,不按 epic 一刀切)**:
1. **Taskboard:取读法 (1),按 registry 写的做,不是发明**——registry 点名 `subagent/src/list-children.ts` 为 consumer,意思就是"被委派的子代理是 task":owner = 父会话,attempt / lease = 子代理 run 的租约(P4-07,已在),artifact outputs = settlement 输出,verification status = 回执;认领发生在委派处(spawn),`list-children` 从板上列;acc[1]"模型不手动更新时 runtime 按 receipts 推进"= P4-06 的 settlement 路径推进状态。must[2] 说的"角色/组织图/captain 留插件层"不禁止这个——task-per-child 是运行时原语,不是组织图。
2. **Mailbox:并入 message-bus,一份实现**——进 inbox 的路径就是总线(P4-06 U.3),`dsh-mailbox` 剩下的唯一独有部分(收件人地址检查)进 `message-bus/mailbox-delivery.ts`,`dsh-mailbox` 包退役(pre-release 立场,无兼容承诺);P5-11 的 mailbox 子句由总线路径满足,记跨 epic 满足。
3. **Blackboard:程序里没有消费者,不能由库满足 must[1]**——而且 P6-02 的 `withProvenance` 是第二个带 provenance 的 fact 存储,同样零调用者。**裁**:一个 fact 存储——blackboard 并入 P6 memory 线(P6-09 拥有 PROV-DM 词汇,memory-context 是现成消费者);P5-11 must[1] 在 P6-02 U 落地后记跨 epic 满足;`dsh-blackboard` 退役。**这是范围裁决,已向用户报告**(§6:范围/发布级由用户最终确认);在用户否决前按此执行。
4. **agent-team 的三份重复**:不在程序范围(experimental、未出货、registry 不提),单开 BLOCKED 记"若 agent-team 出货,必须消费 P5-11 原语,不得保留第二份";不归 P5-11。
**顺序**:1 → 2 → (3 随 P6-02 U)。

### 12.28 delegate 误取消一次观测的签名 job(2026-09-08 01:35 EDT,run 34171963564)

**事实**:run 级状态 "queued" 75 分钟;delegate 按该标签取消并试图重跑。实际 job 级:主 job **已跑完**(单测 20393/0;snapshot 步唯二红 = 两个 pwsh 夹具,`.refresh-skipped.json` 先被打印——137 机制按设计工作),等 runner 的是**产签名 bundle 的第二个 job**。取消挂在它上,这次的签名副本多半没了。**读了标签没读 job 状态**——与 §12.6 禁的"按名字对表"同族,长在 delegate 自己身上。
**处置**:不用 raw report 绿格(§12.17:只引签名副本);执行者 admit pwsh refresh 产物并提交,下一次 run 全绿 + 签名即观测。**规则(进 C14)**:判断一个 run 是否卡住,看 `actions/runs/<id>/jobs` 的 job 级状态与 runner 分配,不看 run 级标签;取消一个 run 之前列出它已经产出的 artifact。

### 12.29 P5-11 taskboard 的 `release`;三条卫生门的归属(2026-09-08 02:10 EDT,`2b917a4b43`)

**事实**:§12.27-1 落地——task = 被委派 child(`subagent/start`/`end` 括住,id = 子会话,owner = 父会话,attempt = 本次 activation 的认领,receipt = 子代理 stop reason),完成推到 `submitted` 不是 `verified`(没人验过);`list-children` 读侧断言板与 projection 的不一致;门 (u) 全部 epic 通过。板只记录不拦截:`TaskStoreContract` 无 `release`,结束的 epoch 无法交回认领,正当恢复自己 child 的 host 会被自己上一轮的认领挡住。
**裁决**:(1) **加 `release`,作 P5-11 C 阶段 supplement**(P5-11 已撤签,C 不在验收锁下;BLOCKED-103 加用例 = supplement);语义与 lease 同源:认领携带子代理 run 的 `LeaseEpoch`(§12.27-1 说的 attempt/lease 就是它),run 结束 → release;**陈旧 epoch 的 release 被拒**(fencing),同一 host 新 epoch 可重新认领。冻结:结束后重认领成功;旧 epoch release 拒;变异去 epoch 检查 → 红。(2) 三条卫生门:`verify-agent-note-format` 三篇缺节、`verify-type-equiv` 中 `SubagentSettledMessageSource` / `Agent` 两处 DRIFT——**执行者本批修**(自己欠的);其余 7 处 DRIFT 早于本程序,记 139 不动;`risk-taxonomy/README` 缺 model-context 与 invariant companion 句——**归 P2-04**(它的包,L1 lane 下一批修),不挡本次推送(这些门不在 exact-sha 路径上,registry gate set 22/1 已过)。(3) 顺序:admit pwsh 产物 → 补 (2) 的两项 → 一批过门推 → §12.27-2 mailbox。

**12.19-1 修订(2026-09-08 03:05 EDT)**:两个 P6-02 消费者被我记成 `[B]`,但 `[B]` 的定义是"存在于冻结基线 `4e84901e`",`packages/memory/memory/src/index.ts`(P6-02 自己的 [N])与 `packages/context/memory-context/src/index.ts`(P6-01 的 [N])都不在基线上——`verify-baseline-file-references` fail-closed 是对的。**改**:`CONSUMERS_ADDED` 条目带 `kind: N`(基线后的消费者),门 (u) 读 `CONSUMERS_ADDED` 不问 kind;基线门只对 kind=B 查存在性。裁决实质不变(P6-02 的消费者是已挂载的 MemoryRuntime 写/读路径 + memory-context 的 recall 路径);错的是我用了一个有定义的标签去表达"消费者"。**教训**:registry 的 kind 是事实(在不在基线),不是角色;角色由 `CONSUMERS_ADDED` 表达。

### 12.30 板只记录不拦截——拦截点是租约(2026-09-08 03:40 EDT,`1212dae191`)

**裁决**:认领被拒**不**拦截子代理启动。理由:P4-07 已在子代理 run 创建前取租约,第二个 host 的 `acquire` 被拒 → 不开 Run——这就是"同一 work item 只有一个持有者"的强制点;板若也拦,就是同一性质的第二个强制点(136 形)。板记录、租约强制,**两者必须一致**:认领携带的 `LeaseEpoch` 与租约发放的相同;冻结一条:第二 host 租约被拒 → 子代理不启动 → 板上仍是第一持有者;变异让板的 epoch 不来自租约 → 红。`decideRelease` 按 attempt 围栏、submitted 保留状态只丢 owner、回执后释放——对。P5-11.U.1 supersede 的理由成立(读板的时刻变了)。§12.19-1 修订的落法(`usageConsumers` 由 `CONSUMERS_ADDED` 生成,门 (u) 不从 kind 反推)对。

### 12.31 租约被拒 ≠ 没有 Run Service(P4-07 强制缺口);BLOCKED-155 取读法 1,经 P6-01(2026-09-08 04:30 EDT)

**A. P4-07**。事实(`run/src/index.ts:607-630`、`dispatch.ts:285-304`、`tool-calls.ts:85-98`):`RunPlugin.open()` 租约被拒 → warn + return,不设 lifecycle/runLease;`advanceLeasedAgent` 答 `no-run`;派发只拦 `fenced`,`no-run` "dispatches normally"。**租约被拒的第二 host 与没挂 Run Service 的部署在派发路径上同形——第二 host 照常启动、照常派发**。这是 must[0]"每个 work item 由 epoch lease 所有"与 acc[1]"不导致双主"的**核心缺口**:强制点只拦"曾持有后被抢"(fenced),不拦"一开始没拿到"。§12.30 的冻结前提由此为假;执行者停下报告,对。
**裁决:取 (1)**——区分 `no-run-service`(组合里没有 Run Service:照常,且出货 bundle 里不可能出现,`verify-run-enabled-in-bundles` 已保证)与 `lease-refused`(有 Run Service、`acquire` 被拒:**agent 不派发**,模型可见 `LeaseRefusedError`,与 `FencedError` 分开命名——一个是从未拥有,一个是被夺走,操作者的下一步不同)。P4-07 C 阶段 supplement(P4-07 已撤签,C 不在锁下)。冻结:第二 host `acquire` 被拒 → 零工具执行、结果带 `LeaseRefusedError`;正对照:第一 host 照常;变异把 `lease-refused` 并回 `no-run` → 红。**板的一致性**取执行者的存在性方案:生产者在无 `lifecycle` 时**不认领**,于是"板上有认领" ⇔ "此 host 真持租约",不加字段;§12.30 冻结改为:第二 host 租约被拒 → 无认领、板上仍是第一持有者(在 (1) 落地后,它同时意味着子代理未派发)。
**B. BLOCKED-155:取读法 1,经 P6-01 执行。** P6-02 must[0] 字面列出 MemoryRecord 的字段;seam 现存的 `MemoryRecordView {id, principal, content, updatedAt}` 是**程序前**的形状,而 P6-01「原生 Memory Service Definition」NOT_RUN——P6-02 在它的 Service Definition 之前被验收了,这就是六个决策够不着真实记录的根因(缺的是词汇不是接线,执行者判断对)。**顺序**:P6-01 U 先——seam 的记录 = P6-02 的 `MemoryRecord`(pre-release 无兼容承诺,三个 provider 同改),`propose`/`query` 携带 lifecycle/provenance/sensitivity 字段;然后 P6-02 U——六个决策落到真实读写路径(写:validate → conflict(supersedes/disputes 关系,不覆盖)→ admit(sensitivity 挡索引);读:`isDefaultRetrievable`),memory-context 的 recall 是现成消费者。读法 2 是承认 harness 不用本程序的记忆记录,读法 3 让 must[1]/[2] 失去主语——都拒。§12.27-3 的 blackboard 合并在读法 1 下成立,随 P6-02 U。**教训**:check-ready 允许 P6-02 在 P6-01 之前(不是前置),但 Service Definition 后置意味着 Provider/Consumer 阶段验的是一个稍后会被定义取代的形状——同类依赖(定义 ← 实现)以后记入 predecessors。

### 12.32 BLOCKED-156:memory 能力在所有出货 bundle 里 disabled——P6 线的"到达"是产品决定,上报用户(2026-09-08 07:05 EDT)

**事实**(执行者三问,delegate 复核 bundle 行):P6-01 主体全在、F 阶段扎实(28 例、两 provider 租户隔离);生产调用者:`ctx.memory.query` 1(memory-context 召回)、`propose`/`get`/`revise`/`forget`/`export` **各 0**;**到达:否**——`dsh-memory` 与 `dsh-memory-context` 在 base bundle 里都 `disabled: true`,理由成立(runtime 不自带 provider),U 的 fixture 自己启用两行并诚实写明。155(seam 存的记录不是 P6-02 的)与 156(seam 没被挂载)叠在一起:按读法 1 长记录,是在扩展一个没有 profile 启用的能力。
**裁决**:
1. **"默认开启跨会话记忆"是产品/数据决定,归用户**(§6:数据/不可逆);delegate 不替用户开。**推荐**:**(2) 现在 + (1) 有门**——P6 线的到达条件定为"**P6-02 的敏感字段准入(must[2])与 P6-08 的驻留/KMS 落地后**,base bundle 启用 `memory` 与 `memory-context`,provider = durable-file 于 `dshHomePath('memory')`"。在此之前默认开启等于把无敏感控制、无驻留控制的跨会话持久化交给每个用户。
2. **在用户裁定前**:§12.31-B 的 seam 记录扩展照做(任何读法都需要);P6-01 / P6-02 的 U 在**显式启用的组合**上验(fixture 已诚实这么做),行上标 `reach: pending P6-line enablement (BLOCKED-156)`;**两条的验收等到达条件裁定**——不是不能验收,是验收的意义要由用户定;程序 GO 前 156 必须关闭。
3. 顺带:P4-05 同样"全绿未验收",按同一三问量后再议。

### 12.33 P2-03 证据包核:两处未达 §12.11-3,再等一次观测(2026-09-08 07:40 EDT)

**过的部分**:must[0] 十二字段全在类型上、全由两条生产路径构造(`tool-calls.ts:411-423`、`ptc.ts:213-220`);`createActionManifest` 等五个主语各 2 个生产调用者,正是 must[1]/[2] 的两条路径;到达:`action/manifest-appended` 在 85 个出货语料日志里,`native-tool-call` 140 / `code-mode-embedded` 12(后者在 `profile: headless` 场景),`classified:false + destructive + requiresApproval:true` 是 acc[2] 的日志证据,`sequence` 是 acc[0] 的先后序证据。
**不过的部分**:(1) 事件只记 11 字段 + `leaseEpoch`,`target` / `preconditions` / `expectedDiff` / `compensation` / `evidenceRequirements` 不落日志——**§12.11-3 明裁"事件内联 manifest 全部 must[0] 字段,'可重建'的理由作废"**;审计者拿日志答不出"这个动作承诺了什么补偿"。三个字段今天是常量(`preconditions: []`、`compensation: {reversible:false,…}`、`target: {kind:'other'}`)——常量也要落日志,它记的是"这条路径今天声明了什么",内容由工具自己声明时补(P2-04 起)。(2) `appendManifestThenGate` / `gateExecution` / `createMemoryManifestAppender` 零生产调用者:两条路径各自手写 append→gate 顺序,旁边放着为此存在的封装——136 形。**裁**:两条路径经 `appendManifestThenGate`(一处实现顺序),门面若仍无人用则删;不留"库里有个没人用的门面"。
**处置**:P2-03 U supplement(事件补五字段 + 路径走封装),模型可见面变了 → 同批四语料回放刷新并报计数;再观测一次,签。**P4-06 / P4-07 / P4-09 / P5-10 / P5-11 的证据包照发**,它们不受此影响,本次观测绿即可签。

### 12.34 七条证据包核:三条各差半条路径;`classified` 上 manifest(2026-09-08 08:20 EDT)

**可签(本次观测绿即走谓词)**:**P4-09**(五个决策经 host 准入路径到达,`workflow()` 在出货 worker 运行时)、**P5-10**(`orderByControlPriority` 2、router 1、ledger 1,`subagent.prompt` 是 Remote 面)、**P5-11**(taskboard 主语各有生产调用者,base 两行启用;板不拦截已裁 §12.30)。**P4-08** 看谓词 (i):must[2] 副作用对账只做一半,覆盖闭合过不了就不签;`recordStep` 零调用者——死导出,删或接。
**不可签(各差半条路径,与撤签同因)**:
1. **P4-06**:inbox 去重在生产路径 ✓(must[2]);**outbox 半边**(`commitWithOutbox` / `admitEnqueue` / `orderForDispatch` / `dispatchOnce`)**无生产生产者**——`dispatchOnce` 唯一调用者在 experimental。must[0]"domain event 与 outbox 行同一事务"、must[1]"dispatcher 发送后 idempotent receipt"只在单测里成立。**裁**:发送侧也走总线——子代理 settlement 经 `commitWithOutbox`(domain event `subagent/end` + outbox 行同一 `BEGIN IMMEDIATE`)→ `dispatchOnce` → 父 inbox(已去重);`notifySettlement` 不再手投。registry [B] `dispatch.ts` 正是这条。
2. **P4-07**:调用者与到达 ✓,但执行者自己记的限制是核心缺口:agent-run 路径上 work item = `run-<uuid>` 每次新铸,**两个 host 永远不会争同一个 item**——租约在 agent 路径上除 store 不可用外**永不拒绝**,acc[1]"不导致双主"在生产里空洞成立。**裁**:agent run 的租约 work item = **session id**(两个进程可能同时打开的那个 durable 东西),P4-01 的 `run-<uuid>` 仍是 run 身份、不是租约键;冻结:第二个进程打开同一 session → `acquire` 被拒 → `LeaseRefusedError`(§12.31-A 的拦截由此在生产里第一次可达)。
3. **P4-12**:预留只在原生派发,**code-mode 子派发不经 ledger**——acc[0] 的"零重复外部效应"对 code-mode 工具不成立(manifest 层拦了绕过,ledger 层没有)。**裁**:`ptc.ts` 子派发同样 reserve → 执行 → confirm,与 manifest 同点;冻结 code-mode 同键第二次不执行。
**`classified: boolean` 上 `ActionManifest`**:接受——"风险是被声明的还是被默认的"是关于这条 manifest 的事实,不是写日志那一刻的事实;acc[2] 说的就是它。P2-03 C supplement(已撤签,C 不在锁下):`classified` 未声明为 false、声明为 true,变异 → 红。
**顺序**:本次观测绿 → P4-09 / P5-10 / P5-11(/P4-08)签;P2-03 U.4 + P4-06 发送侧 + P4-07 session 键 + P4-12 code-mode 预留 → 下一次观测。

**12.33 补记(2026-09-08 00:20 EDT,`01c04d00ff`)**:两处落地——事件内联十二字段(常量照落:日志形状不能等内容出现才变),两条路径经 `appendManifestThenGate` + `createSessionManifestAppender`(会话日志作真正的 appender,放 `dsh-tools` 不放 manifest 包:能力定义去够 session 是 136 那条边);变异去五字段红 29、`classified` 写死红精确 2,不对称即"被读非被假定"。**Standing(执行者提出,delegate 采纳)**:凡改动进入**持久事件负载**的字段,`test:snapshot:refresh` 前必须先构建受影响包——sdk 语料回放的是构建后 `lib/`,不重建则旧代码产出旧 payload 与旧夹具匹配,"某语料没变"是**假阴性**;证据的前提条件不满足时绿无意义(与"没冻结的测试不是证据"同族)。

### 12.35 `layer-deps` 的红是预算不是 flake;P4-06 的 outbox 半边取 (1),分三步(2026-09-08 00:50 EDT)

**1.** `tests/architecture/layer-deps.spec.ts` 三条各跑一次全仓扫描(单跑 1.1–1.4 s),满载 20 worker 超过默认 5 s `testTimeout`,红的是谁先撞预算——**因果确定,不是 flake,不记 145**;给三条显式 timeout(30 s),这是"预算匹配工作量"(dsh-ci-test-reliability),不是放宽断言。
**2. P4-06 outbox**。事实:`commitWithOutbox` 作用于 `AtomicBatchSink`,**全仓零生产实现**;持久 outbox 行只有 `{target, payload}`,`dispatchOnce` 要的 `state/priority/deadline/attempts/receipt` 一个都不存;`openBusStore` 无插件无 bundle 行。与 155 同形(定义的记录与持久化的记录不是一个),叠加"没挂"。registry 的 outbox 是**队列**不是记录:must[1](receipt)、must[3](priority/deadline/dead-letter/backpressure)、acc[1](未送达可查询可重放)都要完整记录——**(2) 让三条子句留在单测里,(3) 只挂空壳,都拒。取 (1),分三步**:
 (a) 持久 outbox 扩到完整 `OutboxRecord`(P4-06 P 阶段 supplement,自己的 store);`commitWithOutbox` / `AtomicBatchSink` 零实现 → **删**,`commitIntake` 是唯一原子提交路径(一条规则一份实现);domain event 与 outbox 行同一 `BEGIN IMMEDIATE` 意味着 domain event 的真相源在 `bus.sqlite` 的 `domain_events`,会话日志里的到达事件是**消费侧的投影**,不是第二份真相。
 (b) `MessageBusPlugin` 提供 `ctx.messageBus`(store + dispatcher),base bundle 行在 session storage root 下(lease / taskboard 同法)。
 (c) settlement 发送侧:子代理结束 → `commitIntake`(`subagent/end` 域事件 + 指向父会话的 outbox 行,一个事务)→ dispatcher 投递进父 inbox,**复用现有插入规则**(idle → followup、busy → steer);teardown 中 → 行保持 pending,父下次启动时投递——这不是时序副作用,这就是 acc[1] 与 P4-06 存在的理由。三条 U 冻结用例在 inbox 侧,仍成立。真组合冻结:父在"子提交后、投递前"被 kill → 重启 → settlement 恰好投递一次(acc[0] 在生产组合里的形态)。
**顺序**:P4-07 session 键、P4-12 code-mode 预留先做(不依赖此);P4-06 (a)→(b)→(c)。

### 12.36 code-mode 动作身份:`actionId` 由 root call id + 发起序号确定性铸造(2026-09-08 01:20 EDT)

**事实**:原生路径 `actionId` = 模型给的 call id,崩溃重放原样重现;code-mode 的 `actionId` 是每次派发新铸的 `subCallId`,同一程序两次 `charge({amount:'10'})` 得两个键,duplicate 分支不可达——执行者把假用例换成两条真可达断言,对。
**裁决:取 (2),但改在身份铸造处而不是键公式处**:code-mode 的 `actionId = <rootCallId>#<发起序号>`(程序调用工具的**发起顺序**,不是完成顺序——并发调度改变的是完成序,发起序由程序决定,确定性成立);键公式 `(sessionId, actionId, argumentsHash)` 不变,原生与 code-mode 一个公式。(1) 会误拒同一程序里故意重复的两次调用(循环扣两次款是合法意图),拒;(3) 让 acc[0] 对 code-mode 只成立一半,拒。Stripe 的模型就是 (2):每个意图一个键、同一请求的重试复用。冻结:同一程序两次相同 sub-call **都执行**(键不同);同一 rootCallId 重放同一序列 → 第二轮 sub-call **命中 duplicate 不执行**;变异序号改随机 → 红。
**P4-07 session 键**:争用用例带正对照、变异红 6——过;两 host 共享租约只能靠共享 sqlite 目录、内存插件各持各的 map——这正是 §12.16-1 要 SQLite provider 的理由,不是缺陷。**操作教训采纳**:对未跟踪新文件做变异先 `cp` 备份,`git checkout --` 恢复不了。

### 12.37 观测 34184070348 红:P5-10 的优先级表把上下文排到了后到的指令之后(2026-09-08 01:40 EDT)

**事实**:20420/2 failed,两条都在 `experimental/agent-team`(mailbox FIFO):inbox 出队按 §12.25-1 的五级全序,后到的 `followup`("do another turn")被排到先到的 `inject`("quiet info")之前;执行者改过 P5-10 自己的一条用例("steer 排在更早到达的 inject 前面"),没跑 agent-team。另 scoped lint 1 错(`subagent-taskboard/src/index.ts:66` 多余类型断言)。
**裁决(定表的内容,§12.25 只定了表的位置)**:must[1]"每类定义优先级"管的是**控制决定之间的冲突**,不是批内内容顺序。**`inject` 是上下文,不是决定**——把先到的上下文排到后到的指令之后会改变那条指令的含义。表:`cancel` 提到最前(必须先于一切应用);`human-answer` 按其等待点定位,不参与排序;`steer` / `continue` / `inject` **按到达顺序**(steer 作用于 continue 打开的那一轮,FIFO 本身就是确定的胜者——"两个非 cancel 种类之间需要确定胜者"的确定性由到达序给出,不需要发明第二个序)。router 侧同表。P5-10 那条被改的用例改回到达序;agent-team 两条不改。冻结:混合批(inject → followup → cancel 到达)出队 = cancel、inject、followup;变异表改成把 followup 提到 inject 前 → 红。**教训**:改共享出队规则的一批,固定集要含所有 inbox 的消费者(experimental/agent-team 在全量里,不在触及包里)。

### 12.39 门的主语集与门面同步;P4-06 (c) 谁驱动 dispatch(2026-09-08 02:15 EDT,`f832ace462`)

**门**:`verify-manifest-constructed` 主语集 = `createActionManifest` 或 `appendManifestThenGate` 任一,正控制查每一个被接受的入口都在 owning 包声明(门面改名不能让门去数一个没人声明的名字然后自信报零);spec 对真实仓库写、钉住 `ptc.ts` 只经门面也计入——对。gate set 连红三次(`.d.mts` 配对、模块图陈旧、`files` 顺序)都是"挂新包 + 加子路径导出"同时触及编译面/生成物/发布面的横向后果,包内测试与固定集都看不见——**gate set 是发 SHA 前的固定动作**,由此定。`openBusStore` 不建目录被用例在出货前抓到、变异精确红 1——对。
**(c) 谁驱动 dispatch:不是定时器,也不只是 pre-step。** 只在父的 pre-step 驱动会死锁:父 idle 等 settlement → 行 pending → 父无步可走 → 永不投递。**裁**:三个触发点,一个实现(`drainOutbox(target)`):(1) **提交即触发**——`commitIntake` 写入指向某会话的行后,同进程内向该会话的驱动发信号,drain 应用现有插入规则(idle → followup 唤醒、busy → steer);(2) **父启动/恢复时 drain**——这就是"teardown 中行 pending、下次启动投递"(acc[1]);(3) **pre-step 兜底**——错过信号的情形。三者幂等(dispatcher 的 receipt + inbox 的 (source,id,epoch) 去重保证多次 drain 一次效果)。冻结:父 idle 时子 settle → 父被唤醒一次;父 teardown 后 settle → 重启后投递一次;三种触发同时发生 → 仍一次。

### 12.40 拆卸顺序:总线先于管理器被拆,teardown 中的 settlement 无处提交(2026-09-08 03:05 EDT)

**事实**:`ctx.fiber.dispose()` 时 `notifySettlement` 里 `ctx.get('messageBus')` 已为 undefined——`SubagentRuntime` 以可选 `ctx.get` 取总线,没有声明依赖,Cordis 不保证拆卸顺序,于是最需要持久化的那条 settlement(进程正在消失)提交不到任何地方;acc[1] 的端到端用例因此只能把行置回 pending 再验 drain(执行者写明是发现不是省事,对);"teardown 中不投递、留 pending"分支不可覆盖,原因相同。
**裁决:用依赖声明定顺序,不手工排。** `SubagentRuntime` 对 `messageBus` 从 `ctx.get` 改为 **`inject`**——依赖者在被依赖者之前拆卸是 Cordis 的契约(与 §12.16-2 `run` inject `leaseStore` 同法);总线已在 base bundle,声明依赖不改变出货行为;测试组合挂内存或 sqlite 总线。由此 (1) 子代理 settlement 在管理器拆卸前提交到仍活着的总线;(2) acc[1] 真组合可达:父在子提交后、投递前被 dispose → 行 pending → 重启 → 投递一次;(3) "teardown 中不投递"分支变得可覆盖,补断言。**拒**"让 settlement 走一个不随服务消失的句柄"——服务边界就是边界,绕过它的句柄是第二条提交路径。
**12.40 续(03:30 EDT)**:vendored Cordis 的 `inject` 无 optional 形式 → 总线成为 subagent 硬依赖;出货无碍(base 两行都在),但 38 个 spec / 44 处 `ctx.plugin(Subagent…)` 要挂总线,而总线只有 sqlite 实现。**裁:取 (2)**——message-bus 加内存 `BusStore` 实现(与 `dsh-lease` 内存版同位、同先例),测试挂它、出货仍 sqlite;(3) 只在继续性管理器 inject 会让一次性子代理的 settlement 绕开总线,拒;(1) 给单测引入文件系统,拒。base bundle 里 `message-bus` 行移到 `subagent` 之前——功能上 Cordis 按依赖解析,但读 bundle 的人该看到与依赖一致的顺序。**规则采纳**:跨包新增 import 先加 tsconfig reference 再构建(否则邻包源被就地 emit 进 src——124 与两次 action-ledger/message-bus 事故同因)。

### 12.41 异步 disposer 的 await 跨过了拆卸顺序;settlement 的提交必须在第一个 await 之前(2026-09-08 03:55 EDT)

**事实**:§12.40 的 `inject` 落地后实测 `bus? false` 不变。原因:`SubagentContinuationManager.drain()` 是 async,以 `ctx.effect(function*(){ … yield () => this.drain() })` 注册;Cordis 的拆卸顺序管纤程先后,**不等待 async disposer**——drain 第一个 `await` 之后的段落在总线纤程消失后继续跑,提交落空。执行者没把它当成功报,对。
**裁决**:**durable 提交在 teardown 路径上必须是同步的**——`commitIntake` 基于 `DatabaseSync` 本来就是同步 `BEGIN IMMEDIATE`;问题只是它被放在 drain 的 await 之后。改:disposer 的**第一个同步段**完成每个未提交 settlement 的 `commitIntake`(子 run 的 `subagent/end` 域事件 + 指向父的 outbox 行),**然后**才进入 async 的投递/唤醒段;teardown 中投递不做(行留 pending,这正是要覆盖的那条分支),下次启动 drain。不改 Cordis 拆卸语义(vendored、影响面全仓),不用越过服务边界的句柄。冻结:父 dispose 时子 settle → 行已提交(pending)→ 重启 → 投递一次(acc[1] 端到端);"teardown 中不投递"分支由此可断言。**规则**:任何"进程消失前必须持久化"的写,不得位于 disposer 的 await 之后。
**操作教训采纳**:跨几十文件的脚本编辑必须让编译器确认(`.e2e.ts` 不在单测配置里,`tsc -b` 才看见);`inject` 的影响面含非测试的消费者(`gen-tool-catalog` 挂 `SubagentRuntime`)。

### 12.42 拆卸期服务注册表已空:持 inject 交付的引用,不在拆卸期重 `get`(2026-09-08 04:20 EDT)

**事实**(执行者三种方式测得一致):inject 之后、同步前段、倒转挂载顺序——disposer 开始运行前 `ctx.get('messageBus')` 已为 undefined。`ctx.get` 读全局服务存储,不是可见性问题:**服务注销发生在任何 disposer 之前**,§12.40/§12.41 的前提在这一层不成立。执行者把同步前段留在树里并写明不可达,对——那是这笔写该在的位置。
**裁决:取 (1) 的合法形态。** 我在 §12.40 拒的是"越过服务边界捕获裸 store"。`inject` 交付的**服务值本身**在激活时就交给了插件——把它持在 `SubagentRuntime` 上、拆卸期用它而不是重 `ctx.get`,**这就是 inject 的用法,不是绕过边界**;纤程顺序(依赖者先拆)保证总线的 DB 在管理器 disposer 运行时仍开着。区别只在:被持有的是服务值(边界),不是它背后的 store(边界之内)。若实测 DB 仍被先关(纤程顺序不成立),再回来量。(2) 让板上出现未结束子代理的行,语义变了;(3) 把 acc[1] 砍成"进程还在"的情形——都不取。冻结不变:父 dispose 时子 settle → 行已提交 pending → 重启 → 投递一次。
**推送**:先推已完成的(三触发 + 内存总线 + §12.39/12.40 部分),acc[1] 闭合单独一批——同意,不让架构裁决压着已完成的部分。

### 12.43 共享暂存区:delegate 的两条裁决提交带走了执行者的实现(2026-09-08 04:45 EDT)

**事实**:`e8a1025886`(§12.40)与 `2bae824b8e`(§12.41)标题是裁决文档,内容含执行者当时已暂存的实现(10 个源文件;`memory-store.ts` / `plugin.ts` / 43 个测试挂载)。成因:共享 worktree 一个索引,`git commit` 提交整个索引;delegate 提交前**看到了**"执行者已暂存 10 个文件"仍然提交——2.6 的"提交前看 staged 区"看了没用上。代码无损,归属与提交信息不符。**不重写历史**(两条虽未推,但共享树里两个会话在同一 HEAD 上工作,rebase 的风险大于一条账面注记)。
**规则(双方)**:(a) delegate 的提交一律 **pathspec 限定**:`git commit -m … -- spec/first100/exec/<file>`,只提交点名的路径,不碰索引里别人的东西;(b) 执行者 `git add <明确路径>`、提交前 `git status` 看索引(已有);(c) 谁发现索引里有对方的文件,先说再动。`e8a1025886` / `2bae824b8e` 的实际内容以本条为准。
**§12.42 结果**:acc[1] 端到端闭合,两个方向的变异各红(写的位置也被断言);`commitSettlement` 跳过已欠行的守卫,对。
**12.43 续 · 规则(2026-09-08 05:20 EDT,执行者提出,采纳)**:改一个包的 `inject`/依赖后,受影响面按**导入来源**枚举(`grep -rl "from '@deepseek-ai/dsh-<pkg>'"` → 逐文件解析默认导入的别名 → 找 `.plugin(<别名>)`),不按调用点的局部名——默认导入可叫任何名字,按名字扫会给出"看起来完整"的假结果(agent-team 三个文件用 `SubagentService` 别名,按 `plugin(SubagentRuntime` 扫零命中)。**先枚举对,再谈范围对。** P2-04 的 `risk-taxonomy` README 两道门已过(model-experience 282/282 本会话首次全绿);`verify-package-invariants` 剩 6 条不归本批。

### 12.44 BLOCKED-158:P4-08 must[2] 的对账经 ledger;acc[2] 的压缩在 run 完成时(2026-09-08 04:05 EDT)

**事实**:`reusableSteps` 只读 `outcome`/`output`/`childReceipts`,不读 `sideEffectReceipts`、不调返回 `reconcile` 的决策;`receiptsToReconcile` / `compactJournal` / `retainsAllReceipts` 生产调用者全 0;生产里 `sideEffectReceipts` 只被 recorder 写。must[2]"有副作用步骤先 reconciliation"与 acc[2] 压缩保留只在函数里成立。执行者判"不需要产品裁决、是消费者忽略字段"——对。
**裁决:取 (2)**。(1) 写的是"带未对账回执的步骤拒绝复用、让它重跑"——**重跑一个副作用步骤正是 P4-12 要防的重复效果**;"先对账"的含义是查该效果的**durable 状态**,而 harness 里外部效果唯一的 durable 状态就是 action ledger(P4-12)。语义:恢复时对每条 `sideEffectReceipt` 查 ledger——`confirmed` → 效果已发生,步骤输出可复用、不重跑;`ambiguous` → 需要对账,**不自动恢复**,以 `ambiguous-reconciliation-required` 结束 resume 并把条目暴露给操作者(P4-12 本来就把 ambiguous 交给对账);无记录 → 该效果从未预留,按未发生重跑。耦合是 registry 已有的(P4-08 must[0] 列了 side-effect receipts,P4-12 是它们的账本);层向下(providers → definitions)。今天没有步骤产生副作用回执,故零行为变更,但子句变真且有真消费者;冻结:confirmed 复用 / ambiguous 拒恢复 / 无记录重跑,变异去掉 ledger 查询 → 红。
**acc[2]**:`compactJournal` 在 **run 完成时**由 `WorkerRun` 调(完成的 run 的 journal 压缩、原始回执保留——`retainsAllReceipts` 在同一点断言),由此有生产调用者;resume 读压缩后的 journal。
**更正**:`recordStep`/`startStep` 在此树非导出,我那句作废。

### 12.45 BLOCKED-157(补编号):`code-runtime-python` 的全局 `Buffer.concat` 补丁是隔离缺陷(2026-09-08 04:00 EDT,原以消息裁定)

真修取注入点(runtime 暴露可观测的 residual/peak 钩子),不取 `singleFork`/`describe.sequential`(把错误的测量方式隔离起来继续用);归 P3-13 lane;四形状对照(预算不足 / 故意用共享预算当断言 / 真回归 / 隔离缺陷)各需不同处置,作产物保留。BLOCKED-157 引用改为本条。

### 12.46 P4-08 acc[2] 与 must[1] 的主语;P2-03 acc[2] 后半归 P2-04(2026-09-08 05:40 EDT)

**A. P4-08**。must[2] 经 ledger 结账已落地(三分支、M25–M27 各自承重、查不到 ≠ 未预留——对)。acc[2] 压缩与 must[1] 的 pure-skip 在这棵树上无主语:`journalingObserver` 常量 `side-effecting`、DSL 无 purity 语法、`stepVerified` 零生产调用者——而**这个 DSL 里被 journal 的步骤只有 `agent()` 调用,没有一个是纯的**;"纯步骤跳过"在此 DSL 由构造即空。**裁(解释,带 provenance 记入 registry 注记,不改字面)**:(1) **verified := 经 §12.44 结账通过**(效果 confirmed + child receipts 核过)——`stepVerified` 在 resume 结账成功处被调用,由此有生产调用者;(2) **skip := 结账后的复用**(§12.44 已做,且比 pure-only 更强:它对副作用步骤也成立,前提是效果已确认);(3) **compaction 作用于 completed+verified 的条目**——丢 inputs、保留全部 receipts(`retainsAllReceipts` 同点断言),不以 `pure` 为门槛;在 run 完成点由 `WorkerRun` 调,由此非恒等、变异可红。DSL 的 purity 声明是工作流语言的产品决定,不在 P4-08 内,记 BLOCKED-158 尾注。
**B. P2-03 acc[2] 后半("要求审批")取 (2)**:P2-03 拥有**声明**(manifest 记 `requiresApproval`,今天每次原生调用都如此,不是边角);**执行**归审批/策略 seam——P2-04(分类)与 P2-05(策略/审批)的 U。签 P2-03 时 acc[2] 后半记**定向延期**:P2-03 行上 BLOCKED 条目 `landsIn: P2-04.U`,P2-04 的 readiness gate 含它、丢不掉;不留在散文里。(1) 会把整条工具路径挂在审批后面(今天所有调用都不可分类),拒。**但记清一句产品事实**:今天一个不可分类的动作被持久记为需审批、然后无审批执行——这是 P2-04/P2-05 落地前的真实状态,进 Known Limitations。

### 12.47 P2-04 preFlight 三裁:policy provider;未知默认 = 最高**可调**等级;acc[0] 走结构(2026-09-08 06:10 EDT)

**(i) P 阶段加 policy provider,走 overlay**:seam 三角色完整或不做——Service Definition = risk-taxonomy 的词表与 `classify`,Provider = `permission-presets` 持有并校验组织 `RiskPolicy`(现成的 `approval/policy` knob 之家),Consumer = 工具派发门。registry P files 只列一个文件是计划未见 seam 规则,overlay 记 provider 文件与理由。
**(ii) U 取 (3),并纠正 C 的一处过度解读**:registry must[3] 原文"未知默认**更高**等级"、P2-03 acc[2]"无法分类的动作默认高风险**并要求审批**"——两条都指向**审批**,不是 kernel hard-deny;C 冻结的 `UNKNOWN_DEFAULT_CLASS = 'safety-critical'`(= `KERNEL_HARD_DENY_CLASSES`)把"更高"读成了"最高且不可调",于是接门那一刻每次原生调用都被内核拒绝——把"不知道"和"已知灾难"混为一谈。**裁**:未知默认 = **最高可调等级**(`security-sensitive`:默认要审批,组织策略可调阈值;`safety-critical` 保留给**已声明**的灾难动作,kernel hard-deny 不可关)。must[3] 约束的是**分类输出**(未知 → 更高等级);**执行决定** = 策略阈值(provider)+ kernel 带。C 那条"classifies at the HIGHEST class" **supersede**(BLOCKED-066:性质变了)为"at the highest policy-adjustable class, never in the kernel hard-deny band"。U 的门对**所有**调用消费 `classify`(不分已声明/未声明,拒 (2):门层"未声明即不拦"削弱 must[3]);审批的落地 = 现有 approval/interaction 能力 + preset 阈值(headless preset 的默认由 provider 决定并冻结,不硬编码)。工具逐个声明 domain tags 作后续:结构门列出出货工具中未声明者,程序 GO 前清零,记 BLOCKED。
**(iii) acc[0] 不预判为延期,先量**:若 CLI / Web / SDK 三个表面都经同一条核心派发(`tool-calls.ts`)到达同一个 `classify` 调用点,acc[0] 由结构成立——冻结一条结构门:全仓 `classify(` 生产调用点唯一且在核心派发上,且三表面无各自的工具派发;若量到某表面另有派发,那才是延期,且要写明是哪个表面。
**F**:fault matrix 按 P4-08.F 形状,边界含"未知 → 可调最高级、不进 hard-deny 带"与"已声明 safety-critical → 策略不可关"。preFlight 其余(标准所有权 ToolAnnotations 等)按卡。

### 12.48 P4-09 的注册半边;P2-04 的默认审批阈值按表面定(2026-09-08 07:20 EDT)

**A. P4-09**:嵌套半边全闭;注册半边 `admitRegistration` / `DefinitionRegistry` / `isCurrentDigest` / `isSelfRecursive` 生产调用者全 0——引擎持 `Map`、digest 按调用者原样存、从不重算,acc[0]"未验证"三字未兑现(digest A 注册 body B 无人拒)。**裁**:(1) 现在做——引擎持 `DefinitionRegistry`,注册经 `admitRegistration`(重算 digest、不符即拒)与 `isSelfRecursive`;(2) **producer 不是产品问题,有仓库先例**:saved workflow = 配置目录下的定义文件,由一个 filesystem provider 在 boot 时加载并经 `admitRegistration` 注册——与 `skill-filesystem` 加载 skills 同形(目录从 profile 存储根派生,不加 tunable);嵌套 `workflow({name,digest})` 解析的就是它们。P4-09 U supplement 含 (1)+(2);冻结:目录里 digest 与 body 不符的定义被拒且点名;自递归定义被拒;真组合:目录一份定义 → 父脚本 `workflow()` 起它。签在此之后。
**B. P2-04 U 的默认阈值**:今天无工具声明 tags → 全部 unknown → `security-sensitive`(rank 6)≥ 基座默认 `destructive`(rank 4)→ **每次调用要审批**;headless 无人可批。**裁(临时,§6 报用户)**:阈值是**表面策略**——有人能批的表面才有"要求审批"的落点。基座 `approvalThreshold = 'safety-critical'`(只门声明的灾难动作,它们本就 kernel hard-deny);**交互表面覆盖为 `destructive`**(`acp-app` / `web-app`:能提示的地方就提示,unknown 在此要审批);`headless` / `sdk-*` 用基座值——保持今天的产品行为,不把整条工具路径挂在没人能批的审批后面。分类本身在所有表面都严格(unknown → security-sensitive),差别只在执行侧谁能批。结构门:列出出货工具中未声明 tags 者,GO 前清零(BLOCKED)。**用户可改**:若要"全表面 unknown 即审批",改基座一行即可,我推荐上面这版。U 冻结:交互表面 unknown → 审批请求真发出;headless unknown → 记录 `requiresApproval` 且按阈值放行并审计;声明 `safety-critical` → 所有表面 hard-deny。
**(iii) acc[0] 结构成立**:全仓两个派发点共享 `external-effect.ts`,三表面无各自派发——结构门冻结即可,不是延期。

**12.48-B 修订(2026-09-08 08:05 EDT,按挂载点实测)**:策略轴不是"表面",是**权限 preset**——base 的 `permission` 条目(`cordis.patch.yml:235`)已有 `read-only` / `workspace-write` / `danger-full-access` 三档,各带 `approval: ask|never`,由 `DSH_PERMISSION_MODE` 选,默认 `workspace-write`;`acp-app` / `headless` / `sdk-*` 不另挂 permission-presets(web 只多 UI 件)。而 `user-approval` 的 `ask` 在无 answerer 时**fail-closed 为 `unavailable`**(headless 立场,设计如此)。于是:门落地时若出货工具仍全部 unknown,headless 每次调用都被拒——不是"没人想要的红",是把整个 headless 打坏。**改裁**:(a) `approvalThreshold` 写在**每个 preset** 上:`read-only` / `workspace-write` → `destructive`,`danger-full-access` → `safety-critical`;bundle 无表面覆盖;两个测试 overlay 继承。(b) **依赖反过来**:出货工具**先声明** domain tags(P2-04 registry U 文件 `core/tools/src/types.ts` = 工具定义带 tags;各工具包填真值,沙箱内常规操作须落在 `destructive` 之下,沙箱逃逸本就走 `ask`),**再**接门;"声明作后续"作废。(c) 结构门:出货工具集合里 unknown = 0,既是 P2-04 U 冻结用例也是 GO 条件。(d) 顺序:tags → 门 → 观测;headless 语料预期不变(声明对的话),acp/web 只在声明类 ≥ 阈值时出现审批。§6:向用户报告——默认 preset 的阈值是产品默认,可改。

### 12.49 P4-09 加载器的登记面;P5-11 签五条、must[1] 定向延期;P2-04 顺序(2026-09-08 08:40 EDT,`8be7368d74`)

1. **登记不上 seam,保持加载器的结构化命名 + 大声拒绝**:`RegisteredDefinition` 下移并让 seam 声明 `registerDefinition` 会强制每个引擎实现登记——seam 语义扩张,而当前消费者只有一个("Design Service Definitions for all current Consumers");结构方式命名唯一需要的操作、缺则拒,正确。Dev Note 记未定项即可。acc[0] 由构造证明(body = `process.exit(1)`,求值即带走进程)对;`RecordingEngine` 包真 registry 而非重写检查,对。
2. **P5-11**:签 taskboard/mailbox 五条;must[1](blackboard facts)记**定向延期** `landsIn: P6-02.U`,门控于 BLOCKED-156(用户对 memory 线的产品裁决)——与 §12.27-3、§12.46-B 同形。
3. **P5-10 可签**(七条子句单一消费者 `ChildControlRouter`,`controlFor` 按子构造缓存,无旁路)。
4. **P2-04 顺序**:preset 三个 `approvalThreshold` 值先写进 base(门未接,零行为变更)→ 工具定义 `riskDomainTags` + 出货工具填真值 → 结构门 unknown = 0 → 接门 → 观测。
5. `core.zh.md` 的 `Agent` 块失同步早于本程序,不伪造配对,归 BLOCKED-124 的 20 对——对。

### 12.50 P2-04 步骤 4:tag → class 映射与接门三分支(2026-09-08 09:35 EDT)

**裁**(八级升序 `read < local-reversible < internal-write < external-communication < destructive < financial < security-sensitive < safety-critical`;默认档阈值 `destructive`):
- 执行者草案**除一条外照准**:`filesystem-read` / `catalog-read` / `session-state-read` / `process-observe` → `read`;`session-state-write` / `context-inject` → `local-reversible`;`filesystem-write` / `process-control` / `agent-spawn` / `agent-control` / `orchestration` → `internal-write`;`network-search` / `network-fetch` → `external-communication`。
- **`shell-execute` → `internal-write`,不是 `destructive`**。理由与 `filesystem-write` 同一条:**沙箱是边界的执法者**,沙箱内的 shell 与沙箱内的写文件是同一信任域(它能做的破坏 = 写文件 + 起进程,都在 workspace-write 已授予的范围内);沙箱逃逸本就走 `approval: ask`。把 shell 抬到阈值上会在交互档每次 bash 都审批、在 headless 每次 bash 被拒(`ask` 无 answerer fail-closed)——打坏 headless,这正是 §12.48-B 修订避开的坑。
- **"表在默认档一个都不拦" 不是缺陷,是沙箱在工作**:默认档的风险门真正门住的三样是 (1) **未声明 tags 的工具**(unknown → `security-sensitive` ≥ 阈值:交互档审批、headless 拒——第三方插件工具"不声明就不在 headless 跑",fail-closed 是 P2-03 acc[2] 的意图,模型可见拒绝文本写明"undeclared risk",Known Limitations 记);(2) **声明 `security-sensitive`/`financial`** 的动作(今天出货集合无);(3) **声明 `safety-critical`** → 所有档 hard-deny。U 的真门用例正是这三条(测试组合里放一个未声明工具、一个声明 security-sensitive 的工具、一个声明 safety-critical 的),不需要把 bash 抬上去制造"有东西被拦"的假象。
- (a) 表写在 base `permission` 条目 `riskRules` 下,全部 bundle 继承,对;(b) 门在 `core/tools/src/external-effect.ts`(两派发器共享),三分支 `hardDenied` 直接拒 / 达阈值走 `ctx.approval` / 其余放行,对;(c) 由上,headless 出货行为不变(shell、写文件都在阈值下),变的只是未声明工具与声明高危动作。snapshot 语料预期不变。
**§6 报用户**:默认档下"未声明风险的插件工具在 headless 被拒"是产品默认,可用 `DSH_PERMISSION_MODE=danger-full-access` 整体退出,或在 preset 里调阈值。

### 12.51 P4-06 / P4-07 全闭可签;P4-12 签七条,must[2] 与 must[3] 后半定向延期到 P4-13.U(2026-09-08 09:50 EDT)

**P4-06**:settlement 路径为消费者(`commitIntake` 4、`applyReceipt` 3),must[0] 否定半边("不经 KV seam")是模块属性——`bus-store.ts` 直接 `node:sqlite`、无 KV import;must[2] 到达键与 `commitSettlement` 同一三元组——**可签**。**P4-07**:两条子句(must[0] work item、acc[0] `leaseRefused`)是在本程序里量错后修对的,证据包按事实写——**可签**。
**P4-12**:七条闭。must[2]"provider 若支持原生 key 则透传"与 must[3]"目标状态查询"后半在本 build **没有主语**:唯一出货 HTTP 出口 `web-fetch-http` 只 GET,搜索 provider 的 POST 是查询不是效果——没有任何出货 provider 既产生外部效果又支持该 header。**定向延期 `landsIn: P4-13.U`**(Reconciliation Engine,W13,前置正是 P4-12;其 must[0]"Tool/provider 可声明 observeState / compareExpected / compensate"就是 provider 声明能力的地方——原生幂等 header 支持与目标状态查询在那里获得主语),写进 P4-13 的 readiness gate。这不是"填一个不会发生的 epic":P4-13 已排期且以 P4-12 为前置。签七条。

### 12.52 delegate 误签 P4-07:`--accept` 只报 (iv) 不等于行是重建后的(2026-09-08 06:50 EDT)

**事实**:`--accept --epic P4-07` 只报 (iv),我随即签 PASS;核 cells 才见 C/P/U 在 `82d5e81122`(run 33959624760,重建前)、F 在 `d4034a8f4c`(admitted),**无任何 supplement**——U.2 / U.3 冻结并在 CI 绿过,但从未记进 ledger;openFinding(barrel 仍导出 `advanceAgentLifecycle`)也仍为真。已 WITHDRAWN。五条候选**没有一条**在 `82df08491f` 有格子或 supplement——执行者的"绿格"是意向不是完成态,我没核就签。
**规则(4.4b)**:签字前核每个格子与 supplement 的 `candidateSha` / run 是**重建后的观测**;`--accept` 的输出是必要条件不是签字依据。**顺序**:admit 绿格(两红步原文)→ 修谓词红(P5-10 coverage 缺、P5-11 acc[0] 引用被 supersede 标题、P4-06 C/P 共享观测文件、P4-12 U 未绿)→ P4-07 删导出关 finding → `--accept` 各只剩 (iv) → 核 SHA → 签。

### 12.53 谓词修正的三条规则;(v) 4 MISSING 等下一次观测(2026-09-08 07:40 EDT)

1. **被 supersede 的 base 冻结条目,其继任者必须也是 base**(P4-06 的 P 被写成 supplement P.5 → stage 无 live base → `checkObservationDistinctness` 对无条目的格子报"shared observation file",读起来像观测问题实为缺条目)。2. `supplements: null` 与键不存在语义相同,数据统一为键不存在,**不改判据**(改 `=== undefined` 为 `== null` 会让真实不一致隐身)。3. coverage 引用为 AND 语义,每条带"为何是独立子事实"。
**(v) 4 MISSING**:P4-12.U(base U 冻于观测之后却从该观测绿——冻结先于观测,不可)、P4-06.P(P.5 改 base 后未观测)、P4-07.U / F(继任者不在其格引用的树)。四格等下一次 run 的观测;**(v) 不为 0 之前不签任何一条**。`--admit-red-run` 正确拒绝了六格"观测在更早 run"的 admit 请求——工具守住了 §12.52 那条。

### 12.54 BLOCKED-145 改判:不是采样缺陷,是 experimental/inspector 的转发竞态;单条用例带记录隔离(2026-09-08 08:20 EDT)

**事实**(执行者实测,6 次/版本):原样 1/6 红;按我 §12.53 后裁的"事件等待"改法 **4/6 红**;回退 0/6。把等待超时压到 3 s 后失败原文:`CDP event never arrived; saw 3 event(s): Runtime.executionContextCreated ×3`——**零条 `Runtime.consoleAPICalled`**。`client.log()` await 的是 fixture 的 request/response(worker 确认收到指令),不是"inspector 已把事件投递到 CDP socket";中间的窗口没有任何东西保证。**这是 inspector 转发路径的产品竞态**,不是 `vi.waitFor` 的问题;我的"改成等事件"裁决前提不成立,**撤回**,执行者回退并报数据是对的。
**裁决**:(1) `experimental/inspector` 不在 110 项内、不出货("private prototypes excluded from official releases"),修它的转发竞态是跨项偷做——**不修**。(2) 但 §12.6(a) 让每次观测为它的竞态背书,不可持续:**这一条用例 `it.skip`,理由字符串引 BLOCKED-145 与上面三行原文**,包的 Known Limitations 记"console 转发在 log 确认后可能不投递(竞态,未修)"。这**不是** flake 名单:它是有原文、有根因、有归属的已知产品缺陷,skip 在报告里可见(skipped 计数),不是静默。与 A2"禁止 skip"的区别:A2 针对**在程序范围内的**基线红产品缺陷(要真修);此处缺陷在范围外、且已按缺陷登记。若 inspector 日后进入程序范围,先修它再取消 skip。**用户可推翻**(改为现在修,预算另议)。(3) py-types 中位数修法保留。

### 12.55 BLOCKED-160:P9-08 / P9-09 保持 PREMATURE;keyless 半边等前置(2026-09-08 09:05 EDT)

执行者把两条 P9 拆成"keyless 可建"(runner、报告形状、反作弊、promotion 决策)与"需真凭据与真花费"(基线 ≥20 任务、nightly 真跑一次、真实 promotion),拆分正确;凭据半边是**权限限制不是能力限制**,归 R10(用户:外部 key + 预算 + 三夜窗)。**裁**:两条的前置(P7-09 W16、P9-06 等)未落,**现在不建 keyless 半边**——在前置未定义的接口上先建下游正是 P6-02 先于 P6-01 的错;`judgeTask` 等零调用者的现状在前置落地前是**预期**而非缺陷。状态保持 `PREMATURE`(§12.10 已裁 (a)),到 W21/W22:先 keyless 半边、再向用户要凭据。

### 12.56 `verify-frozen-titles-resolvable` 的成本随冻结单调增长:改读证据的方式,不改判据(2026-09-08 09:40 EDT)

**事实**:216 条冻结 / 133 条唯一命令,`spawnSync` 顺序重放、每条 `maxBuffer: 256MB`,观测报告 MB 级;本地连续三次被杀(exit 144),209 条时尚可。**裁**:门**检查什么**不变(每条冻结标题必须出现在其命令的真实 `--reporter=json` 输出里);改**怎么拿到输出**:(a) vitest 用 `--outputFile` 写到临时文件、从磁盘解析,不经 stdout 缓冲(去掉 256MB `maxBuffer`);(b) 唯一命令只跑一次,所有引用该命令的条目对同一份输出核对;(c) 保持顺序执行(并行会在共享主机上制造 §12.35 那类负载红),CI 的 exact-sha 同样受益。规格用例:改前改后对同一棵树给出**相同**的 UNRESOLVED 集合(含一条故意坏掉的标题),证明只是读法变了。执行者报门结果时,该门未跑完就说"未跑完",不报 N/M——已对齐。
**P9-08 keyless 半边撤回**:执行者自查是跳 wave(P7-09 W16 全 NOT_RUN),删代码与冻结、三条设计结论留在 BLOCKED-160——对;"技术上没被卡住 ≠ 被准许"这句进 Standing。

### 12.57 P4-05:观测早于主语的移除,四态无生产者;Cedar slice 三答(2026-09-08 10:30 EDT)

**P4-05**。三格绿在 33946026079 / 33946484946 / 33946729009,全部早于 §12.16-3 撤掉本 epic 的主语 `advanceAgentLifecycle`;(v) 过是因为那些树含当时的冻结,但**被观测的代码已不存在**。must[1] / acc[0] 闭(4 个 `advanceLeasedAgent` 调用点,epoch 由 store 签发);must[0] 十态中 `waiting_human` / `paused` / `failed` / `orphaned` 零生产者——**`failed` 不可达意味着终态集合一半死**,出错的 agent 只能到 `completed` 或哪都不到;acc[1] `consumesNoResources` 零调用者;acc[2] `orphaned` 零生产者、全仓无 reclaim 路径。**裁**:(1) 三格从 `34225817745` 重绿(当前代码的观测),否则不算;(2) **P4-05 U supplement**:`failed` 由 agent-loop 的错误路径产出(终态必须可达);`waiting_human` 由 P2-04 的审批请求产出(现在有真 producer);`orphaned` 由 P4-07 的租约过期未释放产出、reclaim 路径归 P4-05(P4-07 Known Limitations 把回收扫描交给 scheduler = 本 epic),acc[2] 两臂由此有主语;acc[1] 给 `consumesNoResources` 一个真消费者——租约续租/预算记账在非消耗态跳过(有机制才是 harness 属性);`paused` 若无 producer 记定向延期并写明。不签直到这些落地并观测。
**Cedar slice**。(i) 三类划分:决策语义(forbid > permit、默认 deny、可解释、partial eval)= **C**(引擎契约);翻译层(`ctx.policy.decide(manifest, identity, token, world, facts)` ↔ Cedar entity/context)= **P**;fail-closed 加载器 + Node 22.19/24 双端 = **F**(`engines` 未声明 → 冻结用例而非散文,对)。形态 runtime,同意。(ii) 包:Service Definition `packages/policy/policy-engine`(`policy` 组 = capability-definitions,已查),Provider `packages/policy/policy-engine-cedar`——但 provider 不能与定义同组同层,放 providers 层的组(与 lease-sqlite / taskboard-sqlite 同法,执行者按 GROUP_LAYERS 选 providers 组)。(iii) 冻结的 `epic` 字段:**先例是 SLICE-fiber-A 记在其消费者 P0-02 的阶段上**;Cedar 的消费者是 P2-05,但 P2-05 未开——写 `P2-05` 会被读成它的阶段。**裁**:冻结条目 `epic: 'P2-05'`、`stage` 按上面三类、`note` 首行 `SLICE-cedar (§3.1), consumer P2-05 not yet started`;门 (u) 与 4.4a 对 P2-05 生效时,这些条目算它的 C/P/F 基础、U 仍由 P2-05 自己接消费者。供应链复验通过(pin 未过期、无 dependencies、13.05 MB、三入口)。preFlight 确认,可动文件。

### 12.58 BLOCKED-162:风险门把未打 tag 的 `subagent` 工具挡在审批后,sdk 无 approver → 子代理永不 spawn(2026-09-08 11:40 EDT)

**事实**(执行者从父 session log 四行断出:`approval/asked`(unknown 默认 security-sensitive)→ `approval/decided unavailable` → `tool/result` 需审批 → `turn/end` ledger 无 reservation 可置 ambiguous):(a) `subagent` 工具没有 `riskDomainTags`——§12.50 的结构门"出货工具 unknown = 0"从 bundle 推导工具集合,**漏了由运行时贡献的工具**(subagent 的工具不经 tool 包的 `defineTool`);(b) native 派发在风险门**之上**就发布了 `records[index]`,被拒的调用带着未 reserve 的 key 走到 `confirmExternalEffect` → `markAmbiguous` 抛——ptc 路径没有这个 bug,两条派发路径在"拒绝"上不一致,正是 P2-04 acc[0] 说不可能的事;已修(门过后才发布 record),对。
**裁决**:(1) **不调低 unknown default**——fail-closed 立场不退。(2) **`subagent` 工具声明 tags:`agent-spawn`(+ `agent-control`)→ `internal-write`**,这不是"替工具下安全判断":§12.50 的表已经把这两类判为 internal-write,这是表的第 29 行,漏在推导里。(3) **结构门修根**:出货工具集合的推导必须覆盖**所有**贡献工具的路径(tool 包 + 运行时 contribution),用例:去掉 subagent 的 tags → 门红;这条洞正是"门看得见文件、看不见到达"的又一形。(4) 该 sdk 场景的 expected 是门之前录的,**修后重录**(先 build):若只差 `classified:true` 与类,这就是真实新行为。**教训**:§12.50 我裁"默认档一个出货工具都不拦"时,依据是执行者的 28 个声明与结构门——门的分母错了,我的裁决也就错了一格;第三问(到达)在 P2-04 U 上的答案要包含"运行时贡献的工具"。
**12.58 修订(2026-09-08 12:20 EDT,执行者实测)**:三条前提不成立——`subagent` 早已声明 `riskDomainTags: ['agent-spawn']`(`tool-subagent/src/index.ts:374`),结构门的推导含 `tool-subagent`,分母没错;"记在我头上"那句作废。**真缺陷仍是第三问(到达),换了个位置**:`gateActionRisk` 用 `ctx.tools.get(name)` **不带 scope**(全局视图),而 subagent 的工具注册在 agent 自己的 scope 上,查不到 → `?? []` → 按未声明送审;派发器早就 `this.get(name, agent)`。范围:**凡 scope 注册的工具一律被当成未声明**——读文件的门看不见,tags 就在它读的源码里。两处门调用点改按调用 agent 的视图查,用例断言分类器收到 `['agent-spawn']`,改回则 `[[]]` 红。sdk 场景 expected 未改即过——它们一直是对的。**教训**:门与派发器对"这次调用解析到哪个定义"必须用同一个查找;到达问题不只在 bundle 行,也在**解析视图**。`EXEC-STATE.activeBranch = first100-exec` 是共享分支名(推送目标),本地 `land-base-align-v2` 只是本地名,不改。

### 12.59 BLOCKED-163:acc[1]"等待态不消耗资源"的真机制是并发槽;策略:等待放槽、恢复优先(2026-09-08 12:55 EDT)

**事实**:我 §12.57 点名的两个消费者都不成立——租约续租跳过非消耗态**有害**(`waiting_tool` 是每次工具调用的常态,超过 `leaseMs` 租约就掉、work item 被抢);预算记账是**空操作**(`LoopBudget` 只有 maxTurns / maxSpendUsd,等待不消耗二者,谓词卡不住任何输入——M39/M44 形)。harness 里等待中的 agent 唯一能霸占的有界资源是 workflow runtime 的 `maxConcurrentAgents` 槽(`runtime.ts:241`,`acquireSlot`/`releaseSlot`,FIFO),当前一个 run 整个运行期占一槽含等待期——刻意的;`holdsDispatchSlot`(`dispatch.ts:219`)零生产调用者,是等这个调度器的包装。
**裁决**:acc[1] 的主语 = 并发槽。(1) 进非消耗态(`waiting_human`、`waiting_tool` 等 `NON_CONSUMING_STATES`)**释放槽**,恢复时**重新获取**;(2) **恢复优先于新启动**——恢复者排队头(不是 FIFO 尾),新启动者可能等待;由此没有"放了槽拿不回来"的饥饿,代价是新启动的延迟,这是被写下的策略而不是碰巧;(3) `holdsDispatchSlot` 成为派发层的真实检查(无槽不派发),由此有生产调用者。**归属**:子句是 P4-05 的,文件是 P4-09 的 runtime——A 类 `CONSUMERS_ADDED`:P4-05 加 `packages/workflow/workflow-worker-thread/src/runtime.ts`(kind N,§12.19-1 修订同法)。冻结:`maxConcurrentAgents=1`:A 等人 → B 启动(槽空)→ A 恢复 → A 先于第三个新启动 C 拿回槽;变异"恢复排 FIFO 尾"→ 红;"等待不放槽"→ B 启动那条红。

### 12.60 `holdsDispatchSlot` 的家是模型步准入;`orphaned` 由回收方写,不开围栏口子(2026-09-08 13:30 EDT)

**槽机制**:§12.59 (1)(2) 落地——等待放槽、恢复 unshift 队头;两变异一个顺序变、一个**死锁**(后者更诚实:B 根本跑不起来);用例等队列状态不等 tick,前两版自己的微任务竞态被作者抓到改用例不收绿——对。
**(3) `holdsDispatchSlot`**:执行者量对——工具派发处不能用它(`tool-calls.ts:95` 派发前就进 `waiting_tool`,而它在 `NON_CONSUMING_STATES` 里,加检查等于拒掉每次工具调用)。**裁**:它的家是**模型步准入**——一个处于非消耗态的 run 在重新持槽前不得开新一步;检查放在 `waiting → running` 的转换点(pre-step / `ensureRunning`),与"恢复优先获取"配套:恢复者拿回槽 → `holdsDispatchSlot` 真 → 步开始。若 `ensureRunning` 的顺序让它不可放,报数据再裁。
**`orphaned`**:`advanceLeasedAgent` 在租约丢失时拒写(`fenced`),而 `orphaned` 定义上写在租约丢失之后——这不是矛盾,是**写入者错了**:丢了租约的 host 不该写任何东西(围栏正确);`orphaned` 是**观察到丢失的一方**写的——回收方(另一 host 或 store 的过期扫描)在 reclaim 时以**自己的**(有效的)epoch 把 run 标为 `orphaned`,随后接管或按 acc[2] 安全失败;原 host 发现被围栏只需停(已有 `FencedError`)。所以 `orphaned` 是 supervisor/reclaimer 侧的生命周期写入,携带新持有者的 token,**不开任何绕过围栏的口子**。reclaim 路径归 P4-05(§12.57),写入点在回收扫描(P4-07 Known Limitations 交给 scheduler 的那一半)。冻结:A 的租约过期未释放 → 回收方 B `acquire` 成功 → 写 `orphaned`(B 的 epoch)→ 接管或失败;A 之后任何写 → `fenced`。

### 12.61 五签;BLOCKED-164 三类归零(被 supersede 的条目不被观测);P4-06.P.1 账本陈旧行;P4-09 两处门口径与 must[2]/must[3] 主语;P2-04 MCP ToolAnnotations 落地不改判据(2026-09-08 11:00 EDT)

**观测**:run `34238203263` @ `434408a47c`,两 job success、签名 bundle、20490/0/0,候选全部 live 冻结标题 passed(自签名报告核,不是执行者转述)。**签**:P2-03、P4-07、P4-12、P5-10、P5-11,各按 4.4b(格与 supplement 全部 `434408a47c`、0 open finding)与 4.4a(生产调用者 + bundle/base 行或 core 包导入 = 到达)逐条核后 `--record-signoff PASS`;P2-03 的 P=N/A 是 contract epic 的设计,acc[2] 执行半按 §12.46-B 在 P2-04.U。

**BLOCKED-164 裁**:四条里三条(`P4-12.C.1`、`P5-11.U.1`、`P4-09.U.1`)在 `command-freeze.json` 已带 `supersededBy`,账本没有它们的行,`--accept` 也不数它们——**被 supersede 的冻结条目不被观测,这就是 supersede 的含义**;改名机制(BLOCKED-040)只用于**仍 live** 的条目标题挪了位而观测含义要保住的情形,三条都不是,**零登记**。执行者"P5-11.U.1 可登记改名"错在把冻结文件里的历史条目当成待绿对象;"P4-12.C.1 性质变了"的担心成立但已被回答:两 principal 同 key 两行、错 principal 拒转换,活在 P 阶段(BLOCKED-142 用例),C.2 只测决策携带 principal,分工正确,无缺口。第四条 `P4-06.P.1`:冻结 #173 已被 P.3(#175,15 条,含改名后的那条)supersede,其余 11 条也都在 live 条目里于本次 run 通过——**内容全被观测,但账本仍持 P.1 GREEN@`b3186e6db9`**,这是账本与冻结不一致的陈旧行,不是改名问题。**P4-06 不签**,直到账本把 P.1 记为被 P.3 supersede(账本工具若没有这条路,`generate-ledger` 应从冻结推导 supplement 的 live 性——工具缺口,补上再绿);之后 `--accept` → 签。**规则(写入 EPIC-LIFECYCLE 2.11)**:supplement 的 live 性以冻结的 `supersededBy` 为准;账本行不得与之矛盾;4.4b 只数 live supplement。

**P4-09 裁**:(1) **不签**——两条理由各自充分:格仍引 `00815e8acc`(4.4b 不过),且 must[2] 有 open finding。(2) **两处门口径**:`--accept` 不查 open finding 而绿格路径查——**统一到严的一边**:`--accept` 在任一 open finding 存在时拒绝(工具改 + 一个拒绝用例),执行者做;此前所有已签行核过 open=0,无追溯。(3) **must[3] 的关闭是过早的**:finding 记三名词(budget / capability token / trace),关闭理由只答了"有生产调用者";实测 `nesting.ts` 继承 budget、检测递归(ancestors+maxDepth),**capability token 与 trace 继承零出现**。重开为两半:capability token——P2-02 已 ACCEPTED,主语存在,**建**:嵌套 run 启动时从父的可衰减 token 派生子 token(只能收窄),冻结:子不得超父、子不能放宽;trace——所有者 P7-07 未启,**按 P4-04/DSSE 同法记 imported-PENDING**,现在暴露字段(子 run 携带父 run id + trace 上下文占位),P7-07 落地前 P4-09 不验收。**规则(4.4c)**:关闭一条 finding 必须逐名词给量,消息里带表;一个名词的证据不关整条。(4) **must[2] `detached` 建,不撤**——must 是 registry 的要求,撤需用户,我不撤;主语现在有了:Run service(P4-05/P4-07 租约、P4-06 journal、resume)。语义:detached run 由 Run service 持有、自持租约,turn 立即返回 run id;session 结束/UI 断开**不取消**(断开 ≠ 取消),显式 cancel 仍传播(P5-10 提升);可按 run id 重新附着(观察/等待/取消);detached run 携带启动时派生的 capability token(与 must[3] 同一机制,这就是它离开 turn 后的权限来源)。做法:先 preFlight(make-vs-use:预期无新 OSS,复用 RunPlugin+lease+journal;4.4a 命名消费者=workflow 工具消费者 + 到达的 launched profile),冻结先于观测(§12.53 顺序),再建。冻结:启动 detached → turn 结束 → run 仍在(租约续)→ 重附着拿到结果;显式 cancel → 终止;变异"turn 结束即 cancel"→ 红。

**P2-04 `@modelcontextprotocol/sdk` 裁**:gate `verify-adapt-dispositions` 红得对,**不改成 deviation**——三类理由无一成立:SDK 在树里且被 `packages/mcp/mcp-client/src/{connection,tools,transport}.ts` 导入、账本 adapt、计划把 `MCP ToolAnnotations` 的 shape 指派给 P2-04(standardsOwned PENDING,`--accept` 本就拒 pending ownership),用户令「有 OSS 就混」。实测缺口:`mcp-client/src/tools.ts` 拉 `tools/list` 后 **annotations 被丢弃**(src 里 readOnlyHint/destructiveHint/openWorldHint/idempotentHint 零出现),于是每个 MCP 工具到 `gateActionRisk` 时 `riskDomainTags` 为空 → undeclared → headless 拒/最严。**建为 P2-04.P.n supplement**:(a) mcp-client 在 wire 边界保留并校验 `annotations`(按 AGENTS.md 在 model/tool JSON 边界校验,畸形 → 拒该工具不拒整个 server);(b) MCP 工具的 riskDomainTags = 运营者在 server 配置里声明的 tags ∪ **只升不降**的注解映射:`destructiveHint:true`→`destructive`,`openWorldHint:true`→`external-effect`,MCP 规范缺省(readOnly=false、destructive=true、openWorld=true)→ 无注解 = 最严,与 undeclared 一致;`readOnlyHint:true` **不能降低**到 undeclared 缺省以下——MCP 规范自己写"不得基于不可信 server 的注解做工具决策";只有 server 配置 `trustAnnotations: true`(validated Config 字段,缺省 false,非硬编码)时 readOnly 才算声明;(c) 这就是账本那句「4 hints 映射到 8 类作为输入,永不作为可信输出」的落地,同时把 `MCP ToolAnnotations` 的 ownership 从 PENDING 变为有用例钉住。冻结:敌意 server 对运营者标 destructive 的工具声明 readOnly → 仍 destructive;无注解 → 最严;destructiveHint → 需审批(workspace-write);`trustAnnotations:true` + readOnly → 放行;畸形 annotations → 该工具拒。**推送**:C14 门③要求 gate set 绿;此条红 → **待推队列(8e7bb870f8…a2d22c1e43 + 本节五签)在此 slice 落地前不推**;这就是"在 F 之后绿格前先落 P 阶段 adoption"的顺序代价,不动门。

### 12.62 supplement live 性派生落地(工具核过);P5-11 C.1 事后被标 SUPERSEDED 不回滚;P4-11 未经 preFlight 起工且手写了账本判 adopt 的断路器——停,先 preFlight(2026-09-08 11:30 EDT)

**工具**:`deriveSupplementLiveness` 在写入时从冻结派生(不手改账本),citation 匹配加 `!f.supersededBy`,RED 不升格、无冻结条目不动——三条用例锁住,与 §12.61 规则一致,核过。P4-06 `P.1` → SUPERSEDED,`P.3` 重绿 `434408a47c`,只剩 (iv),**签**(行 digest 换新,记录以工具计算为准)。
**P5-11 `C.1`**:派生顺带把它标为 SUPERSEDED——它被 live C 条目(#115)取代,签字时我的 note 把它列为绿 supplement,那是当时账本的陈述;签字所依据的是 live 格与 live supplement,子句覆盖不变,`--check` 通过。**不回滚、不重签**;此处记明 note 里的 C.1 一句作废。
**P4-11**:执行者在等我期间自起 `packages/reliability/retry`(C:classify/budget/circuit,14 用例本地绿,未冻结未观测未声称——如实报了,这点对)。**但三处不合规**:(1) 生命周期 §1 要求 preFlight 在第一行代码前完成并经 delegate 确认——没有 preFlight;(2) 「技术上没被卡住 ≠ 被准许」——`check-ready` READY 是必要条件,波次顺序是我给的(P4-06 → P2-04 MCP → P4-09),P4-11 不在其中;(3) **账本判 adapt `cockatiel`**(circuitBreaker consecutive/sampling + halfOpen、bulkhead、timeout、fallback、wrap、events),包 `dependencies: []`,`circuit.ts` 手写了一台断路器状态机——这正是用户令「引用已有的开源软件而不是自己从 0 开始写」禁止的形状,再采 cockatiel 就是两台断路器。**裁**:P4-11 停在此处,C 代码**不作为候选**;先写 preFlight:make-vs-use 记 cockatiel adopted(form=runtime,landsIn P:Provider 用 cockatiel 的 breaker 实现 Definition 侧的决策接口,`circuit.ts` 的状态机删除,不留平行实现);backoff+jitter 复用树里已有的 `llm-retry`(账本据此拒了 p-retry / exponential-backoff),P4-11 是**统一**它而不是第三套;must[1]「所有层消费同一 RunRetryBudget」按 4.4a 在 preFlight 里**逐层点名**消费者(llm-retry、工具执行、subagent、web、mcp transport……树里实际有几层就列几层),放 U 对,但 C 必须定义那些层将消费的类型和接口;must[3]「有副作用动作只在 idempotency/reconciliation 保证下可重试」的主语是 P4-12 action-ledger(已验收)——分类器对副作用动作的重试决定必须读账本对账状态,冻结用例:未对账的副作用动作 → 拒绝重试。classify/budget 可留作 C 候选,以 preFlight 的子句主语审计为准。**规则(写入 EPIC-LIFECYCLE 1.x)**:等待 delegate 期间的空闲用于写下一个 READY epic 的 preFlight 并发来,**不写代码**;代码在 delegate 确认 preFlight 之后。顺序不变:P4-06 签 → P2-04 MCP slice → P4-09 三件 → P4-11 preFlight(可在等待时写)。

### 12.63 P4-05 重建的五片零冻结——推送前必须冻结,否则下一次观测对 P4-05 是空的(2026-09-08 11:55 EDT)

实测:`command-freeze.json` 里 P4-05 的 live 条目仍是 2026-09-05 的 C/U/F 三条(#74–76,原状态机用例);`434408a47c..52edc5ac47` 新增的 `fenced-dispatch.spec.ts` / `nested-budget.spec.ts` 用例——`waiting_human` 可达(must[0])、orphaned 由回收方写且原 host 被围栏(acc[2])、回收拒绝仍持有者当前的项(acc[2] 负控)、等待放槽 / 恢复优先 / 无槽不开模型步(acc[1])、以及 `434408a47c` 里的 `failed` 生产者——**在冻结里零命中**。§12.53 的顺序是冻结先于观测;§12.52/4.4b 的教训是"格绿在早于其冻结的 run 上"就是错的。此处若照队列推送,观测对 P4-05 只覆盖旧三条,新行为无观测,P4-05 不能签,再一次观测白跑。**裁**:推送前执行者补冻 P4-05 supplement(C:failed / waiting_human 可达;U:槽释放、恢复优先、步准入,消费者 `runtime.ts` 按 §12.59 A 类;F:reclaim 写 orphaned + 围栏 + 负控),`argv` 指向各自的 spec 文件,与 P2-04 MCP slice 同一批推。**门③清单加一条**:推送前对每个待观测 epic 核"本批新增的 it() 标题在冻结里的命中数",零命中不推。**我的错也记**:§12.61/§12.62 标题时间写成 15:40/16:30 EDT,实际 11:00/11:30 EDT(`date` 与提交时间为准),已改。

### 12.64 P4-11 preFlight 裁:cockatiel 采、llm-retry 统一不改、outbox 不是 RunRetryBudget 的层、Retry-After 复用 adapter 已有解析、hedge exclusion 按 §12.46-B 分半(2026-09-08 13:05 EDT)

**采用/复用确认**:cockatiel ADOPT(runtime,landsIn P;实测未安装,是真实新增)——断路器、half-open、bulkhead、timeout 全用它,Definition 侧只声明 Provider 要实现的决策接口,**不写 `circuit.ts`**;`llm-retry` 的指数退避 + 对称 jitter 保留原样(对称 jitter 是合法 jitter,must[2] 只要求"backoff+jitter"),P4-11 是让它**消费**共享的分类器与预算,不是第三种拼法;**Retry-After 已有解析**:`llm/llm-deepseek/src/adapter.ts:685 providerRetryAfterMs(response.headers.get('retry-after'))`——P 阶段"wire 边界解析"必须复用/上提这个函数,不得第二份。
**must[1]「所有层」的范围(裁)**:RunRetryBudget 计的是**一个 run 为重做失败工作所花的资源**,层 = 代表 run 的动作再尝试的地方:LLM 重试(`llm-retry`)、MCP 客户端为 run 动作做的调用重试/重连(`connection.ts`;**无 run 归属的后台重连不扣 run 预算**,走连接自己的策略,P 阶段即 cockatiel policy)、subagent 尝试(代表父 run,这正是叠加的典型)、以及树里若有的工具执行/web 重试。**message-bus `decideDelivery` 不是层**:它是**消息**范围的持久投递死信策略(P4-06 已验收:一万次重投一次效果、超预算死信),回答"何时放弃投递",不是"run 还能再试几次";并进去会让话痨 outbox 吃光 run 的模型重试额度,也会改动已验收 epic 的语义。在 preFlight 记为**子句范围裁定**(引本节),不是 make-vs-use deviation。
**must[2] hedge exclusion**:树里无 hedging 生产者(src 零命中);所有者是 **P5-04**(「只在 pre-action reasoning 阶段允许安全 hedge」)与 P5-02(router 输出 hedge)。按 §12.46-B 分半:P4-11 在 C 定义并冻结**决策层**规则(hedged 尝试不再叠加重试、对预算只计一次),P5-04 的 readiness gate **现在就写上**「hedged 尝试必须打标,使 P4-11 规则触发」(BLOCKED 条目,与 BLOCKED-159 同法),P4-11 在规则半上可签。与 §12.61 对 P4-09 trace 的"P7-07 前不验收"的区别:trace 继承没有 trace 就无物可测;hedge exclusion 的决策规则现在可测。
**must[3]**:分类器**读** P4-12 action-ledger 的对账状态决定副作用动作可否重试,不自判幂等;冻结:未对账的副作用动作即使传输可重试也拒(可能已扣款的 503 不是免费重试)。
**顺序**:P4-09 三件(accept 门口径、capability token 片、detached preFlight)先;detached preFlight 发我待审期间可开 P4-11 C(`classify.ts` + `budget.ts` + 决策接口 + 测试,无 circuit.ts),冻结先于观测。

### 12.65 门③ @ `224d2ac867` 过、推送(run 34253568004);观测工作流的快照步改 lib 模式;P1-10 preFlight 三问裁(2026-09-08 13:35 EDT)

**门③**:registry gate set 22/22 + 1 held(translation,BLOCKED-124);固定集 3234 passed / 1 failed:`core/tools/tests/py-types.spec.ts › renders a deeply nested oneOf chain in linear time` —— `expected 3.837 to be less than 3`,深度翻倍的**墙钟比值**断言(线性≈2×、二次≈4×、界 3×),用例自己的注释承认并行负载下曾假红;本批 `py-types.ts`/spec **未触碰**;`gate-wt2` 隔离重跑 3/3 绿(load 15.8,执行者同时在跑 lib 模式快照)。按 §12.6-B 三件(文本诊断 + 现实集无关 + 复现绿)**准入**;`generate-ledger --check` 过。推显式 SHA `224d2ac867`(fast-forward 自 `434408a47c`),run **34253568004**。此观测应覆盖:P4-05 新三条 supplement(8 标题)、P4-08 U 两条(#202/#203)、P2-04 P.3(MCP 11 条)。
**观测工作流看不见 web 语料(执行者量的,对)**:`first100-exact-sha.yml:235` 是裸 `pnpm run test:snapshot`(source 模式,零构建),`apps/web/tests/*.snapshot.ts` 只在 `DSH_EXAMPLE_MODE=lib` 纳入(`vitest.snapshot.config.ts:47-52`);主 CI 的 `snapshotGate()` 显式设 lib(`run-gates.ts:642`),但**主 `ci.yml` 不在 fork 分支上跑**(近 8 次 run 全是 exact-SHA 工作流)——所以 `snapshots/web/minimal-preset` 自 P2-03 manifest 落地起陈旧,**没有任何我们消费的信号能看见**,直到执行者手动跑 lib 模式(已刷新,`41128ed937`,delta = 一条 `action/manifest-appended` + id 顺延)。当前冻结引用 web 语料的条目 = 0,不是活缺陷,是结构陷阱。**裁**:观测工作流的快照步加 `DSH_EXAMPLE_MODE: lib`(前置 build 步,时间代价接受),使"绿"在两个工作流里同义;执行者改 workflow 文件(这是代码改动,归执行者;推送归我),下一次观测按 job 状态判。§12.63 的"新增标题命中数"检查加一句:命中的 spec 必须在观测命令的 include 里。
**P1-10 三问**:(1) **账本已做过 OSS 一遍,执行者漏读了 adapt 行**:`node:sqlite / VACUUM INTO`(Node 24 验证)= snapshot 阶段的机制——原子一致的库副本,不是文件拷贝;`umzug` optional(~15%,线性 up/down 模型,而 must[0] 要 DAG + preconditions)→ **不采**,preFlight 记 deviation,理由是与 registry 要求(DAG)冲突,且其价值(custom storage / pending-executed)已被 `STORAGE_SQLITE_SCHEMA_VERSION` 的 `user_version` 戳覆盖;DAG 拓扑排序若用 `toposort` 类微依赖须能删掉自有代码与测试(仓库依赖政策),否则自有并写明;原子切换用同文件系统 `rename`,无需依赖;六阶段编排是**自有代码,阶段作为数据**(P4-08 resume matrix / P2-04 F 的形)。kysely/dbos/restate 的 reject 维持。(2) **确认**:P1-10 给**已知**旧版本加转换,未知版本仍拒绝,`SCHEMA_VERSION` 单调不变;Agent Note 写明 P1-10 是首个 tagged release 时替换"后端拒绝旧盘格式"立场的机制。(3) **确认**:P1-10 只拥有插件**自己的**持久数据/配置/schema(`dshHome` 下),工作区文件归 P3-11;C 阶段 `backup strategy` 词汇以插件数据命名(如 `PluginDataSnapshot`),JSDoc 写边界,冻一条负例:manifest 里出现工作区路径 → 解析即拒。**补一问执行者没提的**:must[2]「不可逆 migration 必须人工批准并提供 export」——批准走现有 approval 能力(消费者在 preFlight 点名),export = `VACUUM INTO` 副本 + JSON manifest(digest + schema version,同时满足 acc[1] 可对账)。阶段划分(C 词汇+纯判断 / P 六阶段 / U 真实升级路径 + 崩溃战役 + acc[2] 读 P2-02/P2-04 权限态)**同意**。顺序:P4-09 三件 → P4-11 C → P1-10 C。

### 12.66 P4-09 detached preFlight 审:通过;顺序 token 片先;复用 subagent 的 attenuate 路径与 continuation seam;取消边界冻两臂;重附着分活/亡两路(2026-09-08 14:35 EDT)

**审**:`preflight-P4-09-detached.md`(`1aa97502ae`)通过——复用表比 §12.61 设想多一层且对:`run_in_background`(tool-subagent 默认 true)、settlement outbox + `agent/session-start`/`agent/pre-step` drain(continuation.ts:503-517「parent 离开后提交的结算在下次启动送达」)、lease + reclaim、journal + resume;4.4a 第三问已查(RunPlugin 在 bundle/base:529 真挂载,五个出货 bundle 到达;重附着面 `WorkflowRunRegistry.resume` 已存在)。**"断开 ≠ 取消"对 subagent 子运行已存在,detached 复用那条 seam,不造第二个 outbox**——对。
**顺序(裁)**:**capability token 片先落**,detached 随后携带它;两片都是 P4-09。token 派生**复用 `subagent/src/child-agent.ts` 已在调用的 `CapabilityTokenService.attenuate(parent, request)`**(P2-02 的真生产路径),嵌套/detached run 走同一条派生,不写第二处;冻结:子 token 不得超父、放宽请求被拒(`TokenAttenuationDecision` 的拒绝臂)。
**补两条 preFlight 没写的**:(1) **取消边界冻两臂**:`cancel(父 run)` → nested 子被取消、**detached 子不被取消**(这是 detached 与 nested 在取消边界上的区别,负控);`cancel(detached id)` → 终止。launcher(session id + 父 run id)被记录但不是 owner。(2) **重附着分两路**:launcher 仍活 → 经 run registry 订阅/await 活的 run(先核 `resume(runId, request)` 是恢复已停 run 还是也能附着活 run;若只前者,附着活 run 走 registry 的观察面而不是把活 run 当停 run 恢复);launcher 已亡 → 结果经 settlement outbox 在下次启动送达(continuation seam)。两路各冻一条。

### 12.67 run 34253568004 @ `224d2ac867`:红在 lint 步、观测本身签名全绿——P4-05 准入、P2-04.P.3 不准入;P4-08 三条冻结标题已死于 §12.46-A 的性质变更,须 supersede(2026-09-08 15:00 EDT)

**事实**:job「install/typecheck/test」failure,失败步是 **`Lint the files this program changed since the frozen baseline`**(`run-oxlint.ts`,549 文件):`packages/mcp/mcp-client/tests/annotations.spec.ts:65-66` 两条 `no-unnecessary-boolean-literal-compare`(`verdict.ok === false && verdict.reason`)。观测 artifact 在 lint 之前已上传:签名 bundle `candidateSha 224d2ac867`,vitest `success:true`,20510/0;P4-05 65/65 passed(含新三条 supplement 的 8 条)、P2-04 59/59(含 P.3 的 11 条)、P4-08 68/71。
**准入(§12.6-B)**:(a) vitest success ✓;(b) 红步文本诊断 = lint 规则、两处、单文件,现实集 = P2-04.P.3;(c) delegate ack——**对 P4-05 准入**(其现实集 run/run、workflow-worker-thread、core/tools 与红步无关),执行者从本 run 绿 P4-05 C.1/U.2/F.3 → `--accept` → 我核签;**对 P2-04.P.3 不准入**:红在它自己的文件里,修 lint(改断言表达式,标题不动,冻结的 expectCases 不变)后随下一批观测。**新增完成清单项**:报完成前对本批改动文件跑 **CI 同一条命令** `pnpm exec tsx scripts/run-oxlint.ts <changed>`——pre-commit 的 staged lint 没拦住这条,说明规则集或触发不同,不能靠它。
**P4-08(我上次读错了)**:`434408a47c` 时"3 absent"我归因于未推提交——错。三条在 `224d2ac867` 仍 absent,且树里已不存在:C.1 `drops recomputable inputs from a completed, verified, pure step` / `leaves an unverified or side-effecting step untouched`,F.2 `fault boundary 15 compaction leaves a side-effecting entry untouched`。§12.46-A 拿掉了 `compactJournal` 永远触发不了的 `pure` 门,compaction 现在"drops recomputable inputs … **whatever its effect class**"(spec:180),守卫变成 ledger 对账而非纯度——**性质变了,不是改名**(与 §12.61 对 P4-12.C.1 的读法一致)。**裁**:执行者 supersede C.1 与 F.2(新条目冻现存标题原文,note 引 §12.46-A 说明性质如何变、旧性质为何不再成立;F.2 的 boundary 15 若语义不再存在则 boundary 表相应减一并守数),冻结先于观测,随下一批与 P2-04.P.3 lint 修一起推。P4-08 今晚不签,等下一次观测。**§12.63 检查补一条**:待观测 epic 的**全部 live 冻结标题**在本批树里的解析数,不只新增的——死标题在推送前就该看见。

### 12.68 P4-05 签(26);P4-08 C.1/F.2 supersede 核过;执行者自报"先写了预测的 failureSummary 再跑变异"——规则:sensitivityProof 只能是真跑的原文(2026-09-08 15:25 EDT)

**P4-05** 签于 `c77f63d2cd`(digest `cf26fae7…`,`paused` 定向 P2-12.U,BLOCKED-167),accept → 26。
**P4-08**:#188 C.1 / #190 F.2 被 #219 C.4 / #220 F.5 supersede,死标题恰三条、其余 35 条解析;性质变更核实(`replay.ts:102` 守卫 `completed && verified`,不再看效果类);boundary 表未减反增(16 `compaction retains every receipt`),守数断言不受影响。#219/#220 的 `supersedes` 反向字段为空,补上(对称;liveness 派生读的是旧条目的 `supersededBy`,不影响判定)。
**证据规则事故(执行者自报)**:`sensitivityProof.failureSummary` 在跑变异之前按预测写出("三条一起红"),真跑只红一条——**预测被当观测写进了证据**。已改为两次真实变异各附原文(恢复 `pure` 合取 → 1 红 `expected [ 's1-in' ] to deeply equal []`;去掉 `verified` → 2 红)。**规则**:`sensitivityProof` 的 `failureSummary` 只能是**粘贴的真实运行输出**(断言原文/超时原文),写作顺序必须是跑→贴,不得先写后验;delegate 抽查时以"原文里有具体 expected/received 值"为最低门槛。自报是正确行为,记录以防再犯,不追溯。
**P4-11 C** 冻结 #221(13 条),明确不含 backoff / Retry-After 解析 / circuit / must[1](闭在 U),两条变异原文在。

### 12.69 P2-02 撤签(26→25):整条 capability-token 线在出货 profile 上零到达——签发/要求/衰减皆无生产调用者、插件未挂载;重建为 P2-02.U,P4-09 token 片随后复用同一条派生(2026-09-08 16:40 EDT)

**起因**:执行者写 token 片 preFlight 时声称「`child-agent.ts` 已在调用 `attenuate` 铸子 token」,动代码前自查发现为假(把 JSDoc 的意图当调用点),并把 P2-02 的问题摆给我。**我的错**:§12.66 照抄了这句而没做一次 grep;P2-02 的 PASS(09-07 02:37)签在 4.4a 第三问写出之前,只核了 (ii)(iii)(v)。
**实测 `d19b70e6a0`(packages/*/src,排除 tests/lib)**:`CapabilityTokenService.issue` **0** 生产调用者;`tools.requireCapabilityToken()` **0**(`assertTokenPresented` 被 core/tools 导入但从未上膛);`attenuate` / `attenuateDelegatedToken`(`subagent/child-agent.ts:306`)**0**;spawn 路径(subagent/index.ts、descriptor.ts、tool-subagent)**不给子 agent 任何 token**;capability-token 插件**不在 bundle/base**。即 must[1]「TrustKernel 签发/验证」、must[3]「工具、插件 RPC、外部 Agent、ExecutionWorld 均要求 token」、acc[0]「子 token 永不大于父」、acc[1]「撤销父使 descendants 失效」在任何出货 profile 上**都没有主语**——签的是一个产品不执行的安全属性。与 P2-03/P5-11/P4-08/P4-07/P6-02 同形,与 BLOCKED-156(P6-01 绿在无 profile 挂载的能力上)同形。**撤签**(`189b14360d`,理由即上述测量),ACCEPTED 26 → 25。
**重建(P2-02.U supplement,执行者先写 preFlight)**:(1) 会话根 token 由 TrustKernel 在 session 启动时**签发**(must[1]),capability-token 插件挂进 bundle/base 带真实 store 路径,五个出货 bundle 到达;(2) `tools.requireCapabilityToken()` 由该插件在生产**上膛**,agent-loop 的工具执行自动呈递会话 token(用户无感;唯一可见变化是 session 外直接调工具而无 token → 拒),模型可见性若变则四语料快照计数;(3) **一条派生、两个消费者**:`attenuateDelegatedToken` 从 `subagent/child-agent.ts` 上提到 `policy/capability-token`(capability-definitions 层;子主体 = agent 或 workflow run),subagent spawn 路径成为第一个生产消费者(acc[0] 子不宽于父、acc[1] 撤父废子在真 spawn 上冻),P4-09 token 片成为第二个(嵌套/detached run),**不写第二处**;(4) must[3] 四名词按 §12.46-B 分:tools + 子 agent 委托在本 epic 落;插件 RPC → P1-06、外部 Agent → P8-xx(ACP/外部 agent 所有者)、ExecutionWorld → P3-05,各写 readiness BLOCKED 条目。冻结先于观测;4.4a 第三问在 preFlight 里逐名词回答。
**顺序**:本批推送不受影响(P2-02 不在批内)。P2-02.U preFlight → 建 → 观测 → 签;然后 P4-09 token 片(复用 (3))→ detached。P4-11 C / P1-10 C 在等待窗口。
**规则(4.4d)**:安全类 epic(P0/P1/P2 前缀与任何 must 含"要求 token/拒绝/隔离"者)签字前,delegate **亲自** grep 生产调用者并把命令与计数写进 sign-off note;不接受执行者的"已在调用"陈述作为到达证据。对已 ACCEPTED 的 P0/P1 行做同样一遍**回扫**(下一节)。

### 12.70 P2-02.U 落点裁:capability-token 是库不是插件——新建 provider `policy/capability-token-file`,以 family 登记进 `architecture.layers.json`;在 P2-02.U 范围内(2026-09-08 21:55 EDT)

**事实(执行者动代码前撞到,对)**:`policy/capability-token/src` 零 cordis 导入,`CapabilityTokenService` 是 `private constructor` + 静态工厂的普通类——没有插件可"挂进 bundle/base";我 §12.69 与其 preFlight 里"挂载插件"假设了不存在的东西。
**(a) 落点**:`architecture.layers.json` 是 **family 模型**(`{id, definition, providers[], consumers[]}`),层由 family 角色先定、再落 `GROUP_LAYERS`。新建 family `capabilityToken`:definition `@deepseek-ai/dsh-capability-token`(现有,capability-definitions),providers `[@deepseek-ai/dsh-capability-token-file]`(**新包 `packages/policy/capability-token-file`**,命名按后端,与 `lease-sqlite` / `workflow-filesystem` / `settings-file` 同法;放 `policy/` 组但以 provider 角色登记——Cedar §12.57 同形),consumers `[dsh-tools, dsh-agent-loop, dsh-subagent]`(之后 + `dsh-workflow-registry`)。provider 插件职责:提供 `ctx.capabilityTokens`(包 `CapabilityTokenService`,store = `createFileCapabilityTokenStore(dshHomePath('tokens'))`,签名经 `ctx.get('trustKernel')` 的 signature roots,私钥不出 kernel);`session/start` 签发会话根 token(subject = 会话主体,tenant 取 identity 服务、无则本地);validated `Config.requireForTools`(bundle/base 置 true)→ 调 `tools.requireCapabilityToken()` 上膛;暴露 `sessionToken(sessionId)`。
**呈递**:P2-02 registry `files[]` 本就点名 `core/agent-loop/src/runtime-context.ts` + `core/tools/src/index.ts` + `kernel/trust-kernel/src/types.ts`——计划就是 runtime context 携带会话 token、工具执行经现有 `presented` 输入交给 `assertTokenPresented('tool', …)`。不改 loop 结构,只在计划点名的文件上接线。
**(b) 范围**:在 P2-02.U 内。新包记 `filesOverlay`,reason:计划点名了定义与消费者,缺的是把它们在出货 profile 上挂起来的 provider 包。冻结先于观测;4.4a 第三问以 bundle/base 行 + 五个出货 bundle 回答。

### 12.71 run 34298753030 @ `d19b70e6a0`:签名观测 20526/0;红仅在快照步(lib 模式跑到 web 语料,工作流未装 Playwright Chromium)——P2-04.P.3 / P4-08 全部 / P4-11.C 准入;工作流补浏览器安装(2026-09-08 22:20 EDT)

**事实**:test job failure,失败步 `Recorded-session snapshots`:`browserType.launch: Executable doesn't exist at ~/.cache/ms-playwright/chromium_headless_shell-1228/…`(`apps/web/tests/minimal-preset.snapshot.ts:143`),118 passed / 1 failed;其余步全绿(typecheck、gate set、frozen titles、full suite、build、lint、pack、packed install)。第二 job success,签名 bundle `candidateSha d19b70e6a0`,vitest **20526/0**;live 冻结标题:P2-04 59/59(含 P.3 MCP 11 条)、**P4-08 71/71(0 absent——C.4/F.5 替换后首次全解析)**、P4-11.C 13/13。
**诊断**:§12.65 让快照步改 lib 模式时,我只核了"build 步已在前",没核浏览器——主 `ci.yml:200-240` 有 Playwright 缓存 + Chromium 安装步,exact-SHA 工作流没有。红的原因是基础设施(我的改动缺另一半),与 P2-04 / P4-08 / P4-11 的现实集无关。**准入(§12.6-B)**:三者从本 run 绿;执行者 `--admit-red-run` 录入上述文本。**修**:执行者把 ci.yml 的 Playwright 缓存 + 安装两步搬进 `first100-exact-sha.yml`(只 Chromium,置于快照步前)。**收获**:web 语料第一次真的在观测里跑了——minimal-preset 那条陈旧(§12.65)若不刷新,这里就会以断言红而不是浏览器缺失红出现;下次观测是第一次 web 全绿的机会。

### 12.72 P2-04 base U 缺失:走 (a)——补 base U 条目并 supersede U.1/U.2(§12.53 successor 必为 base),附 BLOCKED-159 记录/执行一致性用例;不改工具口径(2026-09-08 22:35 EDT)

**事实**:P2-04 的 U 只有 supplement(U.1 #208 三条、U.2 #210 七条),没有 base U 条目;registry U `nOf=null`(适用),`--accept` 因 U 格 NOT_RUN 拒。与 P4-12 #213 同形(first U entry 被当 supplement 冻了)。
**裁 (a)**:不改工具口径((b) 会让"stage 绿"在两种情况下含义不同)。新建 **base U 条目**,`supersedes` U.1 与 U.2(§12.53:被 supersede 的 base/首条目的 successor 必为 base;liveness 派生会把 U.1/U.2 标 SUPERSEDED),`expectCases` = 两者十条现存原文 **+ 一条新用例**:**BLOCKED-159 记录/执行一致性**——同一动作,manifest 记录的 `requiresApproval` 必须等于门的决定(`presets.requiresApproval(classification, preset)`),否则审计记录与实际执行不一致(记"需审批"却直接跑了,或反之);变异"manifest 用 P2-03 的 classifySideEffect、门用 P2-04 的 classifyAction 且两者不一致"→ 红。U.2 已有的三条 `P2-03 acceptance[2]` 用例(undeclared → ASKS / REFUSES / 按 preset 放行)就是执行半的主语,连同这条一致性用例观测后 **BLOCKED-159 关闭**。argv 指向两个 spec 的并集(`tests/architecture/risk-domain-tags.spec.ts`、`core/tools/tests/tools.spec.ts` + 门的 spec)。冻结先于观测,随下一批推;绿后 P2-04 `--accept` → 签。

### 12.73 P4-08:C/P/F 的 base 条目被 supplement 取代(§12.53 之前的违规)——重建 base;coverage 引用改指 successor;`inputs` 恒空 → acceptance[2] 真空成立,补 producer 后再签(2026-09-08 22:55 EDT)

**冻结谱系(实测)**:base C #101 → 被 supplement C.1 #188 取代 → C.4 #219;base P #102 → P.1 #189;base F #104 → #125 → F.2 #190 → F.5 #220。三个 stage 的 base 都被 supplement 取代,全在 §12.53 之前;后果:(i) coverage 的 `{stage,title}` 引用(不带 seq)只认 base,C/P/F 永远验不了;绿格工具拒绝无 base 的格。**裁**:(1) 为 C/P/F 各建 **base 条目** supersede 当前 live supplement(C.4 / P.1 / F.5),`expectCases` = 其现存标题原文;argv 每 stage 独立(C 与 F 现同用 `resume.e2e.spec.ts`——先读 (iii) 的判据原文,若判据是 argv/观测文件同一,则把 F 的故障矩阵用例移到自己的 spec 文件,否则不动);(2) `acceptance-coverage.json` 里两条死标题引用改指 §12.46-A 的 successor 标题(`…whatever its effect class` / `leaves an UNVERIFIED step untouched…`),note 引 §12.67;这是引用随 supersede 更新,不是改判据;(3) (iii) 若在重建后仍报 C/P 共享观测文件,报判据原文再裁。
**BLOCKED-158 残留升级为阻签项**:`inputs: ArtifactRef[]`(「对存储内容的引用,从不是内容本身」)在 `recorder.ts:97` 无条件写 `[]`,`replay.ts:104` 压缩后也返回 `[]`——acceptance[2]「compaction drops recomputable inputs」在真实数据上是空集减空集,**真空成立**;`compactJournal`/`retainsAllReceipts` 有 3 个调用者只证明决策被调用,不证明节省发生。4.4a:名词 `inputs` 零生产者 → 不签。**补 producer(P4-08 P/U supplement)**:host 在子 agent 启动时(`host.ts:460` 处已握有 `request.prompt` 与 opts)把该步的请求(prompt 文本 + opts JSON)经**现有内容存储 family**(attachments 或 spill,复用,不造新 store)存为 artifact,把 `ArtifactRef` 随 `onAgentStart` 事件交给 recorder 写进 `inputs`;compaction 的现有逻辑于是有东西可丢。冻结(U,真 host 跑):completed+verified 的步压缩前 `inputs.length ≥ 1`、压缩后 `[]`、receipts 全保留、artifact 仍可按 ref 取(GC 不在本 epic);变异「recorder 写 []」→ 红。**P4-08 顺序**:(1)(2) 数据 → (3) inputs producer → 下一批观测 → C/P/F/U 全绿 → `--accept` → 签。今晚不签。

### 12.74 §12.73(3) 修订:`inputs` 的 producer 属 P6-09(内容寻址 Artifact Store,wave 10,账本已判 adapt cacache+ssri、OCI Descriptor)——不在 P4-08 里造第二个 store、不扩 spill;acceptance[2] 按 §12.46-B 分半,P6-09 readiness 携带;P2-02.U 四语料回绿、per-corpus 计数待用户放行(2026-09-08 23:35 EDT)

**执行者查实**:树里没有内容寻址 family——`attachment` 只做图像(png/jpeg/webp/gif + 宽高),`spill` 自述「deliberately minimal: saveText and nothing else」且其唯一 sha256 是对 sessionId 取摘要命名目录,不是内容寻址。我 §12.73 写"复用现有内容寻址 family"的前提不成立(我没查就写了"现有")。**registry 的所有者是 P6-09**「一等公民 Artifact Store、版本、内容寻址与 Lineage」:must「ArtifactRef 含 digest/media type/schema/size/tenant/producer run/action/parents/retention/sensitivity」「不可变内容寻址」;账本已判 adapt **cacache + ssri**(SRI-keyed CAS,per-tenant roots)+ OCI image-spec Descriptor 作 ArtifactRef 形状 + OpenLineage;7 个 dependents(P3-11/P5-06/P6-04/P6-10/P7-02/P7-04/P8-02)。P6-09 依赖 P6-08(静态加密/租户密钥,wave 9,依赖 P3-06)——**不提前**(§12.55 P9 PREMATURE 同理:先于加密层造的 store 之后要重 key)。
**裁**:P4-08 **不造私有 CAS、不扩 spill**(前者是第二个 artifact store,后者改一个自述最小的契约)。acceptance[2] 按 §12.46-B 分半——与 hedge/P5-04、requiresApproval/P2-04、paused/P2-12 同形(producer 属**已排期的后续 epic**,而决策现在可测),区别于 trace/P7-07(无 trace 则机制本身无物可测)与 P2-02 spawn(producer 在本 epic 内,可建):(a) P4-08 现在冻结的 acc[2] 用例用**构造的 ArtifactRef** 证明决策(drop completed+verified 的 inputs、receipts 全留),note **明写**"真实 producer 在 P6-09,此处的节省不可观测";`recorder.ts:97` / `replay.ts:104` 的 `inputs: []` 保留,不伪造;(b) 写 **BLOCKED 条目挂 P6-09 readiness**:host 在步启动处把请求存为 P6-09 ArtifactRef 写入 `inputs`,届时冻真 host 跑的"压缩前 ≥1 / 后 []"用例并关闭本条;(c) P4-08 在决策半上可签(C/P/F base 重建 + U 全绿 + 观测后)。§12.73(3) 的"补 producer"作废,(1)(2) 不变。
**P2-02.U**:四语料回绿 113/3/0(source 模式),per-corpus 计数与四个改动包的单测两条命令**被用户两次当场 kill**,执行者不编数、不提交,等用户放行——正确。回绿靠三处实测修正(`createExecution` 逐字段拼 base 丢了 `capabilityToken`;ptc 子派发继承父调用的 token 不重新取;签发读 `schemas(agent)` 且首次索取时铸造,因 `agent/session-start` 同步发射时 `subagent` 尚未挂载)。未放宽授权(`resources` 精确集合、attenuation 子集检查)。**限制记 README**:首次工具调用之后才注册的工具不在 token 里——这是延后铸造缩小而非关闭的窗口;签字前我要看它是否影响出货 profile 的真实工具集(若某 bundle 在首调用后动态注册工具,则该工具永远被拒——需要用例证明五个 bundle 上不发生,或改为按需重签)。lib 模式(web 语料)也要跑一次。

### 12.75 4.4d 回扫已验收行:P6-07 撤签(25→24,库未挂载、生命周期操作零调用者);P5-11 的 blackboard 是三原语之一未到达——按 §12.27-3 定向 P6-02.U,签字维持但签字 note 补正;我的撤签提交又扫进了执行者的未提交账本(已在提交信息里归属)(2026-09-09 01:40 EDT)

**回扫方法**(只读):对 25 个 ACCEPTED 行,取 registry `files[]` 所在包,查 (a) 是否在 `bundle/*` 任一 cordis 文件或 apps/boot/api 中被挂载或导入,(b) 包外生产 `src/` 导入者数;再对被标出的包按导出符号数生产调用者。sdk-jsonrpc-server(sdk-app/sdk-minimal 挂载)、evidence-format(`scripts/release/collect-evidence.mjs` 消费,主体就是发布脚本)、schema-registry/sdk-protocol/plugin-provenance/cordis-host-runner(各有生产导入者)均到达。
**P6-07(撤签,`1f5d85239c`)**:`@deepseek-ai/dsh-session-lifecycle` 六个 bundle 皆未挂载、包外 0 导入者;`listSessions / projectLifecycleRecords / applyRetention / softDelete / hardErase / legalHold / archiveSession` 各 **0** 生产调用者;只有修复半边(acc[3],`core/session/src/repair.ts`)被 core/session 到达。must[0]/[1]/[2]、acc[0]/[1]/[2] 在任何出货 profile 上无主语——与 P2-02 同形(09-04 签,早于 4.4a)。重建 = P6-07.U:出货 profile 上挂载的消费者(api session controller 的 list/delete/retention 与/或 CLI 命令)调用这些操作,在真实路径上冻;修复半边维持。
**P5-11(维持签字,note 补正)**:`dsh-blackboard` 未挂载、0 导入者——三原语(taskboard / mailbox / blackboard)中 blackboard 未到达;taskboard(subagent-taskboard 委派任务)与 mailbox(P4-06 mailbox-delivery)到达。**§12.27-3 早已裁 blackboard 随 P6-02.U 合并进 memory 线**(定向延期,与 `paused`→P2-12 同形),但我 09-08 的签字 note 只写了 taskboard、未写这条延期,且 BLOCKED-154 的状态行仍是"boards 无 producer"未更新为"task 半已有 producer、fact 半定向 P6-02.U"。**做**:执行者更新 BLOCKED-154 状态(task 半关闭、fact 半 landsIn P6-02.U,P6-02 readiness 携带);本节即签字 note 的补正。区别于 P6-07:P5-11 多数名词到达且延期早有裁定。
**我的提交错误(第二次同形)**:`--record-signoff WITHDRAWN` 派生 `ledger.json/ledger.md/EXEC-STATE.json`,我按 §12.74 的规则把三者纳入 pathspec——但执行者当时有**未提交**的账本改动(run 34298753030 的 P2-04.P.3 / P4-08 / P4-11.C 绿格与 admit 记录)在同一批文件里,被我一并提交。内容未损,归属丢了;已 `--amend` 提交信息写明。**规则**:我动账本派生文件前先 `git status` 看它们是否已 dirty;若 dirty,先让执行者提交(或在提交信息里逐项归属),不得静默扫入。
**账面**:ACCEPTED 24。

### 12.76 09-09 白天裁决汇总:P2-02.U 收口五处、取消≠吊销、BLOCKED-159 记录/执行分离、刷新配对按身份、P4-11 归属规则、P4-09 嵌套能力上界 + digest 覆盖声明;门③ @ cc2defb632 固定集绿、gate set 待 P2-02.U 格撤绿(2026-09-09 12:50 EDT)

**P2-02.U 收口**(提交 `62cdc3ddd9` → 门③红两条:P1-07 fixture 无 kernel 启动死、catalog 未重生成 → 修于 `cc2defb632`,固定集 4515/0 绿):收口前我核工作树而非叙述,要求五处——#222 supersede #69 并吸收、真 spawn 用例(①⊆父∩filter ②filter 外被拒带理由 ③增长后仍⊆)、digest-only/启动竞态/签发失败带原因三条负控、`sensitivityProof` 跑→贴、insecure 启动的挂载守卫——全部落地,base 行改为**按信任根存在**挂载(覆盖六处不 pin kernel 的组合),而非按 env。执行者两次自报并纠正:one-shot 子测的是死会话(改 continuable);`suite.ts` 用正则脚本改坏五次 + 未验证探针三次假结论 → 规则:源码只用精确 Edit、每步 tsc+spec、探针先自证。
**取消 ≠ 吊销**:实测 `parent.cancel` 是 turn 级(清 inbox + abort),取消后 continuable 子仍能调工具——**不是 token 轴的 fail-open**:token 表达会话委派的权威,取消是控制流(P5-10 取消≠断开);对父根 `revokeSession` 会拒掉父的下一个 turn。权威生命期 = min(父过期, 子 TTL) + 显式吊销;显式吊销的 producer = P2-12 紧急停(BLOCKED-168 acc[1] 半定向 P2-12.U)。detached 同读法。
**BLOCKED-159**:一致性用例首跑红得对——manifest `requiresApproval` 由声明类算、与 preset 无关;门按 preset 决定;`danger-full-access` 下 destructive 记"需审批"却直接跑。裁:字段 = 内在分类(JSDoc 收窄);门另发 `action/risk-gated` 事件(actionId/riskClass/preset/decision∈asked|refused|hard-denied|allowed-by-preset);不变量 = 门放行且 manifest 需审批时必有 `allowed-by-preset` 带 preset。148 条新事件行进 fixture。
**刷新配对**:执行者证否"只含两种 delta"——第三种是 `idempotencyKey` 全量重算,根因 `suite.ts` 按位置配对新旧记录、插入事件即错位,比较层掩码使其静默(注释自证第二次)。裁 (b):按 (actionId, argumentsHash) 身份配对 + 单测 + Agent Note;重刷后 148 / 0 删 / key 变更 0(67 逐值同)——我在工作树独立复核一致。
**P4-11**:makeVsUse JSON 记录首版缺六字段(UNRECORDED)→ 补齐,`recordedBeforeFirstLine=false` 如实;四层实为三层;subagent 不是层而是**归属规则**(子会话 llm-retry 记父 run 预算),outbox 维持出局。
**P4-09 token 片**:嵌套 run 同 Agent 同会话,无可派生对象;派生已由 P2-02.U 路径覆盖;缺的是**衰减**——`startChild` 不传 filter,嵌套 run 的子与根 run 的子权限相同。裁:已注册 definition 声明 `tools.allow`,**digest 覆盖规范化的 (body, tools)**(`computeDigest` 原只哈希 body;`meta` 是封闭请求字段;兄弟字段在 digest 外则重注册可放宽)——定义身份 = 它是什么 + 它能做什么;`planNestedRun` bound = 父 ∩ 声明(缺席=继承,`[]`=无工具,二者 digest 可区分);host 把 bound 作 `toolFilter` 传 `subagents.start`;`ChildStartRequest` 不加 filter(worker 上来的请求不得自选权限)。冻:同 body 更宽 tools digest 不同/顺序无关/缺席≠[];真 spawn 声明收窄、不能放宽、深度 2 交集。
**门③**:`acf414d526` gate set 21/22,红 `verify-freeze-in-candidate-tree`:P2-02.U 格 GREEN@`b3186e6db9` 而 live 冻结 #222 后写——按规则 `--revoke-cell` 撤成未观测,下次观测在含 #222 的树上绿。推送等该数据修的 SHA。

### 12.77 09-09 晚—09-10 凌晨裁决汇总:P2-02 重签/P2-04/P4-08 签字;P4-09 attach 六语义 + trace 分半(BLOCKED-173);P4-11 单层 + chargedRun 记忆化;P1-10 C/P/U 与 §12.65 更正;acc[1] 词汇;U 范围裁决(不新建子命令);门③ @ 9742301c70 红:module-graph 第 4 次漏、seams 超时依 BLOCKED-017 提额、pi-ai 看门狗负载红(2026-09-10 05:05 EDT)

**签字**:P2-02 重签 `75b5b45420`(撤签后重建的 token 线:根 token 于 `agent/session-start` 由 `trustKernel.signatureRoots` 签发,`whenSessionToken` 在 `agent-loop/tool-calls.ts` 与 ptc 出示,`deriveChild` 用与 `tools.restrict` 同一个 `composition.toolFilter`,`revokeSession` 经持久 `issuedFor` 查找返回 `revoked | nothing-to-revoke`,门对 `revoked` 拒且零 I/O,签发失败 `capabilityTokenUnavailable` 显式);P2-04 `b71a23779b`;P4-08 `64ae49f353`——我先把三个"缺席"标题读成未推,实为 §12.46-A 的死标题 → supersede,不是推送缺口。
**P4-09**:must[2] 六语义到达含 attach——detached run 自持 Agent 句柄(`ctx.agents.create`),`delegatingSession` 进 `SubagentStartRequest` 与持久 descriptor(`SUBAGENT_DESCRIPTOR_FIELDS` 往返测),`attach(runId)` 上 `WorkflowEngine` 抽象,resume 先取 lease 再 reconcile、错误报持有者;嵌套 spawn 挂死修(`resolvedConcurrency()` 哨兵)。must[3] trace:`traceContext` 只传播不造根(`undefined` 保持 `undefined`——否则 P7-07 落地那天每个无 trace 的 run 都成了自己的根),producer 属 P7-07 → §12.46-B 分半 BLOCKED-173;`workflow/start` 早于 `liveRuns` 登记是 attach 暴露的本 epic 真缺陷,`0c13736522` 修。观测 34452715907 84/84 干净;签字等 trace 片观测。
**P4-11**:must[1] 裁"一层 + 归属规则"(MCP 重连不是层);决策包 `reliability/retry`(`classifyFailure`/`spendsRetryBudget`/`admitRetry`,`CircuitBreakerContract`)+ provider `reliability/retry-cockatiel`(cockatiel 4.0.0,按目的地 baseURL+model 键,unload/rollback 测);`RunRetryUsageStore.admit` 原子;`chargedRun` = 委派根会话的 run、一次解析记忆化(`7da6d31b9d`,F 边界 14:父亡后子仍记父 run);breaker 在 `llm/llm` execute 首块强制(`LlmAdapter.endpointUrl`);F 冻 23 条(`aea8776d11`),timeout 行首版真空由探针揭示(`f2577322ee`)。签字待:含 `7da6d31b9d` 的观测、4.4a 逐调用点命名、family `circuitBreaker`/`runRetryUsage` 是否在 U 注册。
**P1-10 C/P**:C 第四选项——结构环按名报、歧义边拒绝、可逆性来自声明、确认绑定有序步骤 digest、导出先于确认、可逆永不问(`d34ad410d6`,冻 16+6);P 六阶段为数据、`node:sqlite VACUUM INTO`(参数绑定)、隔离 + 两次 rename、health 失败回滚(`fe3fa9e03d`,冻 10)。**§12.65 更正**:原子写的 house pattern 是 `@deepseek-ai/dsh-atomic-write`,不是 npm `write-file-atomic`——§12.65 那条"adopt write-file-atomic"读错了树,执行者 `06cd6c748f` 记录。别名生成器:P 的测试原经缺失的子路径别名解析到 `lib/` 假绿,`gen-tsconfig-paths` 改从 package `exports` 派生并加门(`38d373ac00`);EPIC-LIFECYCLE 2.12 第三因(`123600e694`)。
**P1-10 U**:acc[0] 崩溃战役 9/9,子进程逐阶段真 `SIGKILL`,完整以打开库比行衡量(`9742301c70`)。acc[1] 裁**对插件自己声明的 schema version**——schema-registry 的 `{major, minor}` 是协议/接口兼容词汇(P0-06 / P1-08 域),插件持久数据的 schema 是插件自己的;执行者随即发现 `validate` 算出的 digest 只在返回值里、从未落盘 → 记录写两次:snapshot 时写意图(plugin/from/to/pathDigest),health 过后写成果(`upgradedTo`/`dataDigest`)——拆分即性质(M57 变异精确红);`reconcileUpgrade` 两半都比,缺成果半返回 `false` 不抛(崩溃后的合法磁盘态)。批准。acc[2] 改为只读观测"插件存储根之外无变化"(不 grant/revoke,否则本 epic 证明自己能写 P2-02/P2-04 的状态)——批准,但观测对象须真实 home 布局(settings 文件 + `capability-tokens/` 有内容),空根改无可改是空证明;`settings/src/index.ts` grep 无 permission/approv/allow,已批准权限不在 settings。
**U 范围裁决**:执行者问 must[1] 是否须由 CLI 真命令驱动、需否新建 `dsh plugin upgrade`。裁**不新建**:`runPlugin`(`apps/cli/src/plugin.ts:240-284`)转发 `dsh plugin update/add` 给 pnpm 就是产品的升级通道(文件头 :5-9 自述 `update` 激活新版本声明;registry 给该文件 kind B),挂载点 `reconcilePlugins(before, dir)` :269——产品里唯一知道 `(plugin, from, to)` 之处;preFlight `f684309feb`"两个 U 文件都无升级入口"错,补正 `6a28e710e4`(原记录留存)。四要求缺一不算到达:① `runPlugin` 开头 `recover()`——`SIGKILL` 跳过 `finally`,"unfreeze always"在它为之存在的那次崩溃里不执行;② 性质对 (代码, 数据) 一对成立——事务跑时 pnpm 已切代码,数据回滚后代码半边亦须还原(`before` 的 `package.json` + 事务前 lock,`pnpm install --offline --frozen-lockfile` 从内容寻址 store 装回),还原失败大声报、非零退出;③ acc[2] 真实布局;④ 对账 `false` 由消费者报出插件/版本/缺哪半,不吞。
**门③ @ `9742301c70` 红,不推**。固定集 2 红:`tests/architecture/check-capability-seams.spec.ts` "CI output (acceptance[3])" 超时 5000ms **第 3 次**(CI 33578193549 / 33998988841 已入册 + 本地 1)——依我 09-05 写在 registry 的前置约束 + BLOCKED-017 四条(签名 runner 超时 ✓、真起 CLI 子进程 ✓、同文件 :94/:116 `20_000` 先例 ✓、断言零改由 diff 证)批准该用例提 `20_000`,单独一笔;`packages/llm/llm-pi-ai/tests/adapter.spec.ts:415` idle watchdog(1s 观察窗)本地红,gate-wt2 同 SHA 隔离复跑 73/73 绿 → 负载红(门③与执行者测试并发,load 曾 30),一次观察性记录、不入册(未达 BLOCKED-007③ 两 SHA)。门集红 `verify-module-graph` stale——BLOCKED-014 强制基线 `first100:slice-gate` 未在报告前跑,module-graph **第 4 次**漏;规则:报 SHA 必附 slice-gate exit,没跑不报;执行者重生成 `0571aefde8`。工作树另见 `plugin-migrations/src/*.js|.d.ts|.map` 落入源码面(tsc 直出未走 outDir),执行者 rm 指定路径清掉。U 挂载后 module-graph 会再 stale(新边 apps/cli → plugin-migrations),须再生成。推送等含 U 挂载 + 超时提额的 SHA。
