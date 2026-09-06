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

**来源**:造用账本(artifact `2e874903`;**仓库副本 `spec/first100/exec/make-vs-use-ledger.json`,`rows[].id` 索引,2026-09-06 晚落盘,此前只在 artifact 和 /tmp**)该 epic **整行 16 个字段**,不是两列。开工时必读并逐项回答的七个:`verdict` **和 `verdictSecondary`**(80/109 行有第二判定——"CONTRACT_WRITE + PROVIDER_ADAPT" 意思是契约自己写、provider 接开源,两半分开答)/ `oss[]` 里 `role: adapt` 的每一条**及其 `note`**(note 是接法,不是介绍)/ **`standards[]`**(71/109 行有;是绑定词汇,见 §7.3)/ **`risk`**(109/109 行有;里面有具体禁令,例:P2-03 "do not write a second canonicalizer")/ `residual`(接完还要自己写什么)/ `deletedPct` / `community`(只作设计参考,不接——CATALOG_ADOPT 为 0 已对抗复核)。**账本是判定不是建议**:三路扫描(catalog 2937 / topic 13k / radar 17.5k)+ 扩展点实测。开工时读它,不重判;**账本与 registry 冲突时先问 delegate,不自选。**(2026-09-06 晚修订:本段原只列四个字段,§7 记录了只读四字段造成的漏检。)

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
- **本令的落地本身**:执行者在 registry 提交里引用本文件路径;§0–§6 不再改写,后续只允许**追加带日期的附录章节**(§7 起),其余变更走 BLOCKED-QUEUE 追加

## 6. 本令不覆盖的

- **REUSE_UPSTREAM 中无 planError 的 10 条**(P3-03 · P4-10 · P4-11 · P5-09 · P6-06 · P6-10 · P7-08 · P8-03 · P8-05 · P8-10):账本判定"上游已有部分实现",**BASE-ALIGN-v2(2026-09-03)已按 gap-over-upstream 逐条缩范围**(`spec/first100/sources/base-align-v2/23-partial-rescope-spec.md`),registry 现在的 must/files 就是缩后的缺口。本令不再动;开工三问时读 rescope spec 的对应条目即可。
- **CONTRACT_WRITE / PROVIDER_WRITE / CONSUMER_WRITE 中无 planError 的**:契约和 provider 要自己写,账本没有开源替代,计划没错,不在本令范围。
- **P3-13**(PTC 后端策略绑定,W7/W8):**不在造用账本里**——账本 2026-09-02 生成时 P3-13 同日才由用户批准收录(109→110)。它没有 verdict / oss / deletedPct。**开工三问时补一次单条 make-vs-use 判断**:它接的是 P3-01/02/04/08/10 已建的 ExecutionWorld + 策略设施(组合不是从头造),预期 verdict = CONSUMER_WRITE,依赖 §3.2 的 sandbox-runtime rung。
- **R10**(131 slice,W19 后串行)——另议
- **P9-08 / P9-09**(PREMATURE,R10 后)
- **7 条已验收行的灵敏度回填**(已下令,等冻结表稳定)
- **BLOCKED-124**(14 对双语文档,等用户 `/dsh-translate-docs`)

