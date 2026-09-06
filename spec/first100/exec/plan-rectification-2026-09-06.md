# First-100 计划整改令(2026-09-06)

**签发**:guanjieqiao-92(delegate,C7 常设委托 + C11 registry re-anchor 委托)
**执行**:dsh-first100-clean-ca,执行前按 C11 惯例向用户确认一次委托仍有效
**来源**:`First-100 造用账本`(artifact 2e874903,109 行,字段 verdict / oss / deletedPct / planError / residual),2026-09-02 由 gq-92 用三路扫描(catalog 2937 / topic 13k / radar 17.5k)+ 扩展点实测生成
**对照**:`tests/first100/registry.json` @ `dbeb6082a9`(21/101 ACCEPTED)

## 0. 这份文档做什么、不做什么

**做**:把造用账本里 29 条 `planError` 逐条落到 registry 的具体改动上,并把 3 个被多条 epic 共用的开源引擎定为"消费者到来之前先接入"的独立 slice。

**不做**:不改 110 的收录范围;不动任何已 ACCEPTED 的行;不预造任何 epic 的实现。

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

## 3. 三个共用引擎:消费者到来之前先接入

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

### 3.3 OpenTelemetry(用已有的 `packages/session/session-telemetry-otel`)

**消费者**:P7-07(W13)· P6-05(W12)· P8-09 export(W18)
**不是新接入,是不新建**:计划里的 `packages/observability/otel-exporter` 删掉,TracerProvider pipeline 加在已有包里。

**slice 交付**:
1. `session-telemetry-otel` 内加 TracerProvider + OTLP HTTP exporter + W3C propagator(依赖 `@opentelemetry/sdk-trace-base` 2.10、`exporter-trace-otlp-http` 0.221、`context-async-hooks` 2.11)
2. 语义约定固定为 `gen_ai.*`(`@opentelemetry/semantic-conventions` 1.43 已在 lock)
3. **不做**:durable outbox(那是 P7-07 的)、任何 sink(Langfuse / Phoenix / LangSmith 都是部署级可选,不进依赖)

**时机**:W12 开之前。**最不急的一个**,但要在 §C 的 P7-07 缩范围时一并把 files[] 指向这里。

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

### 4.1 开工第四问:这条 epic 账本判的是造还是用?(自 P2-04 起为标准动作)

前三问(BLOCKED-101):主体在不在执行路径上 / 冻结挂哪 / 每条子句的主体是什么。**第四问在三问之后、第一行代码之前**,答案写进 `clause-subject-audit.json` 该 epic 的 `preFlight.makeVsUse` 字段:`{ verdict, adopted: [...], residual }`。

**来源**:造用账本(artifact `2e874903`)该 epic 那一行——`verdict` / `oss[]`(每条带 `role`)/ `deletedPct` / `residual`。**账本是判定不是建议**:三路扫描(catalog 2937 / topic 13k / radar 17.5k)+ 扩展点实测。开工时读它,不重判;**账本与 registry 冲突时先问 delegate,不自选。**

| verdict | 动作 |
|---|---|
| `PROVIDER_ADAPT` | **用。** 只接 `oss[]` 里 `role: adapt` 的那条,按其 `note` 接;`residual` 写的是接完还剩什么要自己写 |
| `REUSE_UPSTREAM` | **不写。** 上游已有;缺口在 `spec/first100/sources/base-align-v2/23-partial-rescope-spec.md`;活是核缺口 + 接线 |
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
- **本令的落地本身**:执行者在 registry 提交里引用本文件路径;本文件不再编辑,后续变更走 BLOCKED-QUEUE 追加

## 6. 本令不覆盖的

- **REUSE_UPSTREAM 中无 planError 的 10 条**(P3-03 · P4-10 · P4-11 · P5-09 · P6-06 · P6-10 · P7-08 · P8-03 · P8-05 · P8-10):账本判定"上游已有部分实现",**BASE-ALIGN-v2(2026-09-03)已按 gap-over-upstream 逐条缩范围**(`spec/first100/sources/base-align-v2/23-partial-rescope-spec.md`),registry 现在的 must/files 就是缩后的缺口。本令不再动;开工三问时读 rescope spec 的对应条目即可。
- **CONTRACT_WRITE / PROVIDER_WRITE / CONSUMER_WRITE 中无 planError 的**:契约和 provider 要自己写,账本没有开源替代,计划没错,不在本令范围。
- **P3-13**(PTC 后端策略绑定,W7/W8):**不在造用账本里**——账本 2026-09-02 生成时 P3-13 同日才由用户批准收录(109→110)。它没有 verdict / oss / deletedPct。**开工三问时补一次单条 make-vs-use 判断**:它接的是 P3-01/02/04/08/10 已建的 ExecutionWorld + 策略设施(组合不是从头造),预期 verdict = CONSUMER_WRITE,依赖 §3.2 的 sandbox-runtime rung。
- **R10**(131 slice,W19 后串行)——另议
- **P9-08 / P9-09**(PREMATURE,R10 后)
- **7 条已验收行的灵敏度回填**(已下令,等冻结表稳定)
- **BLOCKED-124**(14 对双语文档,等用户 `/dsh-translate-docs`)