## 7. 附录(2026-09-06 晚):台账全字段核验——只读两列造成的漏检

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
| P0-06 | CONTRACT_WRITE | zod ✓ · ajv ✓(2) | 2020-12/toJSONSchema ✓(5);Confluent BACKWARD/FORWARD 词汇:0(只有 `SCHEMA_MAJOR_MISMATCH`) | 词汇债 → P8-07 |
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
- **R2 · P2-03 签发前整改(执行者动作,§7.4)。** `canonicalizeArguments` 换 `canonicalize`(erdtman,RFC 8785 参考实现,已在 lock 里作 sigstore 传递依赖);去掉值与 key 的 NFC;fuzz 套件保留但改为**对库的 conformance**(性质:key 顺序 / 数字拼写 / `é` 与 `é` 字面等价 → 同 hash;NFC≠NFD → **不同** hash)。validation[2] 措辞按 C11 A 类由我改(§7.4 给原文)。C 阶段冻结用例 supersede,重观测;U/U.1/F 不动。另三份手写 canonicalJson:`attest.ts` 随 R1 换;`session-snapshot` / `repeat-tool-reminder` 不做安全绑定,不动,记 BLOCKED-QUEUE。
- **R3 · 词汇债不重开已验收行;"首个跨线消费者"拥有对齐。** 规则:词汇在**第一次跨进程/跨语言/跨系统**时必须是标准名,内部字段名可保留但要有单向映射函数并冻结用例。所有权:SPIFFE → P8-06;CloudEvents → P8-05(P4-06 的 dedup-on-id 可直接用现有 `id`);PROV-DM → P7-04(ClaimGraph)与 P6-03;Confluent 兼容词汇 → P8-07;OTel `enduser.id`/`gen_ai.*` → P7-07。写进各拥有者 epic 的 `preFlight.makeVsUse.standardsOwned`。
- **R4 · P1-01 代码缺陷:`dshVersionRange` 未校验。** E 类(不改 registry)。挂到 P1-03(lockfile 本来要解析 range):加 `semver.validRange`,无效即 manifest 拒绝;冻结一个 `dshVersionRange: "not a range"` 被拒的用例。
- **R5 · P1-02 半做部分**(SBOM/CycloneDX、SLSA provenance、tuf-js 根更新)归 P1-03(lockfile 与 SBOM 同源)与 P1-12(信任等级要 SLSA level)。不重开 P1-02。
- **R6 · P0-03/P0-04 不重写。** 手写检查器在跑、有变异证明、无下游传播;为 deletedPct 重写等于拿工作的东西换风险。记录为"账本判 adapt 未采用"的两条,**不算整改项**。
- **R7 · P1-08 整数 API level、P8-01 手排 fingerprint:记录不改。** 前者是自洽的另一种版本语义(账本推荐 semver 是默认不是必须);后者只 hash 自家 surface 且不外发比对。若 P8-07 Python 端需要复算 fingerprint,届时换 JCS(R3 规则自动触发)。

### 7.3 标准词汇传播链(从账本算的,不是记忆)

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

1. `packages/action/action-manifest/src/canonicalize.ts`:`canonicalizeArguments` 改为 `import canonicalize from 'canonicalize'` 后直接调用;删除 NFC 归一化、迭代栈实现、以及"retained copy of the recursive form"的等价测试(库的正确性由库自己的套件验,§4.1)。`canonicalize` 加进 `action-manifest/package.json` 直接依赖(已在 lock 作传递依赖,版本 2.1.0;账本注 4.0.0 ESM 亦可,由执行者按仓库 ESM 约定选,**理由写进 preFlight**)。
2. 值域声明:JSON only(`JsonValue`),非有限数与 bigint 在进入 `createActionManifest` 前拒绝(账本 risk:"JCS forbids non-finite numbers and big ints — define the argument value domain explicitly")。冻结一个拒绝用例。
3. conformance 用例(替换现 fuzz 里的等价断言):(a) key 顺序不同 → 同 hash;(b) `1.0` / `1` / `1e0` → 同 hash;(c) `"é"` 与 `"é"` 字面 → 同 hash;(d) **NFC `é` 与 NFD `é` → 不同 hash**(这条是安全边界,必须冻结并做变异:把 (d) 断言反向,套件必须红)。
4. registry P2-03 validation[2] 措辞(C11 A 类,delegate 裁决,`rewordedFrom` 记原文):
   - 原:「fuzz canonicalizer,禁止 key order/Unicode/number 表示导致 hash 混淆。」
   - 新:「canonicalizer 遵循 RFC 8785(JCS):key 顺序、数字拼写、JSON 转义拼写(`é` 与字面 `é`)不同的同一 JSON 值得到相同 hash;不同 code point 序列(含 NFC 与 NFD)是不同值,必须得到不同 hash。fuzz 覆盖以上四类。」
   - 计入 `planCorrectedClauses`(用户规则:reword 单独计数)。
5. 冻结:C 阶段受影响用例 **supersede**(替换,BLOCKED-103),不 supplement;`sensitivityProof` 记 (d) 的反向变异;U/U.1/F 的冻结不动,但 U 的 `argumentsHash` 期望值若在 fixture 里写死,随之更新并说明。
6. 完成后 C 重观测 → 我跑四谓词 → 签。**在此之前不签 P2-03,P2-04 不开。**

### 7.5 P2-03 整改令的三处修正(执行者 preFlight 发现,2026-09-06 晚)

执行者按令先列清单、未动文件,清单纠正了 §7.4 两处、补了一条测量规则:

1. **F 阶段也要 supersede**(§7.4 ⑤ 说"U/U.1/F 不动"——错)。F 里有一条 fuzz 用例「a Unicode form change never changes the hash, over generated strings that HAVE two forms」,断言的正是要禁止的行为,**且带变异证明(去掉 NFC 它变红)**——一个对错误要求的正确证明。supersede 为反向:生成器只取 NFC≠NFD(按 code point 序列)的串,断言 hash **不同**;反向变异(改成"相同")套件必须红。重观测范围:C + F;U/U.1 候选链仍有效(执行者核过 U fixture 未写死 argumentsHash)。
2. **`canonicalize` 版本定 2.1.0**(lock 里已作 sigstore 传递依赖,零新增图节点;一个库在树里只留一份,与"第二份声明"同一原则)。执行者用 2.1.0 实测四条性质全部成立(NFC≠NFD 不同 hash / key 顺序 / `1.0`·`1`·`1e0` / 转义与字面)。4.0.0 ESM-only 无行为差异,不为它多一个版本节点。sigstore 日后升版本时随之升。
3. **NFD 用例的测量规则**:源码里的 NFD 字面量会被 shell/编辑器归一化成 NFC,两个输入进 node 时已是同一个串——用例测的是"同一个串等于自己"。**NFD 一律用 `'é'` 转义构造,不写字面量**;`sensitivityProof.failureSummary` 记这条。这是当天第四次"仪器不回答问的问题",执行者自己抓住的。

**教训归档**:变异证明只证明"套件对这条要求敏感",不证明"这条要求对"。要求本身的对错由 registry 措辞 + 账本 `risk` + 安全后果推演定——本次三者都指向反方向,而 F 用例是在读账本前冻的。

### 7.6 canonical JSON 的收敛归 R1,不进 P2-03(执行者逐份核后,2026-09-06 晚)

执行者按**行为**(排 key + stringify + 是否喂 hash + 是否喂授权)而非名字逐份核,找到 **5 份**(比我按 `function canonical*` 名字扫到的 4 份多 `scripts/release/collect-evidence.mjs:89`),并把两件事分开:

- **漏洞只有一份**:① `action-manifest/canonicalize.ts`——NFC 喂 hash 喂授权。R2 修。
- **重复四份,无安全问题**:② `scripts/release/baseline-fingerprint.mjs:57`(NFC 只作用于写盘排版,digest 在归一化前对原始字节算完;固定 ASCII 路径,无触发条件)③ `scripts/first100/attest.ts:20`(喂 hash,无 NFC)④ `session-snapshot/suite.ts:641`(测试支持)⑤ `collect-evidence.mjs:89`(喂 sha256,无 NFC)。另 `guard/repeat-tool-reminder/src/index.ts:103`(启发式去重,不喂授权)。

**裁决**:②③⑤ 全在 P0-01/P0-07 的脚本里,正是 **R1 §3.4 attestation-envelope slice 要改写的文件**,收敛归该 slice(它本来就要把 evidence/baseline 改发 Statement+DSSE),不挂 P2-03——否则 P2-03 重观测范围从 C+F 膨胀到五个包。④ 和 repeat-tool-reminder 不动,按 BLOCKED-126 的范围规矩:**下次有 stage 因自己的子句碰到该文件时顺手换库**,不为一条规矩去动没坏的文件。记 BLOCKED-QUEUE 一条 durable pointer。

**扫描方法归档**:找"第二份声明"按行为扫(`sort.*keys|sortKeysDeep|Object\.keys\(.*\)\.sort` + 后接 `stringify` + 喂 `createHash`),名字扫会漏。

### 7.7 账本落盘(2026-09-06 晚,用户追问「每一点的接法你更新了吗」后)

账本的 **237 条 adapt 级 `oss[].note`(每条的接法:版本、体积、本地验过的行为、要避开的坑)此前只在 artifact 和 `/tmp`**,仓库里没有副本——§4.1 让执行者"开工时读账本那一行",而它手里没有带版本的一份。现在:`spec/first100/exec/make-vs-use-ledger.json`(109 行 × 16 字段,`source` 段记 artifact id / 生成方式 / 提取时间 / `oss.role` 语义)。**第四问从这个文件读,不从 artifact 读**;`preFlight.makeVsUse` 必须引用 `rows[].id` 和所用 `oss[].name`。账本本身若要修(例:§3 P2-02 Biscuit 已被 Fiber 事实超越),改这个文件并在本节追加一行,不改 artifact。

**状态说明(对用户)**:本附录的裁决 R1–R7 里,**代码层已修的是 0 条**——delegate 不改代码。R2(P2-03)执行者已按 preFlight 开工;R1(§3.4 slice)排在 Cedar 之后、P4-04 之前;R3–R7 是归属与规则,在各拥有者 epic 开工时兑现。
