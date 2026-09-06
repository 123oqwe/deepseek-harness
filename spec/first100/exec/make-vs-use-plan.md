# First-100 造用执行表(派生文档)

**派生自** `spec/first100/exec/make-vs-use-ledger.json`(sha256 前 16 位 `3b481dc50e866f16`)+ `ledger.json` 状态 + `p9-verification.json` + 整改令裁决叠加(整改令最近提交 `cab06ebfc3`);**生成时间** 2026-09-06T15:04-04:00;生成器源码在文末 `<details>`。**不要手改本文件**——改账本 JSON / 整改令 + 生成器 overlay,重新生成。

## 0. 文档优先级(执行者与 delegate 共同遵守)——**流程入口是 `EPIC-LIFECYCLE.md`**,本节只讲文件角色

1. `tests/first100/registry.json` —— **做什么**(must / acceptance / validation / files);唯一验收依据。
2. `plan-rectification-2026-09-06.md` —— **裁决**:与账本冲突时以它为准(§2 逐条、§3 共用引擎、§7 审计与 R1–R7、§8 OSS 接入 SOP)。
3. 本文件 —— **每条 epic 的造/用执行卡**(派生),开工第四问按它答,`preFlight.makeVsUse` 引用本文件的 epic 小节 + `rows[].id` + 所用 `oss[].name`。
4. `make-vs-use-ledger.json` —— 数据源(artifact 2e874903 的完整镜像:ROWS + META + MARKET + VERDICTS + CHAPTERS)。

**状态列是生成时快照**(见文首生成时间);实时状态以 `ledger.json` / `p9-verification.json` 为准。

**维护规则**:卡片 = 账本行(自动)+「裁决叠加」(生成器里的 overlay 表,**由 delegate 手工维护**)。整改令每追加一条裁决,delegate 同步更新 overlay 并重新生成;生成器源码在文末,执行者也可重跑但不改 overlay。卡片上 **⟶ 裁决取代** 标记的是被裁决推翻的账本 note。

**`preFlight.makeVsUse` 唯一字段规范**(§4.1 / §7 / §8 / §9 四处增量合并于此,以此为准;写在 `clause-subject-audit.json` → `preFlight[<epic 或 SLICE-id>].makeVsUse`;`verify-make-vs-use` 门按此校验,缺字段 = UNRECORDED):

```jsonc
{
  "ledgerRow": "P2-05",                 // rows[].id;账本外的(P3-13 / SLICE-*)填 null 并在 residual 说明
  "card": { "heading": "#### P2-05", "sheetCommit": "<make-vs-use-plan.md 当时的 git 短 sha>" },   // 卡片 = 本文件里以该 heading 开头的小节;不是行号
  "verdict": "PROVIDER_ADAPT", "verdictSecondary": null,          // P2-05 真实值;有副判定的填账本原文
  "adopted": [ { "name": "cedar-policy/cedar",            // 账本 oss[].name 原文
                 "npm": "@cedar-policy/cedar-wasm", "version": "4.12.0",
                 "form": "runtime" | "oracle" | "optional" | "vendored",
                 "reason": "为什么是这个形态(oracle 必须指向复现硬约束的冻结用例)" } ],
  "rejectedAbsent": [ "@openfeature/server-sdk", "…" ],   // preFlight 时 = 账本 reject 条目里**有 npm 名的**名单(无 npm 名的不可核,不列);
                                                          // 门 (b) 对这些名在 files[] 里核 0 import;结果写进 realized.rejectedAbsent(布尔),不在这里
  "standardsOwned": [],                                   // P2-05 不是任何标准的形状所有者(AuthZEN 的所有者是 P2-03,见 §1 表)
  "standardsImported": [ { "standard": "AuthZEN request/response vocabulary", "from": "P2-03" } ],
  "residual": "接完还要自己写什么(账本 residual,可收窄,收窄写原因)",
  "probes": [ { "claim": "forbid overrides permit",        // 账本 note 里“verified locally”的那句
                "how": "node -e … | 或 tests/…spec.ts 的用例标题",   // 可重跑
                "result": "ok" | "hard-constraint" | "differs",
                "evidence": "数字/输出摘要(硬约束必须有数字,如 depth 5000 THREW)" } ],
  "gapCheck": [ { "community": "dsh-auto-mode", "gap": "缺口原句", "clause": "must[1]" | "outOfScope: P2-07" } ],   // §9.2;P2-04 起必填;之前三条 preFlight 回填
  "expectedDeletedPct": "50" | "0-5" | null,
  "recordedBeforeFirstLine": true,
  "realized": null   // F 阶段填:{ "adoptedOnPath": [{ "name", "importedIn": ["packages/…/src/x.ts"] }], "rejectedAbsent": true, "note": "…" }
}
```

**判定含义**(账本 VERDICTS 原文):`PROVIDER_ADAPT` 薄 adapter 包 OSS · `REUSE_UPSTREAM` 上游已做大半 · `QUALIFICATION_REUSE` 复用开源测试集 · `CONTRACT_WRITE` 自写接口·采标准 · `PROVIDER_WRITE` 自写 provider · `CONSUMER_WRITE` 自写接线 · `KERNEL_WRITE` 内核焊死 · `CATALOG_ADOPT` 社区插件直接用

**`oss[].role`**:`adapt` 接进依赖(按 note)· `optional` 不进依赖不进 CI · `reject` 不接(note 是理由)· `reference` 只读设计。**接法 `form`**(preFlight 字段,不是账本 role):`runtime` 默认 · `oracle`(§7.8:有记录的硬约束 → devDependencies 作差分 oracle)· `optional` · `vendored`。

**109 行判定分布**:REUSE_UPSTREAM 26 · PROVIDER_WRITE 25 · PROVIDER_ADAPT 22 · CONTRACT_WRITE 22 · CONSUMER_WRITE 9 · QUALIFICATION_REUSE 4 · KERNEL_WRITE 1 · 未判定 1
**副判定** 80/109 · **带标准** 71/109 · **adapt 级 OSS 条目** 237 · **CATALOG_ADOPT** 0(对抗复核后最高 47%)

## 1. 标准词汇所有权(首个采用者定形状,其余 import)

| 标准(按子规范) | 形状所有者 | 依据 | 全部涉及者(registry 顺序;~~划掉~~ = 已验收但未采用,所有权已转移) |
|---|---|---|---|
| in-toto / DSSE / SLSA | **SLICE-3.4** | R1:envelope slice 在 P4-04(W9)前落地 | ~~P0-01~~ ~~P0-07~~ ~~P1-02~~ P1-11 P1-12 P2-03 P3-07 P3-09 P4-04 P4-09 P6-08 P6-09 P7-01 P7-02 P7-04 P7-05 P7-10 P8-10 |
| RFC 8785 JCS | **P2-03** | 最早涉及者(未验收) | P2-03 P4-03 P4-04 P7-01 P7-05 ~~P8-01~~ P8-09 |
| CloudEvents | **P4-06** | 最早将采用的未验收涉及者(先前者未采用,所有权顺延) | ~~P4-01~~ P4-06 P8-04 P8-05 |
| SPIFFE ID format | **P3-09** | 最早将采用的未验收涉及者(先前者未采用,所有权顺延) | ~~P0-02~~ ~~P2-01~~ P3-09 P8-06 |
| SPIFFE SVID lifetime rules | **P3-06** | 最早涉及者(未验收) | P3-06 |
| W3C PROV-DM | **P6-09** | 最早将采用的未验收涉及者(先前者未采用,所有权顺延) | ~~P5-11~~ ~~P6-02~~ P6-09 P7-04 |
| OTel GenAI semconv gen_ai.* | **SLICE-3.3** | §3.3:名字来自 @opentelemetry/semantic-conventions 常量包,slice 接 pipeline;时点改为 W11 前(P5-03/P5-06 首发 gen_ai.usage.*) | P5-03 P5-06 P6-05 P7-07 |
| OTel resource/error/process semconv | **npm @opentelemetry/semantic-conventions** | 常量包按需 import,无人定形状 | ~~P2-01~~ P3-03 |
| A2A TaskState | **P4-05** | 最早将采用的未验收涉及者(先前者未采用,所有权顺延) | ~~P4-01~~ P4-05 |
| A2A Message/Part/Artifact | **P5-05** | 最早涉及者(未验收) | P5-05 P5-06 |
| MCP ToolAnnotations | **P2-04** | 最早将采用的未验收涉及者(先前者未采用,所有权顺延) | ~~P2-03~~ P2-04 |
| MCP TaskStatus names | **P4-05** | 最早将采用的未验收涉及者(先前者未采用,所有权顺延) | ~~P4-01~~ P4-05 |
| MCP initialize/capabilities | **P8-01** | 已验收且已采用 | P8-01 |
| MCP elicitation/create | **P2-12** | 最早涉及者(未验收) | P2-12 P8-04 |
| AuthZEN (+MCP profile) | **P2-05** | 最早将采用的未验收涉及者(先前者未采用,所有权顺延) | ~~P2-03~~ P2-05 P2-07 |
| ACP request_permission payload | **P2-06** | 最早涉及者(未验收) | P2-06 P2-07 P2-12 P8-04 |
| ACP session/* lifecycle | **P2-12** | 最早涉及者(未验收) | P2-12 P5-06 P5-09 |
| OCI runtime-spec | **P3-01** | 最早涉及者(未验收) | P3-01 P3-02 P3-08 P3-10 |
| OCI image-spec Descriptor | **P6-09** | 最早涉及者(未验收) | P6-09 |
| OCI-style sha256:<hex> refs | **P5-05** | 最早涉及者(未验收) | P5-05 |
| JSON Schema 2020-12 | **P0-06** | 已验收且已采用 | P0-06 P1-01 P2-11 P4-02 P5-03 P5-05 P7-01 P8-07 |
| RFC 6902 JSON Patch | **P4-13** | 最早涉及者(未验收) | P4-13 P7-08 |
| semver | **P1-03** | R4:validRange 在 P1-03 加 | ~~P1-01~~ |
| W3C DPV | **P6-10** | 最早将采用的未验收涉及者(先前者未采用,所有权顺延) | ~~P6-02~~ P6-10 |
| Sigstore bundle | **P1-02** | 已验收且已采用 | P1-02 |
| Idempotency-Key | **P4-12** | 最早涉及者(未验收) | P4-12 P8-03 |
| K8s resource model | **P8-02** | 最早涉及者(未验收) | P8-02 P8-03 |
| OpenFeature | **P0-05** | 已验收且已采用 | P0-05 P7-10 |

**规则**:形状所有者 = 最早**已验收且真正采用**该标准的 epic;没有则为最早的未验收涉及者。已验收但未采用的(划掉)不再拥有,由 R3 指定的下游拥有(卡片"裁决叠加"里写明)。所有权按**子规范**算——MCP / ACP / OCI 各含多个互不相干的子规范,一个 epic 只拥有自己那条。

## 2. 逐条执行卡

### P0 · 地基(8 项)

#### P0-01 · 锁定可复现审计基线与仓库指纹

`Reproducible audit baseline + repo fingerprint (DONE)` · L6_QUALIFICATION · **CONSUMER_WRITE + CONTRACT_WRITE** · 可省 0% · 状态 **ACCEPTED (W1)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 实现 `pnpm baseline:capture` 与 `pnpm baseline:verify`，记录 Git SHA、Node/pnpm 版本、workspace package 列表、默认 bundle 行 ID、关键协议/事件 schema 哈希。
- must[1] 将审计 SHA 写入文档和机器文件
- must[2] 任何执行批次开始前必须 verify，发现上游漂移时停止并生成 rebase report。
- must[3] 指纹只覆盖架构与协议关键面，不把构建产物、时间戳等非确定信息纳入哈希。
- acceptance[0] 同一干净 checkout 在 Linux 与 macOS 生成相同规范化指纹。
- acceptance[1] 修改任一关键 schema、bundle 行或 package manifest 后，verify 必须失败并指出最小差异。
- acceptance[2] 恢复文件后 verify 必须重新通过。
- validation[0] 运行 `pnpm baseline:capture && pnpm baseline:verify`。
- validation[1] 在测试夹具中分别篡改 `cordis.patch.yml`、SDK types 和事件类型，验证三种漂移均被发现。
- validation[2] 把 baseline report 作为所有后续 Evidence Package 的第一项。
- nonGoals:不冻结上游开发 / 这里只冻结每个优化批次的输入。
- files:[B] `package.json` · [B] `pnpm-lock.yaml` · [B] `packages/bundle/base/cordis.patch.yml` · [B] `docs/testing.md` · [B] `BENCHMARK.md` · [N] `docs/audit/baseline-b150a551.md` · [N] `scripts/release/baseline-fingerprint.mjs` · [N] `tests/release/baseline-fingerprint.spec.ts` · [N] `.dsh/baseline.json`
- stages:C:3 文件 · P:2 文件 · U:3 文件 · F:2 文件
- realTask:E0 S01
- gate:Hash is stable on Linux/macOS; any schema/bundle/package drift exits nonzero with minimum diff; S01.
- rollback:A/Q — revert preflight hook and script together; never relabel a mismatched SHA.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 6 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - captures .dsh/baseline.json with the canonical field set the MUST clause requires
    - canonicalizes the captured output: sorted keys, LF-only, UTF-8 NFC, POSIX-relative paths, and no nondeterministic fields
    - writes the audit SHA into both the machine file and docs/audit/baseline-fingerprint-<sha>.md
    - verify exits 0 against an unmodified captured baseline
    - …共 6 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 1 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - wires baseline:capture/baseline:verify in package.json to the real script, and pnpm run actually executes it
- U:1 条有效冻结 / 5 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - boots a clean fixture normally through the real Loader composition
    - aborts startup with the drifted path when the fixture is tampered after capture
    - no-ops when the checkout has no captured baseline
    - resolves without throwing against an unmodified captured baseline
    - …共 5 条(分布在 1 个冻结条目),见 command-freeze.json
- F:2 条有效冻结 / 5 个具名用例 / 变异证明 1/2 / 格子 GREEN · 有 supplement
    - verify fails and names the tampered SDK protocol types file
    - verify fails and names the tampered known-event-types file
    - verify fails and names the tampered pnpm-lock.yaml
    - captures a fingerprint that never leaks the fixture checkout's absolute path or backslash-spelled paths anywhere in its content
    - …共 5 条(分布在 2 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **in-toto/attestation**(NOASSERTION · 371★) — Emit fingerprint as in-toto subject[] {name, digest:{sha256}} so P0-07 binds by digest
- **node:crypto sha256** — Already used in scripts/release/baseline-fingerprint.mjs:130; no dependency needed
**标准(绑定词汇)**:in-toto Statement v1 subject[]/ResourceDescriptor (本 epic 未采用/不采用;所有者 SLICE-3.4,见裁决叠加)
**自己写(residual)**:Everything except the hash primitive stays (291-line walker + spec); only representational alignment to in-toto subject[] remains.
**禁令/风险(risk)**:None; keep as built and do not add a dependency for sha256 of ~100 files.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-vetting 5★ 覆盖≈0% — Keeps an official-package hash baseline for npm tarballs — different object
**裁决叠加(整改令)**:
- §7.1 已验收核验:整改-传播(R1):in-toto Statement 0 · ResourceDescriptor 0
- §7.2 R1:in-toto Statement v1 + DSSE 信封由 §3.4 attestation-envelope slice(P4-04 开工前)统一;P0-07 attest.ts 改发 Statement+DSSE;不重开格子

#### P0-02 · 确立 Minimal Immutable Trust Kernel 边界

`Minimal Immutable Trust Kernel boundary (DONE)` · L0_KERNEL · **KERNEL_WRITE** · 可省 0% · 状态 **ACCEPTED (W2)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 在 Cordis Context 创建前初始化 TrustKernel
- must[1] 它只拥有 root identity、signature roots、policy enforcement entrypoint、audit append、secret broker handle、sandbox attestation verifier。
- must[2] 禁止 TrustKernel 注册成可替换 Cordis Service
- must[3] 只向运行时发放窄接口和不可伪造 handle。
- must[4] 文档明确哪些仍是插件：模型、工具、存储 provider、workflow、memory provider、UI
- must[5] 哪些永远不是插件：根身份、deny enforcement、审计链根、签名验证根。
- acceptance[0] 任意插件卸载、覆盖 service 或动态 mount 都不能替换 kernel policy/audit/signature verifier。
- acceptance[1] Kernel API 无模型可见文本、无业务领域逻辑、无具体 provider 实现。
- acceptance[2] 未初始化 kernel 时，生产 profile 必须 fail closed
- acceptance[3] 开发 profile 可显式启用 insecure 模式并显示永久警告。
- validation[0] 新增恶意插件测试，尝试覆盖 policy/audit/signature services，必须被 boot 阶段拒绝。
- validation[1] 运行架构依赖检查，确保 kernel 不依赖 Cordis product packages。
- validation[2] 运行默认 web/headless profile smoke test，确认兼容模式仍能启动。
- nonGoals:不把整个 Harness 重写成微内核 / 只固化不可绕过的最小边界。
- predecessors:P0-01
- files:[B] `docs/architecture.md` · [B] `README.md` · [B] `packages/README.md` · [B] `AGENTS.md` · [B] `apps/cli/src/profile-boot.ts` · [B] `packages/boot/app-boot/src/index.ts` · [N] `docs/architecture/trust-kernel-boundary.md` · [N] `packages/kernel/trust-kernel/src/index.ts` · [N] `packages/kernel/trust-kernel/src/types.ts` · [N] `packages/kernel/trust-kernel/src/invariant.ts` · [N] `packages/kernel/trust-kernel/tests/boundary.spec.ts`
- stages:C:5 文件 · P:0 文件 · U:4 文件 · F:4 文件
- realTask:E0 S01
- gate:Frozen production export, no reset/clear/provider dependency; audit/tenant/signature/attestation uncertainty denies; S01 plus negative S05/S10/S11/S14 fixtures.
- rollback:K — switch only to last signed kernel; high-risk boot remains closed.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 38 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - imports nothing: the kernel type surface depends on no other package
    - has no runtime code: every top-level statement is a type/interface declaration or an ambient declare-const symbol
    - declares an exported TrustKernel interface with exactly the six must[2] members, all readonly, and no methods
    - TrustKernel type surface (Epic P0-02 must[2]) exports no Config schema and no apply(ctx, config) plugin entry -- nothing here is a Cordis pl
    - …共 38 条(分布在 1 个冻结条目),见 command-freeze.json
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:1 条有效冻结 / 11 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - stays opted out when the switch is unset or empty
    - opts in on ANY non-empty value, including falsy-looking ones
    - is a no-op when initialized, opt-in or not
    - fails closed (throws, never warns) when uninitialized without the insecure opt-in
    - …共 11 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 10 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - leaves the kernel present after disposing an unrelated plugin, and shows the kernel is owned by the root fiber, not a plugin fiber
    - rejects a plugin row applied to the root Include entry after boot exactly as it rejects one present at initial boot
    - rejects delete-then-reprovide against a kernel pinned via pinTrustKernel, and leaves the original kernel pinned
    - rejects a direct reassignment of the store entry (no delete) against a kernel pinned via pinTrustKernel, and leaves the original kernel pinn
    - …共 10 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **paulmillr/noble-hashes**(npm `@noble/hashes` · MIT · 913★) — Crypto primitives only (already a dep); signature roots must not be hand-rolled crypto
- **Node WebCrypto** — Crypto primitives allowed inside the kernel
**标准(绑定词汇)**:SPIFFE-style URI ids (本 epic 未采用/不采用;所有者 P3-09,见裁决叠加)
**自己写(residual)**:100% hand-written by design: root identity, signature roots, policy entrypoint, audit append, secret-broker handle, attestation verifier (442 lines built).
**禁令/风险(risk)**:Any OSS policy engine (OPA/Cedar/Casbin) belongs behind the enforcement entrypoint as a provider, never in the kernel.
**planError**:validation[1] 'kernel must not depend on Cordis product packages' should be enforced by the P0-04 layer rule, not by review.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-gov 1★ 覆盖≈0% — allow/deny/ask policy + JSONL audit + quotas as a plugin — exactly what can never be root enforcement
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK;SPIFFE 词汇债 → P8-06
- §7.10:planError(kernel 不依赖 Cordis 产品包应由 P0-04 层规则机械强制)**已解决**——check-layer-deps.mjs `KERNEL_PERMITTED_CORDIS_BINDINGS={Context}`(layering.md 规则 4)+ collectKernelVendorEdges

#### P0-03 · 增加 Capability Seam 架构一致性检查器

`Capability-seam architecture checker (ACCEPTED)` · L6_QUALIFICATION · **PROVIDER_ADAPT + PROVIDER_WRITE** · 可省 50% · 状态 **ACCEPTED (W3)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 为每个 capability family 声明 definition、providers、consumers、allowed dependency edges。
- must[1] 扫描 workspace package.json 和 TypeScript imports，禁止 consumer deep-import provider `src/*`，禁止 provider 反向依赖 app/UI。
- must[2] 要求新增可替换能力同时具备 service definition、至少一个 provider fixture、consumer composition test 和卸载回滚测试。
- acceptance[0] 现有仓库在受控 allowlist 下通过
- acceptance[1] allowlist 每项必须带删除日期和负责人。
- acceptance[2] 构造违规 deep import、缺 provider、不可逆注册三类夹具时门禁均失败。
- acceptance[3] CI 输出具体依赖边、源文件和修复建议。
- validation[0] 运行 `pnpm architecture:seams`。
- validation[1] 对一个测试 package 临时加入 consumer→provider deep import，确认失败后恢复。
- validation[2] 将检查加入 `pnpm ci:gate`。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-01 P0-02
- files:[B] `AGENTS.md` · [B] `packages/README.md` · [B] `package.json` · [B] `packages/core/agent-loop/src/index.ts` · [B] `packages/core/agent-loop/src/agent.ts` · [N] `architecture.layers.json` · [N] `scripts/architecture/check-capability-seams.mjs` · [N] `tests/architecture/capability-seams.spec.ts`
- stages:C:3 文件 · P:0 文件 · U:4 文件 · F:2 文件
- realTask:E0 S01
- gate:Full Definition→Provider→Consumer→shipping composition and unload reachability; zero unowned package; S01.
- rollback:Q — revert checker only after restoring the previously signed architecture gate.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 28 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - accepts a well-formed family with a definition, providers, and consumers
    - rejects a family with an empty id
    - rejects a family with a duplicate provider entry
    - rejects a family with a duplicate consumer entry
    - …共 28 条(分布在 1 个冻结条目),见 command-freeze.json
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:1 条有效冻结 / 11 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - collects a runtime import, a type-only import, an export-from, and a require specifier
    - resolves a real workspace package name to its real directory
    - classifies packages/client/* and apps/* as application/UI code, and a provider package as not
    - reports zero schema errors and zero unsuppressed violations under the controlled allowlist
    - …共 11 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 22 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - reports a clear error, and does not throw, when families is not an array
    - reports a clear error, and does not throw, when allowlist is not an array
    - reports a clear error, and does not throw, when a family is missing providers
    - reports a clear error, and does not throw, when a family is missing consumers
    - …共 22 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **sverweij/dependency-cruiser**(npm `dependency-cruiser` · MIT · 7,128★) — npm 18.2.0; forbidden rules from.path/to.path, deep-import ban, --output-type baseline known-violations **⟶ 裁决取代:§7.9:已验收,不采用;判据见 §7.9**
**可选(optional,不进依赖不进 CI)**:
- antoine-coulon/skott — Alternative, weaker rule language
- acrazing/dpdm — Alternative, weaker rule language
- javierbrea/eslint-plugin-boundaries — Alternative
- softarc-consulting/sheriff — npm 404 — UNVERIFIED on npm
- oxlint no-restricted-imports — Already devDep; zero-new-dep partial alternative for deep-import ban
**自己写(residual)**:Family roles as rule-generator input, dated/owned allowlist (owner, removalDate), and the definition+provider fixture+composition test+rollback test presence check.
**禁令/风险(risk)**:Already accepted as hand-rolled (~700 lines); only worth revisiting if P0-04 adopts dependency-cruiser (shared engine, one config); use --cache on ~300 packages.
**planError**:Should have been PROVIDER_ADAPT(dependency-cruiser); actual is a hand-rolled scanner with 0% realized deletion today.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-tool-lens 6★ 覆盖≈0% — Model-facing AST/dependency-graph tool, not a CI gate
- graphlint 7★ 覆盖≈0% — Model-facing dependency-graph tool, not a CI gate
**裁决叠加(整改令)**:
- §7.1 已验收核验:沉没成本,不重写(R6/§7.9)
- §7.2 R6 + §7.9:账本 leverage2 建议退掉手写扫描器换 dependency-cruiser,**推翻**——两者均为 TS AST 实现、三通道覆盖动态 import/require/path alias、规则逻辑(dated allowlist/ADR 豁免/kernel-vendor 绑定)dependency-cruiser 不提供;无下游传播;不为行数重写在跑的门

#### P0-04 · 建立分层依赖与禁止环规则

`Layered dependency + no-cycle rules (TODO)` · L6_QUALIFICATION · **PROVIDER_ADAPT + REUSE_UPSTREAM** · 可省 60-70% · 状态 **ACCEPTED (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义层序：kernel → protocol/types → capability definitions → providers → orchestration/runtime → surfaces/apps。
- must[1] 允许事件类型作为窄共享依赖，但禁止通过全局 singleton 绕过层级。
- must[2] 检测 package graph、TypeScript path alias 与动态 require
- must[3] 对合法循环要求显式 ADR。
- acceptance[0] 生产 package graph 无未豁免环。
- acceptance[1] 任何 kernel 对 Cordis、UI、具体模型 provider 的依赖都失败。
- acceptance[2] 检查在 10 秒内完成并给出最短环路径。
- validation[0] 运行 `pnpm architecture:layers`。
- validation[1] 使用三种环路夹具验证检测。
- validation[2] 在 PR gate 中把新增环路设为 blocking。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-03
- files:[B] `package.json` · [B] `pnpm-workspace.yaml` · [B] `packages/README.md` · [N] `scripts/architecture/check-layer-deps.mjs` · [N] `tests/architecture/layer-deps.spec.ts` · [N] `docs/architecture/layering.md`
- stages:C:3 文件 · P:0 文件 · U:3 文件 · F:1 文件
- realTask:E0 S01
- gate:All packages classified; kernel reverse edges and expired allowlist = 0; shortest cycle <10 s; S01.
- rollback:Q — keep last signed layer map/checker active until replacement.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 28 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - ranks the declared kernel -> protocol/types -> capability definitions -> providers -> orchestration/runtime -> surfaces/apps sequence strict
    - allows a downward dependency
    - allows a same-layer dependency
    - rejects an ordinary upward dependency as a layer violation
    - …共 28 条(分布在 1 个冻结条目),见 command-freeze.json
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:1 条有效冻结 / 14 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - assigns a layer to every real workspace package, leaving none unclassified
    - reports zero violations and no unexempted cycle in the production package graph
    - resolves the real trust-kernel Cordis edge as permitted under rule 4 and its dsh-invariants edge as allowlisted
    - reads the real store and reports no expired or stale entry
    - …共 14 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 44 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - ranks the declared kernel -> protocol/types -> capability definitions -> providers -> orchestration/runtime -> surfaces/apps sequence strict
    - allows a downward dependency
    - allows a same-layer dependency
    - rejects an ordinary upward dependency as a layer violation
    - …共 44 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **sverweij/dependency-cruiser**(npm `dependency-cruiser` · MIT · 7,128★) — no-circular with cycle path, layered forbidden rules from a layer manifest, tsConfig aliases, dynamic import/require detection, baseline **⟶ 裁决取代:§7.9:已验收,不采用;判据见 §7.9**
**可选(optional,不进依赖不进 CI)**:
- antoine-coulon/skott — Fallback
- acrazing/dpdm — Fallback
**不用(reject,理由)**:
- pahen/madge — npm 8.0.0 from 2024-08 — stale
**自己写(residual)**:docs/architecture/layering.md + layer manifest, ADR-required exemption format (adr: + owner), global-singleton-bypass grep check, 10 s budget test + 3 cycle fixtures; package-level cycles reuse scripts/package-graph.ts sinkCycles.
**禁令/风险(risk)**:dependency-cruiser is JS/CJS-flavoured but runs fine on ESM/TS monorepos; pin exact version (hygiene gate).
**裁决叠加(整改令)**:
- §7.1 已验收核验:沉没成本,不重写(R6/§7.9)
- §7.2 R6 + §7.9:账本 leverage2 建议退掉手写扫描器换 dependency-cruiser,**推翻**——两者均为 TS AST 实现、三通道覆盖动态 import/require/path alias、规则逻辑(dated allowlist/ADR 豁免/kernel-vendor 绑定)dependency-cruiser 不提供;无下游传播;不为行数重写在跑的门

#### P0-05 · 为重大能力引入 Shadow/Enforce Feature Gates

`Shadow/Enforce feature gates (ACCEPTED/in-flight)` · L2_PROVIDER · **PROVIDER_WRITE + CONTRACT_WRITE** · 可省 0-15% · 状态 **ACCEPTED (W3)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 统一状态 `off \| shadow \| enforce`
- must[1] shadow 模式执行决策但不改变结果，只写入可比较事件。
- must[2] 每个 gate 记录 owner、introducedVersion、defaultByProfile、removalVersion。
- must[3] `--dump-config` 必须展示最终 gate 来源和覆盖链。
- acceptance[0] 同一请求在 legacy 与 shadow 模式得到相同用户可见结果。
- acceptance[1] shadow 决策与 legacy 决策差异被完整记录且不泄露敏感参数。
- acceptance[2] 过期 gate 在 release gate 中失败。
- validation[0] 为 policy、plugin trust、run journal 各建一个 shadow fixture。
- validation[1] 运行 profile composition tests，覆盖 bundle/profile/home/CLI 四层覆盖。
- validation[2] 验证热更新不能把 enforce 降级为 off，除非拥有 kernel 管理权限。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-02
- files:[B] `packages/settings/settings/src/index.ts` · [B] `packages/settings/settings/src/types.ts` · [B] `packages/bundle/base/cordis.patch.yml` · [B] `apps/cli/src/profile-boot.ts` · [B] `apps/cli/src/dump-config.ts` · [N] `packages/migration/feature-gates/src/index.ts` · [N] `packages/migration/feature-gates/src/types.ts` · [N] `packages/migration/feature-gates/tests/gates.spec.ts`
- stages:C:3 文件 · P:2 文件 · U:3 文件 · F:1 文件
- realTask:E0 S01
- gate:Shadow never changes result; enforce cannot be lowered below policy floor; restart is stable; S01.
- rollback:A/K — switch consumer to shadow/off only when policy permits; retain decision events.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 32 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - declares exactly three states: off, shadow, enforce -- no more, no fewer
    - rejects a fourth state at compile time
    - type-checks each of the three real states with zero diagnostics
    - declares an exported FeatureGateDeclaration interface with exactly the required fields, all readonly
    - …共 32 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 27 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - resolves to the declaration default when no profile/settings/env candidate applies
    - adds a profile entry only when the active profile has its own explicit defaultByProfile key
    - never adds a duplicate profile entry when the active profile is literally "default"
    - adds a settings entry only when the namespace value carries this gate's id
    - …共 27 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 20 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - upper-cases the gate id and collapses non-alphanumeric runs to one underscore
    - contributes no override when unset or empty
    - accepts each of the three declared states
    - fails loud on any other value
    - …共 20 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 26 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - applies a settings override moving an enforce-floor gate to off once hasKernelAdministrativeAuthority is true
    - applies an env override moving an enforce-floor gate to off once hasKernelAdministrativeAuthority is true
    - applies legacy's value when candidate throws during shadow evaluation, matching what off mode returns for the same legacy
    - lets a per-profile default declare a state below the repo-wide default with no authority required -- that is authored policy, not a hot over
    - …共 26 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**不用(reject,理由)**:
- open-feature/js-sdk — npm 1.23.0; would cover only flag evaluation + override chain (~15%) — not worth a boot-path dependency
- scientist (npm) — 1.1.1 from 2022 — stale
- uber/piranha — Code-rewrite tool for expired flags, not applicable to YAML gates
**只读参考(reference)**:
- github/scientist — Shadow pattern reference
**标准(绑定词汇)**:OpenFeature evaluation API (optional) (**本 epic 是形状所有者**)
**自己写(residual)**:Tri-state off\|shadow\|enforce semantics, redacted shadow-diff record, owner/introducedVersion/removalVersion, kernel-gated non-downgrade of enforce, --dump-config provenance chain (>80% dsh-specific; 611 lines built).
**禁令/风险(risk)**:OpenFeature adds an SDK in the boot path for little deletion and cannot model 'run legacy AND new, record diff'; keep hand-rolled.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-evolution-lab 1★ 覆盖≈0% — Canary + rollback for skills, not a feature-gate system
- dsh-smart-restart 覆盖≈0% — Canary boot check, not a feature-gate system
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK

#### P0-06 · 建立统一 Schema Registry 与兼容性规则

`Unified schema registry + compatibility rules (ACCEPTED/in-flight)` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 20-30% · 状态 **ACCEPTED (W2)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 为每个持久/线协议对象声明 schemaId、major/minor、兼容规则和迁移函数。
- must[1] 新增字段默认 backward-compatible
- must[2] 删除/重命名/语义改变要求 major 版本和迁移。
- must[3] Session replay、SDK initialize、plugin load 在使用前先协商/验证 schema。
- acceptance[0] 至少能够读取审计基线产生的旧 session fixture。
- acceptance[1] 不兼容客户端收到机器可读错误，不出现静默字段丢失。
- acceptance[2] 所有 registry migration 具有双向或明确不可逆测试。
- validation[0] 运行 schema golden tests。
- validation[1] 用旧版 fixture 对新 runtime 做 replay
- validation[2] 用新版 unknown optional field 对旧兼容 client 做降级测试。
- validation[3] 对 closed union 增加未知值测试，要求 fail closed 或显式 `unknown` 分支。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-01
- files:[B] `packages/core/session/src/known-event-types.ts` · [B] `packages/core/session/src/types.ts` · [B] `packages/core/session/src/repair.ts` · [B] `packages/sdk/protocol/src/types.ts` · [B] `packages/settings/settings/src/types.ts` · [N] `packages/schema/schema-registry/src/index.ts` · [N] `packages/schema/schema-registry/src/types.ts` · [N] `packages/schema/schema-registry/src/migrate.ts` · [N] `packages/schema/schema-registry/tests/compatibility.spec.ts`
- stages:C:5 文件 · P:2 文件 · U:3 文件 · F:2 文件
- realTask:E0 S01
- gate:One schema owner; old baseline fixtures replay; incompatible major and unknown closed union fail explicitly; S01.
- rollback:A/R/D — retain old codecs and reverse migration until persisted data/cursors age out.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 20 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - registers every known session-event payload type at 1.0
    - registers the named SDK protocol wire types at 1.0
    - exposes at least every bootstrapped schema through listSchemas()
    - registers a schema at its declared first version with the given migration
    - …共 20 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 10 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - exercises the real registry: evolveSchema accepts the breaking rename and stores the forward migration
    - renames firedAt to occurredAt, carrying the value across unchanged
    - round-trips forward then backward without loss: {"firedAt":"2026-01-01T00:00:00.000Z"}
    - round-trips forward then backward without loss: {"firedAt":"2026-08-31T12:34:56.789Z","turn":3,"step":1}
    - …共 10 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 13 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - rejects an initialize handshake whose explicit schemaVersion major differs from the registered major
    - accepts an initialize handshake whose explicit schemaVersion major matches the registered major
    - defaults an absent schemaVersion to the registered version, leaving ordinary handshakes unaffected
    - rejects a session-event line whose explicit schemaVersion major differs from the registered major
    - …共 13 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 3 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - replays snapshots/web/fresh-round-trip/session.jsonl (a real pre-schema-registry session fixture) with no negotiation failure and no silent
    - replays snapshots/sdk/text-turn/session.jsonl (a real pre-schema-registry session fixture) with no negotiation failure and no silent event l
    - replays snapshots/session/skill-load/session.jsonl (a real pre-schema-registry session fixture) with no negotiation failure and no silent ev
**用(adapt)**:
- **colinhacks/zod**(npm `zod` · MIT · 43,759★) — 4.4.3 in 34 packages; native z.toJSONSchema()
- **schemastery (vendored)** — Schema.prototype.toJSON at vendor/schemastery/src/index.ts:296 — settled seam
- **ajv**(npm `ajv`) — Already devDep; validates emitted schemas
**可选(optional,不进依赖不进 CI)**:
- Atlassian json-schema-diff — npm 1.0.0, 2025-11, Bitbucket-hosted, low activity — optional; own ~100-line diff is fine
**不用(reject,理由)**:
- StefanTerdell/zod-to-json-schema — ARCHIVED 2026-03
**只读参考(reference)**:
- confluentinc/schema-registry — Vocabulary only
**标准(绑定词汇)**:JSON Schema 2020-12 as interchange (**本 epic 是形状所有者**) · Confluent compatibility vocabulary BACKWARD/FORWARD/FULL[_TRANSITIVE]
**自己写(residual)**:Registry API, negotiation errors (SCHEMA_MAJOR_MISMATCH), migration functions, replay/SDK-initialize/plugin-load hooks; goldens become derived artifacts from emitted JSON Schema.
**禁令/风险(risk)**:json-schema-diff maintenance is thin — treat as optional; do not introduce a second schema language (TypeSpec/Avro/Protobuf).
**planError**:Registry is TS-type-only (524 lines) with no machine-readable schema, so goldens and additive-vs-breaking checks are hand-asserted.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-config-manager 63★ 覆盖≈0% — Migrates user config bundles, not protocol schemas
**裁决叠加(整改令)**:
- §7.1 已验收核验:planError 未解决(§7.10):registry 无机器可读 schema(§7.1 的 toJSONSchema ✓ 是误归);zod/ajv ✓;Confluent 词汇债 → P8-07
- §7.10:planError(registry 只是 TS 类型、无机器可读 schema)**未解决**;§7.1 的 toJSONSchema ✓ 是误归(命中在 typert/registry 与 plugin-manifest)。处置:不重开格子;P8-07(schema-generated SDK)开工前 schema-registry 必须能发 JSON Schema 2020-12,归 P8-07 preFlight 硬前置;P2-11 的 --dump 导出同源

#### P0-07 · 建立 Release Evidence Package 与不可伪造完成门

`Release Evidence Package + unforgeable completion gate (DONE)` · L6_QUALIFICATION · **CONTRACT_WRITE + PROVIDER_ADAPT** · 可省 25% · 状态 **ACCEPTED (W3)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 每个 gate 输出带哈希的 JSON 结果：命令、开始结束时间、退出码、环境、日志/工件 digest、测试数、跳过原因。
- must[1] 最终 evidence package 绑定 baseline fingerprint、Git diff、构建产物 digest。
- must[2] 任何 skipped blocking gate 或缺失 artifact 都不能标记 `accepted=true`。
- acceptance[0] 篡改任一测试日志、二进制或配置后 evidence verify 失败。
- acceptance[1] 同一次执行的 evidence 可离线验证。
- acceptance[2] Agent 最终回答必须引用 package path 和 accepted 状态。
- validation[0] 运行 `pnpm evidence:collect -- pnpm test` 后执行 `pnpm evidence:verify`。
- validation[1] 分别删除日志、改退出码、换构建产物，验证检测。
- validation[2] 将 evidence verifier 放到发布脚本最后一步。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-01 P0-06
- files:[B] `package.json` · [B] `docs/testing.md` · [B] `AGENTS.md` · [N] `scripts/release/collect-evidence.mjs` · [N] `scripts/release/verify-evidence.mjs` · [N] `packages/assurance/evidence-format/src/types.ts` · [N] `tests/release/evidence-package.spec.ts`
- stages:C:3 文件 · P:2 文件 · U:3 文件 · F:2 文件
- realTask:E0 S01
- gate:Only verifier emits accepted status; stale SHA, skip, missing raw bytes, or invalid signature fails; S01.
- rollback:Q/K — preserve raw artifacts and last verifier; disabling this gate blocks release.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 29 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - imports only a type-only Branded from @deepseek-ai/dsh-brand -- no other import, no runtime dependency edge
    - GateEvidence type surface (Epic P0-07 must[0]) exports no Config schema and no apply(ctx, config) plugin entry -- nothing here is a Cordis p
    - declares GateEvidence as a discriminated union of CompletedGateEvidence \| SkippedGateEvidence \| MissingGateEvidence
    - gives GateEvidenceBase (unexported) exactly the must[0] base fields, all readonly
    - …共 29 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 9 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - seeds every declared required gate as a MissingGateEvidence placeholder at init, keeping accepted=false until each one actually runs
    - collects two real gate runs and a real build-artifact digest into accepted=true, then verifies fully offline
    - never sets accepted=true when a required gate genuinely completes with a nonzero exit code
    - records a --skip reason as SkippedGateEvidence without running any command, and keeps accepted=false
    - …共 9 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 4 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - wires evidence:collect/evidence:verify in the real package.json to the real P-stage scripts
    - pnpm run evidence:collect/evidence:verify actually execute the real scripts end-to-end against a throwaway fixture
    - docs/testing.md documents the pnpm evidence:collect/evidence:verify commands
    - AGENTS.md states the evidence-gate reporting convention (acceptance[2]: cite package path and accepted status)
- F:2 条有效冻结 / 10 个具名用例 / 变异证明 1/2 / 格子 GREEN · 有 supplement
    - detects a completed gate's captured log file deleted entirely, distinct from a merely mutated log
    - detects a gate-level --artifact file deleted entirely after collection
    - detects a required build artifact silently deleted from requiredBuildArtifacts, self-consistently forged so only the manifest cross-check ca
    - detects a required build artifact's file deleted entirely, distinct from a merely mutated one
    - …共 10 条(分布在 2 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **in-toto/attestation**(NOASSERTION · 371★) — predicates/test-result.md: result PASSED\|WARNED\|FAILED, configuration[], passedTests/warnedTests/failedTests
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Envelope format for the reserved signature field
- **slsa-framework/slsa**(1,921★) — Provenance v1 for artifact binding
- **sigstore/sigstore-js**(npm `@sigstore/sign` · Apache-2.0 · 181★) — @sigstore/sign 5.0.0 / verify 4.1.2 / bundle 5.0.0; pluggable Signer → local-key DSSE bundle offline; Fulcio/Rekor keyless optional **⟶ 裁决取代:R1:签名由 §3.4 envelope slice 用 kernel Ed25519 做 DSSE;Sigstore 只在 P1-02 验证器**
**可选(optional,不进依赖不进 CI)**:
- ctrf-io/ctrf — npm 0.3.0 for test-count JSON
**不用(reject,理由)**:
- in-toto/witness — Go binary via subprocess, unaware of dsh gates
**标准(绑定词汇)**:in-toto Attestation Statement v1 (本 epic 未采用/不采用;所有者 SLICE-3.4,见裁决叠加) · DSSE envelope (本 epic 未采用/不采用;所有者 SLICE-3.4,见裁决叠加) · in-toto test-result/v0.1 predicate (本 epic 未采用/不采用;所有者 SLICE-3.4,见裁决叠加) · SLSA Provenance v1 (本 epic 未采用/不采用;所有者 SLICE-3.4,见裁决叠加)
**自己写(residual)**:Gate manifest, blocking-gate completeness rule (accepted=true impossible with skipped gate), tamper fixtures, pnpm evidence:* scripts; implement signature as DSSE via @sigstore/sign local Signer rather than a second envelope.
**禁令/风险(risk)**:Re-shaping persisted JSON now is a P0-06 major bump; acceptable because evidence packages are per-run artifacts.
**planError**:Built bespoke envelope (grep in-toto/dsse/slsa = 0 hits) with signature reserved but unimplemented and no envelope standard chosen.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- loopx 覆盖≈0% — 'evidence' is goal-task evidence for agents, not release gates
- api-relay-audit 覆盖≈0% — Relay pentest, unrelated
**裁决叠加(整改令)**:
- §7.1 已验收核验:整改-传播(R1):自造信封,in-toto/DSSE/SLSA/@sigstore/sign 全 0
- §7.2 R1:in-toto Statement v1 + DSSE 信封由 §3.4 attestation-envelope slice(P4-04 开工前)统一;P0-07 attest.ts 改发 Statement+DSSE;不重开格子

#### P0-08 · 把 BENCHMARK.md 升级为通用 Harness 能力基准框架

`BENCHMARK.md → harness capability benchmark framework (TODO)` · L6_QUALIFICATION · **QUALIFICATION_REUSE + REUSE_UPSTREAM** · 可省 40-50% · 状态 **ACCEPTED (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 分 deterministic lane、fault lane、security lane、real-model lane、scale lane。
- must[1] 标准指标包含 task success、duplicate side effect、policy bypass、recovery success、verification precision、router regret、token/cost、latency。
- must[2] 报告记录置信区间和每个失败的可重放 seed。
- acceptance[0] 不配置外部 API 时 deterministic/security/fault lanes 可完整运行。
- acceptance[1] 同一 seed 可复现相同事件投影和失败位置。
- acceptance[2] real-model 结果与底座不变量分开评分，模型失败不能掩盖安全绕过。
- validation[0] 运行 `pnpm benchmark:harness --lane deterministic`。
- validation[1] 运行 100 次 seeded fault campaign，报告所有注入点。
- validation[2] 生成机器 JSON 与人读 Markdown 两份报告。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-07
- files:[B] `BENCHMARK.md` · [B] `package.json` · [B] `packages/test-support/README.md` · [N] `benchmarks/harness-capability/README.md` · [N] `benchmarks/harness-capability/manifest.yml` · [N] `benchmarks/harness-capability/runner.ts` · [N] `benchmarks/harness-capability/report.ts` · [N] `benchmarks/harness-capability/scenarios/` · [N] `tests/benchmark/runner.spec.ts`
- stages:C:5 文件 · P:0 文件 · U:3 文件 · F:5 文件
- realTask:E0 S01 S15
- gate:Empty/skip/fabricated observation fails; fixed seed replay; runner boots real profile; S01–S15 progressively, final closure at P7-09/P7-10.
- rollback:Q — reverting harness removes claims, not product state.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 3 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - must[0]: declares exactly the 5 required lanes (deterministic, fault, security, real-model, scale), no extras
    - must[1]: each required lane declares exactly the 8 standard metrics
    - must[2]: each required lane's report declares confidenceInterval and a replayable seed
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:1 条有效冻结 / 17 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - contract: readManifest returns the frozen five lanes, so the runner and the schema cannot drift apart silently
    - contract: every lane in the manifest declares exactly the eight standard metric names the report module exports
    - contract: the invariant metrics are a proper subset of the standard metrics, never a separate vocabulary
    - contract: the same run seed, scenario and index always yield the same trial seed
    - …共 17 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 16 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - must[0]: declares exactly the 5 required lanes (deterministic, fault, security, real-model, scale), no extras
    - must[1]: each required lane declares exactly the 8 standard metrics
    - must[2]: each required lane's report declares confidenceInterval and a replayable seed
    - enforcement: deterministic, fault and security all execute with no external model configured
    - …共 16 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — 4.9.0 already devDep (7 files); seeded replayable campaigns for the fault lane
- **laude-institute/harbor**(Apache-2.0 · 4,874★) — Real-model lane substrate (see P9-08); Python+Docker sidecar
**可选(optional,不进依赖不进 CI)**:
- Shopify/toxiproxy — npm 4.1.0; sidecar for network faults
- ethz-spylab/agentdojo — Prompt-injection suites, Python sidecar for the security lane
- promptfoo/promptfoo — 0.122.2, 30 MB; red-team + exec: provider, dev-only
- tinylibs/tinybench — 6.0.2, micro benchmarks only
- simple-statistics — 7.11.0; Wilson CI is ~5 lines anyway
**不用(reject,理由)**:
- UKGovernmentBEIS/inspect_ai — Model-centric, Python
- mattpocock/evalite — 0.19.0; scores LLM outputs, not harness invariants
- confident-ai/deepeval — Python
**自己写(residual)**:benchmarks/harness-capability/manifest.yml, lane runner + JSON/Markdown report with CI, metric definitions (duplicate side effect, policy bypass, recovery success, verification precision, router regret) computed from session-log projections.
**禁令/风险(risk)**:Do not build a new deterministic engine — runner.ts must orchestrate existing session-snapshot (4197 lines), llm-mock-server, llm-replay and 13 golden headless scenarios; real-model lane reports BLOCKED when keyless.
**planError**:Deterministic lane already exists upstream (session-snapshot, seeded mock server, 13 golden scenarios) — the epic must orchestrate, not rebuild.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-eval-harness 14★ 覆盖≈30% — YAML cases → headless overlay-patch fork → session.jsonl asserts → baseline gate; unlicensed, single author, LLM-judge; reference only (overlay-patch isolation trick worth copying)
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK(fast-check ✓);harbor → P9-08
- §7.1:harbor 未接,归 P9-08(其 adapt 亦为 harbor)
- §7.10:planError(上游已有确定性 lane,勿重建)——runner.ts:105 接受外部 scenarios,框架未重建 lane;上游 13 个 golden scenarios 是否接入由 P7-09 接线时核

### P1 · 插件体系(12 项)

#### P1-01 · Plugin Manifest v2：声明能力、权限与副作用

`Plugin Manifest v2 (DONE)` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 5% · 状态 **ACCEPTED (W3)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 `dsh.manifestVersion=2`，字段包含 services、tools、skills、MCP servers/resources/prompts、events、filesystem、network、process、secrets、UI surfaces、data stores、migrations、executionMode、compatibility
- must[1] 每个 Tool/MCP capability 声明 side-effect class、auth audience、allowed destinations 与 data classification。
- must[2] manifest 必须是静态数据，禁止通过执行包代码生成。
- must[3] 旧 `dsh.bundle` 兼容读取但标记 `legacy-untrusted`，生产 profile 默认拒绝。
- acceptance[0] 缺少 manifest、声明与实际注册不一致、申请通配权限时安装失败或进入明确 quarantine。
- acceptance[1] Plugin Inventory 能展示声明权限、实际观察权限、版本与来源。
- acceptance[2] manifest schema 有 golden fixture 与向后兼容测试。
- acceptance[3] Skill/MCP Provider 未声明 transport、auth、network destination 或副作用时不能进入 production profile。
- validation[0] 新增 benign、overprivileged、undeclared-tool、undeclared-network 四个插件夹具。
- validation[1] 运行 `pnpm plugin:verify <fixture>`。
- validation[2] 启动 profile 后比较 Cordis 实际注册表与 manifest，任何差异为 blocking violation。
- validation[3] 新增恶意 MCP server 与 Skill 脚本夹具，验证 schema 欺骗、tool-name collision、elicitation 和 secret 请求被拦截。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-02 P0-06
- files:[B] `apps/cli/src/plugin.ts` · [B] `apps/cli/src/profile-boot.ts` · [B] `packages/host/plugin-inventory/src/index.ts` · [B] `packages/host/plugin-inventory/src/types.ts` · [B] `packages/boot/app-boot/src/profile.ts` · [N] `packages/plugin/plugin-manifest/src/index.ts` · [N] `packages/plugin/plugin-manifest/src/types.ts` · [N] `packages/plugin/plugin-manifest/src/validate.ts` · [N] `packages/plugin/plugin-manifest/tests/manifest.spec.ts` · [N] `docs/plugins/manifest-v2.md`
- stages:C:5 文件 · P:2 文件 · U:5 文件 · F:2 文件
- realTask:E1 S10
- gate:Missing, wildcard, or declaration/observation mismatch quarantines; legacy is denied in production; S10.
- rollback:K/A — retain legacy decoder but production stays deny; disable only the new inventory view.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 74 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - accepts a fully-declared benign manifest
    - rejects a manifest that is not an object
    - rejects a manifest with manifestVersion other than 2
    - rejects a tool capability missing must[1] effect fields
    - …共 74 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 20 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - builds an active permission state when observed registrations exactly match the declared manifest
    - builds a quarantined permission state when the plugin registered a tool its manifest never declared
    - carries a missing declaration and no comparison for a plugin with no manifest at all
    - exposes validatePluginManifestV2 from the package root the same as the documented /validate subpath
    - …共 20 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 48 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - stays off when unset or empty
    - opts in on exactly "enforce"
    - fails loud on any other value (misconfiguration, not a silent default)
    - composes every bundle layer unconditionally outside production, regardless of declaration
    - …共 48 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 14 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - does not crash with an uncaught RangeError on a manifest carrying a deeply nested field anywhere in the raw value
    - reports a deeply nested field as an ordinary validation outcome, not a crash, and denies it production admission
    - still detects a real wildcard finding on an otherwise-valid manifest that also carries an unrelated deeply nested field
    - reports multiple assertJsonSerializable violations inside one array in true left-to-right index order, even when an undefined element sits b
    - …共 14 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **npm/node-semver**(npm `semver` · ISC · 5,460★) — 7.8.5 already transitive in pnpm-lock; semver.validRange for dshVersionRange
**标准(绑定词汇)**:JSON Schema 2020-12 (already) (所有者 P0-06,import 其定义) · semver ranges (本 epic 未采用/不采用;所有者 P1-03,见裁决叠加) · VS Code contributes/capabilities.untrustedWorkspaces vocabulary  · Chrome MV3 permissions/host_permissions vocabulary
**自己写(residual)**:dshVersionRange never validated (add semver.validRange); observed-side effect fields don't exist (BLOCKED-027) — needs P1-08/P1-09 to thread identity/effects through registrations.
**禁令/风险(risk)**:None; don't reopen the format (933 src + 933 test lines, 9 fixtures).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-harbor 24★ 覆盖≈30% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No manifestVersion=2 or structured schema (services/tools/skills/MCP/events/fs/network/process/secrets/UI/data stores/migrations/executionMode/compatibility); flat 13-id string[] only. No si
- dsh-plugin-vet 3★ — Statically infers a CapabilityManifest {hosts, fsPaths, spawnCmds, imports, hasNetwork, hasExec} — candidate 'observed' side; does not read manifest v2
- dsh-plugin-mall 5★ — Verifies dsh.bundle/dsh.client badges; does not read manifest v2
**裁决叠加(整改令)**:
- §7.1 已验收核验:代码缺陷(R4 → P1-03):dshVersionRange 未校验

#### P1-02 · 插件签名、来源证明与 SBOM

`Signing, provenance, SBOM` · L2_PROVIDER · **PROVIDER_ADAPT + CONTRACT_WRITE** · 可省 55% · 状态 **ACCEPTED (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 支持 Sigstore 风格 identity/provenance 或组织离线签名
- must[1] 验证 package digest、source commit、builder identity 和依赖 SBOM。
- must[2] TrustKernel 持有可信根
- must[3] 普通插件不能修改。
- must[4] 允许 `unsigned-dev` 仅在显式开发 profile，且 UI/日志持续显示不可信状态。
- acceptance[0] 篡改一个字节、替换 source repo、伪造 builder 三种情况都拒绝。
- acceptance[1] 同一锁定包在离线模式可验证。
- acceptance[2] Inventory 和审计事件记录验证结果而不记录密钥。
- validation[0] 用签名 fixture 正常安装
- validation[1] 篡改 tarball 后重装必须失败。
- validation[2] 生成 CycloneDX/SPDX SBOM，并检查所有运行依赖均被列出。
- validation[3] 运行 revoked signing identity 测试。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-02 P1-01
- files:[B] `apps/cli/src/plugin.ts` · [B] `packages/host/plugin-inventory/src/types.ts` · [P] `packages/kernel/trust-kernel/src/types.ts` · [N] `packages/plugin/plugin-provenance/src/index.ts` · [N] `packages/plugin/plugin-provenance/src/signature.ts` · [N] `packages/plugin/plugin-provenance/src/sbom.ts` · [N] `packages/plugin/plugin-provenance/tests/provenance.spec.ts`
- stages:C:4 文件 · P:2 文件 · U:3 文件 · F:1 文件
- realTask:E1 S10
- gate:Offline verification binds tarball/source/builder/SBOM; secret key never logged; S10.
- rollback:K/A — revoke signer and quarantine versions; do not activate unsigned fallback.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 13 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - must[0]: a claim backed by Sigstore-style identity/provenance evidence verifies as trusted
    - must[0]: a claim backed by an organization offline-signing key verifies as trusted
    - must[1]: a package whose SBOM omits an actually-installed runtime dependency is rejected for SBOM-coverage mismatch
    - must[2]: the trust root a verification checks evidence against is literally TrustKernel's own signatureRoots handle
    - …共 13 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 12 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - P1-02 Provider — computePackageDigest over real bytes digests the exact bytes it was given, matching an independently computed sha256 of the
    - P1-02 Provider — computePackageDigest over real bytes returns the same digest for the same bytes across separate calls, so a verdict does no
    - P1-02 Provider — computePackageDigest over real bytes changes the digest when a single byte of a real package payload is flipped
    - P1-02 Provider — computePackageDigest over real bytes changes the digest when two bytes are swapped, so it depends on byte order and not onl
    - …共 12 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 10 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - records the unverified state a package shipping no provenance claim actually has, naming no-provenance-claim and carrying no package digest
    - carries no trust anchor id on an unverified record, so an unverified package cannot be read as anchored to anything
    - distinguishes an unverified package from a rejected one, so no claim was presented is never recorded as a refusal
    - CONTROL (passes at RED, and is meant to): still names the anchor on a trusted record, so widening the record for the unverified state does n
    - …共 10 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 50 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - P1-02 Contract — must clauses must[0]: a claim backed by Sigstore-style identity/provenance evidence verifies as trusted
    - P1-02 Contract — must clauses must[0]: a claim backed by an organization offline-signing key verifies as trusted
    - P1-02 Contract — must clauses must[1]: a package whose SBOM omits an actually-installed runtime dependency is rejected for SBOM-coverage mis
    - P1-02 Contract — must clauses must[2]: the trust root a verification checks evidence against is literally TrustKernel's own signatureRoots h
    - …共 50 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **sigstore/sigstore-js**(npm `sigstore` · Apache-2.0 · 181★) — sigstore 5.0.0, @sigstore/verify 4.1.2, @sigstore/bundle 5.0.0, @sigstore/tuf rootPath/cachePath/forceCache; bundle/DSSE parsing, Fulcio chain, Rekor proof, TUF offline cache
- **theupdateframework/tuf-js**(npm `tuf-js` · MIT · 83★) — 6.0.0
- **CycloneDX/cyclonedx-javascript-library**(npm `@cyclonedx/cyclonedx-library` · 24★) — 10.2.0; builds BOM from parsed pnpm-lock data in-process
- **node:crypto Ed25519** — Verified locally; offline org keys
**可选(optional,不进依赖不进 CI)**:
- CycloneDX/cdxgen — 12.8.4 CLI, pnpm-lock supported, large dep tree — prefer the library for in-process
- anchore/syft — Sidecar only
- slsa-framework/slsa-verifier — Sidecar only
- sigstore/cosign — Sidecar only
**标准(绑定词汇)**:in-toto Statement v1 (本 epic 未采用/不采用;所有者 SLICE-3.4,见裁决叠加) · SLSA provenance v1 (本 epic 未采用/不采用;所有者 SLICE-3.4,见裁决叠加) · Sigstore bundle v0.3 (**本 epic 是形状所有者**) · CycloneDX 1.6  · SPDX
**自己写(residual)**:Pin roots into TrustKernelSignatureRoots; scope→identity policy; revocation list; SLSA buildDefinition source-commit == manifest repo check; SBOM-vs-pnpm-lock completeness; unsigned-dev profile gating + inventory/audit events.
**禁令/风险(risk)**:Keyless (Fulcio/Rekor/TUF CDN) is hosted → optional only; local default = org Ed25519 key in Sigstore bundle format with keySelector + TUF forceCache; @sigstore/verify Verifier/toTrustMaterial API UNVERIFIED in session.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-provenance 1★ 覆盖≈15% — SRI integrity vs registry, pin check, parses SLSA attestation but its own source says it does NOT verify the sigstore signature; no roots, no SBOM
- hol-guard 514★ 覆盖≈15% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：All of it targets third-party package installs, not dsh plugin signing with TrustKernel-held roots; no manifest-digest/source-commit/builder-identity triple for dsh packages; no offline veri
**裁决叠加(整改令)**:
- §7.1 已验收核验:半做:sigstore ✓;tuf-js/CycloneDX/SLSA 0 → P1-03/P1-12(R5)
- §7.2 R1:in-toto Statement v1 + DSSE 信封由 §3.4 attestation-envelope slice(P4-04 开工前)统一;P0-07 attest.ts 改发 Statement+DSSE;不重开格子
- §9.2 生态迁移目标:~70 个 market 类插件走裸 pnpm add——安装必须经 harness 的 lockfile/--ignore-scripts/隔离;负用例:自动批 build scripts(dsh-plugin-mall)、扫描器搞崩 boot

#### P1-03 · 可复现插件锁文件与依赖解析

`Reproducible plugin lockfile` · L2_PROVIDER · **PROVIDER_ADAPT + PROVIDER_WRITE** · 可省 40% · 状态 **BLOCKED_ON_ACCEPTANCE (W5)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 锁定 package/version/integrity/source commit/manifest digest/signature identity/dependency graph/load order/granted capabilities。
- must[1] `plugin add/update/remove` 采用事务：先生成候选 lock，验证后原子替换。
- must[2] 生产 boot 只加载 lock 中已批准且 digest 匹配的插件。
- acceptance[0] 断网冷启动可按 lock 验证本地 cache。
- acceptance[1] registry tag 漂移不改变已锁定 profile。
- acceptance[2] 并发两个安装进程不会产生半写 lock。
- validation[0] 运行 parallel install race test。
- validation[1] 修改 registry fixture 的 latest 指向，确认 lock 保持原版本。
- validation[2] 在 lock 与 node_modules 不一致时 boot fail closed。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P1-01 P1-02
- files:[B] `apps/cli/src/plugin.ts` · [B] `apps/cli/src/profile-boot.ts` · [B] `packages/bundle/base/cordis.patch.yml` · [N] `.dsh/plugins.lock.json` · [N] `packages/plugin/plugin-lock/src/index.ts` · [N] `packages/plugin/plugin-lock/src/types.ts` · [N] `packages/plugin/plugin-lock/tests/lock.spec.ts`
- stages:C:4 文件 · P:2 文件 · U:3 文件 · F:1 文件
- realTask:E1 S10
- gate:Lock binds bytes/source/signature/SBOM/ABI/schema/capability and boot fails on drift; S10.
- rollback:K/D — retain last verified lock and atomically discard the candidate.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 16 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - carries package, version, integrity, source commit, manifest digest, signature identity, dependencies and capabilities
    - records the signature identity WITHOUT that recording implying it was verified
    - refuses entries that are not in canonical order
    - resolves a TOTAL load order, so independent plugins do not order by chance
    - …共 16 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 21 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - marks integrity, source commit and signature identity when the package declares none
    - records a declared provenance fact verbatim instead of marking it
    - always computes the manifest digest, since that IS observable
    - digests a manifest independently of its key order
    - …共 21 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 5 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - admits a matching install and reports the boot as verified
    - refuses a drifted install and does not soften admitBoot's verdict
    - refuses when the policy is refuse, naming the gate rather than a plugin
    - proceeds when the policy allows it, but marks the boot UNVERIFIED
    - …共 5 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 18 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - P1-03 Fault — rejection-boundary matrix enumerates at least twelve boundaries, each named once
    - fault boundary 01 a dangling dependency is refused
    - fault boundary 02 a duplicate entry is refused
    - fault boundary 03 unsorted entries are refused, since the file would not be byte-stable
    - …共 18 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **pnpm/pnpm**(npm `@pnpm/lockfile.fs` · MIT · 36,367★) — @pnpm/lockfile.fs 1100.2.5, @pnpm/lockfile.types 1100.1.0; pnpm install --frozen-lockfile --offline --ignore-scripts (flags verified)
- **npm/ssri**(npm `ssri`) — 14.0.0 SRI strings
- **npm/write-file-atomic**(npm `write-file-atomic` · ISC · 256★) — 8.0.0 atomic write
**不用(reject,理由)**:
- moxystudio/node-proper-lockfile — Last push 2023-10 — stale; write a 40-line O_EXCL lockdir instead
**自己写(residual)**:Overlay schema (.dsh/plugins.lock.json keyed by pnpm-lock digest: manifest digest, signature identity, source commit, load order, granted capabilities), candidate→verify→atomic-rename transaction, cross-process lock, boot-time node_modules↔lock digest check, race tests.
**禁令/风险(risk)**:Do NOT invent a second resolver; pnpm's virtual store is the truth; parse pnpm-lock.yaml with the existing yaml dep + @pnpm/lockfile.types.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-mall 5★ 覆盖≈20% — Snapshots profile load-bearing files pre-install, restores on failure, pending-install marker (~20% of transaction semantics)
- dsh-plugin-marketplace 20★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No dsh-owned .dsh/plugins.lock.json: nothing records manifest digest, signature identity, dependency graph, load order or granted capabilities; boot does not verify node_modules against a lo
- dsh-market 3,046★ — Release channels + repo-verified npm preference, no lock overlay
- dsh-unified-market 2★ — SHA-256 check of .dshpack; none lock capabilities/signature identity
**裁决叠加(整改令)**:
- §7.2 R4:P1-01 `dshVersionRange` 只查是字符串(validate.ts:393)→ 本 epic 加 semver.validRange + 拒绝用例;R5:P1-02 的 SBOM(CycloneDX)与 lockfile 同源,在本 epic 建
- §10.3-1 裁决 BLOCKED-094:profile 字段 plugins.lock required|warn(显式 resolve);production-controlled=required;有 lock 而 digest 漂移一律拒绝;lock 生成所有者 = 本 epic U 阶段(dsh plugin lock)→ composeProfile 调用点 → 验收

#### P1-04 · 隔离安装与默认禁止生命周期脚本

`Isolated install, no lifecycle scripts` · L2_PROVIDER · **PROVIDER_ADAPT + REUSE_UPSTREAM** · 可省 45% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 下载 tarball 到只读 quarantine
- must[1] 以 `--ignore-scripts` 解包并验证 manifest、签名、SBOM、路径穿越。
- must[2] 需要构建的插件在无凭证、无宿主网络、临时 filesystem 的 build sandbox 中执行。
- must[3] 通过后原子 promote
- must[4] 失败清理且不修改 profile/lock。
- acceptance[0] preinstall/postinstall 尝试读取 `$HOME`、访问网络、写 profile 均失败。
- acceptance[1] tar path traversal、symlink escape、zip bomb 被拒绝。
- acceptance[2] 安装失败后 profile、lock、node_modules 可恢复到字节级原状态。
- validation[0] 运行恶意 npm fixture 集。
- validation[1] 在 promote 前 kill 进程，重启后 transaction recovery 清理或继续。
- validation[2] 验证无生命周期脚本在宿主权限下执行。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P1-02 P1-03 P3-01
- files:[B] `apps/cli/src/plugin.ts` · [B] `apps/cli/src/process-shutdown.ts` · [N] `packages/plugin/plugin-installer/src/index.ts` · [N] `packages/plugin/plugin-installer/src/quarantine.ts` · [N] `packages/plugin/plugin-installer/src/transaction.ts` · [N] `packages/plugin/plugin-installer/tests/quarantine.e2e.ts`
- stages:C:3 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E1 S10
- gate:No lifecycle script has host authority; failure restores profile/lock/node_modules byte-for-byte; S10.
- rollback:K/D — discard candidate temp transaction; keep old lock/profile active.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **pnpm --ignore-scripts + strictDepBuilds/allowBuilds**(npm `pnpm` · MIT · 36,367★) — Deny-by-default allowlist already in repo pnpm-workspace.yaml; script suppression is configuration
- **npm/pacote**(npm `pacote` · ISC · 396★) — 22.0.0: registry fetch + SRI integrity + extract
- **isaacs/node-tar**(npm `tar` · BlueOak-1.0.0 · 921★) — 7.5.x already in lock; strips absolute paths, rejects .. and symlink extraction unless preservePaths; no expansion cap
- **packages/sandbox/sandbox-local (existing)** — Credential-less/no-network build sandbox, fail-closed
**不用(reject,理由)**:
- LavaMoat/@lavamoat/allow-scripts — 5.1.0 — redundant with pnpm's native allowBuilds
**自己写(residual)**:Read-only quarantine layout, gate ordering (manifest→signature→SBOM→scanner), zip-bomb byte cap on tar entry stream (~30 lines), atomic promote via rename, crash-recovery journal, byte-level restore, malicious npm fixtures.
**禁令/风险(risk)**:pnpm allowBuilds is per-profile config a market plugin can rewrite → installer must pass --ignore-scripts explicitly and treat any allowBuilds edit as policy; Windows pnpm symlink EPERM reports.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-marketplace 15★ 覆盖≈35% [topic-sweep] — bundle·进程内·无 key \| 缺口：No read-only quarantine directory: pnpm mutates node_modules in place. No build sandbox: consented scripts run under host privileges/network with only pnpm's allow-build scoping. No tar path
- dsh-plugin-mall 5★ 覆盖≈30% — Isolated preflight: scripts disabled into throwaway dir, profile snapshot/restore ≈30% of must[0..4]; no signature/SBOM/sandboxed build
- dsh-unified-market 2★ 覆盖≈0% — allowBuilds auto-approve + retry = the anti-pattern P1-04 forbids
- dsh-market 3,046★ — Prefers prebuilt release tarballs (no local build scripts)
**裁决叠加(整改令)**:
- §9.2 生态迁移目标:~70 个 market 类插件走裸 pnpm add——安装必须经 harness 的 lockfile/--ignore-scripts/隔离;负用例:自动批 build scripts(dsh-plugin-mall)、扫描器搞崩 boot

#### P1-05 · 插件静态/动态安全扫描器

`Static/dynamic plugin scanner` · L2_PROVIDER · **PROVIDER_ADAPT + QUALIFICATION_REUSE** · 可省 40% · 状态 **NOT_RUN (W9)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 静态扫描 imports、child_process、fs、net、eval/vm、native bindings、postinstall、dynamic require。
- must[1] 动态扫描在 instrumented plugin host 记录实际 syscall/network/fs/service registration，并与 manifest 比较。
- must[2] 结果分 blocking、review、informational，规则带版本。
- acceptance[0] 已知恶意 fixture 检出率 100%，benign fixture 无 blocking false positive。
- acceptance[1] 动态扫描超时或崩溃不能被解释为通过。
- acceptance[2] 扫描报告进入 plugin provenance 和 evidence package。
- validation[0] 运行 curated malicious corpus。
- validation[1] 用故意混淆的 dynamic import/child process fixture 验证。
- validation[2] 对官方默认 bundle 做回归扫描并建立基线。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P1-01 P1-04
- files:[B] `apps/cli/src/plugin.ts` · [B] `packages/host/plugin-inventory/src/index.ts` · [N] `packages/plugin/plugin-scanner/src/index.ts` · [N] `packages/plugin/plugin-scanner/src/static.ts` · [N] `packages/plugin/plugin-scanner/src/dynamic.ts` · [N] `packages/plugin/plugin-scanner/src/rules.ts` · [N] `packages/plugin/plugin-scanner/tests/scanner.spec.ts`
- stages:C:3 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E1 S10
- gate:Scanner crash/unknown denies; observed behavior matches manifest; S10.
- rollback:K — quarantine candidate and retain previous scan verdict/version.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **NodeSecure/js-x-ray**(npm `@nodesecure/js-x-ray` · MIT · 287★) — 16.0.0: AST SAST, variable tracing, dynamic-import resolution, obfuscator fingerprinting, unsafe-import/data-exfiltration warnings
- **ossf/malicious-packages**(Apache-2.0 · 607★) — ≥1,000 npm OSV records as validation corpus
- **@types/sarif**(npm `@types/sarif`) — 2.1.7
**可选(optional,不进依赖不进 CI)**:
- LavaMoat/@lavamoat/node — 1.0.7; static per-package globals/builtins policy inference; not the P1-06 runtime
- DataDog/guarddog — Sidecar only
- semgrep/semgrep — Sidecar only, SARIF ingest
- google/osv-scanner — Sidecar or pnpm audit
- oxc-project/oxc — 0.148.0 if a bare fast parser is wanted
**只读参考(reference)**:
- ossf/package-analysis — gVisor dynamic analysis — design reference only
**标准(绑定词汇)**:SARIF 2.1.0 report format
**自己写(residual)**:Native-binding + postinstall + DSH-specific rules (plugin-tree injection, profile tamper, builtin-tool shadowing, ctx verb abuse), rule versioning; dynamic scan = P1-06 host in record mode (sandbox-local denials + P3 egress log + Cordis registry diff), timeout/crash ≠ pass.
**禁令/风险(risk)**:node --permission verified locally: fs/child_process denied but fetch returned 200 and process.env visible → cannot be the dynamic scanner's enforcement; community rule corpora are regex-heavy — mine ideas, don't port regexes.
**planError**:Dynamic scanning cannot rely on node --permission (allows network and env).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-vet 3★ 覆盖≈35% — TS-compiler AST, 15 rule modules, capability inference, OSV lookup, opt-in runtime guard + honeypot; alarm-only — best fork source for DSH-specific rules
- dsh-toolbox 30★ 覆盖≈30% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No dynamic scan in an instrumented plugin host (syscall/network/fs/service-registration observation vs manifest) - half the MUST is absent; static rules miss native bindings (.node/koffi/gyp
- dshscan 10★ 覆盖≈25% — @shaoshi/dshscan 0.5.0: 15 regex line-rules incl. DSH-specific R010–R015, optional LLM pass, benign/malicious benchmark
- dsh-poison-guard 2★ — Already js-x-ray + deobfuscation + CI exit code — validates the OSS pick
- dsh-plugin-vetting 5★ — 15+3 regex rules, 'not a security boundary'
**裁决叠加(整改令)**:
- §2.G 开工前设计决定已定(见该 epic 行)

#### P1-06 · 不可信插件 Out-of-Process Host

`Out-of-process host for untrusted plugins` · L2_PROVIDER · **PROVIDER_WRITE + PROVIDER_ADAPT** · 可省 20% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 默认第三方插件在独立进程或 microVM 中运行
- must[1] 只通过 capability-scoped RPC 注册工具、事件和 UI 描述。
- must[2] 禁止传递宿主 Context、raw credentials、任意函数或可变对象引用。
- must[3] host 崩溃可重启，注册 effects 自动撤销。
- must[4] 插件 RPC 不能绕过 ActionManifest。
- acceptance[0] 插件尝试直接读取宿主 home、process.env、socket、其他插件内存均失败。
- acceptance[1] 插件 host 被 kill 后主 Harness 保持健康，相关工具变为明确 unavailable。
- acceptance[2] 每个 RPC 调用具有 principal、capability token、deadline、trace id。
- validation[0] 运行 malicious plugin isolation suite。
- validation[1] 连续 kill/restart 100 次，检查无泄漏注册和僵尸进程。
- validation[2] 测量 p95 RPC 开销并与基线比较，超过门槛必须记录 ADR。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P1-01 P2-02 P3-01
- files:[B] `packages/boot/app-boot/src/index.ts` · [B] `packages/boot/app-boot/src/profile.ts` · [B] `packages/host/plugin-inventory/src/index.ts` · [B] `packages/core/tools/src/index.ts` · [N] `packages/plugin/plugin-host-protocol/src/types.ts` · [N] `packages/plugin/plugin-host/src/index.ts` · [N] `packages/plugin/plugin-host/src/supervisor.ts` · [N] `packages/plugin/plugin-host/src/rpc.ts` · [N] `packages/plugin/plugin-host/tests/isolation.e2e.ts`
- stages:C:2 文件 · P:3 文件 · U:4 文件 · F:2 文件
- realTask:E1 S10
- gate:Real OS process and authenticated RPC are independently observed; unload handles/processes = 0; S10.
- rollback:K/X — revoke token, kill process tree, unload registrations; never fall back in-process.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **microsoft/vscode-languageserver-node**(npm `vscode-jsonrpc` · MIT · 1,784★) — 9.0.2 (9.0.1 already in lock): JSON-RPC over stdio/pipe with CancellationToken, progress, tracing
- **packages/sandbox/sandbox-local (existing)** — landlock/seatbelt/bwrap confinement per plugin host
**可选(optional,不进依赖不进 CI)**:
- @modelcontextprotocol/sdk — Alternative wire for tools/resources/prompts; lacks events/UI/capability tokens
- denoland/deno — 2.9.6 npm binary; --allow-net=host allowlists, npm: specifiers; ~100 MB second runtime — optional provider only
**不用(reject,理由)**:
- laverdet/isolated-vm — Maintenance mode, needs --no-node-snapshot on Node ≥20, even-only Node
- ShadowRealm — Only under --harmony-shadow-realm; no I/O isolation
- node --permission — No network/env restriction (verified)
- extism/extism — 2.0.0-rc13 last published 2025-05-14; WASM can't host Cordis apply(ctx) plugins
- bytecodealliance/jco — 1.32.1; component model, same WASM limitation
- firecracker-microvm/firecracker — Linux/KVM only
**标准(绑定词汇)**:VS Code extension host design (descriptors and proxies only)
**自己写(residual)**:Supervisor + restart, capability-scoped registration proxy (tool/event/UI descriptors only; no Context, functions, or mutable refs), effect revocation on crash, principal/capability-token/trace-id per call, p95 benchmark + ADR.
**禁令/风险(risk)**:Don't pick Deno unless network confinement can't be met by P3's proxy; don't pick WASM (reserve as future pure-compute tier).
**planError**:isolated-vm / ShadowRealm / WASM (Extism, jco) do not fit npm-packaged Cordis plugins.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-vet 3★ 覆盖≈0% — Runtime guard/honeypot are in-process hooks
- dsh-mobile-gate 覆盖≈0% — Isolated child-process reverse proxy for a different purpose
**裁决叠加(整改令)**:
- §2.B 子句不动、加实现约束(见该 epic 小节)
- §9.2 生态迁移目标:~70 个 market 类插件走裸 pnpm add——安装必须经 harness 的 lockfile/--ignore-scripts/隔离;负用例:自动批 build scripts(dsh-plugin-mall)、扫描器搞崩 boot

#### P1-07 · 项目 Trust Boundary：未信任目录不加载项目级执行内容

`Workspace trust boundary` · L2_PROVIDER · **PROVIDER_WRITE + CONTRACT_WRITE** · 可省 0-5% · 状态 **ACCEPTED (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] workspace 状态 `untrusted \| trusted-read \| trusted-execute`，绑定 canonical realpath 与 inode/volume identity。
- must[1] untrusted 时只允许安全读取，不加载项目插件、hooks、MCP server、可执行 skill、home/profile patch 覆盖。
- must[2] 信任升级必须由宿主用户交互完成并写审计。
- acceptance[0] clone 一个含恶意配置的仓库并打开，不产生任何子进程、网络或凭证读取。
- acceptance[1] 目录被替换、symlink 改指、移动后信任不自动继承。
- acceptance[2] 降级 trust 立即撤销项目能力。
- validation[0] 运行 path swap、symlink、git checkout 攻击 fixture。
- validation[1] 验证 trusted-read 只注入纯文本且经过 prompt injection 标记。
- validation[2] 验证 headless profile 无交互时默认不信任。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-02 P2-01
- files:[B] `packages/workspace/workspace/src/entity.ts` · [B] `packages/workspace/workspace/src/index.ts` · [B] `packages/workspace/workspace/src/paths.ts` · [B] `packages/context/agent-instructions/src/index.ts` · [B] `packages/context/agent-instructions/src/files.ts` · [B] `apps/cli/src/profile-boot.ts` · [N] `packages/workspace/workspace-trust/src/index.ts` · [N] `packages/workspace/workspace-trust/src/types.ts` · [N] `packages/workspace/workspace-trust/tests/trust.spec.ts`
- stages:C:3 文件 · P:3 文件 · U:4 文件 · F:1 文件
- realTask:E1 S10 S13
- gate:Untrusted workspace cannot load instructions/hooks/skills/MCP or execute; S10/S13.
- rollback:K — invalidate trust digest; fall back to no project execution.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 15 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - must[0]: a freshly bound workspace trust record starts untrusted and carries the full canonical-realpath-plus-inode/volume binding it was bo
    - must[1]: an untrusted workspace permits only safe reads and denies every project plugin/hook/MCP-server/executable-skill/home-profile-patch-
    - gate: an untrusted workspace denies project instructions, so opening a clone never reads the repository's own AGENTS.md
    - validation[1]: a trusted-read workspace permits project instructions as plain text while still denying every project-level executable kind
    - …共 15 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 9 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - observes the fs.realpath canonical path for a symlinked, dot-segmented spelling of the same directory
    - observes exactly the device and inode fs.stat reports for that canonical path
    - binds a freshly created workspace to its observed identity at untrusted, with no grantor
    - refuses a trust upgrade authored by a non-host principal, leaving the workspace untrusted
    - …共 9 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 14 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - offers the model neither the clone's executable skills nor its instructions while the workspace is untrusted
    - offers the model both the clone's executable skills and its instructions once that same clone is granted trusted-execute
    - discovers only the host-owned user-global instructions while the workspace is untrusted
    - discovers the project instructions once the workspace reaches trusted-read, alongside the host-owned ones
    - …共 14 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 8 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - must[2]: downgradeTrust refuses a raising target, so acceptance[2] entry point can never grant trusted-execute with no host principal and no
    - must[2]: downgradeTrust refuses a raising target even when the presented record still carries a grantor from an earlier grant
    - must[2]: requestTrustUpgrade refuses a lowering target instead of reporting an upgrade and writing an audit record for a demotion
    - must[2]: a refused trust upgrade returns neither a record nor an audit entry, for every refusal reason
    - …共 8 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **fs.realpath + fs.stat ino/dev** — realpathNormalize already exists in packages/workspace/workspace/src/paths.ts
**只读参考(reference)**:
- microsoft/vscode — Design reference only
**标准(绑定词汇)**:VS Code Workspace Trust model (untrustedWorkspaces supported true\|false\|limited, restrictedConfigurations)  · git safe.directory ownership check
**自己写(residual)**:State machine untrusted\|trusted-read\|trusted-execute bound to realpath+inode/dev, gating at load sites (agent-instructions, hooks, MCP, skills, profile patch overlays), audit on escalation, headless default untrusted, prompt-injection marking for trusted-read text.
**禁令/风险(risk)**:Trust state alone does not satisfy acceptance[0] — also depends on P1-04 (--ignore-scripts) and P1-06; add a manifest v2 workspaceTrust field.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- hol-guard 514★ 覆盖≈20% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：External wrapper/hook model, not an in-harness workspace state machine (untrusted \| trusted-read \| trusted-execute) bound to canonical realpath + inode/volume identity; no dsh adapter at all
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK

#### P1-08 · 插件 ABI、Capability 与 Schema 兼容协商

`ABI/capability/schema compat solver` · L2_PROVIDER · **PROVIDER_ADAPT + PROVIDER_WRITE** · 可省 20% · 状态 **ACCEPTED (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] manifest 声明 runtime API range、schema ranges、required/optional capabilities、provider constraints。
- must[1] boot 前求解整个插件图
- must[2] 冲突时输出最小 unsat core。
- must[3] 禁止靠 try/catch 静默降级安全能力。
- acceptance[0] 兼容图可确定性求解，同一输入产生同一 load plan。
- acceptance[1] 缺少必需 capability 或 major schema 不匹配时不执行插件代码。
- acceptance[2] 可选 capability 缺失时只禁用对应功能并明确展示。
- validation[0] 构造 diamond dependency、版本冲突、optional provider 三类图。
- validation[1] 运行 solver property tests。
- validation[2] 将结果写入 `--dump-config` 和 plugin inventory。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-06 P1-01
- files:[B] `packages/boot/app-boot/src/profile.ts` · [B] `packages/host/plugin-inventory/src/types.ts` · [P] `packages/schema/schema-registry/src/index.ts` · [N] `packages/plugin/plugin-compat/src/index.ts` · [N] `packages/plugin/plugin-compat/src/solver.ts` · [N] `packages/plugin/plugin-compat/tests/solver.spec.ts`
- stages:C:3 文件 · P:2 文件 · U:2 文件 · F:1 文件
- realTask:E1 S10
- gate:Only a unique solved lock/ABI/schema/capability plan activates; S10.
- rollback:A/K — retain previous solved activation plan; incompatible candidate stays inactive.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 9 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - must[0]: a manifest declaring runtime API range, schema ranges, a satisfied required capability, and a satisfied requires-provider constrain
    - must[0]: an excludes-provider constraint still resolves active when a different provider of the same capability remains eligible
    - must[1]: solving three independent manifests in one call resolves all three together, not one plugin at a time
    - must[2]: a direct requires-provider vs. excludes-provider contradiction over the graph's only provider yields a minimal unsat core, excludin
    - …共 9 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 16 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - resolves one registeredSchemaVersions entry per live registration, at that registration's current version
    - reads the registry rather than a mirrored list: a schemaId the real registry bootstraps resolves to its registered version, and one it never
    - carries the caller's runtime API version through unchanged — the schema registry contributes no runtime API fact
    - a manifest whose schema range covers the real registry's registered major resolves active against the resolved host context
    - …共 16 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 12 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - mounts the healthy bundle and never the blocked one, and says why on stderr
    - reads runtime API range, schema ranges, required/optional capabilities, and provider constraints from a real package.json
    - returns undefined for a bundle package that declares no dsh.compat -- no declaration is not a constraint
    - must[3]: a malformed dsh.compat fails loud rather than degrading to unconstrained
    - …共 12 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 15 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - fault[A]: two manifests sharing a pluginId fail loud, naming the duplicated id, rather than producing an order-dependent plan
    - fault[A]: the provider stage inherits the same rejection, so no cascade ever runs over a graph with an ambiguous plugin identity
    - fault[B]: a single manifest declaring both requires-provider and excludes-provider on the same sole provider is blocked alone, leaving the g
    - fault[B]: an unrelated healthy plugin still receives an activation when another manifest contradicts itself — an incompatible candidate stay
    - …共 15 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **npm/node-semver**(npm `semver` · ISC · 5,460★) — 7.8.5: validRange/satisfies/intersects/minVersion range algebra
- **dubzzz/fast-check**(npm `fast-check` · MIT) — Already devDep; property tests for the solver
- **packages/schema/schema-registry (existing)** — SchemaVersion majors
**不用(reject,理由)**:
- Z3Prover/z3 — 5.2.0, 35.8 MB unpacked WASM for a ≤100-node graph
**自己写(residual)**:Manifest fields (runtime API range, schema ranges, required/optional caps, provider constraints), backtracking solver + conflict set (~250 lines), load-plan determinism, --dump-config/inventory output, no-silent-degrade rule.
**禁令/风险(risk)**:Keep solver tiny and property-tested; unsat core via explicit conflict-set tracking, not a SAT engine.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-web-plugin-manager 67★ 覆盖≈20% [topic-sweep] — bundle·进程内·无 key \| 缺口：No manifest-declared runtime API range / schema ranges / required-optional capabilities, no graph solver before boot, no minimal unsat core, no load plan, does not gate plugin code execution
- dsh-plugin-mall 5★ 覆盖≈15% — Browse-time compat badges (peer/Node/OS ranges, loader-id collisions, patch composition over 300 combos) — heuristics, no graph solving
- dsh-plugin-integration 11★ 覆盖≈15% — Overlap/compat detection heuristics
- upstream-radar 9★ 覆盖≈15% — Compat IR (imports newer DSH package than peer range allows, package.json↔lockfile drift)
**裁决叠加(整改令)**:
- §7.1 已验收核验:设计偏离记录(R7):整数 API level 而非 semver
- §7.2 R7:整数 API level / 手排 fingerprint 记录不改;P8-07 若需 Python 复算 fingerprint 则换 JCS

#### P1-09 · Service/Tool/Event 命名空间与所有权冲突检测

`Namespace ownership & collision` · L3_CONSUMER · **CONSUMER_WRITE + QUALIFICATION_REUSE** · 可省 0% · 状态 **ACCEPTED (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 所有注册带 PluginIdentity、namespace、stable capability id 和 ownership token。
- must[1] 官方保留 namespace 不可被第三方声明
- must[2] 覆盖必须显式 replace contract 且经 policy。
- must[3] 卸载只撤销与 ownership token 匹配的 effects。
- acceptance[0] 同名工具、跨插件撤销、加载顺序攻击均 fail closed。
- acceptance[1] 允许合法 provider replacement，但 Inventory 显示 replaced/replacing chain。
- acceptance[2] 动态 Cordis 定义同样受规则约束。
- validation[0] 运行 two-plugin collision fixture。
- validation[1] 随机化加载/卸载顺序 1000 次，最终注册表一致。
- validation[2] 验证未授权插件不能注册 `dsh.*` 保留 namespace。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-03 P1-01
- files:[B] `packages/core/tools/src/index.ts` · [B] `packages/extensions/cordis-host-runner/src/registry.ts` · [B] `packages/extensions/cordis-host-runner/src/lifecycle.ts` · [B] `packages/host/plugin-inventory/src/index.ts` · [N] `packages/plugin/plugin-ownership/src/index.ts` · [N] `packages/plugin/plugin-ownership/src/types.ts` · [N] `packages/plugin/plugin-ownership/tests/ownership.spec.ts`
- stages:C:3 文件 · P:0 文件 · U:4 文件 · F:1 文件
- realTask:E1 S10
- gate:Collision rejected before activation; commands/services/events/process/grants after unload = 0; S10.
- rollback:K/A — unload candidate owner; canonical Cordis lifecycle remains truth.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 13 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - must[0]: a successful capability claim carries PluginIdentity, namespace, stable capability id, and a minted ownership token
    - must[1]: an unofficial plugin cannot claim a capability inside the dsh.* reserved namespace
    - must[1]: an unofficial plugin cannot claim a capability inside a dotted sub-namespace under the dsh.* reserved root
    - must[2]: an explicit replace contract fails closed when policy does not authorize replacement
    - …共 13 条(分布在 1 个冻结条目),见 command-freeze.json
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:1 条有效冻结 / 25 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - must[0]: an admitted registration carries plugin identity, namespace, capability id, and a minted ownership token
    - must[1]/validation[2]: an unofficial plugin cannot register a tool in the reserved dsh.* namespace
    - must[1]: an official plugin named by policy may register in the reserved dsh.* namespace
    - acceptance[0]: a SECOND plugin claiming an owned tool name is denied for ownership, not by the legacy duplicate check
    - …共 25 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 9 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - must[1]/must[2]: an unofficial plugin cannot take a reserved dsh.* capability through a replace contract, even when policy allows replacemen
    - must[1]: an official plugin may still replace its own reserved dsh.* capability, so the refusal is scoped to third parties
    - must[1] outranks policy: a third party is told namespace-reserved, not replace-not-authorized, when replacement is ALSO disallowed
    - must[1] outranks collision: a third party claiming a reserved capability id the official plugin ALREADY owns is refused namespace-reserved,
    - …共 9 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT) — 1000 randomized load/unload orders
**标准(绑定词汇)**:npm scope = publisher identity (reserve dsh.*/@deepseek-ai/*)  · VS Code publisher.name id convention
**自己写(residual)**:Add PluginIdentity/namespace/ownership token (P2-02 capability token) to packages/core/tools + cordis-host-runner/registry.ts, replace-contract policy, inventory replaced/replacing chain; Cordis fibers already scope disposal.
**禁令/风险(risk)**:Pure dsh wiring; the only reuse is the property-test harness.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-web-plugin-manager 67★ 覆盖≈25% [topic-sweep] — bundle·进程内·无 key \| 缺口：Post-hoc static detection only (README admits dynamic names are missed); no PluginIdentity/namespace/ownership token at registration, no reserved official namespaces, no explicit replace con
- dshscan 10★ 覆盖≈10% — R015 'builtin tool shadow hijack' detection heuristic
- dsh-plugin-mall 5★ 覆盖≈10% — Host-module shadowing / loader-id collision preflight
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK;保留 scope 词汇债(轻)

#### P1-10 · 插件数据迁移、升级事务与回滚

`Plugin data migrations & rollback` · L2_PROVIDER · **PROVIDER_WRITE + PROVIDER_ADAPT** · 可省 15% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] manifest 声明 migration DAG、preconditions、backup strategy、rollback support。
- must[1] 升级过程：freeze plugin → snapshot data/config → migrate in quarantine → validate → atomic switch → health check。
- must[2] 不可逆 migration 必须人工批准并提供 export。
- acceptance[0] 在每个迁移步骤注入 crash，重启后要么旧版完整可用，要么新版完整可用，不出现混合状态。
- acceptance[1] 数据 digest 和 schema version 可对账。
- acceptance[2] 失败升级不改变已批准权限。
- validation[0] 运行 N-step migration fault campaign。
- validation[1] 测试 downgrade、skip version、concurrent update。
- validation[2] 把 rollback evidence 加入升级结果。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P1-03 P4-12
- files:[B] `apps/cli/src/plugin.ts` · [B] `packages/storage/storage/src/backend.ts` · [B] `packages/storage/storage/src/registry.ts` · [B] `packages/settings/settings/src/index.ts` · [N] `packages/plugin/plugin-migrations/src/index.ts` · [N] `packages/plugin/plugin-migrations/src/types.ts` · [N] `packages/plugin/plugin-migrations/src/transaction.ts` · [N] `packages/plugin/plugin-migrations/tests/rollback.e2e.ts`
- stages:C:3 文件 · P:3 文件 · U:2 文件 · F:2 文件
- realTask:E1 S10
- gate:Failed upgrade can boot old plugin and data; migration is Action-ledgered; S10.
- rollback:D/X — fence writes, restore backup and prior lock, compensate logged effects.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **node:sqlite / VACUUM INTO** — Snapshots on Node 24 (verified)
**可选(optional,不进依赖不进 CI)**:
- sequelize/umzug — 3.8.3 storage-agnostic up/down runner, custom storage, pending/executed (~15%); linear model may not be worth the dep if a DAG runner is written anyway
**不用(reject,理由)**:
- kysely-org/kysely — 0.29.4 SQL-only migrator
- dbos-inc/dbos-transact-ts — 4.27.6 needs Postgres
- restatedev/restate — Needs a server
**自己写(residual)**:Migration DAG + preconditions in manifest, freeze→snapshot→migrate-in-quarantine→validate→atomic-switch→health, irreversible-migration approval + export, crash-injection campaign, digest reconciliation; storage-sqlite currently has no migrations at all.
**禁令/风险(risk)**:Local-only constraint kills durable-execution engines; decide at design whether umzug's linear model earns the dep.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-backup 15★ 覆盖≈25% — Pre-upgrade snapshots on host version change, sha256 verify, auto-rollback, corrupt-log quarantine — snapshot/rollback half, no migrations
- dsh-toolbox 30★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Transacts only the profile manifest bundle order (dsh.profile.bundles) and patch file, not plugin data; no manifest-declared migration DAG/preconditions/backup strategy; no freeze->snapshot
- dsh-config-manager 63★ — Config backup/export/migrate
**裁决叠加(整改令)**:
- §9.2 生态迁移目标:≥5 个快照/回滚实现互相竞争——区分工作区检查点与执行世界快照,P3-11 只做后者

#### P1-11 · 把动态 Cordis 自修改改成 Extension Proposal Pipeline

`Extension Proposal Pipeline (replace live cordis self-modification)` · L2_PROVIDER · **CONSUMER_WRITE + REUSE_UPSTREAM** · 可省 10% · 状态 **NOT_RUN (W10)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] `cordis_define/run` 在 production 改为生成 proposal artifact，不直接 mount。
- must[1] 流水线执行静态扫描、manifest 推断、隔离测试、权限 diff、签名、人工/策略批准、canary、promote。
- must[2] 定义持久化、版本化
- must[3] rollback 时恢复前一版本。
- acceptance[0] 模型无法绕过 proposal 直接访问 host Context。
- acceptance[1] 无人浏览器连接时不无限悬挂
- acceptance[2] 所有 stage 有 deadline 和 durable state。
- acceptance[3] 未批准 proposal 不出现在 active registry。
- validation[0] 运行恶意 extension corpus：host helper escape、async timeout、network/secret access。
- validation[1] kill 每个 pipeline stage 后恢复。
- validation[2] 验证 promote 后与普通签名插件拥有同一治理语义。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P1-05 P1-06 P2-06 P3-01
- files:[B] `packages/extensions/tool-cordis/src/index.ts` · [B] `packages/extensions/tool-cordis/src/inspect.ts` · [B] `packages/extensions/tool-cordis/src/providers.ts` · [B] `packages/extensions/cordis-host-runner/src/index.ts` · [B] `packages/extensions/cordis-host-runner/src/guard.ts` · [B] `packages/extensions/cordis-host-runner/src/sandbox.ts` · [B] `packages/extensions/cordis-host-runner/src/registry.ts` · [N] `packages/extensions/extension-proposal/src/index.ts` · [N] `packages/extensions/extension-proposal/src/types.ts` · [N] `packages/extensions/extension-proposal/src/pipeline.ts` · [N] `packages/extensions/extension-proposal/tests/pipeline.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:5 文件 · F:2 文件
- realTask:E1 S10 S12
- gate:Proposer cannot be sole approver/verifier; every activation comes from signed approved verdict; S10/S12.
- rollback:K/X — revoke candidate, unload process/effects, restore signed champion profile.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **packages/extensions/cordis-host-runner (existing)** — Approval queue (DynamicCordisPendingRequest), guard façade, node:vm sandbox, inspect providers
**不用(reject,理由)**:
- temporalio/temporal — Server — violates local keyless
- restatedev/restate — Server
- inngest/inngest — Server
- dbos-inc/dbos-transact-ts — Postgres
- timgit/pg-boss — Postgres
- taskforcesh/bullmq — Redis
**标准(绑定词汇)**:in-toto Statement as the proposal artifact (subject = definition digest) (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:Proposal store, stage deadlines + durable state (storage-sqlite / jobs / agent-team task DAG CAS), canary, rollback to previous version, 'no browser → no hang'; stages compose P1-05/P1-02/P1-06/P2-06/P1-03.
**禁令/风险(risk)**:tool-cordis/cordis-host-runner are upstream hot zones → add a proposal stage before startHostHalf, don't rewrite the runner.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-harmony 17★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Zero governance: patches auto-apply at boot, no proposal artifact, scan, permission diff, signature, approval, canary, or stage deadlines; control plane is a local HTTP server with a bearer
- dsh-forge 覆盖≈0% — 'Runtime injector' — adjacent, not governance
- ybkk-AIOS 覆盖≈0% — 'Reviewed marketplace' — adjacent
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

#### P1-12 · 官方 Plugin Verifier 与市场信任等级

`Official verifier & trust levels` · L6_QUALIFICATION · **CONTRACT_WRITE + QUALIFICATION_REUSE** · 可省 25% · 状态 **NOT_RUN (W10)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义等级：discovered、metadata-checked、signed、sandbox-verified、official-reviewed。
- must[1] 发布 `dsh plugin verify`，输出 manifest、signature、SBOM、compat、scanner、isolation、tests 的独立报告。
- must[2] 市场只消费证明，不自行获得 kernel trust。
- acceptance[0] 任何等级都可解释具体通过/未通过项目，不能用模糊绿色徽章。
- acceptance[1] 证明绑定插件 digest，升级后自动失效。
- acceptance[2] 离线管理员可用组织 policy 选择最低等级。
- validation[0] 对 dsh-agent-teams、dsh-context 类代表插件跑 verifier，只报告实际证据，不默认背书。
- validation[1] 伪造旧报告对应新 tarball 必须失败。
- validation[2] 验证 market metadata 不可提升 runtime trust。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P1-01 P1-02 P1-05 P1-06
- files:[B] `apps/cli/src/plugin.ts` · [B] `packages/host/plugin-inventory/src/index.ts` · [B] `README.md` · [N] `apps/cli/src/plugin-verify.ts` · [N] `packages/plugin/plugin-certification/src/index.ts` · [N] `packages/plugin/plugin-certification/src/report.ts` · [N] `docs/plugins/trust-levels.md` · [N] `tests/plugin/certification.e2e.ts`
- stages:C:4 文件 · P:1 文件 · U:3 文件 · F:1 文件
- realTask:E1 S10
- gate:Scores cannot offset hard failure; version/signer change invalidates certificate; S10.
- rollback:K/Q — demote/quarantine version; retain signed report for audit.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **slsa-framework/slsa**(1,921★) — Level vocabulary
- **in-toto/attestation**(371★) — Subject digest binding → acceptance[1] is the standard's semantics
**可选(optional,不进依赖不进 CI)**:
- ossf/scorecard — Sidecar
- MicroMilo/upstream-radar — 0.45.0, 15,045 dl; compat evidence input
**标准(绑定词汇)**:SLSA levels (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · in-toto attestation bundle bound to package digest (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · SARIF sections  · OpenSSF Scorecard checks
**自己写(residual)**:Level policy (discovered → metadata-checked → signed → sandbox-verified → official-reviewed), offline org minimum-level policy, report signing, market-consumes-attestations rule; extend fixture-only dsh plugin verify to per-section digest-bound reports.
**禁令/风险(risk)**:Hosted attestation stores (Rekor, npm attestations endpoint) optional only; local = signed report file next to lock.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-marketplace 20★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No `dsh plugin verify` CLI and no per-plugin report bundle (manifest/signature/SBOM/compat/scanner/isolation/tests). Trust levels are effectively only 'discovered' and 'metadata-checked'; no
- upstream-radar 9★ 覆盖≈30% — inspect reviews an exact published artifact without executing; runtime proof matrix in disposable GitHub VMs (CI-only); versioned evidence ledger; no signature/scanner/isolation
- dsh-market 3,046★ — Natural consumer of levels, must never grant trust
- dshbase 覆盖≈0% — '实测可装' badge is exactly the vague badge acceptance[0] bans
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §7.2 R5:P1-02 未建的 SLSA provenance / 信任等级在本 epic 接(slsa-framework)

### P2 · 身份与权限(12 项)

#### P2-01 · 统一 Principal / Tenant / Run / Actor 身份上下文

`Unified Principal / Tenant / Run / Actor identity context` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 5% · 状态 **ACCEPTED (W3)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 UserPrincipal、ServicePrincipal、AgentPrincipal、TenantId、RunId、DelegationChain。
- must[1] 所有 SessionEvent envelope、ToolExecutionContext、SubagentRequest、SDK request 加 identity references。
- must[2] 禁止从可编辑 prompt 文本推断权限身份。
- acceptance[0] 任何 action 都能追溯 root user/tenant 与完整委托链。
- acceptance[1] 跨租户 ID 混用在类型验证和 runtime policy 两层被拒绝。
- acceptance[2] 匿名开发模式有独立受限 principal，不等价管理员。
- validation[0] 运行 tenant-confusion、forged-agent-id、replay-old-token 测试。
- validation[1] 检查所有新增事件的 identity 字段被持久化并 replay。
- validation[2] 静态扫描禁止 tool provider 自己创建管理员 principal。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-02 P0-06
- files:[B] `packages/core/agent/src/types.ts` · [B] `packages/core/agent/src/runtime-types.ts` · [B] `packages/core/session/src/types.ts` · [B] `packages/core/agent-loop/src/runtime-context.ts` · [B] `packages/sdk/protocol/src/types.ts` · [N] `packages/identity/principal/src/index.ts` · [N] `packages/identity/principal/src/types.ts` · [N] `packages/identity/principal/src/chain.ts` · [N] `packages/identity/principal/tests/identity.spec.ts`
- stages:C:5 文件 · P:2 文件 · U:3 文件 · F:2 文件
- realTask:E2 S11
- gate:Admin is explicit capability; request tenant equals authenticated tenant; durable replay rejection; S11.
- rollback:K/R — revoke issuer/epoch and disable consumers; never fall back to caller strings.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 47 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - brands a raw string as a TenantId without changing its value
    - brands a raw string as a RunId without changing its value
    - brands a raw string as a PrincipalId without changing its value
    - creates a non-admin user principal with no adminGrant field
    - …共 47 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 5 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - accepts a live identity whose actual tenant matches the request-claimed tenant
    - rejects a live identity whose actual tenant differs from the request-claimed tenant, throwing TenantMismatchError
    - checks the tenant of the chain's currently-acting principal, not necessarily the root, for a delegated identity
    - rejects cross-tenant confusion at the runtime-policy layer even when the identity's own chain construction never saw a mismatch -- proving t
    - …共 5 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 37 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - a fresh session with a supplied identity attaches it and durably logs it exactly once
    - a session with no supplied identity attaches nothing and logs nothing
    - a session seeded with an already-recorded identity re-supplied at the same tenant attaches it without re-logging
    - a session seeded with an already-recorded identity rejects a re-supplied cross-tenant identity via the runtime-policy layer (registry P2-01
    - …共 37 条(分布在 1 个冻结条目),见 command-freeze.json
- F:2 条有效冻结 / 9 个具名用例 / 变异证明 1/2 / 格子 GREEN · 有 supplement
    - fails closed with a clear Error, not an opaque crash, when supplied.chain has no entries (malformed/replayed data bypassing createChain/exte
    - fails closed with a clear Error, not an opaque crash, when recorded.chain (session-log replay) has no entries
    - rootPrincipal throws a clear Error, not TypeError: Cannot read properties of undefined, for a chain with no entries
    - currentPrincipal throws a clear Error, not the opaque Array.prototype.reduce TypeError, for a chain with no entries
    - …共 9 条(分布在 2 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **spiffe/spiffe**(Apache-2.0 · 1,843★) — Id format only, no JS lib needed
**不用(reject,理由)**:
- w3c/did-core — DIDs add key-resolution machinery a local harness does not need
- decentralized-identity/did-jwt — 8.0.18; same reason
**标准(绑定词汇)**:SPIFFE ID URI for principal ids (本 epic 未采用/不采用;所有者 P3-09,见裁决叠加) · RFC 8693 act nesting for delegation chain  · OTel semconv enduser.id/service.name (本 epic 未采用/不采用;所有者 npm @opentelemetry/semantic-conventions,见裁决叠加)
**自己写(residual)**:Attach IdentityContext refs to ToolExecutionContext, SubagentRequest, SDK request/SessionEvent envelope; runtime tenant check at the PEP; static scan forbidding createAdmin*Principal outside identity/boot.
**禁令/风险(risk)**:None from OSS; ~80% already written fork-side in packages/identity/principal (1,614 lines incl. tests).
**planError**:Plan lists packages/identity/principal/src/{index,types,chain}.ts as new — they exist; re-scope to the wiring gap.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-awiki 14★ 覆盖≈15% — ANP/DID identities for agent-to-agent messaging — network identity, not harness principal (<15%)
- @xgone/dsh-remote 54★ 覆盖≈15% — Web-login users/roles at the HTTP gateway, not on any Cordis seam (<15%)
- dsh-passwords 40★ 覆盖≈15% — Gateway-level; GPL blocks adoption (<15%)
**裁决叠加(整改令)**:
- §7.1 已验收核验:词汇债(R3):SPIFFE/RFC 8693/enduser.id 全 0 → P8-06 / P7-07
- §7.10:planError(files 已存在,缩到接线缺口)——已按缺口验收;residual 的 IdentityContext 接线归 P2-05 PEP 与 P5-05

#### P2-02 · 可衰减 Capability Token 与子 Agent 委托

`Attenuable capability tokens + subagent delegation` · L2_PROVIDER · **PROVIDER_ADAPT** · 可省 60-70% · 状态 **NOT_RUN (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] token 包含 subject、tenant、capability、verbs、resources、constraints、expiry、nonce、delegationDepth、parent digest。
- must[1] TrustKernel 签发/验证
- must[2] 普通代码只能 attenuate，不能扩大。
- must[3] 工具、插件 RPC、外部 Agent、ExecutionWorld 均要求 token。
- acceptance[0] 子 token 的资源/verb/金额/时间范围永不大于父 token。
- acceptance[1] 撤销父 token 立即使所有 descendants 失效。
- acceptance[2] token 不写入模型可见文本、日志只记录 digest 和安全元数据。
- validation[0] property-based 测试随机衰减链 10,000 次。
- validation[1] 测试过期、重放、跨租户、扩大范围、签名篡改。
- validation[2] 子 Agent 尝试请求父级未拥有权限时必须 fail closed。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-01
- files:[B] `packages/core/agent-loop/src/runtime-context.ts` · [B] `packages/core/tools/src/index.ts` · [B] `packages/subagent/subagent/src/child-agent.ts` · [B] `packages/subagent/subagent/src/descriptor.ts` · [P] `packages/kernel/trust-kernel/src/types.ts` · [N] `packages/policy/capability-token/src/index.ts` · [N] `packages/policy/capability-token/src/types.ts` · [N] `packages/policy/capability-token/src/attenuate.ts` · [N] `packages/policy/capability-token/tests/token.spec.ts`
- stages:C:5 文件 · P:2 文件 · U:3 文件 · F:2 文件
- realTask:E2 S03 S11
- gate:Every child scope/budget/expiry/world/resource is an intersection; kernel is sole verifier; S03/S11.
- rollback:K — revoke epoch and stop delegation; never accept unsigned legacy tokens.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 36 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - issueToken mints a root token with exactly these ten fields, no more and no fewer
    - verifyToken accepts a token issued by the real TrustKernel under the same trust root
    - verifyToken rejects a token whose signature does not match its claimed content (tampered)
    - verifyToken accepts a token one millisecond before it expires
    - …共 36 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 23 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - reports an empty state for a path that has never been written to, rather than failing
    - reads back through a separate store instance exactly what the first instance wrote, signature bytes included
    - reconstructs a grandchild's full root-first digest chain by walking recorded parentDigest hops
    - reconstructs a root token's lineage as exactly its own single digest
    - …共 23 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 18 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - must[3]: a scope requiring a capability token refuses a call that presents none, before the tool body runs
    - control: the same call succeeds and reaches the tool body when an authorizing token is presented
    - must[3]: a token that does not name the called tool among its resources is refused
    - must[3]: a token lacking the tool-invocation verb is refused even for a tool it names
    - …共 18 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 19 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - P2-02 Fault — attenuation boundary matrix enumerates at least twelve boundaries, each named once
    - P2-02 Fault — attenuation boundary matrix fault boundary 01 an equal-to-parent request is admitted, so refusals below are selective
    - P2-02 Fault — attenuation boundary matrix fault boundary 02 a narrowed verb set is admitted
    - P2-02 Fault — attenuation boundary matrix fault boundary 03 a verb the parent does not hold is refused
    - …共 19 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **eclipse-biscuit/biscuit**(Apache-2.0 · 1,143★) — Spec, push 2025-10-21 **⟶ 裁决取代:§3:Biscuit 降为 optional;attenuation 在 Fiber Option A 后由 kernel 签名 capability token 自写**
- **eclipse-biscuit/biscuit-rust**(249★) — Core, push 2026-08-17 **⟶ 裁决取代:§3:同上**
- **eclipse-biscuit/biscuit-wasm**(npm `@biscuit-auth/biscuit-wasm` · Apache-2.0 · 29★) — 0.6.0, 2.5 MB, node>=22, ESM-only; verified locally: attenuation-by-construction, per-block revocation ids, authorizer denies write on read-only child **⟶ 裁决取代:§3:同上**
**不用(reject,理由)**:
- ucan-wg/spec — UCAN: @ucanto/core 10.4.6 pulls IPLD/CAR/multiformats/DIDs; ts-ucan stale 2024-03
- storacha/ucanto — Drags IPLD/CAR/multiformats + DID principals
- ucan-wg/ts-ucan — Stale 2024-03, npm last 2022-12
- go-macaroon/js-macaroon — Stale 2022-04; HMAC chain — any verifier holds the mint key
- nitram509/macaroons.js — 2024-12; symmetric-key verification
- panva/jose (nested JWT) — 6.2.3; hand-rolled chains lose attenuation-by-construction
**自己写(residual)**:dsh fact vocabulary as Datalog facts+checks (~150–250 LOC), revocation-id store + propagation (sqlite), TrustKernel root keypair behind signatureRoots, attachment to ToolRunContext/SubagentRequest/plugin RPC/ExecutionWorld, digest-only logging, property tests.
**禁令/风险(risk)**:Node 22 launcher needs --experimental-wasm-modules via re-exec/NODE_OPTIONS or a byte-instantiation loader (~1 day); small JS-binding community (29★) but Eclipse-governed core; keep behind ctx.capabilityTokens so the format is swappable.
**裁决叠加(整改令)**:
- §3 账本判定已被事实超越:Biscuit 的 attenuation 在 Fiber Option A 之后由 kernel 签名的 capability token 自写(锁在 Fiber);Biscuit 降为 optional
- §10 L2:四格全绿上锁——解锁 = §3.5 SLICE-fiber-A(vendored Cordis Fiber.store,Option A)+ §10.3-3 内核 signatureRoots 每安装 Ed25519 密钥对 → must[1] supersession 用例;同时解锁 P2-05 内核执行点

#### P2-03 · 一等公民 ActionManifest

`First-class ActionManifest` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 25% · 状态 **NOT_RUN (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 字段包含 actionId/runId/actor/capability/target/argumentsHash/sideEffectClass/idempotencyKey/preconditions/expectedDiff/compensation/evidence requirements。
- must[1] 所有执行路径先生成并 durable append manifest，再做 policy/approval。
- must[2] code-mode 内嵌工具不能绕过。
- acceptance[0] 任何外部写操作在事件日志中都存在先于执行的 ActionManifest。
- acceptance[1] 参数规范化稳定，语义相同对象得到相同 hash。
- acceptance[2] 无法分类副作用的动作默认高风险并要求审批。
- validation[0] instrument 所有 tool providers，故意创建 bypass path，测试必须失败。
- validation[1] 重放日志验证 manifest→decision→execution→result 完整配对。
- validation[2] canonicalizer 遵循 RFC 8785（JCS）——key 顺序、数字拼写、JSON 转义拼写不同的同一 JSON 值得到相同 hash，而不同 code point 序列（含 NFC 与 NFD）是不同值必须得到不同 hash，fuzz 覆盖以上四类。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-06 P2-01
- files:[B] `packages/core/tools/src/types.ts` · [B] `packages/core/tools/src/index.ts` · [B] `packages/core/tools/src/ptc.ts` · [B] `packages/core/agent-loop/src/tool-calls.ts` · [B] `packages/core/session/src/known-event-types.ts` · [N] `packages/action/action-manifest/src/index.ts` · [N] `packages/action/action-manifest/src/types.ts` · [N] `packages/action/action-manifest/src/canonicalize.ts` · [N] `packages/action/action-manifest/tests/manifest.spec.ts`
- stages:C:5 文件 · P:0 文件 · U:5 文件 · F:2 文件
- realTask:E2 S03 S11
- gate:Every tool/process/network/secret/activation call carries the same digest through later PEPs; S03/S11.
- rollback:K/A — disable new consumers, retain manifest codec/events for replay.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 18 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - P2-03 Contract — must clauses must[0]: a constructed manifest carries actionId/runId/actor/capability/target/argumentsHash/sideEffectClass/i
    - P2-03 Contract — must clauses must[1]: an execution attempt with no manifest appended for its actionId is refused before any policy/approval
    - P2-03 Contract — must clauses must[2]: a code-mode embedded sub-dispatch is admitted when its manifest precedes it, and refused exactly like
    - P2-03 Contract — must clauses must[2]: a plugin RPC call is admitted when its manifest precedes it, and refused exactly like a native call w
    - …共 18 条(分布在 1 个冻结条目),见 command-freeze.json
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:2 条有效冻结 / 9 个具名用例 / 变异证明 2/2 / 格子 NOT_RUN · 有 supplement
    - P2-03 — every appended manifest carries its own position the first manifest is 1, and a second call in the same session is 2
    - P2-03 — every appended manifest carries its own position a manifest precedes the tool/call it describes, which is what the position is for
    - P2-03 Usage — every dispatched call is preceded by its own manifest acceptance[0]: three calls in one turn produce three manifest-then-call
    - P2-03 Usage — every dispatched call is preceded by its own manifest acceptance[0]: each manifest names the actionId of the call that follows
    - …共 9 条(分布在 2 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 4 个具名用例 / 变异证明 1/1 / 格子 NOT_RUN · 有 supersede
    - P2-03 Fault — validation[2]: fuzzing the canonicalizer for hash confusion key order never changes the hash, over generated values rather tha
    - P2-03 Fault — validation[2]: fuzzing the canonicalizer for hash confusion SECURITY: NFD and NFC never share a hash, over generated strings t
    - P2-03 Fault — validation[2]: fuzzing the canonicalizer for hash confusion two values that differ do NOT collide, which is the half a constan
    - P2-03 Fault — validation[2]: fuzzing the canonicalizer for hash confusion a key containing the separator does not collide with a value spell
**用(adapt)**:
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0 ESM, 17 KB, RFC 8785 reference-conformant — deletes canonicalize.ts and its fuzz surface **⟶ 裁决取代:§7.8:不换库、不删 canonicalize.ts;保留迭代实现(库全递归,depth 5000 溢出)、删 NFC;canonicalize@2.1.0 进 devDependencies 作差分 oracle**
- **in-toto/attestation**(371★) — Statement {_type, subject[], predicateType, predicate} envelope
- **openid/authzen**(156★) — Authorization API 1.0 + MCP profile mapping tools/call into subject/action/resource
- **modelcontextprotocol spec**(npm `@modelcontextprotocol/sdk` · 9,112★) — ToolAnnotations (readOnlyHint/destructiveHint/idempotentHint/openWorldHint) already in installed sdk
**只读参考(reference)**:
- cyberphone/json-canonicalization — Java reference impl
**标准(绑定词汇)**:RFC 8785 JCS (**本 epic 是形状所有者**) · in-toto Statement envelope (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · MCP ToolAnnotations as side-effect hint input (本 epic 未采用/不采用;所有者 P2-04,见裁决叠加) · AuthZEN subject/action/resource/context (+ MCP profile / COAZ-MCP binding) (本 epic 未采用/不采用;所有者 P2-05,见裁决叠加)
**自己写(residual)**:Manifest type (actionId/runId/actor/capability/target/argumentsHash/sideEffectClass/idempotencyKey/preconditions/expectedDiff/compensation/evidence), durable append before tools/pre-execute at prepareExecution (~line 1450), code-mode/PTC and plugin-RPC coverage, replay pairing test.
**禁令/风险(risk)**:JCS forbids non-finite numbers and big ints — define the argument value domain (JSON only) explicitly; do not write a second canonicalizer.
**planError**:Today the tools/pre-execute waterfall runs before any durable record.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-permission-rules 102★ 覆盖≈0% — src/call-id.ts binds decisions to call ids; not a manifest
**裁决叠加(整改令)**:
- §2.F 已解决(durable append 先于 pre-execute);§7.4/§7.5/§7.6/§7.8 R2:保留迭代 canonicalizer、删 NFC、canonicalize@2.1.0 作 devDep 差分 oracle、validation[2] 重述、C+F supersede 重观测
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §7.11:MCP ToolAnnotations / AuthZEN 不采用——registry must[0] 定死字段名,这不是词汇债;所有权顺延 P2-04 / P2-05

#### P2-04 · 通用副作用与风险分类体系

`Universal side-effect & risk taxonomy` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 10-15% · 状态 **NOT_RUN (W5)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 read、local-reversible、internal-write、external-communication、destructive、financial、security-sensitive、safety-critical。
- must[1] 允许插件声明 domain tags，但最终映射必须由组织 policy 决定。
- must[2] 分类输出置信度和依据
- must[3] 未知默认为更高等级。
- acceptance[0] 同一动作分类跨 CLI/Web/SDK 一致。
- acceptance[1] 插件不能自行把高风险动作降级。
- acceptance[2] 组织可覆盖阈值但不能关闭 kernel hard-deny 类。
- validation[0] 建立 200 个通用动作 fixture，不依赖某个垂直 Agent。
- validation[1] 测试模糊/嵌套/批量动作取最高风险。
- validation[2] 运行 adversarial description 测试，确认不根据工具自述盲信。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-03
- files:[B] `packages/interaction/permission-presets/src/types.ts` · [B] `packages/core/tools/src/types.ts` · [P] `packages/action/action-manifest/src/types.ts` · [N] `packages/policy/risk-taxonomy/src/index.ts` · [N] `packages/policy/risk-taxonomy/src/types.ts` · [N] `packages/policy/risk-taxonomy/src/classify.ts` · [N] `packages/policy/risk-taxonomy/tests/classify.spec.ts`
- stages:C:4 文件 · P:1 文件 · U:2 文件 · F:1 文件
- realTask:E2 S03 S05 S06 S11
- gate:Unknown action is highest risk; organization floor only tightens; S03/S05/S06/S11.
- rollback:K/A — disable new classifier and deny unknown actions; never fall back to tool-name allowlists.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **OWASP/www-project-top-10-for-large-language-model-applications**(1,383★) — Tag vocabulary, not code
- **mitre-atlas/atlas-data**(179★) — Tag vocabulary (AML.T00xx), data only
- **@modelcontextprotocol/sdk ToolAnnotations**(npm `@modelcontextprotocol/sdk`) — 4 hints map onto the 8 classes as inputs, never trusted outputs
**标准(绑定词汇)**:MCP ToolAnnotations (**本 epic 是形状所有者**) · P1-01 SideEffectClass  · OWASP LLM Top-10 2025 (LLM06 Excessive Agency)  · MITRE ATLAS technique ids
**自己写(residual)**:Classifier with confidence+evidence, org policy override table with kernel hard-deny floor, unknown → higher class, 200-fixture corpus, mapping table from P1-01's 6 classes to the epic's 8.
**禁令/风险(risk)**:No OSS 'action risk classifier' exists for tool calls; LLM-based classification is deliberately not the answer (adversarial descriptions).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-auto-mode 146★ 覆盖≈30% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No formal class enum (read/local-reversible/internal-write/external-communication/destructive/financial/security-sensitive/safety-critical), no numeric confidence, no plugin-declared domain
- dsh-permission-rules 102★ 覆盖≈23% — Built-in high-risk baseline + shell argv decomposition + network target extraction — seed for the fixture corpus (20–25% together with dsh-auto-approve)
- dsh-auto-approve 12★ 覆盖≈23% — Deterministic danger list (rm -rf, dd/mkfs, force-push, curl\|sh, destructive SQL, fork bombs)
**裁决叠加(整改令)**:
- §9:第一条按 §9 走的 epic——preFlight 含全部 community 缺口逐项对子句;§9.1 的 verify-make-vs-use 门在其 preFlight 前建好
- §7.11:MCP ToolAnnotations 形状所有者(P2-03 未采用,顺延)

#### P2-05 · Policy Decision Service 与单调拒绝

`Policy Decision Service + monotonic deny` · L2_PROVIDER · **PROVIDER_ADAPT** · 可省 50% · 状态 **NOT_RUN (W6)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Policy 输入为 identity、capability token、ActionManifest、ExecutionWorld、context facts
- must[1] 输出闭合 decision。
- must[2] decision 由 TrustKernel enforce，插件只能增加约束或建议，不能扩大。
- must[3] 记录 explain trace，但对模型和普通插件隐藏敏感策略细节。
- acceptance[0] 同一 ActionManifest 无论从工具、workflow、SDK、插件、子 Agent 发起都经过同一 PEP。
- acceptance[1] 任何一个 hard deny 即最终 deny。
- acceptance[2] Policy 服务不可被 Cordis replace/unmount。
- validation[0] 构造五条 bypass 路径和后置 allow 插件，全部拒绝。
- validation[1] 运行 policy order permutation 1000 次，结果不变。
- validation[2] 用 audit replay 重新计算 decision，结果一致或明确标记 policy version drift。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-02 P2-02 P2-03 P2-04
- files:[B] `packages/core/tools/src/index.ts` · [B] `packages/core/agent-loop/src/tool-calls.ts` · [B] `packages/extensions/cordis-host-runner/src/guard.ts` · [B] `packages/interaction/user-approval/src/index.ts` · [P] `packages/kernel/trust-kernel/src/index.ts` · [N] `packages/policy/policy-engine/src/index.ts` · [N] `packages/policy/policy-engine/src/types.ts` · [N] `packages/policy/policy-engine/src/evaluate.ts` · [N] `packages/policy/policy-engine/tests/monotonic.spec.ts`
- stages:C:5 文件 · P:1 文件 · U:4 文件 · F:2 文件
- realTask:E2 S03 S05 S06 S11
- gate:Provider crash, decode ambiguity, or lower-level allow cannot override deny; S03/S05/S06/S11.
- rollback:K — freeze at last signed policy snapshot; unknown/new actions deny.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **cedar-policy/cedar**(npm `@cedar-policy/cedar-wasm` · Apache-2.0 · 1,704★) — 4.12.0, 13 MB unpacked / 4.3 MB wasm, ESM + /nodejs CJS; verified locally: forbid overrides permit, default deny, matched-policy explain, no I/O, partial eval
**不用(reject,理由)**:
- open-policy-agent/opa — npm 1.10.0 last publish 2024-11 only evaluates wasm produced by the Go opa build CLI
- casbin/node-casbin — 5.51.1; matcher = expression strings, no schema validation, no formal semantics
- stalniy/casl — App-level abilities, no explain/validation
- osohq/oso — Library deprecated by vendor, last push 2025-02
- openfga/openfga — ReBAC server, wrong shape, violates local default
- authzed/spicedb — ReBAC server
- ory/keto — ReBAC server
**只读参考(reference)**:
- cedar-policy/cedar-spec — Lean proofs of the authorizer
**标准(绑定词汇)**:AuthZEN request/response vocabulary (**本 epic 是形状所有者**)
**自己写(residual)**:ctx.policy Service Definition decide(manifest, identity, token, world, facts), Cedar entity/schema design, PEP unification (prepareExecution + code-mode + workflow + SDK + subagent), kernel enforcement replacing the inert policyEnforcement body pinned like pinTrustKernel, plugin forbid-only API, version drift marking on replay, explain redaction.
**禁令/风险(risk)**:BLOCKED-011: vendored Cordis Fiber fix (Option A) is a documented hard prerequisite before wiring a real enforcement point; Cedar package is heavy (13 MB) and CJS-loaded — fine for host, not browser.
**planError**:P2-05 is gated on BLOCKED-011 which the wave-6 schedule does not show.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-permission-rules 102★ 覆盖≈30% — PEP-side ordered allow/deny/ask YAML on tools/pre-execute; first-match semantics (nearer user allow overrides baseline deny) → not monotonic; tools-only PEP; pins the seam
- dsh-auto-mode 146★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Inputs are raw ToolExecution, not identity/capability-token/ActionManifest/ExecutionWorld facts. Enforcement is an ordinary Cordis plugin, not TrustKernel: lifecycle.spec.ts proves disposing
**裁决叠加(整改令)**:
- §2.G 开工前设计决定已定(见该 epic 行)
- §3.1 共用引擎 Cedar(@cedar-policy/cedar-wasm 4.12.0)在 P2-05 开工前作为 infra slice 接入;本 epic 只写 adapter/PEP/explain
- §9.2 生态迁移目标:5 个权限插件挂 tools/pre-execute + approval answerer 链——PEP 坐该位置;现有 YAML 规则可作 policy source 导入;负用例:first-match 非单调(dsh-permission-rules)必须转换为 forbid > permit
- §7.11:AuthZEN 形状所有者(P2-03 字段由 registry must[0] 定,不采用 AuthZEN 名;顺延至此作 decide() 输入形状)
- §10:开工前置 = §3.1 Cedar slice + §3.5 SLICE-fiber-A(内核执行点);不等 P2-02 验收(predecessors 非机械门),但共用 Fiber A

#### P2-06 · 审批绑定完整规范化参数、资源与前置状态

`Approval bound to canonical args, resources, preconditions` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 5% · 状态 **NOT_RUN (W7)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] ApprovalRequest 引用 ActionManifest digest，并展示经脱敏的完整参数、资源、风险、预期 diff、有效期。
- must[1] 执行前重新验证 digest、preconditions、capability token 和 policy version。
- must[2] 任何字段变化使批准失效并生成新请求。
- acceptance[0] 审批后替换参数、切换账户、改变文件 inode/远端对象版本均不会执行。
- acceptance[1] 敏感值可 redacted 展示，但 hash 仍覆盖真实规范化值。
- acceptance[2] 批准事件与最终 action 形成一一引用。
- validation[0] 运行 TOCTOU、argument substitution、Unicode confusable、batch mutation 测试。
- validation[1] 测试 code-mode 嵌套调用同样绑定。
- validation[2] 审计查询能从 action 反查唯一 approval。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-03 P2-05
- files:[B] `packages/interaction/user-approval/src/types.ts` · [B] `packages/interaction/user-approval/src/index.ts` · [B] `packages/interaction/user-approval/tests/approval.spec.ts` · [B] `packages/core/agent-loop/src/tool-calls.ts` · [N] `packages/interaction/user-approval/src/canonical.ts` · [N] `packages/interaction/user-approval/src/preconditions.ts` · [N] `packages/interaction/user-approval/tests/argument-binding.spec.ts`
- stages:C:5 文件 · P:1 文件 · U:2 文件 · F:2 文件
- realTask:E2 S04 S05 S11
- gate:Any actor/resource/parameter/precondition/policy change invalidates approval; S04/S05/S11.
- rollback:K/X — cancel pending approvals; prepared actions remain blocked until re-approved.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — Digest = JCS(manifest) from P2-03 **⟶ 裁决取代:§1/§7.8:import P2-03 的 canonicalizeArguments,不接库**
- **@agentclientprotocol/sdk**(npm `@agentclientprotocol/sdk`) — 1.4.0 already installed; RequestPermissionRequest {sessionId, toolCall, options[]}
**标准(绑定词汇)**:ACP RequestPermissionRequest.toolCall as the wire projection (**本 epic 是形状所有者**)
**自己写(residual)**:Extend ApprovalRequest with manifest digest + redacted view + riskClass + expectedDiff + expiresAt, preconditions.ts (inode/mtime/etag/remote version capture and re-check), re-validate digest+token+policy version before dispatch, invalidate-on-change, one-to-one approval↔action audit link.
**禁令/风险(risk)**:TOCTOU/precondition semantics are dsh-specific; Unicode-confusable display via NFC + highlighting, hash stays over raw canonical value.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-auto-mode 146★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No ActionManifest digest or canonicalized-argument hash; binding is by string equality of reason/justification, not by hash over canonical args. Preconditions/inode identity are re-validated
- dsh-auto-review 129★ 覆盖≈10% — Caches verdicts by tool+arguments fingerprint, redacts args for reviewer — lives in the answerer, no pre-dispatch re-validation
- dsh-permission-rules 102★ 覆盖≈10% — Call-id binding in the answerer

#### P2-07 · 持久化、可跨 Turn/进程的 Approval Queue

`Durable cross-turn/cross-process approval queue` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 0-10% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Approval 状态 requested/approved/denied/expired/revoked/consumed
- must[1] 持久化 request digest、policy version、actor、deadline。
- must[2] workflow 可进入 `waiting_for_approval` 并释放 worker
- must[3] 批准后由 scheduler 唤醒。
- must[4] 多客户端订阅一致状态，消费用 compare-and-swap。
- acceptance[0] 进程在请求后、批准后、消费前任意崩溃，重启后状态正确。
- acceptance[1] 同一批准最多消费一次。
- acceptance[2] 过期/撤销批准永远不能执行。
- validation[0] 对每个状态转换注入 crash。
- validation[1] 并发两个客户端批准/拒绝，只有一个合法终态。
- validation[2] SDK reconnect 后能继续处理 pending approval。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-06 P4-01
- files:[B] `packages/interaction/user-approval/src/index.ts` · [B] `packages/interaction/user-approval/src/types.ts` · [B] `packages/session/session-persistence/src/coordinator.ts` · [B] `packages/sdk/protocol/src/types.ts` · [N] `packages/interaction/approval-store/src/index.ts` · [N] `packages/interaction/approval-store/src/types.ts` · [N] `packages/interaction/approval-store/src/sqlite.ts` · [N] `packages/interaction/approval-store/tests/recovery.e2e.ts`
- stages:C:3 文件 · P:3 文件 · U:2 文件 · F:2 文件
- realTask:E2 S04 S05 S11
- gate:Pending decisions recover in a new process and do not cross tenants; S04/S05/S11.
- rollback:D/X — stop dequeue, restore store/checkpoint; prepared actions stay blocked.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **openid/authzen access-request-approval profile**(156★) — State vocabulary + 'approval never is access, re-evaluate at enforcement'
- **node:sqlite** — CAS via UPDATE … WHERE state='approved' AND revision=? + changes()==1
**不用(reject,理由)**:
- restatedev/restate — Awakeables are exactly approval waits but needs a server; optional P4-01 provider only
- temporalio/temporal — Server (signals); optional P4-01 provider only
- dbos-inc/dbos-transact-ts — Postgres required
- inngest/inngest — Go server
- timgit/pg-boss — 12.29 Postgres
**标准(绑定词汇)**:AuthZEN Access Request & Approval Profile Draft 1 (所有者 P2-05,import 其定义) · ACP allow_always/reject_always option kinds (所有者 P2-06,import 其定义)
**自己写(residual)**:sqlite table (requested/approved/denied/expired/revoked/consumed, digest, policy version, actor, deadline), CAS consume, waiting_for_approval handoff to P4-01 run service, multi-client subscription, SDK reconnect, crash-injection tests; design so the sqlite store is one provider.
**禁令/风险(risk)**:storage-sqlite has no explicit transactions — the approval store needs BEGIN IMMEDIATE locally in approval-store/src/sqlite.ts; do not widen the storage seam.
**planError**:Durable-execution engines cannot be P2-07's default (server/Postgres) — only optional P4-01 providers.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- hol-guard 514★ 覆盖≈30% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：Not dsh's workflow `waiting_for_approval` + scheduler wake; request identity is not ActionManifest digest + policy version; crash-at-every-point and compare-and-swap consume are asserted in
- dsh-bridge 138★ 覆盖≈20% — IM approval cards — remote answerer/surface; no CAS persistence across restart (<20%)
- dsh-notifier 83★ 覆盖≈20% — Phone approvals — answerer only (<20%)
- dsh-im-bridge 9★ 覆盖≈20% — 'Persistent dedup' — answerer (<20%)
- dsh-Remote plugin 32★ 覆盖≈20% — Android approvals — answerer (<20%)
**裁决叠加(整改令)**:
- §2.B 子句不动、加实现约束(见该 epic 小节)

#### P2-08 · 可复用 Grant、范围规则、过期与撤销

`Reusable grants, scope rules, expiry, revocation` · L2_PROVIDER · **PROVIDER_ADAPT + PROVIDER_WRITE** · 可省 35% · 状态 **NOT_RUN (W9)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Grant 支持 actor/capability/resource predicates、金额/次数/时间窗口、environment、expiry、revocation。
- must[1] Grant 由 policy 匹配，不由模型自由解释。
- must[2] 任何 grant 都可查看、撤销，并记录使用次数。
- acceptance[0] 不存在无作用域永久 grant。
- acceptance[1] 规则边界外动作回到审批或拒绝。
- acceptance[2] 撤销在分布式 worker 中有有界传播并默认 fail closed。
- validation[0] property test 资源/金额/时间边界。
- validation[1] 测试规则重叠时取最严格结果。
- validation[2] 测试撤销竞态与离线 worker。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-05 P2-07
- files:[B] `packages/interaction/user-approval/src/types.ts` · [B] `packages/interaction/permission-presets/src/types.ts` · [B] `packages/settings/settings/src/index.ts` · [N] `packages/policy/grant-store/src/index.ts` · [N] `packages/policy/grant-store/src/types.ts` · [N] `packages/policy/grant-store/src/match.ts` · [N] `packages/policy/grant-store/tests/grants.spec.ts`
- stages:C:4 文件 · P:2 文件 · U:2 文件 · F:1 文件
- realTask:E2 S04 S05 S11
- gate:A new action after revocation rejects immediately; a prepared action rechecks epoch at its next PEP; propagation upper bound ≤1 s; S04/S05/S11.
- rollback:K/X — advance epoch, stop matching old grants, preserve audit.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **cedar-policy/cedar (policy templates)**(npm `@cedar-policy/cedar-wasm` · Apache-2.0 · 1,704★) — Templates with ?principal/?resource slots + templateLinks in isAuthorized input (verified in cedar_wasm.d.ts); caps as forbid so overlaps resolve strictest-first
**可选(optional,不进依赖不进 CI)**:
- eclipse-biscuit/biscuit-wasm — Third-party/attenuation blocks for token-carried grants (P2-02)
**自己写(residual)**:Grant store (sqlite): counters, usage log, revocation flag, expiry sweep, bounded propagation to workers with fail-closed default; match.ts shrinks to selecting candidate templates for the principal.
**禁令/风险(risk)**:Cedar is stateless: usage counts/revocation fed as context/entity attributes per evaluation; 'no unscoped permanent grant' needs a dsh-written linter.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-approve-for-me 14★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No expiry, revocation, usage counters, amount/count/time-window, environment or resource predicates; no per-actor/principal scoping; no grant listing/revoke surface beyond editing the allowl
- dsh-auto-approve 12★ 覆盖≈15% — Session memory: exact tool+raw args approvals reused within sessionMemoryTtlMs — a session-scoped proto-grant
- dsh-permission-rules 102★ 覆盖≈15% — ACP-style allow_always only as a static rule
**裁决叠加(整改令)**:
- §3.1 共用引擎 Cedar(@cedar-policy/cedar-wasm 4.12.0)在 P2-05 开工前作为 infra slice 接入;本 epic 只写 adapter/PEP/explain

#### P2-09 · 多人审批与职责分离

`Multi-party approval & separation of duties` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 10% · 状态 **NOT_RUN (W9)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Policy 可返回 quorum spec：所需角色、人数、互斥关系、顺序、超时。
- must[1] 发起者不能同时满足独立审批角色。
- must[2] 批准签名绑定同一 ActionManifest digest。
- acceptance[0] 重复账户、同一身份不同 session、角色冒充不能满足 quorum。
- acceptance[1] Action 只在完整 quorum 且所有批准仍有效时执行。
- acceptance[2] 任一关键批准撤销后未执行 action 立即失效。
- validation[0] 测试 2-of-3、顺序审批、互斥角色、离职撤权。
- validation[1] 并发批准与撤销竞态。
- validation[2] 审计报告展示每个 approver 的身份和决策。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-01 P2-07
- files:[P] `packages/interaction/approval-store/src/types.ts` · [P] `packages/policy/policy-engine/src/types.ts` · [P] `packages/identity/principal/src/types.ts` · [N] `packages/interaction/approval-quorum/src/index.ts` · [N] `packages/interaction/approval-quorum/src/types.ts` · [N] `packages/interaction/approval-quorum/tests/quorum.spec.ts`
- stages:C:4 文件 · P:2 文件 · U:2 文件 · F:1 文件
- realTask:E2 S04 S05 S11
- gate:One subject cannot impersonate two roles; expired/revoked votes do not count; S04/S05/S11.
- rollback:K/X — invalidate quorum decision and keep action prepared/blocked.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **paulmillr/noble-curves**(npm `@noble/curves` · MIT · 948★) — 2.4.0 (or @noble/ed25519 3.2.0) approver signatures over the manifest digest
**可选(optional,不进依赖不进 CI)**:
- eclipse-biscuit/biscuit-wasm appendThirdPartyBlock — Each approval as an approver-signed block on the action's capability token (if P2-02 lands Biscuit)
**不用(reject,理由)**:
- gravitational/teleport — Access requests — AGPL server
- hashicorp/vault control groups — BSL, Enterprise-only
- openfga/openfga — ReBAC, no m-of-n state
**自己写(residual)**:Quorum spec type returned by policy (roles, count, mutual exclusion, order, timeout), initiator ≠ approver via P2-01 ids, identity dedupe across sessions, all-approvals-still-valid check at execute time, revocation race handling, audit report (~300 LOC over P2-07 store).
**禁令/风险(risk)**:No maintained JS library implements m-of-n human approval state.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- review-gate 2★ 覆盖≈0% — 'Team approval quorum' for merges — code-review gate, not action approval

#### P2-10 · Policy-as-Code、Explain 与 Dry Run

`Policy-as-code, explain, dry run` · L2_PROVIDER · **PROVIDER_ADAPT** · 可省 60% · 状态 **NOT_RUN (W7)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义有限、无任意代码执行的声明式 policy language。
- must[1] 支持 unit tests、shadow evaluation、version pin、diff explain。
- must[2] Explain 输出命中规则和安全摘要，不暴露秘密。
- acceptance[0] Policy 文件不能访问网络/文件/环境变量。
- acceptance[1] 同一输入和版本确定性输出。
- acceptance[2] 升级前可对历史 ActionManifest 重放并生成 impact report。
- validation[0] 运行 parser fuzz、resource exhaustion、conflict tests。
- validation[1] 对一万条历史 fixture 做 shadow replay。
- validation[2] 错误 policy 加载 fail closed 并保留上一有效版本。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-05 P2-05
- files:[B] `packages/interaction/permission-presets/src/index.ts` · [B] `packages/settings/settings/src/index.ts` · [P] `packages/policy/policy-engine/src/index.ts` · [N] `packages/policy/policy-language/src/index.ts` · [N] `packages/policy/policy-language/tests/golden.spec.ts` · [N] `docs/policy/language.md`
- stages:C:5 文件 · P:1 文件 · U:2 文件 · F:1 文件
- realTask:E2 S03 S05 S06 S11
- gate:Compile error denies; explain sources stable; counts/budgets/windows are real, not declarative; S03/S05/S06/S11.
- rollback:K/A — pin last compiled policy; invalid new source never activates.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **cedar-policy/cedar**(npm `@cedar-policy/cedar-wasm` · Apache-2.0 · 1,704★) — checkParsePolicySet, validate(schema), formatPolicies, policyToJson/Text, isAuthorized diagnostics = explain, isAuthorizedPartial residuals — same engine as P2-05
**可选(optional,不进依赖不进 CI)**:
- marcbachmann/cel-js — 2026-08-16; expression language only — for constraint sub-expressions if ever needed
**不用(reject,理由)**:
- open-policy-agent/opa (Rego) — Needs Go opa build to produce wasm; npm eval-only, last 2024-11
- casbin/node-casbin — Expression matchers, no schema, weak explain
- jwadhams/json-logic-js — Last 2024-07; no permit/forbid structure, no schema, no explain
- stalniy/casl — JS-authored abilities
**自己写(residual)**:Policy-set version pin (digest of text + schema), shadow evaluation via P0-05 gate off\|shadow\|enforce, replay harness over historical ActionManifests + impact/diff report, fail-closed loader keeping last-good set, explain redaction, vitest fixture runner, fuzz of Cedar inputs, docs/policy/language.md as dsh's Cedar schema + conventions.
**禁令/风险(risk)**:Cedar has no built-in test runner; 13 MB package weight; wasm boot ~tens of ms (sync); policy text is model-hidden by design.
**planError**:Do not ship the planned packages/policy/policy-language/src/{parser,compiler}.ts — a homemade policy language.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-permission-rules 102★ 覆盖≈45% — YAML rules with JSON Schema, enforce:false dry-run, hot reload keeping previous set on bad edit, /rules test explain, maxRules caps — just under the CATALOG_ADOPT bar; no version pin, no shadow replay, first-match not monotonic; borrow its match vocabulary as Cedar schema attribute names
- dsh-tool-policy 4★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No shadow-evaluation mode, no policy version pin, no diff-explain between policy versions, no replay of historical ActionManifests / impact report (only the building block). Expression langu
**裁决叠加(整改令)**:
- §2.C 缩范围:files[] 删与上游/已有实现重复的 [N] 文件,residual 收窄
- §3.1 共用引擎 Cedar(@cedar-policy/cedar-wasm 4.12.0)在 P2-05 开工前作为 infra slice 接入;本 epic 只写 adapter/PEP/explain

#### P2-11 · 把 Permission Preset 扩展为完整 Policy Profile

`Permission preset → full Policy Profile` · L2_PROVIDER · **PROVIDER_WRITE + CONSUMER_WRITE** · 可省 0% · 状态 **NOT_RUN (W9)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Profile 包含 execution world、fs/network/process/secrets、risk thresholds、approval rules、plugin trust、budget、retention。
- must[1] 预置 `observe-only`, `workspace-safe`, `team-standard`, `production-controlled`，但不写垂直逻辑。
- must[2] 切换 profile 前做 capability diff 和影响确认。
- acceptance[0] 所有 profile 可完整序列化并显示来源。
- acceptance[1] 不存在 profile 把 kernel hard deny 关闭。
- acceptance[2] 运行中降权立即生效
- acceptance[3] 升权需审批。
- validation[0] 对每个 profile 运行 capability matrix。
- validation[1] 测试热切换时正在执行 action 的处理。
- validation[2] 快照 UI 和 headless dump 输出。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-04 P2-05 P3-02
- files:[B] `packages/interaction/permission-presets/src/index.ts` · [B] `packages/interaction/permission-presets/src/types.ts` · [B] `packages/interaction/permission-presets/src/client.ts` · [B] `packages/bundle/base/cordis.patch.yml` · [N] `packages/interaction/permission-presets/src/schema.ts` · [N] `packages/interaction/permission-presets/tests/profile.spec.ts`
- stages:C:3 文件 · P:1 文件 · U:2 文件 · F:1 文件
- realTask:E2 S03 S05 S06 S11
- gate:Profile covers all services and cannot loosen organization floor; keyless safe default boots; S03/S05/S06/S11.
- rollback:K/A — revert composition to prior stricter signed profile.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **schemastery (vendored)** — Settled seam for the ProfileSpec schema; profiles are dsh config composition
**标准(绑定词汇)**:Codex sandbox_mode/approval_policy names (already mirrored)  · JSON Schema export for serialization/--dump (所有者 P0-06,import 其定义)
**自己写(residual)**:schema.ts (execution world, fs/network/process/secrets vocab from P3-02, risk thresholds from P2-04, approval rules, plugin trust, budget, retention), 4 shipped profiles, capability-diff-before-switch, hot demotion vs approval-gated promotion, provenance display.
**禁令/风险(risk)**:Keep custom derivation semantics (derive() in permission-presets) — profiles must remain a fold over knob events so replay stays truthful.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-auto-mode 146★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Profile is only sandbox+approval; no execution-world/fs/network/process/secrets/risk-threshold/plugin-trust/budget/retention fields, no schema, no serialization with provenance, no capabilit
- dsh-auto-approve 12★ 覆盖≈15% — Proves presets are plugin-extensible (inserts auto between workspace-write and danger-full-access)
- dsh-permission-rules 102★ 覆盖≈15% — Network modes deny-all/whitelist/allow-all keyed off the 3 presets

#### P2-12 · 全局 Emergency Stop 与通用 Human Interaction Channel

`Global emergency stop + generic human channel` · L2_PROVIDER · **PROVIDER_WRITE + CONTRACT_WRITE** · 可省 0-10% · 状态 **NOT_RUN (W7)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 提供 `pause new actions`, `cancel run`, `kill execution world`, `ask question`, `resume`。
- must[1] Emergency stop 由 kernel 广播并持久化
- must[2] worker 获取新 lease/action 前必须检查。
- must[3] Question 与 approval 分离，回答只作为输入，不自动授予权限。
- acceptance[0] 触发 stop 后无新外部副作用
- acceptance[1] 在途动作按策略终止或标记 reconciliation-required。
- acceptance[2] 重启后 stop 状态保持，必须显式解除。
- acceptance[3] 所有 surface 的状态一致。
- validation[0] 在工具启动前/中/后注入 stop。
- validation[1] 模拟网络分区 worker，恢复后不得继续旧 token。
- validation[2] 验证 question 回答不能被当作 approval。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-05 P4-06
- files:[B] `apps/cli/src/process-shutdown.ts` · [B] `packages/core/agent/src/dispatch.ts` · [B] `packages/core/agent/src/inbox.ts` · [B] `packages/sdk/protocol/src/transport.ts` · [B] `packages/sdk/protocol/src/types.ts` · [N] `packages/interaction/human-channel/src/index.ts` · [N] `packages/interaction/human-channel/src/types.ts` · [N] `packages/interaction/control-plane/src/index.ts` · [N] `packages/interaction/control-plane/tests/emergency-stop.e2e.ts`
- stages:C:5 文件 · P:1 文件 · U:4 文件 · F:2 文件
- realTask:E2 S04 S07 S14
- gate:A human answer cannot grant authority; stop is durable and checked by scheduler/tool/world/remote; resume requires independent admin capability; S04/S07/S14.
- rollback:K/X — advance stop epoch; rollback never resumes work implicitly.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **@modelcontextprotocol/sdk**(npm `@modelcontextprotocol/sdk`) — 1.29.0 installed; elicitation form/URL mode payload shape
- **@agentclientprotocol/sdk**(npm `@agentclientprotocol/sdk`) — 1.4.0 installed; request_permission allow_once\|allow_always\|reject_once\|reject_always
**不用(reject,理由)**:
- open-feature/js-sdk — 1.23.0; evaluation API only, no persistence/broadcast/lease semantics → relocation not deletion
- open-feature/flagd — Same reason
**标准(绑定词汇)**:MCP elicitation/create (**本 epic 是形状所有者**) · ACP session/request_permission / elicitation_create (所有者 P2-06,import 其定义) · ACP session/cancel (**本 epic 是形状所有者**)
**自己写(residual)**:control-plane (persisted stop state, kernel-broadcast event, lease/action gate every worker checks, explicit audited resume, cross-surface projection), in-flight policy (terminate vs reconciliation-required via P4-06 outbox), human-channel Service Definition askQuestion/requestApproval/notify implemented by MCP-elicitation, ACP, CLI, web and IM answerers.
**禁令/风险(risk)**:The seam is the deliverable: today every remote plugin re-implements approval+question transport on approval/request and user-questions/request.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-im-gateway 45★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No pause-new-actions / cancel-run / kill-execution-world / resume commands; no kernel-broadcast or persisted emergency-stop state; no lease/action pre-check; no cross-surface state consisten
- dsh-task-control 4★ 覆盖≈15% — UNVERIFIED on gh; one-click emergency stop, force-terminate — UI-level, not persisted or kernel-broadcast (<15%)
- dsh-background-agents 9★ 覆盖≈15% — 'Message and interrupt any time' (<15%)
- dsh-bridge 138★ — Ready-made answerer for the human channel once the seam exists
- dsh-lark 50★ — Ready-made answerer
- dsh-notifier 83★ — Ready-made answerer

### P3 · 执行隔离(13 项)

#### P3-01 · 一等公民 ExecutionWorld Capability Seam

`ExecutionWorld capability seam` · L1_CONTRACT · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 30% · 状态 **NOT_RUN (W7)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 WorldSpec、WorldHandle、WorldAttestation、WorldSnapshot、execute/terminate/snapshot/restore 接口。
- must[1] WorldSpec 覆盖 filesystem、network、process、IPC、devices、secrets、resources、lifetime、tenant。
- must[2] 旧 SandboxExecution 作为 local provider 的兼容适配层，不在 Agent Loop 硬编码。
- acceptance[0] 同一 ToolExecution 可在 local/container/microVM provider 间切换而不改变 ActionManifest/Policy 语义。
- acceptance[1] 无 provider 能满足 policy 时 fail closed，不能静默降级。
- acceptance[2] WorldHandle 不能被模型或第三方插件伪造。
- validation[0] 实现 fake world conformance suite，所有 provider 必须通过。
- validation[1] 运行 provider swap composition test。
- validation[2] 测试 world 被 kill、超时、失联时返回统一 typed outcome。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-03 P2-05
- files:[B] `packages/sandbox/sandbox/src/index.ts` · [B] `packages/sandbox/sandbox/src/escalation.ts` · [B] `packages/sandbox/sandbox/src/roots.ts` · [B] `packages/core/tools/src/types.ts` · [N] `packages/execution/execution-world/src/index.ts` · [N] `packages/execution/execution-world/src/types.ts` · [N] `packages/execution/execution-world/src/lifecycle.ts` · [N] `packages/execution/execution-world/tests/world.spec.ts` · [N] `docs/subsystems/execution-world.md`
- stages:C:5 文件 · P:4 文件 · U:2 文件 · F:2 文件
- realTask:E3 S13 S14
- gate:Shipping example creates and closes a real environment; metadata cannot masquerade as execution; S13/S14.
- rollback:K/X — cancel/close worlds, retain receipts, switch to last attested provider.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **opencontainers/runtime-spec**(Apache-2.0 · 3,669★) — State vocabulary + lifecycle ordering
**只读参考(reference)**:
- e2b-dev/E2B — npm e2b 2.46.0 MIT; SDK surface as reference (already dep 2.29.1)
- daytonaio/daytona — gh license field null; npm 0.207.1 Apache-2.0
- kubernetes-sigs/agent-sandbox — CRD naming (Sandbox/SandboxTemplate/SandboxWarmPool) informative
**标准(绑定词汇)**:OCI runtime-spec lifecycle/state (creating/created/running/stopped) (**本 epic 是形状所有者**) · E2B/Daytona SDK shape as reference
**自己写(residual)**:WorldSpec/WorldHandle/WorldAttestation/WorldSnapshot types, lifecycle (create/attach/snapshot/restore/terminate), unforgeable branded kernel-issued handle, fake-world conformance suite; operational seam is already ctx.fs + ctx.subprocess + ctx.shell.sandboxMode.
**禁令/风险(risk)**:Sandbox is a hot zone — keep the new package a facade over existing seams; do NOT re-plumb tool-bash/tool-fs.
**planError**:Epic lists B packages/core/agent-loop/src/runtime-context.ts (hot zone) — attach the world handle via the sandbox-policy runtime-context snapshot contribution pattern, no loop edits.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- axern 59★ 覆盖≈25% [topic-sweep] — not-a-plugin·非插件·无 key \| 缺口：Does not define dsh's WorldSpec/WorldHandle/WorldAttestation/WorldSnapshot; no snapshot/restore at all; no IPC/devices/secrets/lifetime/tenant dimensions in the spec; it is a remote gRPC pla
- mirage (@struktoai/mirage-dsh) 3,596★ — Swaps fs+bash providers — proves seam; docker/e2b/daytona routing lives in mirage core
- dsh-worlds 3★ — Implements ctx.fs+ctx.subprocess+PTY over Docker (111 checks); neither defines the contract
**裁决叠加(整改令)**:
- §2.D 热区改接法:[B] 热区文件换 [N] 新 rung / contribution

#### P3-02 · 扩展 Sandbox Policy 为全维度安全词汇

`Full-dimension sandbox policy vocabulary` · L2_PROVIDER · **CONTRACT_WRITE + PROVIDER_ADAPT** · 可省 40% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 引入 FileSystemPolicy、NetworkPolicy、ProcessPolicy、IpcPolicy、DevicePolicy、SecretPolicy、ResourcePolicy。
- must[1] 策略为闭合、显式 allowlist
- must[2] 未知 capability 默认 deny。
- must[3] 每个 provider 返回 supportedPolicyFeatures，solver 不允许弱语义冒充强语义。
- acceptance[0] 请求禁网时 DNS、IPv4/IPv6、localhost、Unix socket、代理均不可用。
- acceptance[1] 请求不可见其他进程时 `/proc`、ps、debug attach 等受限。
- acceptance[2] 策略序列化和审计不丢失字段。
- validation[0] 运行跨平台 policy conformance suite。
- validation[1] 构造 unsupported policy，确认 fail closed 或迁移到更强 provider。
- validation[2] 对每个维度增加 negative tests。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P3-01
- files:[B] `packages/sandbox/sandbox/src/index.ts` · [B] `packages/sandbox/sandbox/src/roots.ts` · [B] `packages/sandbox/sandbox/src/escalation.ts` · [B] `packages/sandbox/sandbox-local/src/profiles.ts` · [B] `packages/interaction/permission-presets/src/types.ts` · [N] `packages/sandbox/sandbox/src/policy.ts` · [N] `packages/sandbox/sandbox/src/network.ts` · [N] `packages/sandbox/sandbox/src/process.ts` · [N] `packages/sandbox/sandbox/tests/policy.spec.ts`
- stages:C:5 文件 · P:2 文件 · U:3 文件 · F:1 文件
- realTask:E3 S13 S14
- gate:Unsupported enforcement denies or is explicitly non-production; no string-prefix policy; S13/S14.
- rollback:K — revert to previous stricter profile; never widen to emulate compatibility.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **opencontainers/runtime-spec**(Apache-2.0 · 3,669★) — Field names/semantics for process/IPC/device/resource dimensions — adopt names, not the container-centric JSON wholesale
- **anthropics/sandbox-runtime**(npm `@anthropic-ai/sandbox-runtime` · Apache-2.0 · 5,113★) — 0.0.75; sandbox-schemas.ts zod: network allow/deny domains(+port), allowUnixSockets, allowLocalBinding, fs denyRead/allowRead/allowWrite/denyWrite; supportedPolicyFeatures
- **moby/moby default seccomp profile**(Apache-2.0 · 72,030★) — Baseline syscall allowlist
**标准(绑定词汇)**:OCI runtime-spec config.json linux.{namespaces,seccomp,devices,resources,rlimits}, mounts (所有者 P3-01,import 其定义) · Landlock ABI rights names  · srt SandboxRuntimeConfig schema
**自己写(residual)**:dsh union type, closed-allowlist validator, supportedPolicyFeatures per provider + solver (weak cannot impersonate strong), serialization/audit fields; srt's seccomp-availability warning must become fail-closed.
**禁令/风险(risk)**:Don't adopt OCI JSON wholesale (container-centric, huge); Windows WFP fence covers TCP/UDP only (named pipes need ACLs) → record partial.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- axern 59★ 覆盖≈35% [topic-sweep] — not-a-plugin·非插件·无 key \| 缺口：No FileSystemPolicy/ProcessPolicy/IpcPolicy/DevicePolicy/SecretPolicy vocabulary; filesystem policy is only rootfsReadonly + volumes; process visibility comes implicitly from runsc, not a de
- dsh-movein-permissions 15★ 覆盖≈0% — Tool-call gate, not world policy
- dsh-permgate 5★ 覆盖≈0% — Tool-call gate, not world policy

#### P3-03 · 结构化 Out-of-Band Denial 与执行错误

`Typed out-of-band denial & execution outcomes` · L1_CONTRACT · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 50% · 状态 **NOT_RUN (W8)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 typed outcome：policy_denied、resource_exhausted、timeout、cancelled、tool_failed、world_lost。
- must[1] provider 通过控制通道返回状态，不解析模型可控 stdout/stderr 决定安全语义。
- must[2] 保留原始输出为 artifact，但与控制状态分离。
- acceptance[0] 恶意程序打印伪造 denial 文本不能改变 outcome。
- acceptance[1] 每类错误在 session/event、SDK、UI 中保持类型。
- acceptance[2] Retry policy 能基于类型做正确决策。
- validation[0] 运行 forged-stderr fixture。
- validation[1] 对所有 provider 做 error mapping conformance。
- validation[2] 快照 SDK wire 和 web rendering。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-06 P3-01
- files:[B] `packages/sandbox/sandbox-local/src/index.ts` · [B] `packages/sandbox/sandbox/src/index.ts` · [B] `packages/core/tools/src/types.ts` · [B] `packages/core/agent-loop/src/tool-calls.ts` · [B] `packages/llm/llm/src/error.ts` · [N] `packages/execution/execution-world/src/errors.ts` · [N] `packages/execution/execution-world/src/outcome.ts` · [N] `packages/execution/execution-world/tests/denial.spec.ts`
- stages:C:5 文件 · P:0 文件 · U:5 文件 · F:1 文件
- realTask:E3 S13 S14
- gate:Forged model-controlled output cannot alter control outcome; ambiguity carries receipt into reconciliation; S13/S14.
- rollback:A/R — retain old decoder and map only explicit legacy outcomes.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **anthropics/sandbox-runtime**(npm `@anthropic-ai/sandbox-runtime` · Apache-2.0 · 5,113★) — sandbox-violation-store.ts, linux-violation-monitor.ts, seatbelt log tap — violations keyed by commandId = true OOB channel for local worlds
**标准(绑定词汇)**:RFC 9457 problem details on SDK/web wire  · OTel semconv error.type (所有者 npm @opentelemetry/semantic-conventions:常量包按需 import,无人定形状) · POSIX/GNU exit-status conventions 124/125/126/127/128+n
**自己写(residual)**:Full outcome union (policy_denied/sandbox_unavailable/resource_exhausted/timeout/cancelled/tool_failed/world_lost), mapping table per provider, artifact/control separation, retry-policy hook; upstream already gives SANDBOX_UNAVAILABLE + denialSignatures + runnerFailureRules.
**禁令/风险(risk)**:Upstream denial model is stderr-substring based (model-controllable text); OOB via srt only on local — container/remote need exit-code + API status.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- axern 59★ 覆盖≈30% [topic-sweep] — not-a-plugin·非插件·无 key \| 缺口：No per-execution policy_denied outcome: egress denials are REFUSED/dropped on the wire and never reported to the caller through a control channel; no world_lost/resource_exhausted typed outc
**裁决叠加(整改令)**:
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P3-04 · 统一 Network Egress Proxy 与目的地策略

`Egress proxy + destination policy` · L2_PROVIDER · **PROVIDER_ADAPT + REUSE_UPSTREAM** · 可省 65% · 状态 **NOT_RUN (W9)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 所有受控 world 出网经 proxy
- must[1] 策略支持 scheme/host/port/path/method、DNS pinning、TLS identity、带宽和响应大小。
- must[2] 默认阻断 localhost、RFC1918、link-local、cloud metadata、Docker socket bridge，除非显式授权。
- must[3] 记录目的地与字节计数，不记录秘密正文。
- acceptance[0] 直接 IP、DNS rebinding、IPv6、redirect chain、proxy env 绕过均失败。
- acceptance[1] 允许列表访问成功且证据可追踪到 ActionManifest。
- acceptance[2] browser/MCP/shell 使用同一 egress policy。
- validation[0] 运行 SSRF corpus 和 DNS rebinding test server。
- validation[1] 测试 30x 跨域重定向。
- validation[2] 断开 proxy 时 fail closed。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P1-06 P2-05 P3-02
- files:[B] `packages/sandbox/sandbox-local/src/index.ts` · [B] `packages/core/tools/src/index.ts` · [P] `packages/plugin/plugin-host/src/supervisor.ts` · [P] `packages/execution/execution-world/src/types.ts` · [N] `packages/execution/egress-proxy/src/index.ts` · [N] `packages/execution/egress-proxy/src/policy.ts` · [N] `packages/execution/egress-proxy/src/dns.ts` · [N] `packages/execution/egress-proxy/tests/ssrf.e2e.ts`
- stages:C:4 文件 · P:3 文件 · U:1 文件 · F:2 文件
- realTask:E3 S13 S14
- gate:Every hop and resolved address is checked; bypass socket and unauthorized bytes = 0; S13/S14.
- rollback:K/X — deny egress, close sockets, retain byte receipts.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **anthropics/sandbox-runtime**(npm `@anthropic-ai/sandbox-runtime` · Apache-2.0 · 5,113★) — http-proxy.ts, socks-proxy.ts, mux-proxy.ts, tls-terminate-proxy.ts+mitm-ca.ts, request-filter.ts, domain-pattern.ts; Linux net-ns removed + unix-socket bind-mounted proxy; macOS seatbelt proxy-port only; Windows WFP fence
- **nodejs/undici ProxyAgent**(npm `undici` · MIT · 7,687★) — In-process consumers (MCP client, web-fetch)
- **whitequark/ipaddr.js**(npm `ipaddr.js` · MIT · 652★) — Already dep; web-fetch-http SSRF core (isPublicIpAddress, DNS-pinned lookup)
**可选(optional,不进依赖不进 CI)**:
- stripe/smokescreen — CONNECT proxy w/ private-range deny, ACLs; Go sidecar via subprocess seam; no SOCKS/unix-socket — optional hardened server provider
- apify/proxy-chain — Forward proxy with prepareRequestFunction hook — fallback if srt's proxy is too entangled
- Shopify/toxiproxy — 'Proxy dies → fail closed' and partition tests
**不用(reject,理由)**:
- mitmproxy/mitmproxy — Heavyweight dev tool, Python
- tinyproxy / squid — GPL, config-file policy, no per-world API
- envoyproxy/envoy — Heavy
- SagerNet/sing-box — License
- ssrf-req-filter — npm last 2024-05 — stale
- private-ip — Last push 2024-08 — stale
**自己写(residual)**:dsh EgressPolicy (scheme/host/port/path/method, bandwidth/response-size), DNS pinning for direct-IP/rebinding at the proxy reusing web-fetch-http network.ts, byte accounting + ActionManifest evidence via commandId, wiring for browser/MCP (HTTP(S)_PROXY/ALL_PROXY + CA bundle).
**禁令/风险(risk)**:srt is 'beta research preview' 0.0.x — pin exact version, vendor-fork risk; deps @pondwader/socks5-server, node-forge, zod3, commander (8.5 MB incl. seccomp helpers + Java agent jar).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-browser 13★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Not a proxy: Playwright owns the socket, so DNS rebinding / TOCTOU is explicitly unmitigated (docs/architecture.md 'Residual SSRF TOCTOU'); redirect chains are never re-validated (page.goto
- dsh-egress-guard 1★ — Tool-argument allowlist at tools/pre-execute + result redaction — heuristic, not a network boundary
- dsh-net-proxy 8★ — Routes via a proxy, no policy
- cue-omni-reader-guard 7★ — One MCP tool
**裁决叠加(整改令)**:
- §3.2 共用引擎 sandbox-runtime(@anthropic-ai/sandbox-runtime,exact pin)在 W7 前作为 sandbox-srt rung 接入;该 slice 同时把 sandbox-local 的 PLATFORM_CHAINS 表改成 contribution point

#### P3-05 · Process、Syscall、IPC 与 Device 隔离

`Process / syscall / IPC / device isolation` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_ADAPT** · 可省 45% · 状态 **NOT_RUN (W9)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Linux 组合 user/mount/pid/net namespaces、seccomp/Landlock/bwrap
- must[1] macOS 使用 Seatbelt profile
- must[2] Windows 使用 restricted token/job object/ACL。
- must[3] 显式控制 Unix sockets、named pipes、clipboard、camera/microphone、GPU、USB、Docker daemon、SSH agent。
- must[4] 平台能力不足时报告 unsupported，不提供伪安全。
- acceptance[0] 测试进程不可见、不可 ptrace、不可连接 Docker/SSH socket。
- acceptance[1] 设备访问与 clipboard 默认 deny。
- acceptance[2] 跨平台语义差异进入 attestation。
- validation[0] 运行平台专用攻击 fixture。
- validation[1] CI 至少在 Linux/macOS/Windows 各跑受支持子集。
- validation[2] 对 unsupported runner 验证 fail-closed path。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P3-02
- files:[P] `packages/execution/execution-world/src/types.ts` · [N] `packages/execution/local-isolation/src/linux.ts` · [N] `packages/execution/local-isolation/src/macos.ts` · [N] `packages/execution/local-isolation/src/windows.ts` · [N] `packages/execution/local-isolation/tests/process-isolation.e2e.ts`
- stages:C:3 文件 · P:3 文件 · U:1 文件 · F:2 文件
- realTask:E3 S13 S14
- gate:Runtime probes actual primitives; unsupported production profile denies; S13/S14.
- rollback:K/X — terminate world and select last attested provider; no heuristic downgrade.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **anthropics/sandbox-runtime**(npm `@anthropic-ai/sandbox-runtime` · Apache-2.0 · 5,113★) — linux-sandbox-utils.ts (bwrap --unshare-net + seccomp unix-socket block via bundled apply_seccomp), macos-sandbox-utils.ts (SBPL unix-socket allowlist, mach-lookup, no AppleEvents), windows-sandbox-utils.ts (srt-sandbox user + WFP fence + ACEs)
- **native/landlock-run (own launcher)** — ~50 LOC to add ABI 4/6 rules
**可选(optional,不进依赖不进 CI)**:
- google/nsjail — Namespaces+seccomp(kafel)+cgroups+rlimits in one binary; Linux-only, no npm — optional strong rung via subprocess seam
- seccomp/libseccomp — Via koffi if dsh generates BPF itself
- google/gvisor — runsc strongest Linux local rung; root or --rootless with limits — optional not default
**不用(reject,理由)**:
- netblue30/firejail — License, setuid
- google/minijail — Niche
**标准(绑定词汇)**:Landlock ABI 4 (TCP bind/connect) / ABI 6 (abstract unix socket + signal scopes)  · moby default seccomp profile
**自己写(residual)**:Device vocabulary → per-platform mapping (bwrap --dev minimal, SBPL deny iokit-open/device-camera/device-microphone, Docker socket/SSH agent = unix-socket rules, clipboard = pasteboard/X11 socket deny), env scrubbing (SSH_AUTH_SOCK, DOCKER_HOST, DISPLAY), attestation of per-platform differences (P3-07).
**禁令/风险(risk)**:HIGH upstream-conflict risk: sandbox-local is a hot zone — insert a NEW sandbox-srt rung ahead of bwrap rather than editing profiles.ts; Windows AppContainer has no OSS Node wrapper (future).
**planError**:P3-05 lists B sandbox-local/src/{index,profiles}.ts edits — hot zone; add a new sandbox-srt rung/plugin instead.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- axern 59★ 覆盖≈35% [topic-sweep] — not-a-plugin·非插件·无 key \| 缺口：Linux node runtime only: no Seatbelt, no Windows restricted token/job object; no explicit policy for Unix sockets, named pipes, clipboard, camera/mic, GPU, USB, SSH agent; platform semantic
**裁决叠加(整改令)**:
- §2.D 热区改接法:[B] 热区文件换 [N] 新 rung / contribution
- §3.2 共用引擎 sandbox-runtime(@anthropic-ai/sandbox-runtime,exact pin)在 W7 前作为 sandbox-srt rung 接入;该 slice 同时把 sandbox-local 的 PLATFORM_CHAINS 表改成 contribution point

#### P3-06 · Secrets Broker：短期、最小范围、不可回显凭证

`Secrets broker: short-lived, least-scope, non-echoing leases` · L2_PROVIDER · **PROVIDER_WRITE + PROVIDER_ADAPT** · 可省 35% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] CredentialRef 解析为短期 SecretLease，绑定 principal、ActionManifest、world、purpose、expiry。
- must[1] 优先通过 brokered request/FD/socket 注入，避免全局 env
- must[2] 使用后自动撤销。
- must[3] 日志、错误、artifact、模型上下文统一 secret taint/redaction。
- acceptance[0] 子 Agent/插件只能获得明确委托的 secret。
- acceptance[1] secret 不出现在 session log、stdout/stderr、crash dump、evidence package。
- acceptance[2] 过期 lease 无法重放。
- validation[0] 用 canary secrets 扫描所有产物。
- validation[1] 测试 env inheritance、child process、error stack、LLM prompt 泄漏。
- validation[2] kill world 后 broker 撤销 lease。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-02 P3-01
- files:[B] `packages/credentials/credentials/src/index.ts` · [B] `packages/credentials/credentials/src/types.ts` · [B] `packages/credentials/credentials/src/invariant.ts` · [B] `packages/llm/llm/src/api-key.ts` · [B] `packages/settings/settings/src/redact.ts` · [N] `packages/credentials/secrets-broker/src/index.ts` · [N] `packages/credentials/secrets-broker/src/types.ts` · [N] `packages/credentials/secrets-broker/src/lease.ts` · [N] `packages/credentials/secrets-broker/tests/secret-leak.e2e.ts`
- stages:C:4 文件 · P:3 文件 · U:2 文件 · F:2 文件
- realTask:E3 S10 S11 S13
- gate:Secret bytes never enter prompt/event/log/telemetry/artifact/snapshot; sink leak = 0; S10/S11/S13.
- rollback:K/X — revoke leases and destroy handles; no plaintext fallback.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **anthropics/sandbox-runtime**(npm `@anthropic-ai/sandbox-runtime` · Apache-2.0 · 5,113★) — credential-sentinel.ts, credential-mask-env/files.ts, body-substitution.ts, aws-sigv4.ts — fake_value_<uuid4> sentinels substituted only on egress to allowlisted hosts (~35% of epic)
- **secretlint/secretlint**(npm `secretlint` · MIT · 1,445★) — 13.0.4; canary/secret scanning of logs/artifacts/evidence (qualification)
**可选(optional,不进依赖不进 CI)**:
- holepunchto/sodium-native — 5.1.0 sodium_mlock/memzero
- Infisical/infisical — 5.0.2 ISC; optional CredentialRef resolver
- node-vault — 0.12.0 client only; Vault server is BSL — not bundleable
- FiloSottile/age — 0.3.1 pure-TS impl; at-rest encryption of local credential store
- 1Password @1password/sdk — 0.5.0
- @napi-rs/keyring — 1.3.0 OS keychain provider
- dotenvx/dotenvx — Encrypted .env at rest
- gitleaks/gitleaks — CI scanner
**不用(reject,理由)**:
- bitwarden sdk-napi — SEELICENSE
- trufflesecurity/trufflehog — AGPL
**标准(绑定词汇)**:OAuth token-exchange RFC 8693 delegation semantics (borrowed)  · SPIFFE SVID lifetime rules (borrowed) (**本 epic 是形状所有者**)
**自己写(residual)**:SecretLease bound to principal/ActionManifest/world/purpose/expiry, revoke-on-kill, delegation to subagents/plugins, session-log/error/crash-dump taint via settings/redact.ts + llm content, FD/socket injection for non-HTTP secrets (git credential helper, ssh-agent proxy, DB URLs).
**禁令/风险(risk)**:Vault (BSL 1.1), Bitwarden (SEELICENSE), trufflehog (AGPL) → license blockers; srt's masking is HTTP-egress-centric.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-config-manager 63★ 覆盖≈20% — AES-256-GCM export of config — at-rest encryption, not brokered leases (<20%)
- dsh-undo-savepoint 覆盖≈20% — Local vault, not leases (<20%)
- dsh-remote-shell 覆盖≈20% — Vault, not leases (<20%)
- dockyard-dsh 81★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·需 key/服务 \| 缺口：No SecretLease: refs are not bound to principal/ActionManifest/world/purpose/expiry, no auto-revoke, no brokered FD/socket injection (tokens are resolved into process memory and put on Autho
**裁决叠加(整改令)**:
- §3.2 共用引擎 sandbox-runtime(@anthropic-ai/sandbox-runtime,exact pin)在 W7 前作为 sandbox-srt rung 接入;该 slice 同时把 sandbox-local 的 PLATFORM_CHAINS 表改成 contribution point

#### P3-07 · 本地 Sandbox 跨平台 Fail-Closed 强化

`Cross-platform fail-closed hardening + attestation` · L2_PROVIDER · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 30% · 状态 **NOT_RUN (W10)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 启动时生成 attestation
- must[1] 开发降级需显式 flag。
- acceptance[0] 故意移除 bwrap/权限或让 Seatbelt compile 失败时不执行命令。
- acceptance[1] attestation 绑定 OS/kernel/provider version。
- acceptance[2] 安全 profile 在所有支持平台通过 conformance。
- validation[0] 模拟缺失依赖和权限失败。
- validation[1] 执行 escape corpus。
- validation[2] 比较三平台 canonical policy fixtures。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P3-02 P3-05
- files:[N] `packages/sandbox/sandbox-local/src/capabilities.ts` · [N] `packages/sandbox/sandbox-local/src/attestation.ts` · [N] `packages/sandbox/sandbox-local/tests/conformance.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:1 文件 · F:2 文件
- realTask:E3 S13 S14
- gate:Activation blocked when required primitive absent; attestation binds actual config; S13/S14.
- rollback:K — deny local execution or use prior attested provider; no cached seen-set bypass.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **in-toto/attestation**(NOASSERTION · 371★) — Statement {subject: world id, predicateType: dsh/sandbox-attestation/v1}
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Envelope; ~40 lines to hand-roll with node:crypto ed25519 if sigstore-js bundle is unwanted
- **anthropics/sandbox-runtime (probe/violation logic + e2e fixtures)**(npm `@anthropic-ai/sandbox-runtime` · Apache-2.0 · 5,113★) — Test fixtures seed for the conformance/escape corpus (qualification)
**可选(optional,不进依赖不进 CI)**:
- sigstore/sigstore-js — 5.0.0 / @sigstore/sign 5.0.0 / @sigstore/verify 4.1.2; DSSE signing with a local key (no Fulcio needed); adds ~2 MB deps
**标准(绑定词汇)**:in-toto Statement v1 + DSSE envelope for the attestation artifact (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · SLSA-style predicate (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:Predicate schema (os, kernel, provider, version, supportedPolicyFeatures, enforcement), requested ⊆ supported check at each execute, explicit dev-degrade flag, conformance e2e across 3 platforms; verified by the trust-kernel sandboxAttestationVerifier stub.
**禁令/风险(risk)**:sigstore-js adds ~2 MB deps; hand-rolling DSSE is acceptable but keep the FORMAT.
**planError**:P3-07 lists B sandbox-local/src edits — hot zone; upstream already has functional probes and refuse-not-warn.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- hol-guard 514★ 覆盖≈30% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：Attestation is not bound to OS/kernel/provider version tuple in what was read; no requested-policy ⊆ supported-semantics solver at every dsh execution; no conformance suite across dsh's plat
**裁决叠加(整改令)**:
- §2.D 热区改接法:[B] 热区文件换 [N] 新 rung / contribution
- §3.2 共用引擎 sandbox-runtime(@anthropic-ai/sandbox-runtime,exact pin)在 W7 前作为 sandbox-srt rung 接入;该 slice 同时把 sandbox-local 的 PLATFORM_CHAINS 表改成 contribution point
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

#### P3-08 · Container ExecutionWorld Provider

`Container ExecutionWorld provider` · L2_PROVIDER · **PROVIDER_ADAPT** · 可省 55% · 状态 **NOT_RUN (W10)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 支持 OCI image digest、rootless、read-only rootfs、ephemeral overlay、egress proxy、secret leases、resource quotas。
- must[1] 禁止隐式挂载 Docker socket/host home。
- must[2] provider 实现标准 snapshot/terminate/attest contract。
- acceptance[0] 相同 image digest 和 inputs 产生可重放环境。
- acceptance[1] 容器逃逸 corpus 无法访问宿主。
- acceptance[2] cleanup 后无残留容器、volume、secret。
- validation[0] 运行 conformance suite 和 crash cleanup test。
- validation[1] 用固定镜像做 reproducibility hash。
- validation[2] 检查 rootless/privileged 配置。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P3-01 P3-04 P3-06
- files:[P] `packages/execution/execution-world/src/index.ts` · [B] `packages/bundle/base/cordis.patch.yml` · [N] `packages/execution/execution-world-container/src/index.ts` · [N] `packages/execution/execution-world-container/src/runtime.ts` · [N] `packages/execution/execution-world-container/src/images.ts` · [N] `packages/execution/execution-world-container/tests/provider.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E3 S13 S14
- gate:Q2 starts a real supported runtime with read-only root and leaves no container; S13/S14.
- rollback:K/X — kill/remove container, revoke secrets/network, switch profile provider.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **apocas/dockerode**(npm `dockerode` · Apache-2.0 · 4,945★) — 5.0.1; Docker + Podman docker-compat socket; create/start/exec/attach/commit/remove/wait, image pull by digest, HostConfig knobs
- **testcontainers/testcontainers-node**(npm `testcontainers` · MIT · 2,596★) — 12.0.4; lifecycle + Ryuk reaper for crash cleanup — qualification only, not shipped in provider
**可选(optional,不进依赖不进 CI)**:
- google/gvisor — runsc via HostConfig.Runtime
- containers/podman — Rootless default
- sigstore/sigstore-js @sigstore/verify — cosign-signed image digests / SLSA provenance when a public key is pinned
**标准(绑定词汇)**:OCI runtime-spec HostConfig knobs (ReadonlyRootfs, Tmpfs, SecurityOpt no-new-privileges/seccomp, CapDrop ALL, PidsLimit, Memory, NanoCpus) (所有者 P3-01,import 其定义)
**自己写(residual)**:WorldSpec→HostConfig mapping, egress-proxy wiring (network=none + unix-socket or proxy sidecar sharing netns — design decision), secret-lease injection (tmpfs file/FD, not env), attestation predicate (image digest, runtime, rootless), validator rejecting docker.sock/$HOME mounts, conformance provider tests.
**禁令/风险(risk)**:Docker/Podman daemon optional (macOS CI has no Docker by default → provider reports unavailable, fail-closed).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-worlds 3★ 覆盖≈50% — 本会话复核：frozo-ai/dsh-worlds 仓库里没有 LICENSE 文件（gh api license=null），无授权即不可依赖，直接出局；且原审计已记它安全 MUST 覆盖 0%（强制 danger-full-access）。仅作参考。
- dsh-plugin-container 4★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key·一次性提交 \| 缺口：Not on the ExecutionWorld/SandboxExecution seam at all: it is a parallel model-facing docker_* tool surface, so dsh shell/file tools never run inside it and no snapshot/terminate/attest cont

#### P3-09 · MicroVM / Remote ExecutionWorld 与 Attestation

`MicroVM / remote world + attestation` · L2_PROVIDER · **PROVIDER_ADAPT + CONTRACT_WRITE** · 可省 50% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义远程 create/attach/heartbeat/snapshot/terminate 协议，支持 microVM provider。
- must[1] Attestation 证明镜像、policy、tenant、network proxy 和 secret injection。
- must[2] 网络分区时停止签发新 action lease，恢复后 reconciliation。
- acceptance[0] 客户端断线/重启可重新 attach，不重复已完成 action。
- acceptance[1] 伪造或过期 attestation 被拒绝。
- acceptance[2] tenant A 不可 attach tenant B world。
- validation[0] 运行网络分区、server restart、stale lease、wrong image tests。
- validation[1] 对远程 world 执行同一 conformance suite。
- validation[2] 验证销毁后数据不可再读。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-01 P3-01 P4-07
- files:[P] `packages/execution/execution-world/src/types.ts` · [B] `packages/e2b/README.md` · [B] `packages/sdk/protocol/src/types.ts` · [N] `packages/execution/execution-world-remote/src/index.ts` · [N] `packages/execution/execution-world-remote/src/client.ts` · [N] `packages/execution/execution-world-remote/src/attestation.ts` · [N] `packages/execution/execution-world-remote/tests/reconnect.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E3 S09 S11 S14
- gate:One durable remote state; receipt and attestation bind action/world/config; S09/S11/S14.
- rollback:K/D/X — revoke remote lease, fence late owner, preserve receipts, close world.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **e2b-dev/E2B**(npm `e2b` · Apache-2.0 · 13,650★) — Installed 2.29.1 (latest 2.46.0): Sandbox.create/connect/setTimeout/pause/betaPause/kill, snapshot → template; mirror as the RemoteWorldClient interface (no new wire protocol)
- **zerocore-ai/microsandbox**(npm `microsandbox` · Apache-2.0 · 8,061★) — 0.6.16; libkrun microVMs on macOS+Linux, self-hosted server — keyless local microVM (needs KVM/HVF)
**可选(optional,不进依赖不进 CI)**:
- daytonaio/daytona — 0.207.1 Apache-2.0 SDK; gh license null — verify AGPL vs Apache before self-hosting
- modal — 0.10.0 hosted only
- vercel/sandbox — Hosted only
- alibaba/OpenSandbox — Possible 2nd self-hosted provider, not verified further
- Shopify/toxiproxy — Partition/reconnect tests (qualification)
**不用(reject,理由)**:
- cloudflare/sandbox-sdk — Workers-only
- firecracker-microvm/firecracker — Raw hypervisor — only via E2B/microsandbox/OpenSandbox
- kata-containers/kata-containers — Raw hypervisor
- apple/container — macOS 26 raw hypervisor
**只读参考(reference)**:
- kubernetes-sigs/agent-sandbox — k8s CRD, informative only
**标准(绑定词汇)**:in-toto/DSSE attestation (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · SPIFFE ID format for tenant/world identity (**本 epic 是形状所有者**)
**自己写(residual)**:Reconnect/reconciliation (idempotent action-lease ledger), tenant-scoped attach tokens, partition tests, provider-signed in-toto Statement (image digest, policy hash, tenant, proxy config hash, secret-injection mode) with hardware: none\|sev-snp\|tdx field.
**禁令/风险(risk)**:TPM/SEV-SNP/TDX attestation out of scope (no provider surfaces it; Go-only tooling); microsandbox needs KVM/HVF → GitHub Linux runners without nested virt fall to unavailable (fail-closed).
**planError**:TPM/SEV-SNP attestation is not achievable with any keyless/local default — declare software attestation with explicit hardware:none.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- axern 59★ 覆盖≈45% [topic-sweep] — not-a-plugin·非插件·无 key \| 缺口：No microVM provider yet (Firecracker named only as future direction); attestation is node-capability evidence, not a per-world signed attestation delivered to the client proving image/policy
- mirage 3,596★ — Routes to docker/e2b/daytona in its core (not in the dsh plugin)
- dsh-remote 51★ — SSH workspace mirroring — not a world provider
**裁决叠加(整改令)**:
- §2.B 子句不动、加实现约束(见该 epic 小节)
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §7.11:SPIFFE ID 格式形状所有者(P0-02/P2-01 未采用,顺延);P8-06 import

#### P3-10 · CPU/Memory/Disk/Time/Process/Network 资源配额

`Resource quotas (CPU/mem/disk/time/pids/net)` · L2_PROVIDER · **PROVIDER_WRITE + PROVIDER_ADAPT** · 可省 35% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] BudgetSpec 支持 per action/run/tenant 的 wall time、CPU、memory、disk、processes、network bytes、tool calls、agents。
- must[1] scheduler 预留资源，world provider enforce，telemetry 对账。
- must[2] 超限返回 typed outcome 并触发清理。
- must[3] 此项只定义 ExecutionWorld 资源计量/硬限额原语
- must[4] P4-10 的调度公平性在其上层消费。
- acceptance[0] fork bomb、disk fill、memory balloon、network flood 均被限制。
- acceptance[1] 累计预算不能通过子 Agent 拆分绕过。
- acceptance[2] 计量误差在声明范围内且可审计。
- validation[0] 运行资源攻击 fixture。
- validation[1] 测试 50 个子 Agent 共享父预算。
- validation[2] 超限后检查无残留进程/文件/lease。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P3-01
- files:[B] `packages/guard/timeout-policy/README.md` · [B] `packages/sandbox/sandbox-local/src/index.ts` · [B] `packages/workflow/workflow/src/types.ts` · [B] `packages/core/agent/src/types.ts` · [N] `packages/execution/resource-budget/src/index.ts` · [N] `packages/execution/resource-budget/src/types.ts` · [N] `packages/execution/resource-budget/src/accounting.ts` · [N] `packages/execution/resource-budget/tests/budget.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E3 S13 S14
- gate:Meets v1.1 meter/overshoot bounds; no work after hard budget; S13/S14.
- rollback:K/D — stop admissions, terminate over-budget worlds, reconcile reservations.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **systemd-run** — --scope -p MemoryMax -p CPUQuota -p TasksMax (Linux w/ systemd, no npm)
- **apocas/dockerode HostConfig**(npm `dockerode` · Apache-2.0 · 4,945★) — Memory/NanoCpus/PidsLimit/StorageOpt
- **soyuka/pidusage**(npm `pidusage` · MIT · 546★) — 4.0.1 cross-platform CPU/mem sampling
- **packages/subprocess/win32-process (existing)** — FFI base for CreateJobObject/SetInformationJobObject
**可选(optional,不进依赖不进 CI)**:
- google/nsjail — --cgroup_mem_max --cgroup_pids_max --cgroup_cpu_ms_per_sec --rlimit_* --time_limit
**标准(绑定词汇)**:OCI linux.resources names (所有者 P3-01,import 其定义) · OTel process.* semconv
**自己写(residual)**:BudgetSpec (per action/run/tenant; wall, cpu, mem, disk, pids, net bytes, tool calls, agents), scheduler reservation, hierarchical accounting across subagents, typed resource_exhausted outcome + cleanup, reconciliation with telemetry.
**禁令/风险(risk)**:macOS local has no cgroup equivalent (ulimit soft caps, -v breaks binaries) → provider reports partial and attests it; disk quota on local = polling or tmpfs size.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-container 4★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key·一次性提交 \| 缺口：All limits are opt-in per call (no default budget), only per-container not per action/run/tenant, no network-bytes / tool-call / agent-count budgets, no scheduler reservation or telemetry re
- dsh-passwords 39★ 覆盖≈0% — Per-subuser token/daily quotas — model-token budgets, not world resources; license blocks reuse
- dsh-cost-meter 243★ 覆盖≈0% — Cost, not resources

#### P3-11 · ExecutionWorld Snapshot / Restore / Rollback

`World snapshot / restore / rollback` · L2_PROVIDER · **PROVIDER_ADAPT + CATALOG_ADOPT** · 可省 50% · 状态 **NOT_RUN (W11)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Snapshot 包含 world filesystem/content digests、provider metadata、running action boundary、secret references（不含 secret 值）。
- must[1] 只允许在安全 quiescent boundary 创建一致快照
- must[2] 非一致快照明确标记。
- must[3] restore 生成新 world identity，旧 token 不继承。
- acceptance[0] 恢复后文件/依赖/数据库状态与快照 digest 匹配。
- acceptance[1] secret lease、network connection、process PID 不被错误复用。
- acceptance[2] rollback 事件和 artifact lineage 可追踪。
- validation[0] 在 tool step 边界注入 crash 后 restore。
- validation[1] 测试 snapshot corruption、provider version mismatch。
- validation[2] 运行 100 次 create/restore/delete 泄漏检查。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P3-01 P6-09
- files:[B] `packages/compaction/compaction/src/checkpoint.ts` · [P] `packages/execution/execution-world/src/lifecycle.ts` · [B] `packages/workspace/workspace/src/entity.ts` · [N] `packages/execution/world-snapshot/src/index.ts` · [N] `packages/execution/world-snapshot/src/types.ts` · [N] `packages/execution/world-snapshot/src/store.ts` · [N] `packages/execution/world-snapshot/tests/restore.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E3 S13 S14
- gate:Encrypted content-addressed state restores in a new world; corrupt/incompatible state rejects; S13/S14.
- rollback:D/K — close world, restore last compatible encrypted snapshot, retain codec.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **git plumbing (host CLI)** — git stash create / write-tree / commit-tree with private GIT_INDEX_FILE → content-addressed tree SHA = digest; restore via read-tree/checkout-index
- **apocas/dockerode commit**(npm `dockerode` · Apache-2.0 · 4,945★) — fs layers → image digest (consistent: fs-only)
- **e2b pause()/betaPause() + snapshot→template**(npm `e2b` · Apache-2.0 · 13,650★) — Sandbox.create(snapshotId) = restore with NEW sandbox id
**可选(optional,不进依赖不进 CI)**:
- isomorphic-git/isomorphic-git — 1.41.9 only if a git-less host must be supported
- checkpoint-restore/criu — GPL/LGPL, Linux root; via podman container checkpoint — optional process-state snapshots
**不用(reject,理由)**:
- marc136/node-folder-hash — Not needed — git tree SHA is the digest
**自己写(residual)**:WorldSnapshot manifest (provider metadata, running-action boundary, secret REFERENCES not values, lineage), new-world-identity-on-restore (token rotation, lease non-reuse), corruption/version-mismatch typed outcomes, leak test loop.
**禁令/风险(risk)**:CRIU Linux-only/root, breaks with TCP sockets/GPU — optional; container commit snapshots fs only → mark consistent: fs-only.
**planError**:CRIU process-state snapshots are not achievable as a keyless/local default — declare fs-only snapshots as the contract.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-filesnap 32★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Not ExecutionWorld-aware at all: no WorldSpec/WorldHandle/provider metadata, no container/microVM provider, snapshot is only the local cwd filesystem (plus declared absolute paths), not depe
- dsh-checkpoint-rewind 15★ 覆盖≈22% — 本会话复核：它是工作区/会话检查点（Claude Code Checkpoints 对标物），git stash create/commit-tree 产生游离对象、不碰 worktree/index/history。但 P3-11 要的是 ExecutionWorld 快照——provider 元数据、运行中动作边界、secret 引用、恢复后换新 world identity 且旧 token 不继承、PID/网络连接不复用——这些全无。原 55% 是对「本地 provider 那一半」的打分，对 epic must+acceptance 只有约 22%。技术上值得借鉴其 git 游离对象快照法。
- dsh-recall-plugin 28★ — Shadow git per message — similar
- dsh-undo-savepoint 140★ 覆盖≈0% — Snapshots CONFIG + plugin code, not the world
**裁决叠加(整改令)**:
- §2.B 子句不动、加实现约束(见该 epic 小节)
- §9.2 生态迁移目标:≥5 个快照/回滚实现互相竞争——区分工作区检查点与执行世界快照,P3-11 只做后者

#### P3-12 · Workspace 路径、附件准入与恶意输入边界强化

`Workspace path, attachment admission, malicious-input hardening` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_ADAPT** · 可省 40% · 状态 **NOT_RUN (W8)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 所有路径操作使用 openat/handle 风格或执行前重新验证 inode，禁止 symlink escape。
- must[1] 附件进行 MIME sniff、大小/像素/解压比/嵌套深度/恶意宏与可执行检测。
- must[2] 未信任附件只在隔离 world 解析，解析产物带 lineage。
- acceptance[0] path swap、symlink、hardlink、case-fold、Unicode 路径攻击失败。
- acceptance[1] zip bomb、polyglot、伪 MIME、恶意文档不进入模型或宿主 parser。
- acceptance[2] 跨租户 content hash 不导致引用泄漏。
- validation[0] 运行路径与附件攻击 corpus。
- validation[1] 对 TOCTOU 使用并发 stress。
- validation[2] 验证 quarantine 清理与审计记录。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-01 P3-01
- files:[B] `packages/workspace/workspace/src/paths.ts` · [B] `packages/workspace/workspace/src/entity.ts` · [B] `packages/attachment/attachment/src/admission.ts` · [B] `packages/attachment/attachment/src/error.ts` · [B] `packages/attachment/attachment/src/types.ts` · [B] `packages/sandbox/sandbox/src/roots.ts` · [N] `packages/attachment/attachment-security/src/index.ts` · [N] `packages/attachment/attachment-security/src/scanner.ts` · [N] `packages/attachment/attachment-security/tests/malicious.e2e.ts` · [N] `packages/workspace/workspace/tests/path-race.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:3 文件 · F:2 文件
- realTask:E3 S13 S14
- gate:Scan is bound to bytes handle; no reopen-by-path; quarantine cleanup/audit proven; S13/S14.
- rollback:K/X — quarantine/reject new inputs; close handles and remove isolated temp data.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **sindresorhus/file-type**(npm `file-type` · MIT · 4,324★) — 22.0.1 magic-byte MIME sniff (ESM)
- **lovell/sharp**(npm `sharp` · Apache-2.0 · 32,624★) — Already dep; flip limitInputPixels:false to a bound + metadata()
- **thejoshwolfe/yauzl**(npm `yauzl` · MIT · 824★) — 3.4.0 streams central directory → uncompressedSize before inflate
- **101arrowz/fflate**(npm `fflate`) — Already dep; unzip filter callback exposes originalSize
- **koffi (openat2 / O_NOFOLLOW_ANY)**(npm `koffi`) — Already dep; ~30 LOC for openat2
**可选(optional,不进依赖不进 CI)**:
- LarsKoelpin/magic-bytes — Alt to file-type
- decalage2/oletools — olevba sidecar for macro detection
- Cisco-Talos/clamav — Daemon; clamscan 2.4.0 MIT client stale 2024-10 — optional scanner provider
**不用(reject,理由)**:
- openSUSE/libpathrs — No prebuilt/npm — not worth a native build
- image-size/image-size — ARCHIVED
**标准(绑定词汇)**:Linux openat2 RESOLVE_BENEATH\|RESOLVE_NO_SYMLINKS\|RESOLVE_NO_MAGICLINKS  · macOS O_NOFOLLOW_ANY
**自己写(residual)**:Open-handle-then-verify discipline in fs-local/fsio.ts and workspace entity.ts (fstat dev/ino vs FsVersion, nlink>1 reject), polyglot rule (declared vs sniffed vs extension), nesting depth/ratio thresholds, quarantine + lineage, parse-in-world consumer wiring over P3-01, NFC + case-fold collision checks.
**禁令/风险(risk)**:ClamAV/YARA are GPL/BSD C daemons → optional only; image-size archived.
**planError**:attachment-local 在 image.ts:93/116、normalization.ts:74、request-image.ts:89 四处传 limitInputPixels:false，关掉了 sharp 默认的像素炸弹护栏（本会话核实）；P3-12 应显式设上限而不是保持 false。
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-docs 13★ 覆盖≈30% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：MUST-2 mostly unmet: MIME is derived from file extension only (mediaTypeForPath), no content sniffing, no polyglot/fake-MIME detection, no pixel limits, no decompression-ratio/zip-bomb or ne
- dsh-files 30★ 覆盖≈15% — sha256 dedup + content-sniff read_document — ~15% overlap
**裁决叠加(整改令)**:
- §2.E 代码级 must-fix:四处 `limitInputPixels:false` 显式设上限;§7.8 pointer:参数深度上限(拒绝而非溢出)是本 epic 主体

#### P3-13 · Code-Runtime ExecutionWorld Policy Binding

`(not in ledger)` · L2_PROVIDER · **未判定** · 可省 None% · 状态 **NOT_RUN (W9)**

**SDD · 规格**:见 registry(P3-13 由 C8 收录);TDD 未冻结。
**用(adapt)**:— 不在账本内,开工时补判
**自己写(residual)**:账本 2026-09-02 生成时本 epic 同日才收录;开工时按 §4.1 补一次单条 make-vs-use 判断并写进本卡(delegate 维护 overlay)。
**禁令/风险(risk)**:—
**裁决叠加(整改令)**:
- §3.2 共用引擎 sandbox-runtime(@anthropic-ai/sandbox-runtime,exact pin)在 W7 前作为 sandbox-srt rung 接入;该 slice 同时把 sandbox-local 的 PLATFORM_CHAINS 表改成 contribution point
- §6:不在账本内(09-02 同日收录);开工时补单条 make-vs-use 判断,预期 CONSUMER_WRITE,依赖 §3.2 rung

### P4 · 任务编排(14 项)

#### P4-01 · 一等公民 Run Service 与 Run Event Log

`Run service + append-only run event log` · L2_PROVIDER · **PROVIDER_WRITE + CONTRACT_WRITE** · 可省 0-5% · 状态 **ACCEPTED (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Run 状态 accepted/planning/waiting/running/paused/verifying/reconciling/succeeded/failed/cancelled。
- must[1] Run event log append-only，引用 Session、Workflow、Action、Artifact、Approval、Verification。
- must[2] Run owner 是服务而非 UI/turn holder。
- acceptance[0] 进程重启后可列出所有非终态 Run 并恢复。
- acceptance[1] 非法状态转换被拒绝。
- acceptance[2] 一个 Session 可关联多个 Run，一个 Run 可跨多个 Session/Agent。
- validation[0] state-machine property tests。
- validation[1] 在每个状态转换后 kill/restart。
- validation[2] 验证 Run list 分页、tenant filtering 和权限。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-06 P2-01
- files:[B] `packages/core/session/src/types.ts` · [B] `packages/core/agent/src/types.ts` · [B] `packages/workflow/workflow/src/types.ts` · [B] `packages/session/session-persistence/src/coordinator.ts` · [N] `packages/run/run/src/index.ts` · [N] `packages/run/run/src/types.ts` · [N] `packages/run/run/src/events.ts` · [N] `packages/run/run/src/state-machine.ts` · [N] `packages/run/run/tests/state-machine.spec.ts`
- stages:C:5 文件 · P:2 文件 · U:3 文件 · F:2 文件
- realTask:E4 S07 S14
- gate:One Run truth, append checksum/tenant chain, illegal transition reason, new-process recovery; S07/S14.
- rollback:D — fence writers, restore journal checkpoint, keep old event decoder.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 111 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - accepted -> accepted is rejected
    - accepted -> planning is accepted
    - accepted -> waiting is rejected
    - accepted -> running is rejected
    - …共 111 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 19 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - lists a non-terminal Run reconstructed from the durable store by a fresh service
    - lists every non-terminal Run, not just the most recently written one
    - omits a Run that reached a terminal state before the restart from the non-terminal listing
    - resumes a non-terminal Run reconstructed after a restart
    - …共 19 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 18 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - opens a durable Run for the agent session a real harness boot starts
    - owns that Run with RUN_SERVICE_OWNER_ID, never the agent session that started it
    - associates the Run with the exact session the harness started, as its initiating Session
    - mints the Run's genesis log entry with no prior state, at seq 0
    - …共 18 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 7 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - two concurrent transitions out of one state never both succeed, and the durable log records exactly the accepted one
    - two services over one store path both durably record their Run, losing neither
    - a store document naming a Run state outside the closed set is refused, never restored and offered for resumption
    - a store document whose event log has a seq gap is refused, never appended onto with a backwards seq
    - …共 7 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **cloudevents/spec**(Apache-2.0 · 5,885★) — Attribute names only; do not depend on the cloudevents SDK (HTTP binding focus)
**不用(reject,理由)**:
- temporalio/temporal — sdk-typescript 905★ MIT; needs server + native core-bridge; would own run state outside the session log
- restatedev/restate — BSL server
- dbos-inc/dbos-transact-ts — Postgres-only
- statelyai/xstate — 5.32.6; v5 silently ignores unhandled events, no append-only log
- event-driven-io/emmett — License unverified; sqlite adapter peer-deps native sqlite3
**标准(绑定词汇)**:CloudEvents attribute names (id/source/type/time/subject/datacontenttype) (本 epic 未采用/不采用;所有者 P4-06,见裁决叠加) · A2A TaskState / MCP TaskStatus names at surfaces (本 epic 未采用/不采用;所有者 P4-05,见裁决叠加)
**自己写(residual)**:10-state table (~80 LOC), sqlite runs/run_events tables via node:sqlite, restart scan of non-terminal runs, cross-refs to sessions.
**禁令/风险(risk)**:No engine can be the keyless local default (server / Postgres / BSL / SSPL) and a Run owned by an external engine breaks 'session log is source of truth' — recommend no engine provider even as optional.
**planError**:run/* event types must be added to core/session known-event-types (closed list) or the run log lives in its own sqlite tables with session refs — decide explicitly; plugin-side event registration does not work (dsh-llm-fallbacks #52).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh_workflow 113★ — run.json + events.jsonl store = prior art only
- loopx 5,424★ — Python control plane above the harness — not adoptable
**裁决叠加(整改令)**:
- §7.1 已验收核验:词汇债(R3):CloudEvents/A2A 0 → P8-05

#### P4-02 · 通用 TaskProfile 编译结果

`TaskProfile (generic compiled task profile)` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 0% · 状态 **NOT_RUN (W6)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] TaskProfile 只表达通用字段，不含销售/金融等垂直流程。
- must[1] 保留原始用户目标引用和所有推断的来源/置信度。
- must[2] 高风险或歧义字段缺失时产生 question，不擅自猜授权。
- acceptance[0] 同一输入在确定性 parser fixture 下输出稳定。
- acceptance[1] 所有 hard constraint 可从 profile 追溯原始来源。
- acceptance[2] 未知 side effect 不会被标为 none。
- validation[0] 建立代码、研究、外部动作、个人计划四类通用 fixture。
- validation[1] 测试冲突约束与缺失信息。
- validation[2] 验证 TaskProfile 被持久化且可版本修订。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-04 P4-01
- files:[B] `packages/core/agent/src/dispatch.ts` · [B] `packages/core/agent/src/types.ts` · [P] `packages/run/run/src/types.ts` · [N] `packages/run/task-profile/src/index.ts` · [N] `packages/run/task-profile/src/types.ts` · [N] `packages/run/task-profile/src/validate.ts` · [N] `packages/run/task-profile/tests/profile.spec.ts`
- stages:C:5 文件 · P:1 文件 · U:2 文件 · F:1 文件
- realTask:E4 S07 S14
- gate:Each hard constraint retains provenance; ambiguity yields a question rather than a guessed plan; only P4-03 compiles RunPlan; S07/S14.
- rollback:A/D — retain old profile decoder and recompile only before plan freeze.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**不用(reject,理由)**:
- W3C PROV (per-field provenance) — Overkill
**只读参考(reference)**:
- a2aproject/A2A Task/Message — Naming reference only
**标准(绑定词汇)**:JSON Schema for the profile via zod (none exists for the concept) (所有者 P0-06,import 其定义)
**自己写(residual)**:Pure dsh vocabulary: goal ref, hard/soft constraints with source+confidence, side-effect class (unknown ≠ none), open questions routed to packages/interaction/user-questions; vitest golden fixtures.
**禁令/风险(risk)**:Vertical creep is the risk, not OSS; keep fields generic per must#1.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-trajectory-governor 13★ 覆盖≈30% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No per-inference source/confidence (only a scalar complexity score); no question emission for ambiguous or high-risk fields (it guesses); no side-effect field at all, so 'unknown side effect

#### P4-03 · RunPlan：模型、Agent、工具、世界、预算与验证的可执行计划

`RunPlan (executable plan data)` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 5% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] RunPlan 包含 objectives、constraints、modelRoutes、contextTopology、agentGraph、worlds、budgets、approvalGates、verification、recovery。
- must[1] 编译阶段做 capability/policy/budget satisfiability。
- must[2] Plan 是数据，不包含任意可执行代码。
- must[3] 先定义 versioned `verificationContractRef` 扩展点
- must[4] P7-01 在不破坏 RunPlan ABI 的前提下提供完整契约。
- acceptance[0] 无法满足的约束返回最小冲突集，不进入运行。
- acceptance[1] Plan 中每个 node 能追溯 TaskProfile requirement。
- acceptance[2] 同一 normalized inputs 产生确定性 plan id。
- validation[0] 运行 solver golden tests。
- validation[1] 构造缺模型/缺世界/预算不足/政策冲突。
- validation[2] 验证计划可序列化、持久化、SDK 传输。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P3-01 P4-02
- files:[B] `packages/workflow/workflow/src/types.ts` · [B] `packages/core/agent/src/model-selection.ts` · [P] `packages/run/run/src/types.ts` · [N] `packages/run/run-plan/src/index.ts` · [N] `packages/run/run-plan/src/types.ts` · [N] `packages/run/run-plan/src/compile.ts` · [N] `packages/run/run-plan/tests/compile.spec.ts`
- stages:C:5 文件 · P:1 文件 · U:2 文件 · F:1 文件
- realTask:E4 S07 S14
- gate:Same canonical inputs produce same digest and every decision is logged; S07/S14.
- rollback:A/D — discard only unfrozen plans; frozen plans require amendment.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0; JCS + sha256 via existing @noble/hashes → byte-stable plan ids **⟶ 裁决取代:§1/§7.8:import P2-03 的 canonicalizeArguments,不接库**
**不用(reject,理由)**:
- serverlessworkflow/specification — Control-flow DSL; RunPlan is a resource/topology/budget/gate plan (sdk-typescript 88★)
- ChristopheBougere/asl-validator — AWS ASL control-flow DSL — no fit
- z3 wasm / logic-solver — SAT solver adds MBs for a ~100 LOC deletion-based minimal conflict set
**标准(绑定词汇)**:RFC 8785 JCS + sha256 for deterministic plan id (所有者 P2-03,import 其定义)
**自己写(residual)**:Satisfiability over typed constraints (capability ⊆ available, budget ≤ cap, policy allow) + deletion-based minimal conflict set (~100 LOC); verificationContractRef as versioned opaque ref (P7-01 fills it).
**禁令/风险(risk)**:Keep verificationContractRef opaque and versioned.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh_workflow 113★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key·一次性提交 \| 缺口：The plan is not data: the executable part is arbitrary JavaScript run in QuickJS, directly contrary to 'Plan 是数据，不包含任意可执行代码'. No TaskProfile input or requirement traceability, no determinist
**裁决叠加(整改令)**:
- 执行卡 §1(JCS 所有者 P2-03):argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P4-04 · RunPlan Freeze、签名与 Amendment Protocol

`Plan freeze, kernel signature, amendment CAS` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 10-15% · 状态 **NOT_RUN (W9)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 执行前 canonicalize+kernel sign
- must[1] runtime 只接受已签 plan。
- must[2] 任何结构变化创建 PlanAmendment，重新做 policy/budget/approval。
- must[3] 允许运行时小范围参数 resolution，但字段必须预先声明 mutable。
- acceptance[0] 修改 plan JSON 任一字节签名失效。
- acceptance[1] Agent 不能自行提升 maxAgents、network、budget、approval mode。
- acceptance[2] 所有 action 引用生效 plan revision。
- validation[0] 运行 privilege-escalation amendment tests。
- validation[1] 并发两个 amendment 使用 CAS，只能一个成为 active revision。
- validation[2] replay 可重建每个 revision 时间线。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-05 P4-03
- files:[P] `packages/run/run-plan/src/types.ts` · [P] `packages/run/run/src/events.ts` · [P] `packages/kernel/trust-kernel/src/index.ts` · [N] `packages/run/run-plan/src/freeze.ts` · [N] `packages/run/run-plan/src/amend.ts` · [N] `packages/run/run-plan/tests/amendment.spec.ts`
- stages:C:4 文件 · P:1 文件 · U:1 文件 · F:2 文件
- realTask:E4 S07 S14
- gate:Real asymmetric signature; no caller-provided verified flag; S07/S14.
- rollback:K/D — revoke signer, stop unfrozen/amended runs, retain original signed plan.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0 (alt snowyu/json-canonicalize 9★ MIT 3.0.0) **⟶ 裁决取代:§1/§7.8:import P2-03 的 canonicalizeArguments,不接库**
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Envelope; payloadType application/vnd.dsh.runplan+json
- **in-toto/attestation**(371★) — Later supply-chain alignment
- **node:crypto Ed25519** — Zero new crypto dep rather than @noble/curves
**标准(绑定词汇)**:DSSE envelope over RFC 8785 JCS (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · Ed25519 via node:crypto  · in-toto/attestation alignment for later P5/P6 (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:Trust-kernel signing entrypoint (signatureRoots is an empty placeholder, index.ts:79), mutable-field declaration, amendment record + sqlite CAS on active_revision, re-run policy/budget/approval, replay from run_events.
**禁令/风险(risk)**:Don't invent an envelope; DSSE keeps P4-04 compatible with supply-chain chapters.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Hash is not a signature (any party can recompute); no kernel signing, no PlanAmendment protocol, no declared-mutable fields, no re-policy/re-budget on structural change. Only actions are fro
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- 执行卡 §1(JCS 所有者 P2-03):argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P4-05 · 扩展 Agent Lifecycle 状态机

`Agent lifecycle state machine (PARTIAL)` · L3_CONSUMER · **REUSE_UPSTREAM + CONSUMER_WRITE** · 可省 0% · 状态 **NOT_RUN (W5)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 状态 queued/starting/running/waiting_tool/waiting_human/paused/cancelling/failed/completed/orphaned。
- must[1] 每个转换带 reason、runId、lease epoch。
- acceptance[0] 非法转换和 stale worker 更新被拒绝。
- acceptance[1] 等待状态不消耗 LLM/worker 资源。
- acceptance[2] 重启后 orphaned Agent 可被 reclaim 或安全失败。
- validation[0] state transition property tests。
- validation[1] 模拟 worker crash、UI disconnect、approval wait。
- validation[2] 验证 Session status 向后兼容映射。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-01
- files:[B] `packages/core/agent/src/types.ts` · [B] `packages/core/agent/src/runtime-types.ts` · [B] `packages/core/agent/src/dispatch.ts` · [B] `packages/core/agent/src/inbox.ts` · [B] `packages/core/agent-loop/src/agent.ts` · [N] `packages/core/agent/src/state-machine.ts` · [N] `packages/core/agent/tests/state-machine.spec.ts`
- stages:C:4 文件 · P:0 文件 · U:4 文件 · F:1 文件
- realTask:E4 S07 S14
- gate:Agent is a Run actor; one state truth and no false completed state; S07/S14.
- rollback:D — replay canonical Run journal with prior projector version.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 20 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - contract: the state map declares exactly the ten states must[0] names, with no extras
    - contract: every declared target is itself a declared state, so the map cannot name a state that does not exist
    - contract: waiting_tool and waiting_human are distinct states rather than one waiting state
    - contract: a transition with an empty reason is refused, so a recorded transition always says why
    - …共 20 条(分布在 1 个冻结条目),见 command-freeze.json
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:1 条有效冻结 / 9 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - contract: an admitted transition returns the next lifecycle carrying the proposal epoch
    - contract: a refusal is RETURNED, not thrown, so a supervisor can record a turned-away worker as an ordinary outcome
    - contract: the refusal reason reaches the caller unchanged, so dispatch adds no interpretation of its own
    - contract: a refused transition leaves the lifecycle untouched, so a rejected proposal cannot half-apply
    - …共 9 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 28 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - contract: the state map declares exactly the ten states must[0] names, with no extras
    - contract: every declared target is itself a declared state, so the map cannot name a state that does not exist
    - contract: waiting_tool and waiting_human are distinct states rather than one waiting state
    - contract: a transition with an empty reason is refused, so a recorded transition always says why
    - …共 28 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — 'Every non-listed edge throws' property
**可选(optional,不进依赖不进 CI)**:
- @xstate/graph — 3.0.4 path enumeration — unnecessary with 10 states
**不用(reject,理由)**:
- statelyai/xstate — Would add a 30k★ runtime dep to reject 10 illegal edges
- matthewp/robot — Same reason
**标准(绑定词汇)**:A2A TaskState / MCP TaskStatus mapping at surfaces (waiting_human ↔ input_required) (**本 epic 是形状所有者**)
**自己写(residual)**:10-state validated transition table with {reason, runId, leaseEpoch}, stale-epoch rejection, orphan reclaim on restart, back-compat mapping to idle\|running (~150 LOC + fast-check); upstream already has inbox projection, consumed-work, holder model.
**禁令/风险(risk)**:Wave inversion: P4-05 (wave 5) needs leaseEpoch from P4-07 (wave 6) — declare leaseEpoch as opaque number now, enforce fencing in P4-07.
**planError**:P4-05 depends on lease epoch from P4-07 scheduled a wave later — declare the field early.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No lease epoch on transitions, no stale-worker write rejection (no fencing), lifecycle is per task/work-unit not per agent, no waiting_tool/waiting_human/cancelling distinctions, unverified
- DSH-taskboard 282★ — Exclusive claims, orphaned claims stay visible (no epoch/heartbeat) — prior art
**裁决叠加(整改令)**:
- §2.F planError 已解决,记录即可
- §10 L3:供给方 P4-07 已验收 → 按 BLOCKED-092 第二步写 acceptance[2] 的 supersession 用例(重启后孤儿 agent 经 lease store 回收/安全失败)→ 验收;排在 P4-06 之后(共 dispatch.ts/inbox.ts)

#### P4-06 · Durable Inbox / Outbox 与 At-Least-Once 投递 + 幂等消费
(账本原题「Durable Inbox / Outbox 与 Exactly-Once Effect Handoff」;registry 已重述,provenance `rewordedFrom`,见整改令 §2.A)

`Durable inbox/outbox, effectively-once handoff (PARTIAL)` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_WRITE** · 可省 0-5% · 状态 **BLOCKED_ON_ACCEPTANCE (W5)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] domain event 与 outbox 行在同一 SQLite 事务（BEGIN IMMEDIATE）内写入，不经 storage KV seam
- must[1] dispatcher 发送后用 idempotent receipt 标记。
- must[2] consumer 按 message id/epoch 去重。
- must[3] 支持 priority、deadline、dead-letter 和 backpressure。
- acceptance[0] 在 commit 前后、发送前后、ack 前后 kill，消息最终只产生一次业务 effect，由 consumer 按 (messageId, epoch) 幂等保证，不由传输保证 exactly-once。
- acceptance[1] 未送达消息可查询和重放。
- acceptance[2] 跨租户消息不能被消费。
- validation[0] 系统化 fault matrix 覆盖至少 12 个边界。
- validation[1] 运行重复投递 10,000 次。
- validation[2] 监控 dead-letter 产生明确告警。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-01 P4-01
- files:[B] `packages/core/agent/src/inbox.ts` · [B] `packages/core/agent/src/dispatch.ts` · [B] `packages/session/session-persistence/src/write-behind.ts` · [B] `packages/session/session-persistence/src/coordinator.ts` · [N] `packages/run/message-bus/src/index.ts` · [N] `packages/run/message-bus/src/inbox.ts` · [N] `packages/run/message-bus/src/outbox.ts` · [N] `packages/run/message-bus/tests/crash.e2e.ts`
- stages:C:4 文件 · P:3 文件 · U:2 文件 · F:2 文件
- realTask:E4 S07 S14
- gate:State+outbox atomically converge; effect is effective-once only under the v1.1 conditions; S07/S14.
- rollback:D/X — stop relay, preserve inbox/outbox and ambiguous entries, reconcile before resuming.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 14 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - kill after-commit, then replay: the business effect is applied exactly once
    - kill after-send, then replay: the business effect is applied exactly once
    - kill after-effect, then replay: the business effect is applied exactly once
    - kill after-ack, then replay: the business effect is applied exactly once
    - …共 14 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 17 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - hands the event and its record to the sink in a single call
    - keeps a multi-record commit together and preserves its order
    - refuses a commit with no records rather than appending a lone event
    - does not retain the caller's array, so a later mutation cannot reach the sink
    - …共 17 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 6 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - spends the attempt and persists `sent` BEFORE handing the record to the transport
    - applies the receipt, and applying the same outcome twice does not ack twice
    - returns a failed send to pending with its attempt spent, not dead-lettered
    - dead-letters once the attempt budget is exhausted, and says which reason
    - …共 6 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 22 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - enumerates at least the twelve boundaries the clause requires
    - fault boundary 01 deadline expired before any attempt
    - fault boundary 02 attempt budget exhausted
    - fault boundary 03 expired AND exhausted reports the expiry, pinning check order
    - …共 22 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**可选(optional,不进依赖不进 CI)**:
- taskforcesh/bullmq — Redis — optional provider only, never default
- timgit/pg-boss — Postgres — optional
- graphile/worker — Postgres — optional
- NATS JetStream — Optional provider
**不用(reject,理由)**:
- cloudevents/sdk-javascript — 10.0.0; adopt attribute names, not the HTTP-binding SDK
- better-queue — Stale 2024-06
**标准(绑定词汇)**:CloudEvents attribute names; dedup on id (**本 epic 是形状所有者**)
**自己写(residual)**:Outbox tables + BEGIN IMMEDIATE transactional write (cannot use KV seam), dispatcher receipts, consumer dedup by (messageId, epoch), priority/deadline/DLQ/backpressure, tenant column checks (~400 LOC + fault matrix).
**禁令/风险(risk)**:'Exactly-once' is at-least-once + idempotent consumer; say so in the contract.
**planError**:P4-06 should say 'at-least-once + idempotent consumer' not 'exactly-once'; transactional outbox cannot use the storage KV seam (single-statement by design).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No dead-letter, no per-message priority/deadline, no consumer-side epoch dedup, no tenant isolation, no crash-campaign evidence in the tests I read. Python/sqlite only.
- dsh-lark-link 覆盖≈0% — 'At-least-once zero-loss' is a notify bridge
**裁决叠加(整改令)**:
- §2.A 子句措辞改(标题/must[0]/acc[0] → at-least-once + 幂等消费,BEGIN IMMEDIATE 事务)
- §7.11:CloudEvents 属性名形状所有者——新 [N] 文件直接采用标准名(id/source/type/time/subject/datacontenttype),不自造
- §10 L3 + §10.3-2:(b) BEGIN IMMEDIATE 事务;(a) 去重信号 = 认领 turn 的既有 turn/end 事件(reason 非 interrupted → consumed;interrupted/缺失 → 可恢复),不新增事件类型

#### P4-07 · Worker Lease、Heartbeat 与 Fencing Token

`Worker lease, heartbeat, fencing token` · L2_PROVIDER · **PROVIDER_WRITE + QUALIFICATION_REUSE** · 可省 0% · 状态 **ACCEPTED (W6)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 每个 work item 由 epoch lease 所有
- must[1] 所有状态写和 action execution 携带 fencing token。
- must[2] heartbeat 续租，过期后 scheduler 可 reclaim。
- acceptance[0] 旧 worker 恢复后无法提交结果或执行新副作用。
- acceptance[1] clock skew 在容忍范围内不导致双主。
- acceptance[2] lease store 故障时停止新工作。
- validation[0] 运行 split-brain 和 delayed packet tests。
- validation[1] 模拟 100 workers 竞争同一 item。
- validation[2] 验证 stale token rejection 写入审计。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-06
- files:[B] `packages/core/agent/src/dispatch.ts` · [B] `packages/core/agent/src/consumed-work.ts` · [B] `packages/workflow/workflow-worker-thread/src/host.ts` · [B] `packages/workflow/workflow-worker-thread/src/runtime.ts` · [N] `packages/run/lease/src/index.ts` · [N] `packages/run/lease/src/types.ts` · [N] `packages/run/lease/src/store.ts` · [N] `packages/run/lease/tests/fencing.e2e.ts`
- stages:C:3 文件 · P:2 文件 · U:4 文件 · F:2 文件
- realTask:E4 S07 S14
- gate:Storage-side monotonic time and fencing alone decide authority; client wall clock cannot change correctness; stale writes after a newer token = 0; S07/S14.
- rollback:D — stop workers, advance epoch, restore store; never reuse a token.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 10 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - refuses the old holder's token after the item is reclaimed at a higher epoch
    - admits the new holder's token against the same reclaimed lease
    - refuses a token whose epoch is HIGHER than any the store issued
    - refuses any write when the item holds no lease at all
    - …共 10 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 12 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - issues increasing epochs across successive acquisitions of one item
    - refuses a second worker while the incumbent lease is unexpired
    - keeps epochs per work item, so acquiring one does not advance another
    - extends the deadline without issuing a new epoch
    - …共 12 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 7 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - CHARACTERIZATION: unfenced, a self-asserted high epoch is admitted and becomes the authority
    - fenced, that same self-asserted epoch is refused
    - admits the holder's real token, so the check is not refusing everything
    - refuses the previous holder after the item is reclaimed
    - …共 7 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 22 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - P4-07 validation[0]: systematic fault matrix enumerates at least twelve boundaries, each named once
    - fault boundary 01 a strictly older epoch is refused as stale
    - fault boundary 02 an epoch above the current one is refused, not treated as newer authority
    - fault boundary 03 the exact current epoch is admitted, so the check is not refusing everything
    - …共 22 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — Split-brain/clock-skew sims (100 workers racing one item)
- **sinonjs/fake-timers**(npm `@sinonjs/fake-timers` · BSD-3-Clause · 859★) — Via vitest vi.useFakeTimers()
**不用(reject,理由)**:
- redlock — Redis
- moxystudio/node-proper-lockfile — Stale 2023, no epoch
- workflow-es redlock provider — Stale 2025-01
**标准(绑定词汇)**:Kleppmann fencing-token semantics
**自己写(residual)**:leases(item, owner, epoch, expires_at) with UPDATE … WHERE epoch=? AND owner=? (SQLite serializes writers), monotonic clock + tolerance, fail-closed on lease DB errors (~250 LOC).
**禁令/风险(risk)**:Fencing semantics must be enforced by the ledger (P4-12) and run store, not just the lease table.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈30% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No heartbeat/renew API, no epoch/fencing token carried on state writes or actions (grep heartbeat/epoch/fenc in store: none), no stale-epoch idempotency ledger, no clock-skew handling, no 's
- DSH-taskboard 282★ — Exclusive claim (no heartbeat/epoch) — prior art
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK(注入时钟等价 fake-timers)

#### P4-08 · Workflow Journal 与步骤级 Resume

`Workflow journal + step-level resume` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 0% · 状态 **ACCEPTED (W7)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 记录 script digest、program counter/step id、input/output artifact refs、child agent receipts、side-effect receipts、phase。
- must[1] 恢复时跳过已完成且验证过的纯步骤
- must[2] 有副作用步骤先 reconciliation。
- must[3] 禁止序列化任意闭包
- must[4] workflow DSL/worker API 需可 journal。
- acceptance[0] 在每个 agent() call 前后 kill，恢复不重复已完成 child work。
- acceptance[1] script digest 改变时不能盲目 resume，必须 migrate/restart。
- acceptance[2] journal 可压缩但原始证据保留。
- validation[0] 运行现有 workflow tests 外加系统 fault injection。
- validation[1] 24 小时虚拟时钟场景 100 次重启。
- validation[2] 验证 resume 结果与无故障结果相同。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-01 P4-06 P4-07
- files:[B] `packages/workflow/workflow/src/types.ts` · [B] `packages/workflow/workflow/src/runtime-types.ts` · [B] `packages/workflow/workflow-worker-thread/src/host.ts` · [B] `packages/workflow/workflow-worker-thread/src/protocol.ts` · [B] `packages/workflow/workflow-worker-thread/src/session.ts` · [B] `packages/workflow/workflow-worker-thread/src/worker.ts` · [N] `packages/workflow/workflow-journal/src/index.ts` · [N] `packages/workflow/workflow-journal/src/types.ts` · [N] `packages/workflow/workflow-journal/src/replay.ts` · [N] `packages/workflow/workflow-journal/tests/resume.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:3 文件 · F:2 文件
- realTask:E4 S07 S14
- gate:Only pure verified steps may skip; committed effect receipts are not replayed, ambiguous effects reconcile, and a new process resumes the same cursor; S07/S14.
- rollback:D — fence worker, restore journal checkpoint, replay only committed safe steps.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 19 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - carries step id, phase, effect class, outcome, inputs, output, both receipt kinds and verification
    - keeps `verified` separate from `outcome`
    - records artifact REFS, never inline content
    - skips it and reuses its recorded output
    - …共 19 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 13 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - writes an in-flight entry when a step STARTS, before it settles
    - replaces the in-flight entry in place when the step settles
    - orders entries by sequence even when they settle out of order
    - carries the declared phase, and names an unphased step rather than omitting it
    - …共 13 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 8 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - records a started agent call as in-flight, carrying the child session id as its receipt
    - settles a completed call with an output the resume can reuse
    - maps `cancelled` to a failed journal outcome, so a resume re-runs it
    - maps `failed` the same way, and `completed` differently
    - …共 8 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 19 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - P4-08 Fault — resume boundary matrix enumerates at least twelve boundaries, each named once
    - fault boundary 01 an in-flight step is re-run
    - fault boundary 02 a failed step is re-run
    - fault boundary 03 a completed but unverified step is re-run
    - …共 19 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**不用(reject,理由)**:
- temporalio/sdk-typescript — Server + native core-bridge; deterministic-isolate model cannot share dsh worker-thread scripts
- restatedev/restate — Closest semantic match but BSL-1.1 server sidecar
- dbos-inc/dbos-transact-ts — Postgres-only
- inngest/inngest — SSPL dev server; inngest-js 1002★ Apache-2.0
- vercel/workflow — 4.8.5; needs 'use workflow' bundler transform — impossible for runtime model-authored scripts
- resonatehq/resonate — Server (SDK 57★)
- danielgerlag/workflow-es — Stale 2025-01; memory/mongo/redis
**自己写(residual)**:Journal record {runId, scriptDigest, seq, kind, inputDigest, receipt\|artifactRef, phase, epoch} on top of protocol.ts + logged tool-workflow/agent-start\|end events; replay returns recorded receipt; digest mismatch ⇒ refuse resume (~400–600 LOC); side effects hand off to P4-12/13.
**禁令/风险(risk)**:Adopting Temporal would replace workflow-worker-thread (1987 LOC, adjacent to hot zones) and impose determinism rules on model scripts — a rewrite, not a delete.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh_workflow 113★ 覆盖≈35% — resume-run via call-seq cache + events.jsonl proves the pattern; own file store above ctx.subagents, compiled lib/, single author — 35% by feature, 0% reusable code
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK

#### P4-09 · Detached、Saved、Versioned 与 Nested Workflow

`Detached / saved / versioned / nested workflows` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 0-5% · 状态 **BLOCKED_ON_ACCEPTANCE (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Workflow 定义作为签名 artifact 注册，版本固定
- must[1] Run 引用 digest。
- must[2] detached workflow 由 Run service 持有，UI/turn 断开不终止。
- must[3] nested workflow 继承/衰减 budget、capability token、trace，并检测递归。
- acceptance[0] 保存/加载不会执行未验证代码。
- acceptance[1] 父取消能传播
- acceptance[2] 子失败按声明策略处理。
- acceptance[3] 递归深度、总 agents、总 budget 受限。
- validation[0] 测试 UI disconnect、parent restart、nested cancellation。
- validation[1] 测试 workflow version upgrade 与旧 Run resume。
- validation[2] 递归/循环定义必须在编译阶段拒绝。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P1-02 P4-08
- files:[B] `packages/workflow/workflow/src/types.ts` · [B] `packages/workflow/workflow-worker-thread/src/meta.ts` · [B] `packages/workflow/workflow-worker-thread/src/runtime.ts` · [B] `packages/workflow/workflow-worker-thread/src/session.ts` · [N] `packages/workflow/workflow-registry/src/index.ts` · [N] `packages/workflow/workflow-registry/src/types.ts` · [N] `packages/workflow/workflow-registry/src/version.ts` · [N] `packages/workflow/workflow-registry/tests/nested.e2e.ts`
- stages:C:5 文件 · P:1 文件 · U:2 文件 · F:2 文件
- realTask:E4 S07 S14
- gate:Saved workflow resolves exact signed version; nested graph is acyclic/tenant scoped; S07/S14.
- rollback:D/K — pin previous signed version and resume from journal; candidate stays inactive.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 17 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - identifies a definition by the digest of its body, not by its name
    - recomputes the digest rather than trusting the one supplied
    - requires versions to advance by one per name
    - refuses to reuse a version already issued for a different body
    - …共 17 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 10 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - registers a first definition and resolves a run against it
    - does not resolve a definition that was refused
    - reports the highest version as current, not the most recently registered
    - reports no current definition for an unknown name
    - …共 10 条(分布在 1 个冻结条目),见 command-freeze.json
- U:2 条有效冻结 / 8 个具名用例 / 变异证明 2/2 / 格子 GREEN · 有 supplement
    - caps the child at its decayed agent budget, not at the deployment ceiling
    - never raises the child above the parent worker's own total
    - inherits concurrency unchanged rather than dividing it
    - refuses to plan a run it would not admit, so limits cannot be derived without admission
    - …共 8 条(分布在 2 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 19 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - P4-09 Fault — registration and nesting boundary matrix enumerates at least twelve boundaries, each named once
    - fault boundary 01 a digest that does not match its body is refused
    - fault boundary 02 a version that skips ahead is refused
    - fault boundary 03 a version already issued is refused for a different body
    - …共 19 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **packages/storage/storage-sqlite KV unit (existing)** — Registry store keyed by digest, value = DSSE envelope
**不用(reject,理由)**:
- serverlessworkflow/specification — Saved format — rejected
- OCI artifacts / ORAS — Overkill
**标准(绑定词汇)**:sha256 content digest + DSSE signature (P4-04) for saved definitions (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:Signed-artifact load path that never executes unverified code, detached ownership by the Run service, nested budget/capability/trace decay, recursion/cycle rejection at compile, parent-cancel propagation (~400 LOC).
**禁令/风险(risk)**:Detached runs need durable job records — jobs-local is in-memory and can't own them; the Run service must.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh_workflow 113★ — Capsules (digest/version/catalog) = prior art
- dsh-agent-team-gui 163★ — Persistent teams — UI
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

#### P4-10 · Workflow 预算、Scheduler、Backpressure、公平性与资源锁

`Budget, scheduler, backpressure, fairness, locks (PARTIAL)` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_WRITE** · 可省 15% · 状态 **NOT_RUN (W9)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] BudgetSpec 覆盖 tokens/cost/time/agents/tool calls/world resources
- must[1] 父子层级累计。
- must[2] scheduler 支持 tenant fairness、priority aging、resource locks、exclusive tools。
- must[3] backpressure 传播到 workflow script，禁止无限排队。
- acceptance[0] 50 个并发 Agent 下无死锁、无超预算、无跨租户饥饿。
- acceptance[1] 两个写同一资源的任务被序列化或冲突检测。
- acceptance[2] 取消会释放所有 lock/permit。
- validation[0] 运行 deterministic scheduler simulation。
- validation[1] 随机任务/锁 property test。
- validation[2] scale lane 测 1k queued / 100 active tasks。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P3-10 P4-07
- files:[B] `packages/workflow/workflow/src/types.ts` · [B] `packages/workflow/workflow-worker-thread/src/runtime.ts` · [B] `packages/core/agent/src/dispatch.ts` · [B] `packages/guard/timeout-policy/README.md` · [N] `packages/run/scheduler/src/index.ts` · [N] `packages/run/scheduler/src/queue.ts` · [N] `packages/run/scheduler/src/locks.ts` · [N] `packages/run/scheduler/src/fairness.ts` · [N] `packages/run/scheduler/tests/scheduler.e2e.ts`
- stages:C:5 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E4 S07 S14
- gate:Atomic child≤parent budget, bounded backpressure, fair tenant scheduling, no unfenced lock; S07/S08/S14.
- rollback:D — stop admissions, fence workers, restore queue/reservations.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **sindresorhus/p-queue**(npm `p-queue` · MIT · 4,265★) — 9.3.3: priority+concurrency+per-task timeouts in-process
- **DirtyHairy/async-mutex**(npm `async-mutex` · MIT · 1,431★) — 0.5.0 Mutex/Semaphore permits
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — Model-based fc.commands + fake timers for scheduler sims (qualification)
**不用(reject,理由)**:
- animir/node-rate-limiter-flexible — Per-key rate limits, not fairness
- SGrondin/bottleneck — Stale 2024-01
**自己写(residual)**:Multi-dim BudgetSpec + parent/child accumulation, tenant WFQ/priority aging (~100 LOC deficit round-robin), cross-process sqlite lock rows, exclusive tools, Backpressure message into the worker protocol (closed enum — B-edit), lock release on cancel (~600 LOC).
**禁令/风险(risk)**:No npm lib does tenant-fair hierarchical scheduling; locks must be sqlite rows if workers are separate processes.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Budgets are concurrency slots only: no tokens/cost/time/tool-call/world budgets, no parent-child accumulation beyond slots, no tenant fairness, no exclusive tools, no backpressure signal int
- dsh-cost-meter 243★ 覆盖≈0% — Cost budget UI
- dsh-agent-team-gui 163★ 覆盖≈0% — Soft token budget
**裁决叠加(整改令)**:
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P4-11 · 统一 Retry Classifier、Circuit Breaker 与 Retry Budget

`Retry classifier, circuit breaker, retry budget (PARTIAL)` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_ADAPT** · 可省 30-35% · 状态 **NOT_RUN (W8)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 统一错误 taxonomy 与 retryability
- must[1] 所有层消费同一 RunRetryBudget。
- must[2] 支持 exponential backoff+jitter、Retry-After、provider circuit breaker、hedge exclusion。
- must[3] 有副作用动作只有在 idempotency/reconciliation 保证下可重试。
- acceptance[0] 永久 4xx、policy deny、invalid input 不重试。
- acceptance[1] 多个插件不能使总重试超过 Run budget。
- acceptance[2] provider 故障时 circuit 打开且可恢复。
- validation[0] 运行 error matrix 与 virtual clock tests。
- validation[1] 注入重复 retry listeners，验证预算单一。
- validation[2] 测试 partial streaming 和 ambiguous completion。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-01 P4-12
- files:[B] `packages/llm/llm/src/adapter-failure.ts` · [B] `packages/llm/llm/src/retry-policy.ts` · [B] `packages/llm/llm-retry/src/index.ts` · [B] `packages/llm/llm-retry/src/history.ts` · [B] `packages/core/agent-loop/src/agent.ts` · [N] `packages/reliability/retry/src/index.ts` · [N] `packages/reliability/retry/src/classify.ts` · [N] `packages/reliability/retry/src/budget.ts` · [N] `packages/reliability/retry/src/circuit.ts` · [N] `packages/reliability/retry/tests/retry.spec.ts`
- stages:C:5 文件 · P:4 文件 · U:1 文件 · F:1 文件
- realTask:E4 S07 S14
- gate:Only safe or ledger-protected operations retry; causal attempts and budget converge; S07/S14.
- rollback:X/D — open circuit and stop retries; preserve attempt/ledger history.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **connor4312/cockatiel**(npm `cockatiel` · MIT · 1,816★) — 4.0.0: circuitBreaker consecutive/sampling + halfOpen, bulkhead, timeout, fallback, wrap(), events
**可选(optional,不进依赖不进 CI)**:
- nodeshift/opossum — Breaker only
**不用(reject,理由)**:
- sindresorhus/p-retry — 8.0.1 redundant with llm-retry
- coveooss/exponential-backoff — Redundant with llm-retry
**自己写(residual)**:Cross-layer error taxonomy extending retry-policy codes, RunRetryBudget (shared CAS counter in run store), Retry-After parsing (~20 LOC), hedge exclusion, idempotency-gated retry (P4-12 check); keep llm-retry as the durable-before-wait executor.
**禁令/风险(risk)**:cockatiel has no shared cross-policy budget and no Retry-After parsing; don't replace llm-retry's durable events with cockatiel's retry policy.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-llm-fallbacks 20★ — Fallback chains ≈ hedge; too small, different scope
**裁决叠加(整改令)**:
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P4-12 · 外部副作用 Idempotency Ledger

`External side-effect idempotency ledger` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 0-5% · 状态 **NOT_RUN (W7)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] ActionManifest 强制 idempotencyKey
- must[1] ledger 状态 prepared/sent/confirmed/ambiguous/compensated。
- must[2] provider 若支持原生 key 则透传
- must[3] 不支持时使用目标状态查询/本地 fencing。
- must[4] 执行前 CAS reserve，完成后记录外部 receipt digest。
- must[5] 外部 idempotency ledger 拒绝 stale epoch。
- acceptance[0] 10,000 次随机 crash campaign 中 duplicate external effect 为 0。
- acceptance[1] ambiguous 状态不盲目重试，进入 reconciliation。
- acceptance[2] 同 key 不同参数被拒绝。
- validation[0] 使用可观测 fake external service 在每个网络边界注入 crash。
- validation[1] 测试 provider timeout 但服务已提交。
- validation[2] 对 batch action 验证逐项 ledger。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-03 P4-06 P4-07
- files:[B] `packages/core/agent-loop/src/tool-calls.ts` · [B] `packages/core/tools/src/types.ts` · [B] `packages/session/session-persistence/src/write-behind.ts` · [P] `packages/action/action-manifest/src/types.ts` · [N] `packages/action/action-ledger/src/index.ts` · [N] `packages/action/action-ledger/src/types.ts` · [N] `packages/action/action-ledger/src/store.ts` · [N] `packages/action/action-ledger/tests/idempotency.e2e.ts`
- stages:C:5 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E4 S03 S05 S14
- gate:Same key+different digest rejects; sent/ambiguous never returns to prepared; irreversible duplicates = 0; S03/S05/S14.
- rollback:X/D — stop dispatch, preserve ledger/receipts, reconcile ambiguous entries.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**不用(reject,理由)**:
- idempotency-key (npm) — Does not exist on npm; other idempotency packages are Express middlewares / in-memory
**标准(绑定词汇)**:IETF draft-ietf-httpapi-idempotency-key-header-07 Idempotency-Key passthrough (**本 epic 是形状所有者**) · Stripe same-key-different-params reject
**自己写(residual)**:sqlite ledger(key, params_digest, state prepared\|sent\|confirmed\|ambiguous\|compensated, epoch, receipt_digest) with CAS reserve, stale-epoch rejection from P4-07, ambiguous → P4-13 (~300 LOC + fast-check crash campaign).
**禁令/风险(risk)**:Batch actions need per-item rows; provider-native keys must be passed through verbatim per the IETF header semantics.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No prepared/sent/confirmed/ambiguous/compensated ledger states, no native-provider-key passthrough, no target-state query for ambiguous, no 10k crash campaign, no same-key-different-args rej

#### P4-13 · Reconciliation Engine 与 Saga Compensation

`Reconciliation engine + saga compensation` · L3_CONSUMER · **CONSUMER_WRITE** · 可省 5-10% · 状态 **NOT_RUN (W13)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Tool/provider 可声明 observeState、compareExpected、compensate
- must[1] Harness 编排而非垂直硬编码。
- must[2] 部分成功生成 StateDiff 和 repair options。
- must[3] 不可逆 action 标记 manual intervention，不伪造 rollback。
- acceptance[0] 对半成功 batch 能准确识别已完成项。
- acceptance[1] 补偿本身也生成 ActionManifest、policy/approval、ledger 和 evidence。
- acceptance[2] 重启后 reconciliation 可继续且幂等。
- validation[0] 运行 multi-step saga with failure at each step。
- validation[1] 测试 compensation 失败和二次补偿。
- validation[2] 验证外部真实状态而非 Agent 自报。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-12 P7-02
- files:[P] `packages/action/action-ledger/src/types.ts` · [P] `packages/run/run/src/state-machine.ts` · [B] `packages/core/tools/src/types.ts` · [N] `packages/action/reconciliation/src/index.ts` · [N] `packages/action/reconciliation/src/types.ts` · [N] `packages/action/reconciliation/src/engine.ts` · [N] `packages/action/compensation/src/index.ts` · [N] `packages/action/reconciliation/tests/saga.e2e.ts`
- stages:C:4 文件 · P:3 文件 · U:1 文件 · F:2 文件
- realTask:E4 S03 S05 S14
- gate:Observe/compensate is provider-specific, durable, authorized, evidenced; S03/S05/S14.
- rollback:X/D — stop saga, preserve ledger, escalate ambiguous state; never replay effect.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **Starcounter-Jack/JSON-Patch**(npm `fast-json-patch` · MIT · 1,982★) — 3.1.1 RFC 6902 patch documents
- **AsyncBanana/microdiff**(npm `microdiff` · MIT · 3,866★) — Compute diffs
**不用(reject,理由)**:
- node-sagas — Stale 2023-01
- workflow-es sagas — Stale, mongo/redis
- @node-ts/bus — Not on npm
**标准(绑定词汇)**:JSON Patch RFC 6902 for StateDiff/repair-option representation (**本 epic 是形状所有者**)
**自己写(residual)**:observeState/compareExpected/compensate tool-declared hooks; engine as a workflow over the Run service emitting compensation ActionManifests (policy/approval/ledger/evidence); compensation runs as a nested run (P4-09) (~350 LOC).
**禁令/风险(risk)**:Never fabricate rollback: irreversible ⇒ manual intervention; verify external state, not agent self-report.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No observeState/compareExpected/compensate declarations for tools, no StateDiff/repair options, no saga compensation, no manual-intervention marking for irreversible actions.

#### P4-14 · Partial-Turn Resume、Durable Schedule/Goal Trigger

`Partial-turn resume, durable schedule/goal triggers (PARTIAL)` · L2_PROVIDER · **REUSE_UPSTREAM + CONSUMER_WRITE** · 可省 0% · 状态 **NOT_RUN (W14)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 在模型请求、tool call、tool result、assistant commit 后写 checkpoint boundary。
- must[1] 恢复时根据 ActionLedger/WorkflowJournal 判定继续、重放纯步骤或 reconciliation。
- must[2] Schedule/Goal 触发写 durable trigger event，由 scheduler claim。
- acceptance[0] 任意边界崩溃后不丢 user input、不重复副作用。
- acceptance[1] 错过的 schedule 按 catch-up policy 明确处理。
- acceptance[2] 时区/DST/clock jump 不产生重复触发。
- validation[0] 故障注入覆盖 turn 全路径。
- validation[1] 虚拟时钟测试 DST、跨时区、进程停机。
- validation[2] 对旧 synthetic-close session fixture 保持可读。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-08 P4-12 P4-13
- files:[B] `packages/core/session/src/repair.ts` · [B] `packages/core/session/src/preparation.ts` · [B] `packages/session/session-persistence/src/preparations.ts` · [B] `packages/core/agent-loop/src/agent.ts` · [B] `packages/schedule/README.md` · [B] `packages/goal/README.md` · [N] `packages/run/trigger-service/src/index.ts` · [N] `packages/run/trigger-service/tests/resume.e2e.ts`
- stages:C:4 文件 · P:3 文件 · U:3 文件 · F:2 文件
- realTask:E4 S04 S07 S14
- gate:Checkpoint aligns event offset/run/budget/actions/triggers; trigger neither repeats nor disappears; S04/S07/S14.
- rollback:D/X — disable triggers, fence workers, restore atomic checkpoint, reconcile pending action.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**可选(optional,不进依赖不进 CI)**:
- Hexagon/croner — 10.0.1 only if cron syntax is added (not in must)
- harrisiirak/cron-parser — 5.7.0 same
**不用(reject,理由)**:
- breejs/bree — No
**自己写(residual)**:Resume classifier joining repair codes (TOOL_NOT_STARTED / TOOL_OUTCOME_UNKNOWN) with ActionLedger/WorkflowJournal (continue / replay pure / reconcile), trigger events as outbox rows (P4-06) claimed by the scheduler with explicit catch-up enum skip\|run-once\|run-each (~200 LOC).
**禁令/风险(risk)**:Don't add a second checkpoint store; the session log already is one (step/start, tool/call, tool/result, assistant/message + repair.ts).
**planError**:P4-14's turn-checkpoint package is mostly redundant with upstream session events + repair.ts — collapse to a resume classifier.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-harness-one 17★ 覆盖≈35% [topic-sweep] — bundle·进程内·无 key \| 缺口：Zero coverage of partial-turn checkpoint boundaries (model request / tool call / tool result / assistant commit) -- the plugin relies on dsh sessionPersistence for that. Trigger is persisted
- dsh-automation 86★ — Scheduled fresh-session runs with definition revisions — product prior art, not resume semantics
- dsh-web task-board 6,684★ — Kanban + cron; UI
**裁决叠加(整改令)**:
- §2.C 缩范围:files[] 删与上游/已有实现重复的 [N] 文件,residual 收窄

### P5 · 子代理与多 Agent(12 项)

#### P5-01 · Strategy Router：Direct / ReAct / Plan / Workflow / Multi-Agent

`Strategy router (answer / ReAct / plan-execute / durable-workflow / multi-agent)` · L2_PROVIDER · **PROVIDER_WRITE + QUALIFICATION_REUSE** · 可省 0-10% · 状态 **NOT_RUN (W9)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 输入 TaskProfile、available capabilities、policy、budget、historical outcomes
- must[1] 输出 StrategyDecision 和可解释依据。
- must[2] 策略包括 answer-only、single-agent-react、plan-execute、durable-workflow、multi-agent
- must[3] 不包含垂直角色。
- must[4] Router 只提出结构，不能授予权限或绕过 VerificationContract。
- acceptance[0] 简单只读任务不创建不必要子 Agent。
- acceptance[1] 长时/高风险/多交付物任务不会落到无恢复 single turn。
- acceptance[2] decision 被持久化并可重放。
- validation[0] 建立 100 个通用 task profile fixtures。
- validation[1] 测试预算/风险变化导致的边界决策。
- validation[2] 运行 shadow mode 与人工 gold labels 比较。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-05 P4-02 P4-03
- files:[B] `packages/core/agent/src/dispatch.ts` · [B] `packages/core/agent/src/model-selection.ts` · [B] `packages/core/agent-loop/src/agent.ts` · [B] `packages/workflow/workflow/src/types.ts` · [P] `packages/run/task-profile/src/types.ts` · [N] `packages/router/strategy-router/src/index.ts` · [N] `packages/router/strategy-router/src/types.ts` · [N] `packages/router/strategy-router/src/rules.ts` · [N] `packages/router/strategy-router/tests/router.spec.ts`
- stages:C:4 文件 · P:2 文件 · U:4 文件 · F:1 文件
- realTask:E5 S08 S09
- gate:RunPlan consumes logged decision; shadow cannot change outcome; S08/S09.
- rollback:A/D — gate to previous strategy, retain decisions for replay.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — Budget/risk boundary fixtures (qualification)
**不用(reject,理由)**:
- CacheControl/json-rules-engine — 7.3.1; relocates typed decisions into untyped JSON and loses explainability
- langchain-ai/langgraphjs — Routing inside its own runtime, not applicable
- mastra-ai/mastra — Same
- openai/openai-agents-js — Handoffs inside its own loop
**自己写(residual)**:All of rules.ts/types.ts/index.ts (~400 lines) + 100 fixtures as a waterfall listener like model-selection.ts emitting a strategy/decision session event.
**禁令/风险(risk)**:B-files core/agent/dispatch.ts and agent-loop/agent.ts are upstream hot zone — implement as a waterfall listener, do not edit the loop; ship rule-based first.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- ruflo 70,209★ 覆盖≈30% [topic-sweep] — not-a-plugin·非插件·无 key \| 缺口：Strategy vocabulary is execution-shape over subtasks, not answer-only/single-react/plan-execute/durable-workflow/multi-agent; inputs do not include policy or budget; no explicit 'simple read
- odai-dsh-plugin 107★ 覆盖≈15% — Role dispatch direct/inline/same-turn/child, user-configured, no persisted decision
- dsh-agent-team-gui 163★ 覆盖≈10% — 'Smart planner may skip trivial work' heuristic inside a team plugin

#### P5-02 · Model Router：成功率、成本、延迟、隐私和工具能力联合选择

`Model router (success / cost / latency / residency / tool capability)` · L2_PROVIDER · **PROVIDER_WRITE + REUSE_UPSTREAM** · 可省 20-30% · 状态 **NOT_RUN (W10)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] ProviderModelCapability 描述 context、tool calling、structured output、vision、streaming、data residency、price、latency。
- must[1] Router 输出 primary/fallback/hedge 与置信度，受 policy/budget 硬约束。
- must[2] 先支持规则/统计 provider，再允许学习模型作为可替换 provider。
- acceptance[0] 敏感任务不会路由到不允许的数据区域。
- acceptance[1] 预算和所需工具能力不满足的模型不会被选。
- acceptance[2] 决策和实际 outcome 可用于离线 regret 计算。
- validation[0] 使用 fake provider matrix 做 exhaustive tests。
- validation[1] 注入价格/延迟/不可用变化。
- validation[2] real-model lane 按任务族比较成功率与成本。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-05 P5-01
- files:[B] `packages/core/agent/src/model-selection.ts` · [B] `packages/core/agent/src/types.ts` · [B] `packages/llm/llm/src/index.ts` · [B] `packages/llm/llm/src/call-config.ts` · [P] `packages/run/run-plan/src/types.ts` · [N] `packages/router/model-router/src/index.ts` · [N] `packages/router/model-router/src/types.ts` · [N] `packages/router/model-router/src/score.ts` · [N] `packages/router/model-router/tests/router.spec.ts`
- stages:C:4 文件 · P:3 文件 · U:2 文件 · F:1 文件
- realTask:E5 S08 S09
- gate:Privacy/policy/capability hard filters precede score; decision explainable and logged; S08/S09.
- rollback:A/D — gate to prior router/catalog snapshot; retain decisions.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **sst/models.dev**(MIT · 6,686★) — api.json 212 providers with tool_call/structured_output/reasoning/modalities/limit/cost — vendor a pinned snapshot as fixture (data only)
- **BerriAI/litellm (model_prices JSON)**(NOASSERTION · 57,824★) — model_prices_and_context_window.json 2.09 MB — data-only reuse; router itself is a Python sidecar (rejected)
- **@earendil-works/pi-ai catalog (llm-pi-ai/src/catalog.ts)**(npm `@earendil-works/pi-ai` · MIT · 100,867★) — Already materializes Model{input, reasoning, contextWindow, maxTokens, cost}
**不用(reject,理由)**:
- lm-sys/RouteLLM — Last push 2024-08 — dead research code
- Not-Diamond/notdiamond-python — Hosted SaaS only
- Portkey-AI/gateway — 1.15.2; separate process with own routing config; reachable as optional pi-ai route with zero code
**自己写(residual)**:score.ts (data residency / observed latency / success rate exist in no catalog), router as waterfall over agent/request, regret ledger hooks fed from session-log outcomes.
**禁令/风险(risk)**:Learned routers are Python + dead; every hosted router breaks keyless CI; vendored catalog snapshots drift → pin + refresh script; agent/request is a hot zone.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-subagent-director 14★ 覆盖≈25% — Static per-role provider/model + 4-level fallback; proves the agent/request seam works for subagents
- dockyard-dsh 81★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·需 key/服务 \| 缺口：No price, latency, success-rate, data-residency or tool-calling fields; no primary/fallback/hedge decision with confidence; no policy/budget hard constraints; no decision persistence or offl
- dsh-vision-router 1,051★ 覆盖≈10% — Image→vision-model chain for text-only models = capability shim, not a router
- dsh-llm-fallbacks 20★ 覆盖≈10% — Time-slot chains

#### P5-03 · 模型能力协商与 Provider-Specific Prompt Compiler

`Capability negotiation + provider-specific prompt compiler` · L2_PROVIDER · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 40-50% · 状态 **NOT_RUN (W11)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 provider-neutral PromptIR，包含 instructions、context slices、tool surface、output contract、policy notices。
- must[1] Adapter compiler 只做语义保持转换
- must[2] 不擅自删除安全/验收约束。
- must[3] 编译结果与 capability negotiation 写入 EpochHeader，确保可重建。
- acceptance[0] 同一 PromptIR 在不同 provider 上保留所有 required clauses。
- acceptance[1] 不支持能力时在规划阶段报错或显式降级，不静默忽略。
- acceptance[2] token estimate 与实际误差进入 telemetry。
- validation[0] 为 DeepSeek/OpenAI/Anthropic-compatible adapters 建 golden snapshots。
- validation[1] 使用 clause-preservation tests。
- validation[2] replay 旧 request header 验证可重建。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-06 P5-02
- files:[B] `packages/llm/llm/src/content.ts` · [B] `packages/llm/llm/src/message.ts` · [B] `packages/llm/llm/src/assembler.ts` · [B] `packages/llm/llm/src/call-config.ts` · [B] `packages/core/session/src/request-header.ts` · [N] `packages/llm/prompt-compiler/src/index.ts` · [N] `packages/llm/prompt-compiler/src/types.ts` · [N] `packages/llm/prompt-compiler/tests/golden.spec.ts`
- stages:C:5 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E5 S08 S09
- gate:Roles/tool schema preserved; model-visible inputs logged; exact/≤15% proposed count rule; S08/S09.
- rollback:A/D — select prior compiler and retain PromptIR/request headers for replay.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **badlogic/pi-mono (@earendil-works/pi-ai)**(npm `@earendil-works/pi-ai` · MIT · 100,867★) — 0.84.2 already dep: compat flags for reasoning format, maxTokensField, Bedrock/Anthropic/Responses translation — the adapter compiler already exists
**不用(reject,理由)**:
- microsoft/vscode-prompt-tsx — 0.4.0-alpha; priority pruning is precisely the silent clause-dropping the epic forbids
- BoundaryML/baml — Own DSL + codegen — second language
- vercel/ai — Second IR next to the settled pi-ai twin
- microsoft/prompty — Asset format
**标准(绑定词汇)**:JSON Schema for the output contract (所有者 P0-06,import 其定义) · OTel GenAI semconv gen_ai.usage.* for token-estimate telemetry (所有者 SLICE-3.3:§3.3:名字来自 @opentelemetry/semantic-conventions 常量包,slice 接 pipeline;时点改为 W11 前(P5-03/P5-06 首发 gen_ai.usage.*))
**自己写(residual)**:PromptIR types (instructions / context slices / tool surface / output contract / policy notices), IR→dsh Message[] lowering (one function), clause-preservation golden tests, negotiation + IR hash written into EpochHeader via request-header.ts foldRequestHeader.
**禁令/风险(risk)**:Do not create a second provider-translation layer; token estimate uses CHARS_PER_TOKEN=4 until the tokenizer epic lands.
**planError**:Planned packages/llm/prompt-compiler/src/compile.ts per provider already exists as pi-ai compat + llm-pi-ai/src/context.ts toPiContext + llm-deepseek/src/translate.ts.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-vision-router 1,051★ 覆盖≈10% — 'Unsupported image → explicit vision degrade' is the one negotiation case the community built; core already has projectImagesForTextModel
**裁决叠加(整改令)**:
- §2.C 缩范围:files[] 删与上游/已有实现重复的 [N] 文件,residual 收窄

#### P5-04 · Provider Fallback、Hedging、Rate Limit 与一致预算

`Provider fallback, hedging, rate limit, budget` · L2_PROVIDER · **PROVIDER_ADAPT + REUSE_UPSTREAM** · 可省 30-40% · 状态 **NOT_RUN (W11)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 只在 pre-action reasoning 阶段允许安全 hedge
- must[1] 产生 tool call 后使用单一 winner/fencing。
- must[2] 支持 provider health、rate-limit bucket、regional failover、budget reservation。
- must[3] fallback 记录原因，不把不同 provider 输出偷偷拼接。
- acceptance[0] primary timeout 时 fallback 完成且只执行一组工具动作。
- acceptance[1] 成本不超过 RunPlan 预算。
- acceptance[2] rate limit 不造成 thundering herd。
- validation[0] 模拟 partial stream、late winner、双响应、429/5xx。
- validation[1] 检查 action ledger 无重复。
- validation[2] 并发 100 run 的 rate-limit simulation。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-11 P4-12 P5-02
- files:[B] `packages/llm/llm/src/adapter-failure.ts` · [B] `packages/llm/llm/src/retry-policy.ts` · [B] `packages/llm/llm-retry/src/index.ts` · [B] `packages/core/agent-loop/src/agent.ts` · [N] `packages/router/provider-resilience/src/index.ts` · [N] `packages/router/provider-resilience/src/hedge.ts` · [N] `packages/router/provider-resilience/src/rate-limit.ts` · [N] `packages/router/provider-resilience/tests/fallback.e2e.ts`
- stages:C:4 文件 · P:3 文件 · U:1 文件 · F:2 文件
- realTask:E5 S08 S09
- gate:Only pure/idempotent calls hedge; late results fenced and cost reconciled; S08/S09.
- rollback:X/D — open circuit, cancel hedges, preserve usage/partial receipts.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **connor4312/cockatiel**(npm `cockatiel` · MIT · 1,816★) — 4.0.0: circuit breaker w/ half-open, bulkhead, timeout, fallback, composable; no hedging
- **animir/node-rate-limiter-flexible**(npm `rate-limiter-flexible` · ISC · 3,582★) — 11.2.0: token buckets, BurstyRateLimiter, RateLimiterUnion; use RateLimiterMemory (SQLite backend expects better-sqlite3/sqlite3)
**可选(optional,不进依赖不进 CI)**:
- sindresorhus/p-queue — intervalCap alternative
- nodeshift/opossum — Breaker only
**不用(reject,理由)**:
- SGrondin/bottleneck — Stale 2024-01
- Portkey-AI/gateway — External process; routing decisions leave the session log
- remorses/ai-fallback — 3.0.0 Vercel-AI-only
**自己写(residual)**:hedge.ts (pre-action-only, single-winner fencing keyed to the action ledger), budget reservation against RunPlan, regional failover policy, core-registered llm/fallback event; keep llm-retry/retry-policy as backoff.
**禁令/风险(risk)**:Hedging exists in no JS lib (Polly .NET has it); cockatiel/rate-limiter state is in-memory (not durable across restarts — acceptable).
**planError**:The durable fallback/switch event must be a core event type (dsh-llm-fallbacks #52 shows plugin-declared event types are not loadable).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-llm-fallbacks 20★ 覆盖≈38% — Provider/model fallback chains on agent/request-error after llm-retry, cooldown, half-open recovery, per-role chains — ~35–40% (fallback + health); no hedge/buckets/budget/regional; hit host issue #52 (plugin event types not loadable)
**裁决叠加(整改令)**:
- §2.G 开工前设计决定已定(见该 epic 行)

#### P5-05 · 扩展 Structured SubagentRequest Contract

`Structured SubagentRequest contract` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 0% · 状态 **NOT_RUN (W9)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Request 包含 objective、deliverables、context refs、artifact refs、capability token、WorldSpec、budget、output schema、verification obligations、parent trace。
- must[1] 传引用而非复制全部父上下文
- must[2] provider 决定如何 materialize。
- must[3] 所有字段进入 session/run event，敏感值仅用引用。
- acceptance[0] 内部、Codex、Claude、ACP provider 都通过同一 conformance tests。
- acceptance[1] 子 Agent 无法看到未授权 context/tool/secret。
- acceptance[2] 缺少 required capability 时 spawn 前失败。
- validation[0] 运行 provider contract tests。
- validation[1] 测试 context isolation 和 token attenuation。
- validation[2] SDK serialization round-trip。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-02 P4-03
- files:[B] `packages/subagent/subagent/src/types.ts` · [N] `packages/subagent/subagent/src/request.ts` · [N] `packages/subagent/subagent/tests/request-contract.spec.ts`
- stages:C:5 文件 · P:0 文件 · U:3 文件 · F:2 文件
- realTask:E5 S08 S09
- gate:Runtime PEP enforces every child constraint; parent journal records digest; S08/S09.
- rollback:A/R — retain old decoder; reject requests that cannot be safely attenuated.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **a2aproject/A2A**(npm `@a2a-js/sdk` · Apache-2.0 · 25,602★) — @a2a-js/sdk 1.1.0 types verified: Task, TaskStatus, TaskState, Message, Part, Artifact, AgentCard
**不用(reject,理由)**:
- ucan-wg/ts-ucan — Stale 2024-03; token format belongs to P4-03/Trust Kernel, not here
- biscuit-auth/biscuit — Token format is not this epic's concern — carry only a reference
**标准(绑定词汇)**:A2A Message/Part/Artifact vocabulary (**本 epic 是形状所有者**) · JSON Schema for outputSchema (所有者 P0-06,import 其定义) · W3C Trace Context traceparent  · OCI-style sha256:<hex> content-addressed refs (**本 epic 是形状所有者**)
**自己写(residual)**:request.ts (objective, deliverables, context refs, artifact refs, capability token ref, WorldSpec, budget, verification obligations, parent trace), capability flags per new field, provider conformance suite across 4 providers.
**禁令/风险(risk)**:All B-files are in packages/subagent/subagent/src = upstream hot zone (~7,200 commits/month) — keep additive and land the seam change upstream first.
**planError**:P5-05 patches packages/subagent/subagent/src/* (hot zone) — land upstream, keep fork-side work to conformance tests.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh_workflow 113★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key·一次性提交 \| 缺口：No capability token, tenant/principal, WorldSpec beyond shared-cwd/worktree, artifact refs, or parent trace id in the request. Only one transport is exercised (ctx.subagents 'spawn' default)
- dsh-crew 125★ 覆盖≈0% — Reverse direction (Claude Code/Codex dispatching into dsh)
- dsh-agent-teams 1,285★ 覆盖≈0% — Builds ad-hoc request text on top of ctx.subagents — evidence the contract is wanted
**裁决叠加(整改令)**:
- §2.D 热区改接法:[B] 热区文件换 [N] 新 rung / contribution

#### P5-06 · 扩展 Structured SubagentResult 与完整证据回传

`Structured SubagentResult + evidence return` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 0% · 状态 **NOT_RUN (W11)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Result 包含 status、summary、structured output、artifacts、state diffs、action receipts、tool trace refs、usage/cost、verification hints、continuation token。
- must[1] 大结果存 Artifact Store，只在 Result 放内容寻址引用。
- must[2] 失败保留 partial artifacts 和明确 failure class。
- must[3] 先以通用 ArtifactRef/ActivityRef 回传原始证据入口
- must[4] P7-02 再统一升级为 EvidenceRef。
- acceptance[0] 父级能独立验证 artifact，不依赖 summary。
- acceptance[1] 所有 provider 字段缺失有明确 capability flag。
- acceptance[2] Result 与 child session/run id 一一对应。
- validation[0] 用伪造 summary/错误 artifact fixture 验证父级不盲信。
- validation[1] 测试大输出、partial failure、cancel。
- validation[2] 检查 usage/cost 总和与 provider records 对账。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P5-05 P6-09
- files:[B] `packages/subagent/subagent/src/types.ts` · [B] `packages/workflow/workflow/src/types.ts` · [N] `packages/subagent/subagent/src/result.ts` · [N] `packages/subagent/subagent/tests/result-contract.spec.ts`
- stages:C:3 文件 · P:0 文件 · U:3 文件 · F:2 文件
- realTask:E5 S08 S09
- gate:Versioned result/partial/cancel/receipt states validate ArtifactRef; S08/S09.
- rollback:A/R — retain prior decoder; invalid refs never become completed.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **a2aproject/A2A**(npm `@a2a-js/sdk` · Apache-2.0 · 25,602★) — Artifact{artifactId,name,description,parts,metadata}, TaskState
- **@agentclientprotocol/sdk**(npm `@agentclientprotocol/sdk` · Apache-2.0 · 4,132★) — 1.4.0 already dep; update vocabulary
**标准(绑定词汇)**:A2A Artifact + TaskState enum (incl. input-required/auth-required/rejected) as failure class (所有者 P5-05,import 其定义) · ACP session/update tool_call ids for tool-trace refs (所有者 P2-12,import 其定义) · OTel GenAI gen_ai.usage.* for usage/cost (所有者 SLICE-3.3:§3.3:名字来自 @opentelemetry/semantic-conventions 常量包,slice 接 pipeline;时点改为 W11 前(P5-03/P5-06 首发 gen_ai.usage.*))
**自己写(residual)**:result.ts (status, summary, artifact refs, state diffs, action receipts, tool trace refs, usage/cost, verification hints, continuation token), Artifact Store spill for large results, per-provider capability flags; keep structured validation provider-owned.
**禁令/风险(risk)**:Same hot-zone caveat; cost reconciliation needs token-meter route pricing (route-pricing.ts exists).
**planError**:P5-06 patches the upstream subagent hot zone — land upstream first.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No usage/cost, tool-trace refs, action-receipt list, or continuation token. JSON-Schema + Python only. The DSH plugin never maps a DSH child result back — the child must finalize its lane vi
**裁决叠加(整改令)**:
- §2.D 热区改接法:[B] 热区文件换 [N] 新 rung / contribution

#### P5-07 · Codex Adapter：结构化流、继续执行、审批与证据映射

`Codex adapter: structured stream, continuation, approval, evidence` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_ADAPT** · 可省 60-70% · 状态 **NOT_RUN (W12)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] tool/approval 请求回到父 Policy。
- must[1] 支持 resume/fork，并保存 provider continuation identity。
- must[2] 收集 diff、test output、usage、artifacts，不只最终 answer。
- acceptance[0] 父取消在有界时间内中断 Codex。
- acceptance[1] Codex 不能自行扩大 sandbox/approval。
- acceptance[2] 重连后不重复 turn。
- validation[0] 用官方 app-server fixture 或可控协议 server 做 wire tests。
- validation[1] 真实 Codex E2E 作为可选 lane。
- validation[2] 测试 malformed/unknown item 类型。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P5-05 P5-06 P8-04
- files:[B] `packages/subagent/subagent-codex/src/index.ts` · [B] `packages/subagent/subagent-codex/src/run.ts` · [B] `packages/subagent/subagent-codex/src/wire.ts` · [P] `packages/subagent/subagent/src/request.ts` · [P] `packages/subagent/subagent/src/result.ts` · [N] `packages/subagent/subagent-codex/tests/structured.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:1 文件 · F:2 文件
- realTask:E5 S08 S09 S15
- gate:Extend native lifecycle; structured evidence/approval/continuation; proposed cancel bounds; S08/S09/S15, Q3 for live claim.
- rollback:X/R — cancel session, retain receipts, select prior adapter version.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **openai/codex (app-server protocol)**(npm `@openai/codex` · Apache-2.0 · 120,901★) — Pinned 0.149.1 (npm latest tag 0.145.0); thread/resume, thread/fork, turn/steer, turn/interrupt, thread/list, item/*/requestApproval verified by code search
**自己写(residual)**:Route requestApproval to parent policy/user-approval seam instead of unattendedDecision, persist threadId + thread/resume\|fork, turn/steer for steer, collect diff/test/usage items into SubagentResult evidence; wire.ts (703 lines) already maps items.
**禁令/风险(risk)**:App-server v2 protocol churns (v1.rs + v2 mappers in flux) — wire tests must use recorded fixtures; version pin drift needs a renovate rule.
**planError**:Lists 'new' continuation/map-events files for features the pinned SDK already ships.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-cli-bridge 2★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Approval requests are NOT routed to the parent policy: it forces `-c approval_policy="never"` so a headless run refuses instead of asking; no fork; no reconnect/dedupe semantics because it i
- dsh-codex-connect 74★ 覆盖≈0% — ChatGPT-OAuth LLM route, not a subagent adapter
- dsh-codex-auth 13★ 覆盖≈0% — LLM route
- dsh-plugin-subscriptions 310★ 覆盖≈0% — LLM routes (credentials chapter)
- dsh-codex-sync 25★ 覆盖≈0% — Mirrors skills/MCP
**裁决叠加(整改令)**:
- §2.C 缩范围:files[] 删与上游/已有实现重复的 [N] 文件,residual 收窄

#### P5-08 · Claude Code Adapter：结构化流、会话恢复、工具与 Artifact 映射

`Claude Code adapter: structured stream, session resume, tool/artifact mapping` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_ADAPT** · 可省 60-70% · 状态 **NOT_RUN (W12)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 解析结构化输出/事件而非屏幕文本
- must[1] 映射 tools、subagents、diff、tests、usage。
- must[2] 支持 provider session resume/interrupt 和 worktree identity。
- must[3] 所有外部动作仍由父 policy/action ledger 管理。
- acceptance[0] provider 崩溃可恢复或明确失败，保留 partial evidence。
- acceptance[1] 工具权限不因 Claude 自有设置绕过父 policy。
- acceptance[2] 结果符合统一 SubagentResult。
- validation[0] 协议 fixture 覆盖 stream fragmentation、unknown events、process exit。
- validation[1] 可选真实 Claude Code E2E。
- validation[2] 测试取消/恢复/重复输出。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P5-05 P5-06 P8-04
- files:[B] `packages/subagent/subagent-claude-code/src/index.ts` · [B] `packages/subagent/subagent-claude-code/src/process.ts` · [B] `packages/subagent/subagent-claude-code/src/run.ts` · [P] `packages/subagent/subagent/src/request.ts` · [P] `packages/subagent/subagent/src/result.ts` · [N] `packages/subagent/subagent-claude-code/tests/structured.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:1 文件 · F:2 文件
- realTask:E5 S08 S09 S15
- gate:Native provider mapping, recovery, artifacts and proposed cancel bounds; S08/S09/S15, Q3 for live claim.
- rollback:X/R — terminate child, retain session/evidence, select prior adapter.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **anthropics/claude-agent-sdk-typescript**(npm `@anthropic-ai/claude-agent-sdk` · 1,725★) — Pinned 0.3.241 (latest 0.3.246): Options.resume/continue/forkSession/canUseTool/hooks/permissionMode; forkSession(), getSessionInfo(), listSubagents(), getSubagentMessages(); worktree-aware session listing
**自己写(residual)**:canUseTool → parent policy (today run.ts:326-357 pre-computes disallowedTools), persist session_id + resume/forkSession, query.interrupt() → cancel, SDK subagent messages + usage → SubagentResult, cwd = worktree from P5-12, pin settingSources: [] with a test that permissive local settings are ignored.
**禁令/风险(risk)**:SDK is 0.3.x and moves daily; 'Claude's own settings cannot bypass parent policy' must be asserted by a test, not assumed.
**planError**:Lists 'new' files for features the pinned SDK already ships.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-cli-bridge 2★ 覆盖≈45% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No unified SubagentResult conformance (its own RunEnd/DelegationSnapshot shape); no parent policy/action ledger governing individual tool actions (only the coarse 3-mode flag; `extraArgs` is
- dsh-movein 15★ 覆盖≈0% — Imports Claude Code sessions/config (migration, not delegation)
- dsh-claude-move 14★ 覆盖≈0% — Migration
- dsh-chat-import 131★ 覆盖≈0% — Migration
**裁决叠加(整改令)**:
- §2.C 缩范围:files[] 删与上游/已有实现重复的 [N] 文件,residual 收窄

#### P5-09 · ACP Provider：远程可继续会话、Trace 枚举与安全身份

`ACP provider: remote resumable session, trace enumeration, secure identity` · L2_PROVIDER · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 50% · 状态 **NOT_RUN (W18)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] ACP handshake 协商 identity、capabilities、protocol version、resume token、event cursor。
- must[1] 远程 child 事件映射到可枚举 trace，artifact 使用内容寻址。
- must[2] 支持 authenticated continue/cancel/steer。
- acceptance[0] 断线重连后从 cursor 继续且不丢/重复事件。
- acceptance[1] 远程 child 无法伪造 tenant/parent identity。
- acceptance[2] 父级能列出、查询和取消 ACP child。
- validation[0] 运行 reconnect/replay/out-of-order tests。
- validation[1] 测试 forged continuation token。
- validation[2] 与 SDK protocol compatibility matrix 联测。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P5-05 P8-01 P8-05
- files:[B] `packages/subagent/subagent-acp/src/index.ts` · [B] `packages/subagent/subagent-acp/src/run.ts` · [B] `packages/subagent/subagent/src/continuation.ts` · [B] `packages/sdk/protocol/src/types.ts` · [N] `packages/subagent/subagent-acp/src/session.ts` · [N] `packages/subagent/subagent-acp/src/events.ts` · [N] `packages/subagent/subagent-acp/tests/continuation.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:1 文件 · F:2 文件
- realTask:E5 S08 S09 S15
- gate:Capability negotiation/server authorization/reconnect/dedupe/proposed cancel bounds; S08/S09/S15, Q3 for live claim.
- rollback:R/X — cancel/revoke remote session, retain trace/receipts and prior protocol.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **agentclientprotocol/agent-client-protocol**(npm `@agentclientprotocol/sdk` · Apache-2.0 · 4,132★) — SDK 1.4.0 (fork pin; npm latest 1.3.0) methods verified in dist; no event cursor
**可选(optional,不进依赖不进 CI)**:
- a2aproject/A2A — tasks/resubscribe + push notifications fit HTTP-remote better — a future subagent-a2a provider, not an ACP extension
**标准(绑定词汇)**:ACP 1.4.0 session/load, session/resume, session/fork, session/list, session/request_permission, authenticate, sessionCapabilities (所有者 P2-12,import 其定义)
**自己写(residual)**:Negotiate sessionCapabilities at initialize, session/load\|resume on reconnect, session/request_permission → parent policy, session/fork; dsh-side monotonic cursor on the child's session log (ACP has none); Trust-Kernel-signed continuation token for identity anti-forgery.
**禁令/风险(risk)**:Protocol version pinning (PROTOCOL_VERSION 2; fork pins 1.4.0 while npm latest is 1.3.0 — confirm channel); authenticated steer beyond prompt/cancel is not an ACP method.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-product-subagents 19★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No identity/tenant negotiation, no resume token + event cursor (loadSession failure silently falls back to a NEW session = lost continuity, violating no-loss/no-dup acceptance); no enumerabl
- @openma/deepseek-harness-acp 21★ 覆盖≈10% — dsh AS ACP agent for Zed — reverse direction, already covered by packages/acp (<10%)
- dsh-awiki 14★ 覆盖≈10% — ANP DID identity — network identity, out of keyless-local scope (<10%)
**裁决叠加(整改令)**:
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P5-10 · Continuation、Steer、Human Input 与 Cancellation Convergence 修复

`Continuation / steer / human-input / cancellation convergence` · L2_PROVIDER · **REUSE_UPSTREAM + QUALIFICATION_REUSE** · 可省 0% · 状态 **NOT_RUN (W7)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 区分 continue、steer、inject、cancel、human-answer
- must[1] 每类定义优先级和状态前置条件。
- must[2] 所有 control message durable、带 epoch、幂等。
- must[3] 取消进入 convergence barrier，确认 child/world/actions 停止后才终态。
- acceptance[0] 在取消同时发送 steer/continue 不会唤醒已取消 child。
- acceptance[1] human answer 只送到指定等待点。
- acceptance[2] 重复 control message 不产生重复 turn。
- validation[0] 运行 race scheduler 10,000 seeds。
- validation[1] 覆盖 cancellation wake gap 回归。
- validation[2] 测试 parent crash during convergence。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-06 P4-07
- files:[B] `packages/subagent/subagent/src/continuation.ts` · [B] `packages/subagent/subagent/src/lifecycle.ts` · [B] `packages/subagent/subagent/src/child-agent.ts` · [B] `packages/subagent/subagent/src/client.ts` · [B] `packages/core/agent/src/inbox.ts` · [B] `packages/subagent/subagent/src/control.ts` · [N] `packages/subagent/subagent/tests/control-race.e2e.ts`
- stages:C:3 文件 · P:2 文件 · U:3 文件 · F:2 文件
- realTask:E5 S08 S14 S15
- gate:Convergence barrier waits for child/world/action receipts and meets the proposed ≤30 s recovery bound; cancelled child never revives; S08/S14/S15.
- rollback:D/X — fence delegation, preserve partial result, reconcile remote cancellation.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 18 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - P5-10 Contract — must[0]/must[1]: each kind acts only in the phases that admit it steer and continue are admitted while running
    - P5-10 Contract — must[0]/must[1]: each kind acts only in the phases that admit it acceptance[0]: a steer arriving while the child is CANCELL
    - P5-10 Contract — must[0]/must[1]: each kind acts only in the phases that admit it acceptance[0]: a continue arriving while cancelling is ref
    - P5-10 Contract — must[0]/must[1]: each kind acts only in the phases that admit it nothing at all is admitted in terminal — a message after t
    - …共 18 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 11 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - P5-10 Provider — an admitted message reaches its Agent operation must[0]: each kind maps onto the operation that kind names
    - P5-10 Provider — an admitted message reaches its Agent operation acceptance[0]: a steer arriving while cancelling reaches the Agent NOT AT A
    - P5-10 Provider — an admitted message reaches its Agent operation acceptance[0]: cancel arriving BESIDE a steer is applied first, whatever or
    - P5-10 Provider — an admitted message reaches its Agent operation acceptance[2]: a redelivered message dispatches once, not twice
    - …共 11 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 6 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - P5-10 Usage — a prompt that races an interrupt acceptance[0]: after an interrupt, the next prompt is refused and never reaches the child
    - P5-10 Usage — a prompt that races an interrupt a child that was never interrupted takes its prompt as before
    - P5-10 Usage — a prompt that races an interrupt acceptance[2]: the same request id delivered twice opens one turn, not two
    - P5-10 Usage — a prompt that races an interrupt a redelivery is refused as a DUPLICATE, not as a child that cannot resume
    - …共 6 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 4 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - P5-10 Fault — one child's control state cannot decide another's an interrupt on one child leaves a sibling promptable
    - P5-10 Fault — one child's control state cannot decide another's the SAME request id delivered to two different children is two deliveries
    - P5-10 Fault — one child's control state cannot decide another's interrupting a child that was never prompted still refuses its next prompt
    - P5-10 Fault — one child's control state cannot decide another's KNOWN GAP: control state is retained for every child seen, and nothing relea
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — 4.8.0 installed; scheduler() arbitrary for the 10,000-seed race test — replaces ~200 lines of custom race harness
**自己写(residual)**:Unified 5-way vocabulary (continue/steer/inject/cancel/human-answer) with priority + state preconditions, durable epoch-tagged control log, convergence barrier (child + world + actions quiescent before terminal); continuation.ts (1,569 lines) already has steer/inject/cancel/epoch/cold-resume/settlement.
**禁令/风险(risk)**:Highest hot-zone risk in the chapter: continuation.ts is upstream-owned and refactored monthly — land vocabulary + barrier upstream; fork keeps the property test and the parent-crash fixture.
**planError**:P5-10 patches the upstream subagent hot zone — land upstream first.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-Visual-Workflow 14★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Control messages are in-memory only (no durability, epoch, or idempotency key); interrupt is best-effort with no convergence barrier confirming child/world/actions stopped before the termina
- dsh-recall-unread 123★ 覆盖≈0% — UI to recall unread steering text
- dsh-queue-plus 16★ 覆盖≈0% — Queue panel — UI only
**裁决叠加(整改令)**:
- §2.F planError 已解决,记录即可
- §10.3-4:actions 半供给方钉为 P2-03(in-flight = 已 append manifest 无配对终态记录);P2-03 验收后写该用例;world 半等 P3-01

#### P5-11 · 通用 Taskboard、Mailbox 与 Blackboard 原语

`Generic taskboard / mailbox / blackboard primitives` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_WRITE** · 可省 40-50% · 状态 **ACCEPTED (W7)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Task 支持 atomic claim、attempt、lease、owner、artifact outputs、verification status。
- must[1] Blackboard 只存结构化 facts/artifact refs，带 provenance。
- must[2] 角色、组织图和 captain 保持插件/skill 层。
- acceptance[0] 多进程并发 claim 只有一个 winner。
- acceptance[1] 模型未手动更新任务时，runtime 根据 receipts 推进状态。
- acceptance[2] 循环依赖在提交时拒绝。
- validation[0] 运行 100 worker claim stress。
- validation[1] 测试消息去重、blackboard provenance、dependency release。
- validation[2] 对社区插件做 adapter proof-of-concept，不复制其垂直 UI。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-06 P4-07
- files:[B] `packages/core/agent/src/consumed-work.ts` · [B] `packages/core/agent/src/inbox.ts` · [B] `packages/subagent/subagent/src/list-children.ts` · [P] `packages/run/run/src/types.ts` · [N] `packages/collaboration/taskboard/src/index.ts` · [N] `packages/collaboration/taskboard/src/types.ts` · [N] `packages/collaboration/taskboard/src/store.ts` · [N] `packages/collaboration/mailbox/src/index.ts` · [N] `packages/collaboration/blackboard/src/index.ts` · [N] `packages/collaboration/taskboard/tests/claims.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:5 文件 · F:1 文件
- realTask:E5 S08
- gate:The primitives cannot substitute for one another or become a second Run/lock truth; mutations require tenant capability and CAS; S08.
- rollback:D — fence claims, replay task journal, retain messages.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 20 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede · 有 supplement
    - carries exactly the enumerated fields
    - represents an unclaimed task with explicit nulls, not absent fields
    - claims an open task, taking ownership and a lease
    - refuses a second worker while the first claim is live
    - …共 20 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 10 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - admits the first claimant and refuses every later one
    - lets the next worker win once the first claim lapses, at a higher attempt
    - persists the winning claim, so a later read sees the owner
    - refuses a claim on an unknown task
    - …共 10 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 14 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - admits a structured value and a stored reference
    - refuses a bare string, an array and null, even when the type would allow them
    - requires an observed fact to name its source
    - requires a derived fact to name at least one source it can resolve
    - …共 14 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 20 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - P5-11 Fault — claim and graph boundary matrix enumerates at least twelve boundaries, each named once
    - fault boundary 01 an open task admits its first claim
    - fault boundary 02 a live claim refuses a second worker
    - fault boundary 03 a claim is still held AT its expiry instant
    - …共 20 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **packages/experimental/agent-team (existing)** — task-board.ts DAG/blockedBy/writeScopes/revision CAS, task-graph.ts cycle reject, mailbox.ts durable point-to-point — promote into the Service Definition
**不用(reject,理由)**:
- timgit/pg-boss — Postgres-only
- taskforcesh/bullmq — Redis-only
- graphile/worker — Postgres; claim+lease is ~100 lines over node:sqlite BEGIN IMMEDIATE
**标准(绑定词汇)**:W3C PROV-DM field names for blackboard provenance (wasGeneratedBy, wasAttributedTo, wasDerivedFrom) (本 epic 未采用/不采用;所有者 P6-09,见裁决叠加)
**自己写(residual)**:Attempt/lease/owner fields, multi-process single-winner claim (sqlite BEGIN IMMEDIATE + UPDATE … WHERE owner IS NULL), receipt-driven status advance, blackboard (structured facts + artifact refs + provenance), moving roster/captain out to plugin layer.
**禁令/风险(risk)**:Planned packages/collaboration/* would be a second implementation beside agent-team's 700+ lines of DAG/mailbox.
**planError**:P5-11 plans packages/collaboration/* from scratch next to agent-team — promote agent-team's DAG/mailbox into the Service Definition instead.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-agent-teams 1,285★ 覆盖≈48% — Atomic claim + attempt_id + revoke/quiesce + cold-restart recovery + durable jsonl mailbox + captain/roles + quality gates — ~45–50%; single-process JSON state, no lease expiry, no blackboard, 12 UI peer deps, pinned to alpha.2; make it the first consumer/adapter PoC
- allinluna 51★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No mailbox or blackboard primitives, no multi-process claim test, Python/sqlite. dsh already has packages/experimental/agent-team task DAG with revision CAS — this is a parallel design, not
- DSH-taskboard 282★ 覆盖≈30% — node:sqlite authority, blocked status, relations, agent tools limited to in_review, CLI — persistence + human gate; no claim/lease/DAG
- @dsh-suite/plugin-team-board 50★ 覆盖≈15% — task_claim in-memory
- dsh-client-ui-task-board 6,717★ 覆盖≈15% — Cron kanban that runs sessions — a P4 schedule neighbour
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK(非重复:agent-team 无 claim/lease);PROV 词汇债 → P7-04
- §7.10:planError(应提升 agent-team 的 DAG/mailbox 而非新建 collaboration/*)——核实 agent-team 2452 行无 claim/lease/mailbox/DAG 原语(0 提及),前提不成立;taskboard 自带 dependsOn。**不是重复**

#### P5-12 · 多 Agent 协调安全、Worktree 隔离与 Router Regret 评测

`Multi-agent coordination safety, worktree isolation, router-regret eval` · L2_PROVIDER · **PROVIDER_WRITE + CONSUMER_WRITE** · 可省 10% · 状态 **NOT_RUN (W10)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 每个写代码/文件的 child 获得隔离 workspace/worktree
- must[1] merge 由显式 queue 与 verifier 控制。
- must[2] 检测等待图循环、消息风暴、重复任务、无进展循环和 agent budget。
- must[3] shadow 比较单/多 Agent 的成功率、成本、延迟，计算 regret。
- acceptance[0] 并发修改同一文件不会直接覆盖。
- acceptance[1] 死锁在阈值内被发现并产生可行动诊断。
- acceptance[2] Router 不因任务看似复杂就默认多 Agent
- acceptance[3] 需证据支持。
- validation[0] 运行冲突 merge corpus 和 wait-for graph tests。
- validation[1] 50-agent scale test。
- validation[2] 在 benchmark 中做 paired single-vs-multi runs。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-10 P5-01 P5-11
- files:[B] `packages/workflow/workflow-worker-thread/src/runtime.ts` · [B] `packages/subagent/subagent/src/depth.ts` · [B] `packages/workspace/workspace/src/entity.ts` · [P] `packages/router/strategy-router/src/index.ts` · [N] `packages/workspace/worktree-provider/src/index.ts` · [N] `packages/workspace/worktree-provider/src/merge.ts` · [N] `packages/collaboration/coordination-guard/src/index.ts` · [N] `packages/evaluation/router-regret/src/index.ts` · [N] `packages/collaboration/coordination-guard/tests/deadlock.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:3 文件 · F:2 文件
- realTask:E5 S08
- gate:Actual filesystem/git observations; v1.1 deadlock bound; all worktrees/locks cleaned; S08.
- rollback:D/X — cancel agents, preserve branches/diffs, release leases and garbage-collect only owned worktrees.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **git worktree via execa (already dep)**(npm `execa`) — git worktree add --detach / remove / prune — smaller than any wrapper
**不用(reject,理由)**:
- steveukx/git-js (simple-git) — 3.36.0; no worktree API (only raw) → deletes nothing vs execa
- isomorphic-git/isomorphic-git — 1.41.9; no worktree support
- dagrejs/graphlib — 4.0.5; wait-for cycle detection is 40 lines and agent-team/task-graph.ts already has one
- promptfoo/promptfoo — Evaluates prompts/models, not harness strategies
**自己写(residual)**:worktree-provider (add/remove/prune/merge queue + verifier gate, ~300 lines), coordination-guard (wait-for graph, message-storm/no-progress/duplicate-task detectors, agent budget), router-regret (paired single-vs-multi runs → regret).
**禁令/风险(risk)**:Merge queue semantics (verifier-gated, explicit) are dsh-specific; 50-agent scale test needs the P5-11 sqlite claim first; regret needs P5-01 decisions persisted + a P8/P9 benchmark corpus.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-cli-bridge 2★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Verifier is optional LLM review, not a required verification gate; no coordination guard (no wait-graph cycle, message-storm, duplicate-task or no-progress detection — children never wait on
- dsh_workflow 113★ 覆盖≈15% — Says the dsh subagent seam lacks worktree → register registerIsolationAdapter() or fail loud — direct evidence a core worktree seam is missing (<15%)
- dsh-lark-bot 38★ 覆盖≈15% — git-worktree per-scope workspaces (<15%)
- dsh-univer-office 234★ 覆盖≈15% — Isolated worktrees for multi-agent (<15%)

### P6 · 上下文与记忆(10 项)

#### P6-01 · 原生 Memory Service Definition（Provider-Neutral）

`Provider-neutral Memory Service Definition` · L1_CONTRACT · **CONTRACT_WRITE + CATALOG_ADOPT** · 可省 0% · 状态 **NOT_RUN (W4)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 propose/query/get/revise/forget/export 接口和事件，不指定向量库/图数据库。
- must[1] Memory provider 可替换
- must[2] consumer 通过 Service Definition，不 direct import。
- must[3] 所有读取受 principal、purpose、scope 和 context budget。
- acceptance[0] 至少 local reference provider 和 fake provider 通过 conformance。
- acceptance[1] 不存在模型直接写入 durable memory 的旁路。
- acceptance[2] Memory 不等于 Session Query，二者边界文档明确。
- validation[0] 运行 provider load/unload/replacement tests。
- validation[1] 测试跨 tenant/scope 读取。
- validation[2] 验证 model-visible memory 全部有 logged projection event。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-03 P2-01
- files:[B] `packages/context/README.md` · [B] `packages/session-query/session-query/src/types.ts` · [B] `packages/core/agent-loop/src/runtime-context.ts` · [B] `packages/bundle/base/cordis.patch.yml` · [N] `packages/memory/memory/src/index.ts` · [N] `packages/memory/memory/src/types.ts` · [N] `packages/memory/memory/src/invariant.ts` · [N] `packages/memory/memory/tests/conformance.spec.ts` · [N] `docs/subsystems/memory.md`
- stages:C:5 文件 · P:2 文件 · U:4 文件 · F:1 文件
- realTask:E6 S02 S11
- gate:Agent loop resolves composed service and records real events; no per-turn backend construction/catch-all; S02/S11.
- rollback:A/D — switch profile to prior provider while keeping record decoder.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 19 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - conformance: fake provider (acceptance[0] + must[0]) propose() accepts a candidate record and resolves a new MemoryRecordId
    - conformance: local reference provider (acceptance[0] + must[0]) propose() accepts a candidate record and resolves a new MemoryRecordId
    - conformance: fake provider (acceptance[0] + must[0]) query() resolves matching records honoring the caller-supplied context budget
    - conformance: local reference provider (acceptance[0] + must[0]) query() resolves matching records honoring the caller-supplied context budge
    - …共 19 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 17 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - a second provider instance over the same directory reads back a record the first instance proposed
    - a provider instance over a different directory does not see the first directory's record — durability is per-directory, never process-global
    - a revise() by one instance is the content a later instance reads back
    - a forget() by one instance stays forgotten for a later instance, while a sibling record it did not forget stays readable
    - …共 17 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 13 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - carries all four read-scoping dimensions from config when the agent has no attached identity
    - prefers the agent's durably attached principal over the configured fallback id
    - never reads across tenants: the scope tenant is the configured one, not the attached principal's
    - returns undefined for an empty recall so no empty snapshot is ever injected
    - …共 13 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 27 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - local-reference: export() under tenant-b returns no record proposed under tenant-a
    - local-reference: query() under tenant-b matches no record proposed under tenant-a, even on an exact content term
    - local-reference: get() under tenant-b resolves undefined for an id proposed under tenant-a
    - local-reference: forget() under tenant-b leaves the tenant-a record it names intact
    - …共 27 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**可选(optional,不进依赖不进 CI)**:
- mem0ai/mem0 — npm 3.1.7 /oss TS impl needs LLM+embedder, non-persistent vector store; auto-writes extracted facts → only an optional provider whose writes become MemoryProposals
- getzep/graphiti — Neo4j/FalkorDB + LLM sidecar
- letta-ai/letta — Server sidecar
**不用(reject,理由)**:
- run-llama/LlamaIndexTS — ARCHIVED 2026-03
- langchain-ai/langchainjs — Chat-history/summary buffers only
- mastra-ai/mastra @mastra/memory — 1.28.1 Apache-2.0 but tied to Mastra storage/vector abstractions; auto-extract semantics
**标准(绑定词汇)**:Mem0 OSS API op names add/search/get/update/delete/history (alignment)  · dsh-memory-protocol v1 (dsh-memento)
**自己写(residual)**:MemoryService{propose,query,get,revise,forget,export} + events + invariant + conformance; offer the two existing injection shapes (agent/pre-step waterfall, ctx.systemPrompt section) so plugins migrate by deleting hook code.
**禁令/风险(risk)**:Adopting Mem0/Mastra as the definition imports auto-extract semantics (model writes memory directly) — violates 'no model bypass to durable memory'; keyless CI cannot run any LLM-extracting memory.
**planError**:Mem0/Zep/Letta are Python/server memory products whose auto-extraction contradicts P6-01's no-bypass rule — optional providers only.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-memento 80★ 覆盖≈35% — Zero-dep node:sqlite provider defining ctx.memory seam, approval-gated writes, adapter registry, conformance suite + JSON schema; missing propose/verify lifecycle, purpose/scope/tenant/budget, provenance, event-logged projection — borrow suite/golden pattern
- dsh-knowledge 22★ 覆盖≈20% [topic-sweep] — bundle·进程内·无 key \| 缺口：It is a document knowledge base, not agent memory: no propose/revise/forget lifecycle or events, no MemoryRecord semantics; scope is a UI toggle per base, not principal/purpose gating; the m
- @openviking/dsh-memory-plugin 35,035★ — OpenViking server-backed; hand-rolled store + agent/pre-step injection — would become a provider
- @vectorize-io/hindsight-coding-agents 22,121★ — Hindsight daemon-backed; same hook triple
- @agentscope-ai/reme 3,384★ — Local Markdown KB, BM25
- @zilliz/memsearch-dsh 2,549★ — Python memsearch CLI + Milvus
- dsh-deja 757★ — Local BM25 over session files, zero-network
- graph-memory 591★ — Own typed graph store
**裁决叠加(整改令)**:
- §2.G 开工前设计决定已定(见该 epic 行)
- §9.2 生态迁移目标:136 个 memory 插件手搓 store,注入挂 agent/pre-step 或 ctx.systemPrompt 段——两种形态必须 wire-compatible;dsh-memento 的 ctx.memory provider 形态直接可挂;borrow 其 conformance suite + JSON schema + golden;冻结"现有形态插件不改代码可作 provider"用例

#### P6-02 · MemoryRecord：来源、置信度、TTL、范围、用途与冲突

`MemoryRecord: provenance, confidence, TTL, scope, purpose, conflict` · L1_CONTRACT · **CONTRACT_WRITE + QUALIFICATION_REUSE** · 可省 0-5% · 状态 **ACCEPTED (W5)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] MemoryRecord 含 content artifact/ref、kind、subject、source events、created/valid time、confidence、scope、purpose、TTL、sensitivity、status。
- must[1] 冲突不覆盖旧记录，而是建立 supersedes/disputes relation。
- must[2] 敏感字段不进入 embedding/索引除非 policy 允许。
- acceptance[0] 每条记忆可追溯至少一个来源或明确标记 user-asserted。
- acceptance[1] 过期/撤销记录不进入默认检索。
- acceptance[2] 跨 scope 合并必须显式。
- validation[0] 测试时间有效性、冲突链、source deletion。
- validation[1] fuzz record validation。
- validation[2] 查询结果必须返回 provenance。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-06 P6-01
- files:[P] `packages/memory/memory/src/types.ts` · [B] `packages/core/session/src/types.ts` · [P] `packages/identity/principal/src/types.ts` · [N] `packages/memory/memory/src/record.ts` · [N] `packages/memory/memory/src/provenance.ts` · [N] `packages/memory/memory/tests/record.spec.ts`
- stages:C:5 文件 · P:0 文件 · U:2 文件 · F:1 文件
- realTask:E6 S02 S11
- gate:Source is EvidenceRef, not a string; valid/transaction time and purpose are preserved; S02/S11.
- rollback:A/D — retain old decoder and dual-read records until migrated.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 20 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - carries content, kind, subject, provenance, times, confidence, scope, purpose, sensitivity, status and relations
    - distinguishes inline content from a stored reference
    - treats an open-ended validity as an explicit null, not an absent field
    - refuses a derived record naming no source event
    - …共 20 条(分布在 1 个冻结条目),见 command-freeze.json
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:1 条有效冻结 / 8 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - permits it and reports that no boundary was crossed
    - treats the same tenant and session as one scope
    - refuses a cross-tenant merge with no authorization
    - refuses a cross-session merge with a DIFFERENT reason from a cross-tenant one
    - …共 8 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 19 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - P6-02 Fault — record boundary matrix enumerates at least twelve boundaries, each named once
    - fault boundary 01 confidence below zero is refused
    - fault boundary 02 confidence above one is refused
    - fault boundary 03 NaN confidence is refused, not admitted by two false comparisons
    - …共 19 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **w3c/prov**(2★) — Relation vocabulary
- **w3c/dpv**(81★) — Purpose/personal-data vocabulary shared with P6-10
- **dubzzz/fast-check**(npm `fast-check` · MIT) — Already dev dep; arbitraries over the zod schema
**只读参考(reference)**:
- getzep/graphiti — Field naming precedent
**标准(绑定词汇)**:W3C PROV-DM relations wasDerivedFrom/wasGeneratedBy/wasAttributedTo (本 epic 未采用/不采用;所有者 P6-09,见裁决叠加) · Graphiti-style bitemporal fields created_at/valid_at/invalid_at/expired_at  · W3C DPV for purpose & personal-data categories (本 epic 未采用/不采用;所有者 P6-10,见裁决叠加)
**自己写(residual)**:Record/zod schema, conflict chain, sensitivity-gated indexing; vocabulary adoption only.
**禁令/风险(risk)**:No library models 'agent memory record'; inventing new provenance names when PROV exists would be the mistake.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-memento 80★ 覆盖≈25% — MemoryEntry (track/scope/workspaceKey/agentKey/text/source/tags/version/recallCount); no evidence links or supersedes/disputes
- powercontext-dsh 11★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No confidence, TTL, valid-time, purpose, sensitivity level, subject, created-time, or explicit supersedes/disputes relation; conflicts are rejected (409) rather than recorded as disputes. us
- graph-memory 591★ — Typed nodes/edges
- dsh-mneme — Heat-decay TTL
**裁决叠加(整改令)**:
- §7.1 已验收核验:词汇债(R3):PROV/DPV 0,bitemporal 半 → P6-03

#### P6-03 · Memory Proposal、验证、合并、遗忘与导出

`Memory proposal / verify / merge / forget / export` · L2_PROVIDER · **PROVIDER_WRITE + PROVIDER_ADAPT** · 可省 25-35% · 状态 **NOT_RUN (W8)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] Agent 只能提交 MemoryProposal，包含证据、预期用途、TTL、敏感等级。
- must[1] Policy 决定 auto-accept/review/reject
- must[2] 高敏感默认人工。
- must[3] 支持 merge、supersede、forget、export、right-to-erasure，并传播到索引。
- acceptance[0] 伪造无证据 proposal 不进入 active memory。
- acceptance[1] forget 后主存、索引、cache、projection 在 SLA 内清除并留下合规 tombstone。
- acceptance[2] 导出包含来源和冲突状态。
- validation[0] 运行 hallucinated-memory corpus。
- validation[1] 测试 erase propagation 与 backup policy。
- validation[2] 在线 memory precision/utility 指标进入 eval。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-05 P2-12 P6-02
- files:[P] `packages/memory/memory/src/index.ts` · [P] `packages/memory/memory/src/record.ts` · [P] `packages/interaction/human-channel/src/types.ts` · [N] `packages/memory/memory-policy/src/index.ts` · [N] `packages/memory/memory-policy/src/proposal.ts` · [N] `packages/memory/memory-policy/src/conflict.ts` · [N] `packages/memory/memory-policy/tests/lifecycle.e2e.ts`
- stages:C:4 文件 · P:1 文件 · U:1 文件 · F:2 文件
- realTask:E6 S02 S11
- gate:Conflict remains explicit; proposed Q1 erase ≤60 s with residue tombstone/evidence; S02/S11.
- rollback:D/K — pause writers/erase jobs, restore record versions/tombstones, retain holds.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **node:sqlite FTS5** — FTS5 compiled in (verified); keyless default BM25 ranking
- **asg017/sqlite-vec**(npm `sqlite-vec` · Apache-2.0 · 8,069★) — 0.1.9 MIT-OR-Apache prebuilt darwin/linux/win; loads into node:sqlite via loadExtension(getLoadablePath())
- **xiaowu0162/LongMemEval**(MIT · 1,051★) — Eval corpus (qualification)
- **HUST-AI-HYZ/MemoryAgentBench**(MIT · 444★) — Eval corpus (qualification)
**可选(optional,不进依赖不进 CI)**:
- lancedb/lancedb — 0.38.0 native
- chroma-core/chroma — 3.5.0 is a client → server
- mem0ai/mem0 (OSS TS) — Optional provider
- snap-research/locomo — Stale 2024; license unasserted — check before vendoring
**自己写(residual)**:Policy, proposal evidence check, tombstone + erase SLA propagation (FTS/vec tables, projection caches, P6-09 refs), export with provenance, hallucinated-memory corpus (must be synthesized); EmbeddingProvider is a small L1 gap.
**禁令/风险(risk)**:sqlite-vec is pre-1.0 (0.1.9, last push 2026-05) — pin + conformance-test the extension load path; Windows partial; do NOT pick a second sqlite driver.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-memento 80★ 覆盖≈40% — Approval gate, budgets, consolidate, adapter export; no evidence requirement, tombstones, erase propagation, TTL
- dsh-knowledge 22★ 覆盖≈15% [topic-sweep] — bundle·进程内·无 key \| 缺口：No MemoryProposal (evidence/expected use/TTL/sensitivity), no policy tiers (auto-accept/review/reject), no human-by-default for high sensitivity, no merge/supersede, no compliance tombstone,
- dsh-memory-system 9★ — Approval-gated lease-lock writes
- meow-memory 73★ — node:sqlite 7-layer
- dsh-layered-memory — Hybrid BM25+vector

#### P6-04 · Context Graph 与 Retrieval Planner

`Context graph + retrieval planner` · L2_PROVIDER · **PROVIDER_WRITE + PROVIDER_ADAPT** · 可省 15-20% · 状态 **NOT_RUN (W11)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] ContextNode/Edge 引用原始 source，不复制真值
- must[1] provider 可贡献 code/artifact/domain graph。
- must[2] RetrievalPlan 指定 sources、queries、filters、token/time budget、rerank、stop conditions。
- must[3] 检索结果带 trace、score、policy decision 和被舍弃原因。
- must[4] 把来自 web、MCP、附件、仓库和外部工具的内容标记为 untrusted-data
- must[5] 不得把其中的指令提升为 system/developer policy。
- acceptance[0] 预算耗尽时确定性停止，不无限搜索。
- acceptance[1] 敏感源在计划阶段被 policy 过滤。
- acceptance[2] 同一 source 不因多个插件重复注入。
- acceptance[3] Prompt-injection canary 不能改变 Tool allowlist、Policy、Approval 或 RunPlan
- acceptance[4] 只能作为待分析数据。
- validation[0] 构造多源冲突/重复/超预算 fixtures。
- validation[1] 测 precision/recall 与 token cost。
- validation[2] 验证 session-query trace 与 context projection 对齐。
- validation[3] 运行 indirect prompt injection、retrieval poisoning、malicious README/MCP resource fixtures。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P6-01 P6-09
- files:[B] `packages/context/agent-instructions/src/index.ts` · [B] `packages/context/agent-instructions/src/render.ts` · [B] `packages/session-query/session-query/src/index.ts` · [B] `packages/session-query/session-query/src/tracing.ts` · [B] `packages/core/agent-loop/src/runtime-context.ts` · [N] `packages/context/context-graph/src/index.ts` · [N] `packages/context/context-graph/src/types.ts` · [N] `packages/context/retrieval-planner/src/index.ts` · [N] `packages/context/retrieval-planner/src/budget.ts` · [N] `packages/context/retrieval-planner/tests/planner.spec.ts`
- stages:C:5 文件 · P:3 文件 · U:2 文件 · F:2 文件
- realTask:E6 S02 S11
- gate:Graph references sources, is cycle-safe/tenant-filtered; untrusted retrieval never becomes policy; S02/S11.
- rollback:D/K — disable retriever, retain source graph/trace, fall back to authorized empty context.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **graphology/graphology**(npm `graphology` · MIT · 1,738★) — 0.26.0 in-memory multigraph, traversal, graphology-dag cycle detection, JSON serialization
- **node:sqlite FTS5 + sqlite-vec**(npm `sqlite-vec` · Apache-2.0 · 8,069★) — Index code deleted
- **ethz-spylab/agentdojo**(MIT · 790★) — Injection fixtures exported once to JSON (qualification)
- **uiuc-kang-lab/InjecAgent**(MIT · 166★) — Stale 2024; fixtures
**可选(optional,不进依赖不进 CI)**:
- tree-sitter/tree-sitter — 0.26.11 wasm for the optional code-graph provider
- microsoft/BIPIA — Stale 2024; license unasserted
- huggingface/transformers.js — 4.2.0 local ONNX reranker/embedder
**不用(reject,理由)**:
- lucaong/minisearch — Not needed with FTS5
- kuzudb/kuzu — ARCHIVED 2025-10 (LadybugDB fork 1,696★ has no npm)
- cozodb/cozo — Stale 2024-12
- levelgraph/levelgraph — Stale 2024-05
**自己写(residual)**:RetrievalPlan/budget/stop/trace/dedup-by-source/untrusted-data marking, policy filter, injection fixtures as JSON; tokenizer upgrade belongs behind token-meter seam.
**禁令/风险(risk)**:Local graph DBs are dead or stale on npm — keep the graph in-memory (graphology) + sqlite-backed edges; Python corpora converted once (keyless).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-context 1,238★ — Projection CONSUMER (attribution/fold), not a planner
- dsh-recall / dsh-project-memory / dsh-library / dsh-knowledge — Retrieval without budget/policy/trace
- graph-memory 591★ — Typed graph hand-rolled

#### P6-05 · Per-Agent Context Topology 与稳定 Context Telemetry Contract

`Per-agent context topology + telemetry contract` · L2_PROVIDER · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 0% · 状态 **NOT_RUN (W12)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] RunPlan 为每个 Agent 声明 shared/private/retrievable context zones。
- must[1] Telemetry 只发布 source ids、token counts、selection reasons、redacted previews。
- acceptance[0] 两个 child 的 private context 互不可见。
- acceptance[1] UI 插件卸载不影响实际 context assembly。
- acceptance[2] 敏感内容不会通过 telemetry 泄漏。
- validation[0] 运行 cross-agent leak tests。
- validation[1] 对 context composition 做 golden snapshots。
- validation[2] 使用 dsh-context 类插件作为 consumer 兼容验证。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-02 P4-03 P6-04
- files:[B] `packages/core/agent-loop/src/runtime-context.ts` · [B] `packages/context/agent-instructions/src/state.ts` · [B] `packages/context/agent-instructions/src/render.ts` · [N] `packages/context/context-topology/src/index.ts` · [N] `packages/context/context-topology/src/types.ts` · [N] `packages/context/context-telemetry/src/index.ts` · [N] `packages/context/context-telemetry/tests/isolation.spec.ts`
- stages:C:4 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E6 S02 S11
- gate:RunPlan zones enforce least inheritance; telemetry is read-only IDs/counts/reasons/redacted previews; S02/S11.
- rollback:K/A — unload telemetry without affecting assembly; fall back to private zones.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **open-telemetry/semantic-conventions**(npm `@opentelemetry/semantic-conventions` · Apache-2.0 · 642★) — 1.43.0; @opentelemetry/* already deps; carried by existing session-telemetry-otel
**标准(绑定词汇)**:OTel semconv gen_ai.* attribute names (+ dsh.context.source_id / selection_reason) (所有者 SLICE-3.3:§3.3:名字来自 @opentelemetry/semantic-conventions 常量包,slice 接 pipeline;时点改为 W11 前(P5-03/P5-06 首发 gen_ai.usage.*))
**自己写(residual)**:Declarative shared/private/retrievable zones in RunPlan + stable telemetry record (source ids, token counts, reasons, redacted previews); upstream child-agent.ts seed boundary + telemetry redaction waterfall cover 'child does not inherit full history'.
**禁令/风险(risk)**:Telemetry token counts come from the CHARS/4 heuristic — label them estimated or adopt a real tokenizer.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-capability-menu 84★ 覆盖≈15% [topic-sweep] — bundle·进程内·无 key \| 缺口：Zones are process-global, not declared per agent in a RunPlan (MetaSearchOptions.scope is explicitly NOT used for filtering; the on-disk catalog is shared last-write-wins across dsh instance
- dsh-context 1,238★ — Consumes sessionProjections for composition attribution — use as the compatibility fixture the epic's validation demands (secondary CATALOG_ADOPT as consumer fixture)
- dsh-auxiliary 6★ — Dedicated routes for compaction/subagents
**裁决叠加(整改令)**:
- §3.3 OTel:在既有 packages/session/session-telemetry-otel 上加 TracerProvider pipeline;不建 otel-exporter 包;gen_ai.* 用 @opentelemetry/semantic-conventions

#### P6-06 · Compaction 保真度、来源证明与 Tool Pairing 强化

`Compaction fidelity, provenance, tool pairing` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_WRITE** · 可省 5% · 状态 **NOT_RUN (W11)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] CompactionResult 标记覆盖 event ranges、preserved constraints、open actions、artifact/evidence refs、dropped categories。
- must[1] 对 hard constraints 和 unresolved items 使用结构化保留区，不只自然语言摘要。
- must[2] 任何 open action ledger entry 不得被裁剪成不一致 surface。
- acceptance[0] compaction 前后 VerificationContract、未完成 action、审批状态等价。
- acceptance[1] 摘要中的每个关键 claim 可回链原事件。
- acceptance[2] 多轮 compaction 不累计丢失关键事实。
- validation[0] 使用长 session adversarial corpus。
- validation[1] 连续 compaction 20 次比较 invariants。
- validation[2] 随机 tool pairing event streams property test。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P4-01 P7-01
- files:[B] `packages/compaction/compaction/src/index.ts` · [B] `packages/compaction/compaction/src/checkpoint.ts` · [B] `packages/compaction/compaction/src/tool-pairing.ts` · [B] `packages/compaction/compaction/src/types.ts` · [B] `packages/core/session/src/surface.ts` · [N] `packages/compaction/compaction/src/coverage.ts` · [N] `packages/compaction/compaction/src/provenance.ts` · [N] `packages/compaction/compaction/tests/fidelity.e2e.ts`
- stages:C:5 文件 · P:2 文件 · U:1 文件 · F:2 文件
- realTask:E6 S02 S11
- gate:Native seam retains provenance/tool pairs/model-visible log and token budget; S02/S11.
- rollback:D — restore pre-compaction checkpoint and prior algorithm version.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT) — Generators over assistant/message + tool/result sequences asserting toolPairingBalanced across 20 compactions (qualification)
**自己写(residual)**:coverage.ts / provenance.ts marks (covered ranges, preserved constraints, open actions, evidence refs, dropped categories) on CompactionResult + fidelity e2e; upstream has the balance invariant, checkpoint source and sectioned summarizer.
**禁令/风险(risk)**:Any change to compaction/* event shapes touches the hot zone (compaction-basic upstream-owned) — keep marks additive on the payload.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-compaction-instant 14★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No structured CompactionResult fields: compaction/summary still carries only shadowedRange/shadowedSeqs/shadowedTokenCount/provider/model (upstream's basic protocol); the compiler's stats (t
- dsh-argp 4★ — LLM proposes / deterministic guards dispose — design idea only
- dsh-headroom 6★ — Reversible compression + retrieval
- dsh-plugin-thread 3★ — Status card re-anchored across compaction
- billion-context-dsh 68★ — Model-driven pruning
**裁决叠加(整改令)**:
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P6-07 · Session 生命周期：分页、过滤、删除、保留与 Partial Data Repair

`Session lifecycle: paging, filters, delete, retention, repair` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_WRITE** · 可省 0-5% · 状态 **ACCEPTED (W4)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 列表支持 tenant/workspace/status/time filters。
- must[1] soft delete、legal hold、hard erase、archive 分离
- must[2] 删除传播到 query/attachments/memory/artifacts 按 policy。
- acceptance[0] 百万 session fixture 分页稳定且无遗漏/重复。
- acceptance[1] legal hold 阻止 hard erase
- acceptance[2] 授权 erase 完整传播。
- acceptance[3] 损坏日志读取返回最小可恢复范围和证据。
- validation[0] 运行 pagination property tests。
- validation[1] 测试 delete/retention across indexes。
- validation[2] corruption fuzz 与 recovery report。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-06 P2-01
- files:[B] `packages/session/session-persistence/src/index.ts` · [B] `packages/session/session-persistence/src/coordinator.ts` · [B] `packages/session/session-persistence/src/revision.ts` · [B] `packages/session-query/session-query/src/cursor.ts` · [B] `packages/session-query/session-query/src/filters.ts` · [B] `packages/core/session/src/repair.ts` · [N] `packages/session/session-lifecycle/src/index.ts` · [N] `packages/session/session-lifecycle/src/retention.ts` · [N] `packages/session/session-lifecycle/src/delete.ts` · [N] `packages/session/session-lifecycle/tests/lifecycle.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:4 文件 · F:2 文件
- realTask:E6 S02 S11
- gate:Pagination has no omission/duplicate; soft delete/archive/hard erase/legal hold are distinct; held data is never deleted and repair never fabricates completion; S02/S11.
- rollback:D — pause deletion jobs, restore tombstone/checkpoint, retain legal holds.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 28 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - filters by tenant, admitting only matching-tenant sessions and excluding others
    - filters by workspace, admitting only matching-workspace sessions and excluding sessions with no workspace or a different one
    - filters by status (disposition kind), admitting only sessions in the requested dispositions
    - filters by a time range, admitting sessions whose createdAt falls within [from, to] inclusive -- including both boundary values themselves -
    - …共 28 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 18 个具名用例 / 变异证明 0/1 / 格子 GREEN · 有 supersede
    - lists a lifecycle record reconstructed from the durable store by a fresh service
    - walks every page of a restored listing, visiting each durable record exactly once with no omission or duplication
    - durable session-lifecycle registry (acceptance[0]: listing survives a restart) starts empty on a first boot, with no store file on disk yet
    - reads back exactly what a separate store instance over the same path wrote, brands included
    - …共 18 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 23 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - projects an unregistered corpus session as active under its observed tenant
    - carries an observed workspaceId through, and omits the property when the corpus observed none
    - keeps a registered record's durable disposition rather than projecting it back to active
    - keeps a registered record's legal hold, which a corpus observation can never clear
    - …共 23 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 16 个具名用例 / 变异证明 0/1 / 格子 GREEN
    - control: a log whose every row parses recovers fully, so the truncation cases below measure a decision
    - enforcement: recovery stops at the first unreadable row and never resumes past it, even when later rows parse
    - enforcement: a corruption on the very first row recovers nothing rather than reporting an empty success
    - enforcement: the evidence names the exact row and reason, not a summary
    - …共 16 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **node:sqlite keyset pagination** — Prepared statements already used
- **dubzzz/fast-check**(npm `fast-check` · MIT) — Pagination & corruption fuzz (qualification)
**自己写(residual)**:tenant/workspace/status filter kinds, lifecycle state machine (soft-delete / legal-hold / hard-erase / archive), propagation contract to attachments/memory/artifacts, damage-report surfacing of existing repair codes.
**禁令/风险(risk)**:'Million-session fixture' must be generated, not a corpus; keep cursor opaque (already branded).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-session-manager 58★ — Trash/restore/purge, archive, fork, workspace grouping — demand evidence; no legal hold/retention/propagation
- dsh-archived-chats 18★ — Archive + restore-as-copy
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK

#### P6-08 · 静态加密、租户密钥、Tamper-Evident Audit 与 Data Residency

`Encryption at rest, tenant keys, tamper-evident audit, residency` · L2_PROVIDER · **PROVIDER_ADAPT + PROVIDER_WRITE** · 可省 30-40% · 状态 **NOT_RUN (W9)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 每租户 envelope key
- must[1] key 由 KMS/keychain provider 管理，不存同一明文文件。
- must[2] 关键 Run/Policy/Action/Approval/Verification 事件进入 append-only hash chain，定期签 anchor。
- must[3] Storage/Model/World route 受 residency policy。
- acceptance[0] 磁盘拷贝无法直接读取明文。
- acceptance[1] 删除/修改/重排 audit record 100% 被检测。
- acceptance[2] 禁止区域外 provider 时没有数据出境。
- validation[0] 运行 key rotation、lost key、cross-tenant ciphertext tests。
- validation[1] tamper corpus。
- validation[2] residency route integration test。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P0-02 P2-01 P3-06
- files:[B] `packages/storage/storage/src/backend.ts` · [B] `packages/storage/storage/src/index.ts` · [B] `packages/attachment/attachment/src/index.ts` · [B] `packages/session/session-persistence/src/write-behind.ts` · [B] `packages/workspace/workspace/src/entity.ts` · [N] `packages/storage/storage-encryption/src/index.ts` · [N] `packages/storage/storage-encryption/src/keyring.ts` · [N] `packages/audit/audit-ledger/src/index.ts` · [N] `packages/audit/audit-ledger/src/hash-chain.ts` · [N] `packages/data/data-residency/src/index.ts` · [N] `packages/audit/audit-ledger/tests/tamper.e2e.ts`
- stages:C:5 文件 · P:4 文件 · U:3 文件 · F:2 文件
- realTask:E6 S02 S11
- gate:Tenant AAD, full-chain verification, zero key plaintext leakage; live KMS claim requires Q3; S02/S11/S14.
- rollback:K/D — stop writes, restore encrypted checkpoint, retain old KEK versions for decrypt-only migration.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **Node WebCrypto AES-256-GCM / HKDF** — Zero deps
- **paulmillr/noble-ciphers**(npm `@noble/ciphers` · MIT · 414★) — 2.4.0 audited; XChaCha20-Poly1305
- **paulmillr/noble-hashes**(npm `@noble/hashes` · MIT · 913★) — Already dep; HKDF + chain hashing
- **paulmillr/noble-curves**(npm `@noble/curves` · MIT · 948★) — 2.4.0 ed25519 anchors (or node:crypto)
- **FiloSottile/typage**(npm `age-encryption` · BSD-3-Clause · 475★) — 0.3.1 portable encrypted blobs for backups/exports/key files (age 23,402★ CLI interop)
- **Brooooooklyn/keyring-node**(npm `@napi-rs/keyring` · MIT · 99★) — 1.3.0 macOS Keychain / Secret Service / Credential Manager (keytar ARCHIVED 2022)
**可选(optional,不进依赖不进 CI)**:
- sigstore/sigstore-js — Rekor anchor sink
- miguelmota/merkletreejs — Only if inclusion proofs are required
- codenotary/immudb — Daemon, optional sink
- google/trillian — Daemon, optional sink
- transparency-dev/tessera — Daemon, optional sink
- getsops/sops — CLI, optional config-file provider
**不用(reject,理由)**:
- sqlcipher/sqlcipher — Needs better-sqlite3; dsh is on node:sqlite
- m4heshd/better-sqlite3-multiple-ciphers — 13.0.3; second native driver reopens a settled seam
**标准(绑定词汇)**:RFC 6962-style hash chain  · DSSE/in-toto statements for signed tree heads (P0-07 format) (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:Per-tenant KEK/DEK keyring semantics, encrypting KvUnit/session-row codec wrapper (hook exists in session-persistence-sqlite compression.ts), RFC 6962 chain + signed anchors behind trustKernel.auditAppend (no-op stub), tamper corpus, residency route policy.
**禁令/风险(risk)**:Row/line-level envelope encryption leaves seq/type/time metadata in clear — state it; full-database encryption would force a driver swap; key-loss = data-loss must be documented.
**planError**:SQLCipher would reopen the node:sqlite seam; keytar is archived.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- Cambium 294★ 覆盖≈20% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：No encryption at rest, no per-tenant envelope keys/KMS, no residency policy; prev_receipt_sha256 hash chain + external tail anchor is roadmap 'Next', not shipped, so delete/reorder in the ho
- dsh-passwords 39★ — Encrypted auth + audit log — hand-rolled
- qiushi-dsh-evidence-audit 4★ — Hash-chained JSONL receipts
- dsh-nuke-plugin 3★ — Hash-chain audit
- dsh-config-manager 63★ — AES-256-GCM secrets
- dsh-model-pro 6★ — AES-256-GCM secrets; all hand-roll → seam missing
**裁决叠加(整改令)**:
- §2.G 开工前设计决定已定(见该 epic 行)
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

#### P6-09 · 一等公民 Artifact Store、版本、内容寻址与 Lineage

`First-class artifact store: versions, CAS, lineage` · L1_CONTRACT · **CONTRACT_WRITE + PROVIDER_ADAPT** · 可省 35-45% · 状态 **NOT_RUN (W10)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] ArtifactRef 包含 digest、media type、schema、size、tenant、producer run/action、parents、retention、sensitivity。
- must[1] 不可变内容寻址
- must[2] 新版本创建新 digest 与 lineage edge。
- must[3] 支持 range/read streaming 和 signed access token。
- acceptance[0] 相同字节去重但权限不跨租户泄漏。
- acceptance[1] 所有 OutcomePackage/SubagentResult/Evidence 使用 refs。
- acceptance[2] lineage 可从最终交付物追溯输入、生成步骤和验证。
- validation[0] 测试 digest collision handling、cross-tenant dedup、large streaming。
- validation[1] lineage DAG cycle rejection。
- validation[2] 删除/retention 与 session lifecycle 联测。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P2-01 P6-08
- files:[B] `packages/attachment/attachment/src/index.ts` · [B] `packages/attachment/attachment/src/types.ts` · [B] `packages/storage/storage/src/backend.ts` · [P] `packages/subagent/subagent/src/result.ts` · [N] `packages/artifact/artifact/src/index.ts` · [N] `packages/artifact/artifact/src/types.ts` · [N] `packages/artifact/artifact/src/lineage.ts` · [N] `packages/artifact/artifact-local/src/index.ts` · [N] `packages/artifact/artifact/tests/lineage.spec.ts`
- stages:C:4 文件 · P:3 文件 · U:1 文件 · F:2 文件
- realTask:E6 S01 S02 S11
- gate:ID derives from real bytes; auth, encryption, classification, lineage, corruption detection; S01/S02/S11.
- rollback:D/K — stop writes, retain content-addressed bytes/old ref decoder, restore index from lineage.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **opencontainers/image-spec**(Apache-2.0 · 4,467★) — Descriptor shape
- **OpenLineage/OpenLineage**(Apache-2.0 · 2,639★) — spec/OpenLineage.json verified; no npm client (@openlineage/client 404) — emit JSON directly
- **in-toto/attestation**(371★) — Consistent with P0-07
- **npm/cacache**(npm `cacache` · ISC · 300★) — 21.0.1 SRI-keyed CAS with streaming put/get, index, verify GC — per-tenant cache roots
- **npm/ssri**(npm `ssri`) — 14.0.0 SRI strings
**可选(optional,不进依赖不进 CI)**:
- oras-project/oras — OCI registry sink
- graphology/graphology — graphology-dag for lineage cycle rejection (or 30-line Kahn)
**不用(reject,理由)**:
- multiformats/js-multiformats — CIDs not needed
- isomorphic-git/isomorphic-git — Git object store — heavier, wrong semantics
**标准(绑定词汇)**:OCI image-spec Descriptor {mediaType, digest sha256:…, size, annotations} for ArtifactRef (**本 epic 是形状所有者**) · OpenLineage Run/Job/Dataset + facets for lineage events  · W3C PROV vocabulary (**本 epic 是形状所有者**) · in-toto attestation for verification links (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:ArtifactRef schema (OCI Descriptor + tenant/producer/parents/retention/sensitivity/schema), lineage edges/DAG, signed access tokens, range reads over cacache streams, retention hooks to P6-07; keep attachment-local untouched.
**禁令/风险(risk)**:cacache is single-directory, no ACL, no ranges natively; per-tenant roots cost cross-tenant dedup; OpenLineage standardizes the event shape but the store is still dsh.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-research-report 41★ — Content-addressed evidence ledger, sealed versions — demand evidence
- dsh-science 33★ — Versioned artifacts with provenance
- dsh-popout-sidebar 197★ — Artifact listing UI
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §7.11:W3C PROV-DM 与 OCI image-spec Descriptor 两个形状的所有者;P7-04 import PROV

#### P6-10 · Privacy Classification、Redaction、Fork/Snapshot Lineage 与导出/擦除

`Privacy classification, redaction, fork lineage, export/erase` · L2_PROVIDER · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 15-25% · 状态 **NOT_RUN (W11)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 数据标记 public/internal/confidential/restricted 与 purpose
- must[1] 传播到 events/artifacts/memory/context。
- must[2] redaction 在边界执行：model request、logs、telemetry、export、plugin RPC。
- must[3] fork/snapshot 记录 purpose filter，默认不复制 secrets/grants。
- acceptance[0] canary PII/secret 不出现在未授权 sink。
- acceptance[1] 导出仅含用户有权数据并保留 provenance。
- acceptance[2] erase 能遍历 fork/snapshot/index/backup policy 并报告剩余 legal hold。
- validation[0] 运行 taint propagation tests。
- validation[1] 跨 10 个 sink 扫描 canary。
- validation[2] 测试 fork privilege inheritance 和 purpose change。
- nonGoals:规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。
- predecessors:P3-06 P6-08 P6-09
- files:[B] `packages/settings/settings/src/redact.ts` · [B] `packages/core/session/src/types.ts` · [B] `packages/attachment/attachment/src/types.ts` · [B] `packages/workspace/workspace/src/types.ts` · [B] `packages/sdk/protocol/src/types.ts` · [N] `packages/privacy/data-classification/src/index.ts` · [N] `packages/privacy/data-classification/src/types.ts` · [N] `packages/privacy/redaction/src/index.ts` · [N] `packages/privacy/data-lineage/src/index.ts` · [N] `packages/privacy/data-lineage/tests/privacy.e2e.ts`
- stages:C:5 文件 · P:1 文件 · U:5 文件 · F:2 文件
- realTask:E6 S11 S13
- gate:P6-09 remains artifact-lineage owner; purpose/erase propagates across 10 sinks with zero unauthorized canary; S11/S13.
- rollback:K/D — close sinks, stop erase/export jobs, retain tombstones/legal holds.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **secretlint/secretlint**(npm `@secretlint/core` · MIT · 1,445★) — @secretlint/core 13.0.5 + secretlint-rule-preset-recommend 13.0.5, ESM; usable in-process on strings at model-request/log/telemetry/export/plugin-RPC boundaries
- **gitleaks/gitleaks**(MIT · 29,065★) — gitleaks.toml rules as extra regex data
- **w3c/dpv**(81★) — Vocabulary
**可选(optional,不进依赖不进 CI)**:
- microsoft/presidio — PII NER sidecar only
- Yelp/detect-secrets — Python
**不用(reject,理由)**:
- trufflesecurity/trufflehog — AGPL
- solvvy/redact-pii — Stale 2023
**标准(绑定词汇)**:W3C DPV for purpose/personal-data categories (**本 epic 是形状所有者**) · public/internal/confidential/restricted tiers (convention, no formal standard)
**自己写(residual)**:Classification taxonomy + taint propagation through events/artifacts/memory/context, purpose-filtered fork/snapshot (default: no secrets/grants), cross-fork export/erase traversal with legal-hold report, PII canary set (Luhn/email/phone regex keyless default); note redact.ts fail-open TODO for unions.
**禁令/风险(risk)**:PII NER needs a model → Presidio sidecar or ONNX only as optional providers; keyless default stays regex+canary.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-secure-audit 84★ — Chinese-PII redaction + injection detection as read-only tools — could be re-homed as a redaction rule provider
- dsh-companion 4★ — Export with privacy redaction
- dsh-home-migrate 4★ — Credential redaction
**裁决叠加(整改令)**:
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

### P7 · 证据与验证(10 项)

#### P7-01 · VerificationContract：在执行前冻结可验证成功标准

`VerificationContract frozen before execution` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 15% · 状态 **NOT_RUN (W10)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 VerificationContract、Claim、CheckSpec、EvidenceRequirement、AcceptanceRule、VerifierIndependence 与 confidence policy。
- must[1] 把契约引用写入 RunPlan，并在 RunPlan freeze 后禁止执行 Agent 自行删除 required check、降低阈值或改为 self-attestation。
- must[2] 允许按任务类型组合确定性检查、外部状态检查、人工签署和统计检查，但协议本身保持领域无关。
- must[3] 所有契约、修订和批准写入 canonical Run/Session ledger，并带 schemaVersion 与 hash。
- acceptance[0] 任何进入 executing 状态的 Run 都有不可变 VerificationContract
- acceptance[1] 缺失时 fail closed。
- acceptance[2] 执行者不能修改 required checks、evidence requirements 或 acceptance rule
- acceptance[3] 修改必须走 PlanAmendment 和重新审批。
- acceptance[4] 同一契约经 TS/Python 编解码、持久化和重放后 hash 完全一致。
- acceptance[5] 契约可表达文件、API、外部系统、人工批准、统计测试和安全策略等通用检查，不包含垂直业务逻辑。
- validation[0] 先写 tests/verification-contract.spec.ts 红灯测试：hash 稳定、非法降级、未知 schema、空 required check。
- validation[1] 运行 pnpm test --filter dsh-verification-contract、pnpm typecheck、schema compatibility tests。
- validation[2] 构造恶意执行 Agent 试图在结束前删除检查，确认 Run 被拒绝且审计事件完整。
- nonGoals:不把某个行业的 KPI 或代码测试框架硬编码进契约。
- predecessors:P0-06 P4-03 P4-04
- files:[B] `packages/workflow/workflow/src/types.ts` · [B] `packages/core/session/src/types.ts` · [B] `packages/core/tools/src/types.ts` · [B] `packages/attachment/attachment/src/types.ts` · [N] `packages/assurance/verification-contract/src/index.ts` · [N] `packages/assurance/verification-contract/src/types.ts` · [N] `packages/assurance/verification-contract/src/schema.ts` · [N] `packages/assurance/verification-contract/src/invariant.ts` · [N] `packages/assurance/verification-contract/tests/verification-contract.spec.ts`
- stages:C:5 文件 · P:1 文件 · U:4 文件 · F:1 文件
- realTask:E7 S01 S02 S03 S14
- gate:Contract freezes before execution and binds code/config/schema/run/action/dataset/verifier identity; S01/S02/S03/S14.
- rollback:K/A — reject unverifiable runs; retain old signed contract codec.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **in-toto/attestation**(Apache-2.0 · 371★) — Statement v1 envelope
- **in-toto/in-toto**(Apache-2.0 · 1,036★) — Layout spec only (functionaries = VerifierIndependence, threshold = quorum); not the Python verifier or Link metadata
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0; or reuse scripts/first100/attest.ts canonicalJson — pick one **⟶ 裁决取代:§1/§7.8:import P2-03 的 canonicalizeArguments;attest.ts 的 canonicalJson 随 R1 收敛**
- **colinhacks/zod**(npm `zod` · MIT) — 4.4.3 in 38 pkgs; native toJSONSchema for TS↔Python codec contract
**标准(绑定词汇)**:in-toto Statement v1 + in-toto layout semantics (steps/inspections/functionaries/threshold) (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · JSON Schema 2020-12 via zod4 toJSONSchema (所有者 P0-06,import 其定义) · RFC 8785 JCS canonical hash (所有者 P2-03,import 其定义)
**自己写(residual)**:Claim/CheckSpec/EvidenceRequirement/AcceptanceRule/confidence policy types, freeze semantics inside RunPlan, PlanAmendment re-approval path, ledger events with schemaVersion.
**禁令/风险(risk)**:Predecessors P4-03/P4-04 (RunPlan) do not exist in the tree; freeze semantics have nowhere to attach yet.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- deepseek-harness-reliability-governor 2★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No RunPlan or PlanAmendment binding (P4-03/04 do not exist upstream); contract is opt-in per model tool call, so a Run can execute with no contract at all (docs/LIMITATIONS.md admits 'contra
- loopx (dsh-loopx-plugin) 5,424★ 覆盖≈10% — Python control plane keeping gate/evidence state outside dsh — not a contract in the ledger (<10%)
- Aegis 1,164★ 覆盖≈10% — Skill/prompt pack, not machine-checkable (<10%)
- odai-dsh-plugin 107★ 覆盖≈10% — 'Verified completion' = governance/routing bundle (<10%)
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- 执行卡 §1(JCS 所有者 P2-03):argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P7-02 · EvidenceCollector：内容寻址、可追溯、不可伪造的证据层

`EvidenceCollector: content-addressed, unforgeable` · L2_PROVIDER · **PROVIDER_ADAPT + CONTRACT_WRITE** · 可省 35% · 状态 **NOT_RUN (W12)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 EvidenceRef、EvidenceEnvelope、EvidenceType、producer、actionId、worldId、source URI、timestamp、contentHash、classification、freshness 和 retention。
- must[1] 在 tool completion、subagent result、artifact commit、external observation、test run 和 human approval 边界自动采集
- must[2] 大对象进入内容寻址 Artifact Store，ledger 仅保存不可变引用。
- must[3] 证据原文与模型渲染分离
- must[4] 模型只看经过权限和 token budget 过滤的 projection，但 Verifier 可读取授权原始证据。
- must[5] 为外部 API/浏览器结果保存请求摘要、响应摘要、状态码、ETag/版本和采集环境，避免只保存一段模型转述。
- acceptance[0] 所有 required evidence 都能追溯到具体 producer、ActionManifest、ExecutionWorld 和原始 hash。
- acceptance[1] 修改证据字节、元数据或引用后完整性校验 100% 检出。
- acceptance[2] 同一证据重复采集去重，但不同权限/时间上下文不会被错误合并。
- acceptance[3] 父 Agent 可以拿到结构化证据引用，不再只拿子 Agent 最终文本。
- validation[0] 写 tamper、dedupe、large artifact、cross-agent provenance、redaction 和 TTL 测试。
- validation[1] 运行故障注入：在写入 artifact、ledger、index 的每个边界 kill 进程，确认无悬空“已验证”引用。
- validation[2] 使用假外部系统返回版本化状态，核对 EvidenceEnvelope 与真实世界状态一致。
- nonGoals:不让 EvidenceCollector 自己判断业务结论是否正确。
- predecessors:P2-03 P5-06 P6-09
- files:[B] `packages/core/agent-loop/src/tool-calls.ts` · [B] `packages/core/tools/src/types.ts` · [B] `packages/core/session/src/types.ts` · [B] `packages/attachment/attachment/src/index.ts` · [B] `packages/attachment/attachment/src/types.ts` · [B] `packages/subagent/subagent/src/assistant-output.ts` · [N] `packages/assurance/evidence/src/index.ts` · [N] `packages/assurance/evidence/src/types.ts` · [N] `packages/assurance/evidence/src/collector.ts` · [N] `packages/assurance/evidence/src/store.ts` · [N] `packages/assurance/evidence/src/invariant.ts` · [N] `packages/assurance/evidence/tests/evidence.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:4 文件 · F:2 文件
- realTask:E7 S01 S02 S03 S14
- gate:Immutable raw bytes and complete canonical envelope, tenant/encryption/retention; S01/S02/S03/S14.
- rollback:D/K — stop collection, retain immutable bytes/index and last codec.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **npm/cacache**(npm `cacache` · ISC · 300★) — 21.0.1; SRI-addressed, atomic writes, verify() integrity sweep + GC, index — deletes store.ts and tamper-detection loop
- **npm/ssri**(npm `ssri` · ISC · 61★) — 14.0.0
- **in-toto/attestation**(371★) — ResourceDescriptor {name, uri, digest{sha256}, mediaType, downloadLocation, annotations}
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Signed-envelope format
**可选(optional,不进依赖不进 CI)**:
- multiformats/js-multiformats — 14.0.5 CID id format only
**不用(reject,理由)**:
- isomorphic-git/isomorphic-git — Git object store — heavier; fair alternative only if artifacts must be git-addressable
**标准(绑定词汇)**:in-toto ResourceDescriptor as EvidenceRef (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · DSSE envelope for sealed EvidenceEnvelope (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:Collection hooks at tool-completion / subagent-result / artifact-commit / approval boundaries, raw-vs-projection split with permission+token-budget filter, dedupe keyed by (hash, principal, time-context), retention policy, HTTP request/response summary capture, crash ordering (CAS commit before ledger ref).
**禁令/风险(risk)**:cacache stores in its own dir layout; if the storage chapter mandates storage-sqlite, cacache is a second store → fall back to a ~150-LOC CAS over node:sqlite blobs.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-research-report 42★ 覆盖≈25% — Content-addressed ledger objects/<sha256> + JSONL journals, sealed manifest hash, claim↔evidence binding, SARIF verifier CLI — a vertical with internal ledger; reference implementation
- oh-my-knowledge 18★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·需 key/服务 \| 缺口：No EvidenceEnvelope vocabulary (producer/actionId/worldId/classification/freshness/retention), no collection at artifact-commit/external-observation/human-approval boundaries, no projection-
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

#### P7-03 · Independent Verifier：与执行者隔离的验证 Provider Seam

`Independent Verifier provider seam` · L2_PROVIDER · **PROVIDER_WRITE + REUSE_UPSTREAM** · 可省 10% · 状态 **NOT_RUN (W13)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 VerifierProvider、VerificationRequest、VerificationReport、CheckResult 与 explicit abstain/unverified。
- must[1] 默认要求 verifier principal、model route、context projection 和 world 与执行者隔离
- must[2] Verifier 获得只读 artifact/evidence 权限，不继承写权限和执行者 secrets。
- must[3] Verifier 必须直接读取 EvidenceRef 和实际外部状态，不接受执行者传入的未签名“测试通过”字符串。
- must[4] 允许确定性 verifier、模型 verifier、人工 verifier 和 quorum provider 组合，但核心 gate 只消费统一报告。
- acceptance[0] 高风险 Run 不允许 executorId == verifierId，除非策略明确批准并标记 degraded assurance。
- acceptance[1] Verifier 无法修改 workspace、外部系统、approval 或 evidence
- acceptance[2] 越权尝试被 kernel 拒绝并审计。
- acceptance[3] 恶意执行者伪造测试文本时，独立 verifier 仍能识别失败。
- acceptance[4] Verifier 超时、崩溃或 abstain 不得被解释为 pass。
- validation[0] 写 adversarial executor fixture，返回伪造截图/日志，确认 verifier 读取真实状态并拒绝。
- validation[1] 测试 capability token 不可继承写权限、secret 访问和 evaluator override。
- validation[2] 分别运行 deterministic、model-backed、human-mock 三类 provider contract tests。
- nonGoals:不强制所有低风险、纯文本任务都调用昂贵模型 verifier。
- predecessors:P2-02 P3-01 P7-01 P7-02
- files:[B] `packages/subagent/subagent/src/index.ts` · [B] `packages/subagent/subagent/src/types.ts` · [B] `packages/sandbox/sandbox/src/index.ts` · [B] `packages/core/agent/src/runtime-types.ts` · [B] `packages/workflow/workflow/src/types.ts` · [N] `packages/assurance/verifier/src/index.ts` · [N] `packages/assurance/verifier/src/types.ts` · [N] `packages/assurance/verifier/src/provider.ts` · [N] `packages/assurance/verifier/src/coordinator.ts` · [N] `packages/assurance/verifier/src/invariant.ts` · [N] `packages/assurance/verifier/tests/verifier-isolation.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:3 文件 · F:2 文件
- realTask:E7 S01 S02 S03 S14
- gate:Separate process/world/permissions cannot write tested facts; signed identity/trust/revocation; S01/S02/S03/S14.
- rollback:K/Q — invalidate verifier key/verdicts; release remains blocked.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **packages/subagent (existing seam)** — SubagentCapabilities.{outputSchema,toolFilter}, maxDepth, agent/turn-stopping give isolated spawn + tool restriction + structured verdict
**可选(optional,不进依赖不进 CI)**:
- braintrustdata/autoevals — 0.3.0 LLM-judge/factuality/JSON-diff scorers a model-verifier provider can call
- promptfoo/promptfoo assertions — Scorers only
**自己写(residual)**:VerifierProvider/VerificationRequest/VerificationReport/CheckResult types, kernel-enforced capability non-inheritance, executorId ≠ verifierId policy, quorum coordinator, timeout/abstain → unverified, deterministic verifier reading EvidenceRef + real world.
**禁令/风险(risk)**:Verifier isolation is a kernel/policy property; wrapping any OSS judge in a plugin does not deliver it.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- deepseek-harness-reliability-governor 2★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No VerifierProvider seam — check evaluation is hard-coded in src/governor.ts; no model-backed, human, or quorum verifier providers; verifier runs in the executor's process/session/principal
- dsh-proof 2★ 覆盖≈30% — Read-only verifier on agent/turn-stopping with toolFilter.deny + outputSchema — right shape but fails open by design (abstain treated as no objection), deny-list narrowing instead of non-inheritance, no evidence refs
- dsh-llm-as-a-verifier 6★ — Logprob-expectation scoring — possible optional model-verifier provider
- Vibe-Mathematics — Multi-verifier debate — vertical

#### P7-04 · ClaimGraph：声明—证据—反证—不确定性的通用图

`ClaimGraph (claim–evidence–contradiction–uncertainty)` · L2_PROVIDER · **CONTRACT_WRITE + PROVIDER_WRITE** · 可省 15% · 状态 **NOT_RUN (W14)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 ClaimNode、EvidenceEdge、ContradictionEdge、DerivedFrom、scope、freshness、confidence、status。
- must[1] 由执行和验证阶段提交 claim proposal
- must[2] 只有 Verifier/Acceptance Gate 能把 required claim 标为 verified。
- must[3] 当证据过期、撤销或冲突时自动使依赖 claim 进入 stale/conflicted，而不是保留旧 pass。
- must[4] 最终 OutcomePackage 渲染器必须显示 unverified/conflicted claim，不得静默删除反证。
- acceptance[0] 每个关键 final claim 可反向遍历到至少一个 EvidenceRef 或显式 `unverified`。
- acceptance[1] 引入相互矛盾证据后，状态确定性变为 conflicted，并传播到派生 claim。
- acceptance[2] 过期规则可按 evidence type 配置且不会修改原始证据。
- acceptance[3] 图重放结果与在线投影一致。
- validation[0] 构造支持、反对、过期、循环依赖、撤销和部分证据测试。
- validation[1] 运行 property-based tests，确保没有无来源的 verified claim。
- validation[2] 用研究/代码/外部状态三种通用 fixture 验证同一 Contract 可复用。
- nonGoals:不内置新闻可信度、医疗证据等级等垂直评分表 / 这些由 policy/skill provider 提供。
- predecessors:P6-09 P7-02 P7-03
- files:[B] `packages/core/session/src/types.ts` · [B] `packages/session-query/session-query/src/types.ts` · [B] `packages/attachment/attachment/src/types.ts` · [B] `packages/feedback/message-feedback/src/index.ts` · [N] `packages/assurance/claim-graph/src/index.ts` · [N] `packages/assurance/claim-graph/src/types.ts` · [N] `packages/assurance/claim-graph/src/projector.ts` · [N] `packages/assurance/claim-graph/src/consistency.ts` · [N] `packages/assurance/claim-graph/tests/claim-graph.spec.ts`
- stages:C:5 文件 · P:2 文件 · U:2 文件 · F:2 文件
- realTask:E7 S01 S02 S03 S14
- gate:Only signed verdict supports claim; version/tenant/expiry/conflict preserved; S01/S02/S03/S14.
- rollback:D/K — rebuild projection from immutable evidence/verdicts; never hand-mark verified.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **in-toto/attestation (spec/predicates/scai.md)**(371★) — Attribute assertion + evidence + conditions — adopt names
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — 'No verified claim without evidence' property
**可选(optional,不进依赖不进 CI)**:
- graphology/graphology — 0.26.0 graph + traversal + cycle detection (~15%); a Map<claimId, edges> is fine if the graph stays small
**标准(绑定词汇)**:W3C PROV-DM relations (wasDerivedFrom, wasGeneratedBy, wasInvalidatedBy, wasAttributedTo) (所有者 P6-09,import 其定义) · in-toto SCAI predicate (attributes + evidence + conditions) (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:Status lattice (proposed/verified/stale/conflicted/unverified), propagation on expiry/revocation/contradiction, verifier-only verified transition, projector from ledger, OutcomePackage rendering that never drops contradictions.
**禁令/风险(risk)**:graphology is optional; vertical scoring tables are out of scope (nonGoal).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- grove 22★ 覆盖≈25% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：No ContradictionEdge/conflicted state or automatic conflict propagation; no confidence, scope or freshness-by-evidence-type rules; not run-scoped; the agent itself sets B validated (no verif
- dsh-research-report 42★ 覆盖≈20% — Claim verdict lattice unverified/insufficient/disproven/contradicted, negative-knowledge disproofs.jsonl, falsification ledger — best in-ecosystem reference, vertical
- dsh-deepread 44★ — Claim-evidence-data reports — vertical
- graph-memory 591★ — Typed-node memory — not claims
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §7.11(修订 R3):PROV-DM 形状所有者是 P6-09(W10),本 epic import;P5-11/P6-02 内部名的映射在首次对外处做

#### P7-05 · AcceptanceGate 与 OutcomePackage：只有被证明的结果才能完成 Run

`AcceptanceGate + OutcomePackage (signed, content-addressed)` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 20% · 状态 **NOT_RUN (W15)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 新增 run 状态 verifying、accepted、rejected、needs-human、compensating
- must[1] execution completed 只能进入 verifying。
- must[2] AcceptanceGate 纯函数式消费冻结的 VerificationContract、VerificationReport、ClaimGraph、policy 和 required approvals。
- must[3] 定义 OutcomePackage：finalAnswer、artifacts、stateDiffs、actionTrace、policyDecisions、verificationReport、costs、failures、compensations、memoryProposals。
- must[4] OutcomePackage 内容寻址并签名
- must[5] SDK/UI 以它为完成依据，不以最后一条 assistant message 为依据。
- acceptance[0] 缺失 required check/evidence/approval 时 Run 不可能进入 accepted。
- acceptance[1] 执行成功但验证失败时状态为 rejected/repairing，不得返回 completed=true。
- acceptance[2] OutcomePackage 可以从 ledger 完整重建，签名和 hash 稳定。
- acceptance[3] 外部调用方可以只依赖 OutcomePackage 判断成功，而无需解析自然语言。
- validation[0] 建立 truth table 覆盖 pass/fail/abstain/timeout/conflict/human-needed/compensation。
- validation[1] 在每个 gate 输入写入点故障注入，确认不会产生半签名 accepted package。
- validation[2] SDK contract test 验证旧的 assistant final text 不再等价于 Run success。
- nonGoals:不要求所有输出都有自然语言 finalAnswer / 机器工作流可只返回 artifacts/stateDiffs。
- predecessors:P4-01 P7-01 P7-03 P7-04
- files:[B] `packages/workflow/workflow/src/types.ts` · [B] `packages/core/agent-loop/src/agent.ts` · [B] `packages/core/session/src/known-event-types.ts` · [B] `packages/sdk/protocol/src/types.ts` · [B] `packages/attachment/attachment/src/types.ts` · [N] `packages/assurance/acceptance-gate/src/index.ts` · [N] `packages/assurance/acceptance-gate/src/types.ts` · [N] `packages/assurance/acceptance-gate/src/evaluate.ts` · [N] `packages/assurance/outcome-package/src/index.ts` · [N] `packages/assurance/outcome-package/src/types.ts` · [N] `packages/assurance/acceptance-gate/tests/gate.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:5 文件 · F:2 文件
- realTask:E7 S01 S02 S03 S14
- gate:Only P4 Run plus signed verdict graph can satisfy acceptance; missing/stale/unknown rejects; S01/S02/S03/S14.
- rollback:K/D — reopen Run as rejected/blocked; retain OutcomePackage/verdict history.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **in-toto/attestation (vsa.md, test-result.md)**(371★) — verifier id, policy ref, verificationResult PASSED/FAILED, verifiedLevels, inputAttestations
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Envelope
- **scripts/first100/attest.ts (existing)** — canonicalJson + ed25519 sign/verify + pinned identity — promote to a package
**可选(optional,不进依赖不进 CI)**:
- sigstore/sigstore-js — 5.x; keyless Fulcio/Rekor = hosted → optional only
- open-policy-agent/npm-opa-wasm — 1.10.0; AcceptanceRule engine only if the policy chapter standardizes on it
- cedar-policy/cedar — 4.12.0; same — decide once with P2/P3/P5
**标准(绑定词汇)**:SLSA Verification Summary Attestation (in-toto vsa.md) (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · in-toto Statement + DSSE envelope (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地) · RFC 8785 JCS (所有者 P2-03,import 其定义) · Ed25519 via node:crypto under Trust Kernel signatureRoots
**自己写(residual)**:Run-state machine (verifying/accepted/rejected/needs-human/compensating), OutcomePackage fields, hand-written pure gate truth table, ledger reconstruction, SDK contract change ('final assistant text ≠ success'); reuse evidence-format's accepted:true structural trick.
**禁令/风险(risk)**:Do NOT make sigstore keyless the default (needs Fulcio/Rekor network + OIDC); DSSE + local ed25519 satisfies keyless CI.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- deepseek-harness-reliability-governor 2★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No Run-level state machine (verifying/accepted/rejected/needs-human/compensating) — the turn still stops and the gate acts by steering a message, not by changing Run status; no OutcomePackag
- odai-dsh-plugin 107★ 覆盖≈0% — 'Verified completion' heuristic
- evidence-first 3★ 覆盖≈0% — Regex-detects 完成/成功 claims without a nearby tool/result — heuristic, not a gate
- dsh-nuke-plugin 覆盖≈0% — Hash-chain audit — unrelated
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- 执行卡 §1(JCS 所有者 P2-03):argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P7-06 · Bounded Repair/Replan Loop：验证失败后的有限修复与计划修订

`Bounded repair / replan loop` · L3_CONSUMER · **CONSUMER_WRITE + QUALIFICATION_REUSE** · 可省 5% · 状态 **NOT_RUN (W16)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 根据 failed checks 生成最小 RepairPlan，明确可重试 action、不可重复 external effects、预算、最大轮数和 escalation。
- must[1] 修复需要变更 RunPlan 时必须提交 PlanAmendment
- must[2] 不得修改原 VerificationContract 除非重新审批。
- must[3] 支持 alternate model/tool/world、局部重做、回滚后重做、人工接管
- must[4] 保留每轮 evidence 与差异。
- must[5] 使用 Action Ledger/Reconciliation 判断是否需要执行、验证、补偿或只读取现有状态。
- acceptance[0] repair 次数、token、时间、外部写次数全部有硬上限
- acceptance[1] 达到上限进入 needs-human/rejected。
- acceptance[2] 同一验证失败不会重复不可逆外部动作。
- acceptance[3] 修复后必须重新运行受影响检查
- acceptance[4] 未受影响且仍新鲜的证据可以复用。
- acceptance[5] 执行者不能通过把失败 check 标为 optional 获得通过。
- validation[0] 测试 transient、deterministic bug、external partial success、irreversible failure、budget exhaustion。
- validation[1] 10,000 次 fault-injection 中重复 external side effect 数为 0。
- validation[2] 构造恶意模型循环请求，确认硬预算和 emergency stop 生效。
- nonGoals:不把普通 provider HTTP retry 混入任务级 repair 语义。
- predecessors:P4-11 P4-12 P4-13 P7-05
- files:[B] `packages/llm/llm-retry/src/index.ts` · [B] `packages/llm/llm-retry/src/types.ts` · [B] `packages/guard/repeat-tool-reminder/src/index.ts` · [B] `packages/core/agent-loop/src/agent.ts` · [B] `packages/workflow/workflow-worker-thread/src/runtime.ts` · [N] `packages/assurance/repair/src/index.ts` · [N] `packages/assurance/repair/src/types.ts` · [N] `packages/assurance/repair/src/coordinator.ts` · [N] `packages/assurance/repair/src/policy.ts` · [N] `packages/assurance/repair/tests/repair.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:2 文件 · F:2 文件
- realTask:E7 S01 S02 S03 S14
- gate:Durable attempts/budget/changes/evidence; only verifier can mark repaired; S01/S02/S03/S14.
- rollback:D/X — exhaust/stop budget, preserve attempts, escalate human; never lower standard.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — fc.commands model-based runs for '10,000 fault injections, 0 duplicate external effects'
- **packages/llm/llm-retry (existing)** — Transport retry the epic must stay separate from
**不用(reject,理由)**:
- temporalio/sdk-typescript — Would replace the agent loop's hot zone
- dbos-inc/dbos-transact-ts — Same
**自己写(residual)**:RepairPlan from failed checks, PlanAmendment, idempotency via Action Ledger/Reconciliation, budget ceilings, needs-human escalation — dsh's own state machine over P4-11/12/13.
**禁令/风险(risk)**:Keep provider HTTP retry (llm-retry) and task-level repair separate (nonGoal).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- deepseek-harness-reliability-governor 2★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Only attempt count is capped — no token, wall-time or external-write budgets; no RepairPlan structure, no PlanAmendment, no alternate model/tool/world, no rollback/snapshot, no human-takeove
- MisakaNet 432★ 覆盖≈0% — Failure-recovery memory
- dsh-proactive 覆盖≈0% — 'Quality reflection with automatic retry and model switch' — unverified, not verification-gated
- dsh-harness-ops#dsh-restart-recover / dsh-smart-restart 覆盖≈0% — Process restart, not check-driven repair

#### P7-07 · Causal Trace、Policy/Evidence/Cost Trace 与 Durable Telemetry Outbox

`Causal trace + policy/evidence/cost trace + durable telemetry outbox` · L2_PROVIDER · **PROVIDER_ADAPT + PROVIDER_WRITE** · 可省 40% · 状态 **NOT_RUN (W13)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 trace/span/link vocabulary，覆盖 run/turn/step/tool/action/policy/approval/subagent/world/evidence/verifier/repair。
- must[1] 以 runId、actionId、parentSpanId 和 causationId 连接 Session ledger、Action Ledger、Evidence 和 OutcomePackage。
- must[2] 实现 per-sink durable outbox、ack cursor、at-least-once delivery、receiver dedupe 与 retention
- must[3] 不得阻塞 agent hot path。
- must[4] 默认挂载安全 redaction/classification policy
- must[5] 共享状态必须明确 full/feedback-only/disabled，并记录真实交付状态而非只记录 handoff。
- acceptance[0] 任意 OutcomePackage 可遍历到产生它的全部关键 actions、policy decisions、evidence 和 cost。
- acceptance[1] 在 enqueue/flush/ack/shutdown 每个边界 kill 进程后，terminal events 最终送达且无逻辑重复。
- acceptance[2] 未挂载 redaction policy 时共享 collector 默认拒绝启动，而不是裸数据外发。
- acceptance[3] Trace 不改变 canonical ledger 的事实语义，Telemetry 失败不使工作流状态失真。
- validation[0] 运行 crash matrix、collector outage、duplicate ack、out-of-order ack、PII canary。
- validation[1] 对 1,000-Agent synthetic run 验证 trace cardinality、存储增长和 p95 开销。
- validation[2] 使用 OTel test collector 核对 parent/link 因果关系和 cost 汇总。
- nonGoals:不把 telemetry backend SDK 的内部实现写死在核心 Service Definition。
- predecessors:P2-05 P4-06 P6-10 P7-02
- files:[B] `packages/session/session-telemetry/src/coordinator.ts` · [B] `packages/session/session-telemetry/src/index.ts` · [B] `packages/core/session/src/types.ts` · [B] `packages/core/agent-loop/src/runtime-context.ts` · [B] `packages/interaction/user-approval/src/types.ts` · [N] `packages/observability/causal-trace/src/index.ts` · [N] `packages/observability/causal-trace/src/types.ts` · [N] `packages/observability/telemetry-outbox/src/index.ts` · [N] `packages/observability/telemetry-outbox/src/store.ts` · [N] `packages/observability/causal-trace/tests/crash-delivery.e2e.ts`
- stages:C:4 文件 · P:4 文件 · U:3 文件 · F:2 文件
- realTask:E7 S01 S02 S03 S14
- gate:Transactional cursor/ACK/backpressure and classification-aware export survive restart; S01/S02/S03/S14.
- rollback:D/K — stop exporter, retain outbox/causal trace, resume from ACK.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **open-telemetry/opentelemetry-js**(npm `@opentelemetry/sdk-trace-base` · Apache-2.0 · 3,454★) — 2.10.0 + exporter-trace-otlp-http 0.221.0 + core W3CTraceContextPropagator + context-async-hooks 2.11.0 — spans + links, exporter, batching, retry, propagation
- **open-telemetry/semantic-conventions**(npm `@opentelemetry/semantic-conventions` · Apache-2.0 · 642★) — 1.43.0 already in lockfile; /incubating ATTR_GEN_AI_*, METRIC_GEN_AI_*
- **w3c/trace-context**(510★) — Propagation across subagent/ACP/MCP/SDK hops
**可选(optional,不进依赖不进 CI)**:
- open-telemetry/opentelemetry-collector-contrib — Local sidecar with file_storage persistent sending queue = deployment-level durable outbox
- langfuse/langfuse — MIT core + ee/ commercial; OTLP at /api/public/otel; self-host docker — best free self-host sink
- Arize-ai/phoenix — Not OSI; self-host external process, never a dependency
- langchain-ai/langsmith-sdk (LangSmith) — Hosted SaaS OTLP ingest via x-api-key — one cordis.yml row, no npm package needed; self-host = Enterprise K8s+Postgres+Redis+ClickHouse → never default/CI
- Helicone/helicone — Proxy/gateway via baseURL or async logger; self-host
**不用(reject,理由)**:
- traceloop/openllmetry-js — 0.27.0 monkey-patches vendor SDKs — wrong layer for pi-ai/own adapters
- Arize-ai/openinference — 2.8.0 competing attribute spec; emit gen_ai.* only
**标准(绑定词汇)**:OTel GenAI semantic conventions (gen_ai.agent.*, conversation.id, operation.name, request/response.*, usage.*, evaluation.*) (所有者 SLICE-3.3:§3.3:名字来自 @opentelemetry/semantic-conventions 常量包,slice 接 pipeline;时点改为 W11 前(P5-03/P5-06 首发 gen_ai.usage.*)) · W3C Trace Context traceparent/tracestate  · OTLP/HTTP wire
**自己写(residual)**:Trace vocabulary as a Service Definition, ~250-LOC durable outbox over node:sqlite (per-sink table, ack cursor advanced on exporter success, receiver dedupe via deterministic span ids) as an additive layer under SessionTelemetrySink.emit(), redaction-required-to-start rule, delivery-status recording, cost aggregation, cardinality control, dsh.* attribute namespace.
**禁令/风险(risk)**:Reopens two documented upstream decisions (span mapping rejected 'for this revival'; outbox deferred) — frame as the 'future consumer with real span queries' the note anticipates, keep emit() unchanged.
**planError**:Plan creates packages/observability/otel-exporter while packages/session/session-telemetry-otel already is the OTel backend — add a TracerProvider pipeline there instead.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-observe 4★ 覆盖≈45% — OTLP traces+metrics (JSON) + Langfuse ingestion, sanitize, bounded durable offline spool over storage-domain, deterministic ids, kill switch, zero runtime deps — closest to CATALOG_ADOPT but <50%
- @loongsuite/dsh-plugin 21★ 覆盖≈40% — Session/agent-loop/LLM/tool lifecycle → OTel GenAI traces+metrics over OTLP/HTTP protobuf, private TracerProvider, ENTRY→AGENT→STEP→{LLM,TOOL}; mapping.ts is a working span-shape reference
- dsh-plugin-langfuse 13★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No durable outbox, ack cursor, at-least-once delivery or retention — README decision 5 states 'a durable outbox is deliberately out of scope'; inherits the seam's at-most-once handoff (SDK q
- dsh-langfuse-plus 2★ — Langfuse trace trees + prompt versioning
- @tma1-ai/dsh-plugin-greptimedb 9★ — Traces/metrics/logs → GreptimeDB + Grafana
- dsh-telemetry-redactor 3★ — Mounts on the official session-telemetry/record waterfall — a ready redaction rule set
**裁决叠加(整改令)**:
- §2.C 缩范围:files[] 删与上游/已有实现重复的 [N] 文件,residual 收窄
- §3.3 OTel:在既有 packages/session/session-telemetry-otel 上加 TracerProvider pipeline;不建 otel-exporter 包;gen_ai.* 用 @opentelemetry/semantic-conventions
- §7.11(修订 R3):OTel 名字来自 @opentelemetry/semantic-conventions 常量包,无人定形状;§3.3 slice 提前到 W11 前(P5-03/P5-06 首发 gen_ai.usage.*);本 epic 做 P2-01 enduser.id 映射
- §9.2 生态迁移目标:4 个各接 OTel 或自签 HMAC 链——session-telemetry-otel 唯一 backend,插件只加 processor/exporter

#### P7-08 · Deterministic Replay、Simulation 与 Decision Diff

`Deterministic replay, simulation, decision diff` · L3_CONSUMER · **REUSE_UPSTREAM + PROVIDER_ADAPT** · 可省 50% · 状态 **NOT_RUN (W14)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 ReplayBundle，包含 schema fingerprints、RunPlan、events、model streams、external observations、policy inputs、clock/random seeds 和 artifacts refs。
- must[1] 回放模式禁止真实网络/写入，ExecutionWorld 由 recorded-world provider 提供确定性观察。
- must[2] 分别比较 normalized projection、policy decisions、action manifests、router choices、verification reports 和 outcome。
- must[3] 支持 shadow replay 新 Router/Policy/Prompt Compiler，产出 DecisionDiff 而不影响生产状态。
- acceptance[0] 相同 ReplayBundle 重放 100 次，normalized projection、policy decisions 和 OutcomePackage hash 100% 一致。
- acceptance[1] 回放不会产生任何真实外部 side effect，网络与写工具调用数为 0。
- acceptance[2] schema/adapter 版本不兼容时明确拒绝或经过登记迁移，不静默偏离。
- acceptance[3] 可以准确定位首次 decision divergence 及其输入差异。
- validation[0] 写 deterministic clock/random/provider/world tests。
- validation[1] 用每个可恢复边界的 crash bundle 回放并对比在线最终状态。
- validation[2] 对旧版本 fixture 做 forward compatibility 和 migration golden tests。
- nonGoals:不宣称真实模型在重新调用时可位级确定 / 模型输出需作为已记录输入回放。
- predecessors:P0-06 P4-08 P4-12 P7-07
- files:[B] `packages/core/session/src/repair.ts` · [B] `packages/core/session/src/surface.ts` · [B] `packages/session/session-persistence/src/coordinator.ts` · [B] `packages/llm/llm/src/assembler.ts` · [B] `packages/test-support/llm-replay/src/index.ts` · [N] `packages/evaluation/replay/src/index.ts` · [N] `packages/evaluation/replay/src/types.ts` · [N] `packages/evaluation/replay/src/recorded-world.ts` · [N] `packages/evaluation/replay/src/normalizer.ts` · [N] `packages/evaluation/replay/src/diff.ts` · [N] `packages/evaluation/replay/tests/replay.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:3 文件 · F:2 文件
- realTask:E7 S03 S07 S14
- gate:Schema/plan/event/model/tool/world/clock/random fixed or explicitly non-replayable; S03/S07/S14.
- rollback:Q/D — retain ReplayBundle and prior normalizer; no false replayable flag.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **packages/test-support/llm-replay + session-snapshot (existing)** — Model streams as recorded inputs, throw/hang/retry overrides, normalized projections, workspace tree comparison, record/replay/refresh lanes
- **nodejs/undici SnapshotAgent**(npm `undici` · MIT · 7,687★) — lib/mock/snapshot-agent.js in 8.10.0 in-tree (record/playback/update; experimental) — recorded-world provider for HTTP with zero new deps
- **sinonjs/fake-timers**(npm `@sinonjs/fake-timers` · BSD-3-Clause · 859★) — Via vitest vi.useFakeTimers
- **pure-rand**(npm `pure-rand`) — 8.4.2 fast-check's PRNG, transitive; seeds
- **Starcounter-Jack/JSON-Patch**(npm `fast-json-patch` · MIT · 1,982★) — 3.1.1 first-divergence path
**可选(optional,不进依赖不进 CI)**:
- nock/nock — 14.0.17 nock.back record/replay fallback for node:http paths
**不用(reject,理由)**:
- Netflix/pollyjs — Stale (last push 2025-05-31)
- mswjs/msw — No built-in recorder
- rr-debugger/rr — Process-level, Linux — wrong layer
- temporalio replay (Worker.runReplayHistory) — Requires Temporal's workflow model — replaces the loop
**标准(绑定词汇)**:RFC 6902 JSON Patch for DecisionDiff (所有者 P4-13,import 其定义)
**自己写(residual)**:ReplayBundle schema (schema fingerprints, RunPlan, policy inputs, seeds, artifact refs), replay-mode enforcement 'no real network/write' through sandbox/tool seams, non-HTTP world observations (fs/process) recording, shadow replay of Router/Policy/Prompt Compiler, version-mismatch refusal/migration.
**禁令/风险(risk)**:SnapshotAgent is flagged experimental by undici — pin the version and keep nock as fallback; policy replay needs the policy engine to be pure over recorded inputs.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-repro 2★ 覆盖≈15% — /repro exports minimal secret-scrubbed replayable bundle — overlap with ReplayBundle packaging
- grove 22★ 覆盖≈15% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：Replays protocol-state mutations only: no recorded model streams, tool observations, policy inputs, clock/random seeds, recorded-world provider, or DecisionDiff of first divergence; nothing
- dsh-replay 10★ 覆盖≈10% — Timeline viewer, session compare, HTML export — a viewer, not re-execution
- huahua-dsh-record-replay 3★ — Timeline + 're-run in a fresh session' (non-deterministic)
- dsh-trace-insight / dsh-checkpoint-diff — Comparison UIs
**裁决叠加(整改令)**:
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P7-09 · General-Purpose Capability Scenario Suite：用领域夹具验证 Harness，而非内置垂直 Agent

`General-purpose capability scenario suite (15 scenarios, two lanes)` · L6_QUALIFICATION · **QUALIFICATION_REUSE** · 可省 30% · 状态 **NOT_RUN (W16)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 建立 15 类通用场景：代码变更、证据研究、外部写、日程/消息、高风险财务模拟、医疗/法律安全策略、24h 虚拟长任务、50-Agent、Provider failover、恶意插件、租户隔离、自扩展、恶意附件、崩溃恢复、SDK 重连。
- must[1] 场景只提供目标、工具契约、世界状态、风险策略和验收条件
- must[2] 具体领域行为由 fixture Skill/Provider 提供，测试结束即卸载。
- must[3] 分为 deterministic scripted-model lane 与 real-model statistical lane，禁止把模型波动混入安全硬门。
- must[4] 每个场景输出完整 Evidence/Outcome/Trace，并检查资源清理和副作用。
- acceptance[0] 所有安全、隔离、幂等、审计和恢复 hard gates 100% 通过。
- acceptance[1] scripted-model lane 的 deterministic capability success ≥99%，且连续 20 次无 flaky。
- acceptance[2] real-model lane 按模型/配置分别报告成功率、95% CI、成本、时延和 human intervention，不用单一总分掩盖差异。
- acceptance[3] 核心 packages 中不存在为某个场景写死的行业关键词/业务规则。
- validation[0] 新增 pnpm test:capability，CI 每 PR 跑 deterministic subset，每夜跑 full/real-model lane。
- validation[1] 使用 architecture linter 检查 fixtures 不能成为生产依赖。
- validation[2] 对每个场景注入 5–20 个 crash/policy/provider faults，验证 OutcomePackage 与真实 world。
- nonGoals:不以“能跑一个销售 Demo”代替通用 Harness 验收。
- predecessors:P0-08 P7-05 P7-08
- files:[B] `BENCHMARK.md` · [B] `package.json` · [B] `docs/testing.md` · [B] `packages/test-support/README.md` · [N] `tests/capability/README.md` · [N] `tests/capability/manifest.yaml` · [N] `tests/capability/runner.ts` · [N] `tests/capability/worlds/code-world.ts` · [N] `tests/capability/worlds/research-world.ts` · [N] `tests/capability/worlds/external-write-world.ts` · [N] `tests/capability/worlds/high-risk-world.ts` · [N] `tests/capability/worlds/long-run-world.ts` · [N] `tests/capability/worlds/malicious-plugin-world.ts` · [N] `tests/capability/worlds/multi-tenant-world.ts` · [N] `tests/capability/worlds/sdk-reconnect-world.ts`
- stages:C:5 文件 · P:5 文件 · U:5 文件 · F:3 文件
- realTask:E7 S01 S15
- gate:Real Q1/Q2 app/profile lifecycle; empty/skip fails; raw observations go to independent verifier; S01–S15.
- rollback:Q — remove qualification claim/gate only; product state unchanged.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — In-tree property runner
- **packages/test-support/session-snapshot (existing)** — 1674-LOC suite.ts already owns scenario tables, fixtures, workspace expectations, subprocess launch
- **simple-statistics/simple-statistics**(npm `simple-statistics` · ISC · 3,521★) — 7.11.0 95% CI per model/config
- **ethz-spylab/agentdojo**(MIT · 790★) — Prompt-injection task/attack corpus → port cases as fixtures
**可选(optional,不进依赖不进 CI)**:
- laude-institute/terminal-bench — Real-model lane via subprocess/docker sidecar, never a hard gate
- SWE-bench/SWE-bench — Real-model lane sidecar
- NVIDIA/garak — Probe corpus
- Shopify/toxiproxy — 4.1.0; provider-failover faults — in-process undici MockAgent covers keyless CI
**不用(reject,理由)**:
- chaos-mesh/chaos-mesh — k8s — too heavy
**只读参考(reference)**:
- sierra-research/tau-bench — Deterministic tool-environments with DB state — pattern for external-write world
**自己写(residual)**:The 8 worlds (code/research/external-write/high-risk/long-run/malicious-plugin/multi-tenant/sdk-reconnect) as fixture Skill/Provider bundles + manifest runner; architecture linter 'fixtures can't be prod deps' extends tests/architecture/capability-seams.spec.ts.
**禁令/风险(risk)**:Per-PR gate must stay keyless (scripted lane + property/fault runs); real-model statistical lane is nightly with keys; Python benchmarks need docker + python env in nightly.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-eval-harness 14★ 覆盖≈30% — YAML cases → headless fork → session.jsonl asserts (turn_end, tools_called, output_contains, max_steps/max_tokens) → baseline gate; right runner shape but unlicensed — design reference
- oh-my-knowledge 18★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·需 key/服务 \| 缺口：None of the 15 general scenarios (external write, tenancy, malicious plugin, crash recovery, SDK reconnect, 50-agent...), no deterministic scripted-model lane in DSH mode (mocks unsupported)
- upstream-radar 9★ — Retests plugin bytes × DSH host in GitHub VMs — relevant to P7-10's plugin gate
- dsh-self-evolving 7★ — Uses Harbor (terminal-bench harness) — precedent that terminal-bench runs as a sidecar against dsh

#### P7-10 · Evaluation Plane、Chaos/Security/Scale Gates 与 Champion–Challenger 受控演化

`Evaluation plane, chaos/security/scale gates, champion–challenger` · L6_QUALIFICATION · **QUALIFICATION_REUSE + PROVIDER_WRITE** · 可省 35% · 状态 **NOT_RUN (W17)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义指标：verified task success、policy violation、duplicate side effect、recovery、router regret、cost、latency、human intervention、memory pollution、evidence completeness。
- must[1] 支持 offline replay、shadow、A/B、canary、champion/challenger
- must[2] 候选只能读取复制流，不共享写 token。
- must[3] 动态 extension/prompt/router/workflow 改进必须形成 EvolutionProposal，经静态扫描、离线 eval、安全 eval、canary 和批准后签名发布。
- must[4] 建立自动回退阈值和不可自动演化清单：Trust Kernel、tenant boundary、audit integrity、root signing keys、不可逆审批政策。
- acceptance[0] 任何候选不能未经 gate 直接替换生产 provider/plugin/policy。
- acceptance[1] 安全回归、成本超限或成功率劣化达到阈值时自动停止 canary 并恢复 champion。
- acceptance[2] Eval 结果可重放、可审计并绑定代码/config/schema/model 版本。
- acceptance[3] 发布门同时检查 unit/coverage/architecture/security/recovery/capability/scale，不允许仅凭模型自评晋级。
- validation[0] 运行故意劣化 router、恶意 plugin、泄密 prompt、成本爆炸 workflow 的 challenger 测试。
- validation[1] 对 champion/challenger 使用同一 ReplayBundle，计算差异与置信区间。
- validation[2] 验证 root-policy 文件变更只能走人工高权限 release gate。
- nonGoals:不允许系统在生产主进程内即时自写、自测、自批准并自发布。
- predecessors:P1-11 P7-07 P7-08 P7-09
- files:[B] `package.json` · [B] `docs/testing.md` · [B] `packages/feedback/README.md` · [B] `packages/session/session-telemetry/src/index.ts` · [B] `packages/extensions/tool-cordis/src/index.ts` · [B] `packages/extensions/cordis-host-runner/src/registry.ts` · [N] `packages/evaluation/eval/src/index.ts` · [N] `packages/evaluation/eval/src/types.ts` · [N] `packages/evaluation/eval-registry/src/index.ts` · [N] `packages/evaluation/eval-runner/src/index.ts` · [N] `packages/evaluation/champion-challenger/src/index.ts` · [N] `packages/evaluation/evolution-proposal/src/index.ts` · [N] `tests/chaos/runner.ts` · [N] `tests/security/runner.ts` · [N] `tests/scale/runner.ts` · [N] `.github/workflows/general-purpose-gate.yml`
- stages:C:5 文件 · P:4 文件 · U:4 文件 · F:3 文件
- realTask:E7 S01 S15
- gate:Metrics derive from signed verdict; hard failures never average away; proposed rollback thresholds; S01–S15.
- rollback:K/Q — revoke candidate and restore signed champion; retain all observations.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **promptfoo/promptfoo**(npm `promptfoo` · MIT · 24,755★) — 0.122.2 eval runner with exec:/JS providers, assertions, dataset/baseline compare, red-team suite (needs attack model → nightly); dev/CI-only or npx
- **mattpocock/evalite**(npm `evalite` · MIT · 1,673★) — 0.19.0 vitest-native — fits the keyless per-PR lane
- **braintrustdata/autoevals**(npm `autoevals` · MIT · 1,021★) — 0.3.0 scorers for model-judged metrics
- **simple-statistics/simple-statistics**(npm `simple-statistics` · ISC · 3,521★) — CI on champion vs challenger over the same ReplayBundle
- **mcollina/autocannon**(npm `autocannon` · MIT · 8,509★) — 8.0.0 SDK/HTTP scale gate
**可选(optional,不进依赖不进 CI)**:
- open-feature/js-sdk — 1.23.0 in-memory provider for champion/challenger routing + hooks; otherwise a 30-line variant selector
- open-feature/flagd — Sidecar
- openai/evals — Corpus only
- ossf/scorecard — Static supply-chain gate (P1-11 territory)
**不用(reject,理由)**:
- grafana/k6 — External tool only, never a dep
- UKGovernmentBEIS/inspect_ai — Sidecar only — not worth it when promptfoo/evalite are TS-native
- confident-ai/deepeval — npm deepeval 0.9.13 is an unrelated TS package
**标准(绑定词汇)**:OpenFeature as the champion/challenger flag standard (only if the routing chapter also adopts it) (所有者 P0-05,import 其定义) · DSSE-signed EvolutionProposal (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:Metric definitions over dsh's ledger/OutcomePackage (verified task success, policy violation, duplicate side effect, router regret, memory pollution, evidence completeness), EvolutionProposal lifecycle (static scan → offline eval → security eval → canary → approval → signed release), not-auto-evolvable list, candidate read-only copied-stream isolation, general-purpose-gate.yml.
**禁令/风险(risk)**:promptfoo pulls a large dependency tree — dev/CI-only or npx, never runtime; OpenFeature worth it only if the routing chapter also uses it — cross-chapter decision.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- oh-my-knowledge 18★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·需 key/服务 \| 缺口：No shadow/canary against live traffic, no replicated read-only stream for candidates, no automatic rollback thresholds, no EvolutionProposal signing pipeline (static scan / security eval / a
- dsh-self-evolving 7★ 覆盖≈30% — Bounded Cordis plugin candidate generation, real-Loader admission, Harbor eval, journaled lineage — usable only behind the gate, never as the gate
- dsh-evolution-lab 1★ 覆盖≈25% — Quarantined SKILL.md candidates, baseline vs candidate in isolated processes, held-out canaries, atomic promote/rollback — EvolutionProposal shape for the skill class
- upstream-radar 9★ — Compatibility-evidence retests — ready external gate input
- sofagent#cordis-plugin-sofagent-audit 42★ — Subdir README empty in API — UNVERIFIED
- api-relay-audit 822★ 覆盖≈0% — LLM API relay auditing, Python, off-topic and copyleft
- dsh-pentest / dsh-redteam-model / dsh-pentester 352★ 覆盖≈0% — Offensive tooling for the agent to use, not harness security gates
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

### P8 · 远程与运维(10 项)

#### P8-01 · Protocol Version Negotiation 与 Capability Discovery

`Protocol version negotiation + capability discovery` · L1_CONTRACT · **CONTRACT_WRITE + REUSE_UPSTREAM** · 可省 10% · 状态 **ACCEPTED (W5)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 在 initialize handshake 交换 protocolVersion range、schema fingerprints、methods、events、resource types、streaming/approval/replay capabilities。
- must[1] 定义 mandatory/optional capability 与 fail-fast 规则
- must[2] 未知 mandatory capability 必须拒绝连接。
- must[3] 支持 compatibility adapter 注册，但 adapter 必须显式记录降级项并进入 trace。
- must[4] 将协议 schema 生成物纳入 release evidence 和 golden compatibility fixtures。
- acceptance[0] 新客户端连接旧服务端、旧客户端连接新服务端均有确定性协商结果，不出现静默字段丢失。
- acceptance[1] 不兼容 mandatory capability 在执行任务前被拒绝，并返回机器可读原因。
- acceptance[2] 相同构建的 schema fingerprint 稳定
- acceptance[3] 任何协议行为变更都会触发 fixture diff。
- acceptance[4] 协商结果写入每个 Run 的 provenance。
- validation[0] 建立 N-2/N-1/N compatibility matrix tests。
- validation[1] 故意删除 mandatory capability、改变 enum/required field，确认 CI fail。
- validation[2] TS 与 Python 客户端对同一 handshake fixture 产生相同 negotiated profile。
- nonGoals:不依赖 User-Agent 字符串或 package version 猜测能力。
- predecessors:P0-06 P4-01
- files:[B] `packages/sdk/protocol/src/types.ts` · [B] `packages/sdk/protocol/src/transport.ts` · [B] `packages/sdk/protocol/src/index.ts` · [B] `packages/sdk/server/src/server.ts` · [B] `packages/sdk/client/src/client.ts` · [B] `packages/api/gateway/src/index.ts` · [N] `packages/sdk/protocol/src/version.ts` · [N] `packages/sdk/protocol/src/capabilities.ts` · [N] `packages/sdk/protocol/src/schema-fingerprint.ts` · [N] `packages/sdk/protocol/tests/version-negotiation.spec.ts` · [N] `docs/subsystems/control-protocol.md`
- stages:C:5 文件 · P:3 文件 · U:3 文件 · F:2 文件
- realTask:E8 S11 S15
- gate:Every connection negotiates auth, audience, version, schemas, capabilities before use; S11/S15.
- rollback:R — negotiate the last common version; retain both decoders and reject new-only commands.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:2 条有效冻结 / 29 个具名用例 / 变异证明 2/2 / 格子 GREEN · 有 supplement
    - contract: a new client against an old server agrees on the highest version both support
    - contract: an old client against a new server reaches the same version as the reverse pairing
    - contract: the highest mutually supported version wins, not the lowest
    - contract: non-overlapping ranges refuse with a machine-readable reason and BOTH ranges, so no field silently vanishes
    - …共 29 条(分布在 2 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 15 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - provider: the package exports every negotiation function a peer needs
    - provider: the exported functions are the same implementations the Contract stage proved, not re-declarations
    - provider: a fingerprint computed through the package face equals one computed from the same surface twice
    - provider: the server advertises a RANGE even while it speaks one generation
    - …共 15 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 9 个具名用例 / 变异证明 1/1 / 格子 GREEN
    - contract: a complete negotiation reaches the caller with every field intact
    - control: the server identity still arrives, so the case above measures the added fields and not a broken handshake
    - contract: a server that sends no negotiation is admitted, and the field is absent rather than empty
    - contract: a malformed range is dropped rather than repaired into a claim the peer never made
    - …共 9 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 32 个具名用例 / 变异证明 1/1 / 格子 GREEN · 有 supersede
    - contract: a new client against an old server agrees on the highest version both support
    - contract: an old client against a new server reaches the same version as the reverse pairing
    - contract: the highest mutually supported version wins, not the lowest
    - contract: non-overlapping ranges refuse with a machine-readable reason and BOTH ranges, so no field silently vanishes
    - …共 32 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **modelcontextprotocol/modelcontextprotocol**(NOASSERTION · 9,112★) — Spec only; initialize shape
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0; fingerprint = sha256(JCS(JSON Schema)); ~100 lines — inline the sort if the dependency bar is not met **⟶ 裁决取代:§7.2 R7:已验收,手排 fingerprint 记录不改;P8-07 若需 Python 复算再换**
- **npm/node-semver**(npm `semver` · ISC · 5,460★) — 7.8.5 range matching
- **colinhacks/zod**(npm `zod` · MIT) — 4.4.3 z.toJSONSchema from Typert zod (already dep of typert/registry)
- **paulmillr/noble-hashes**(npm `@noble/hashes` · MIT) — Present
**不用(reject,理由)**:
- microsoft/vscode-languageserver-node (vscode-jsonrpc) — 9.0.2 frames with LSP Content-Length not NDJSON, no Python twin — would break the hand-written Python client
- open-rpc/generator — Last push 2025-10-22 (stale)
**标准(绑定词汇)**:MCP initialize protocolVersion + capabilities shape (**本 epic 是形状所有者**) · LSP ClientCapabilities pattern  · RFC 8785 JCS for schema fingerprints (本 epic 未采用/不采用;所有者 P2-03,见裁决叠加)
**自己写(residual)**:version.ts (range algebra over SchemaVersion major/minor + wire protocolVersion), capabilities.ts (mandatory/optional sets, fail-fast, compatibility-adapter registry recording degradations into trace/provenance), N-2/N-1/N golden fixtures, Python mirror of negotiation in client.py (~50 lines); replace the hand-mirrored registry ID list with the generated fingerprint set.
**禁令/风险(risk)**:Do NOT swap transport.ts for vscode-jsonrpc; InitializeParams carries only schemaVersion today — gap is real but narrow.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-multica-runtime 60★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Exact-match version only, no range negotiation; no schema fingerprints; no mandatory/optional capability classification or fail-fast rule on unknown mandatory capability; no compatibility-ad
- hermes-dsh-bridge 2★ 覆盖≈0% — Injects apiProxy, a seam removed 2026-08-10 → breakage evidence for capability discovery
- dsh-remote-web-ui 6,717★ 覆盖≈0% — Carries a posture.ts probe to detect which cohort of dsh it runs on
**裁决叠加(整改令)**:
- §7.1 已验收核验:设计偏离记录(R7):手排 fingerprint,不外发
- §7.2 R7:整数 API level / 手排 fingerprint 记录不改;P8-07 若需 Python 复算 fingerprint 则换 JCS

#### P8-02 · 一等公民 Remote Resources：Run、Agent、Action、Approval、Artifact、Verification、World

`First-class remote resources (Run/Agent/Action/Approval/Artifact/Verification/World)` · L5_SURFACE · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 35% · 状态 **NOT_RUN (W16)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义稳定资源 ID、summary/detail representations、pagination、filter、watch 和 optimistic concurrency token。
- must[1] 提供 run.create/get/list、agent.get/list、action.get/list、approval.get/list、artifact.get/list、verification.get、world.get/list。
- must[2] Remote API 只读取各领域 Service Definition，不复制业务状态
- must[3] 遗留 API Proxy 逐项迁移并保留明确 compatibility route。
- must[4] 所有资源响应带 tenant、classification、revision、createdAt/updatedAt、provenance 和 allowedActions。
- acceptance[0] 客户端无需解析 assistant 文本或 raw event 即可判断 Run 当前状态、待审批项、证据和产物。
- acceptance[1] 分页、过滤和 revision 在 100k Runs/1M Actions 数据集上稳定且无全表内存加载。
- acceptance[2] 资源访问经过 P2/P8 authorization，越权 ID 枚举不泄露资源存在性。
- acceptance[3] Typert Remote、JSON-RPC SDK 与 Host API 对同一领域状态返回语义一致。
- validation[0] 运行 schema/contract/golden tests 和 100k-resource pagination load test。
- validation[1] 跨租户 fuzz ID、cursor、filter，确认 404/403 语义不泄露。
- validation[2] 迁移一个现有 Session API 作为 compatibility test，比较旧/新投影。
- nonGoals:不把 Remote Resource 本身变成新的状态源 / canonical domain ledger 仍是事实来源。
- predecessors:P4-01 P6-09 P7-05 P8-01
- files:[B] `packages/sdk/protocol/src/types.ts` · [B] `packages/sdk/server/src/server.ts` · [B] `packages/sdk/client/src/api.ts` · [B] `packages/api/remotes/src/index.ts` · [B] `packages/api/remotes/src/types.ts` · [N] `packages/api/remotes/src/run.ts` · [N] `packages/api/remotes/src/action.ts` · [N] `packages/api/remotes/src/approval.ts` · [N] `packages/api/remotes/src/artifact.ts` · [N] `packages/api/remotes/src/verification.ts` · [N] `packages/api/remotes/src/world.ts` · [N] `packages/sdk/protocol/src/resources.ts` · [N] `packages/sdk/protocol/tests/resources.contract.spec.ts`
- stages:C:5 文件 · P:5 文件 · U:5 文件 · F:2 文件
- realTask:E8 S11 S15
- gate:Authorized projections, cursor/snapshot/delta/backpressure meet proposed limits; never second write store; S11/S15.
- rollback:R/D — disable new resources, retain canonical stores/cursors and old decoder.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**不用(reject,理由)**:
- ts-rest/ts-rest — Last push 2026-02-06; third RPC contract beside Typert
- trpc/trpc — Third RPC seam
- connectrpc/connect-es — 2.1.2; third RPC seam
- bufbuild/buf — Third RPC seam
- microsoft/typespec — 1.15.0; second source of truth
- OAI/OpenAPI-Specification — Emit OpenAPI/JSON Schema FROM Typert as a derived artifact (P8-07), never as source
- unnoq/orpc — gh lookup redirected to dinwwwh/orpc 7★ — UNVERIFIED canonical
**只读参考(reference)**:
- kubernetes/kubernetes — Pattern only
- aip-dev/google.aip.dev — Pattern only
**标准(绑定词汇)**:Kubernetes resource model (metadata.uid/resourceVersion/creationTimestamp, spec/status, list+watch, resourceVersion precondition) (**本 epic 是形状所有者**) · Google AIP-158 page_token pagination  · Google AIP-160 filter grammar
**自己写(residual)**:5 resource projections (action/approval/artifact/verification/world) as @Remote Typert methods reading P4-01/P6-09/P7-05/P2-07 definitions, shared ResourceEnvelope (tenant, classification, revision, timestamps, provenance, allowedActions), opaque keyset cursor, filter parser, watch = existing mux stream, 100k/1M sqlite pagination test; upstream has session(~Run)+agent get/list with cursor+limit+authorized filtering.
**禁令/风险(risk)**:Any OpenAPI/tRPC/Connect/ts-rest adoption is a THIRD RPC seam beside stdio JSON-RPC and Typert Remote — violates 'not a settled seam'.
**planError**:Files list references packages/host/apiproxy/src/api-proxy.ts which no longer exists (removed 2026-08-10; session.export is now an exact Fetch route in session-log-export).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- sandbase-harness 641★ 覆盖≈10% — Exposes manage agents/sessions, stream turns, inspect artifacts, cancel over stdio MCP — competing surface on a different runtime; no envelope/tenant/revision
**裁决叠加(整改令)**:
- §2.F planError 已解决,记录即可

#### P8-03 · 远程生命周期控制：Pause、Resume、Cancel、Fork、Retry、Reconcile、Close

`Remote lifecycle control (pause/resume/cancel/fork/retry/reconcile/close) w/ idempotency + version check` · L5_SURFACE · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 0% · 状态 **NOT_RUN (W17)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 实现 run.pause/resume/cancel/fork/retry/reconcile/close，并要求 commandId、idempotencyKey、expectedRevision 和 reason。
- must[1] Pause 等待安全 checkpoint
- must[2] Cancel 传播到子 Agent、Workflow、World、工具和审批，并进入 cleanup/compensation。
- must[3] Fork 明确复制 RunPlan/context/artifacts 的哪些部分，不继承 secrets、grants、leases 和 mutable world。
- must[4] 每个命令返回 accepted/currentState/command resource，异步完成通过 event stream 通知。
- acceptance[0] 重复提交同一 commandId 不会重复执行动作或补偿。
- acceptance[1] 非法状态转换被拒绝且不改变 revision。
- acceptance[2] 暂停后进程重启仍可 resume
- acceptance[3] cancel 后没有孤儿 Agent、process、world、lease 或 secret handle。
- acceptance[4] Fork 与父 Run lineage 可追踪，权限不扩大。
- validation[0] 对每条命令运行 state-transition table 和 concurrent command race tests。
- validation[1] 在 pause/cancel/fork 的每个边界 kill 进程并恢复。
- validation[2] 断线后重发命令 1,000 次，验证幂等和最终状态。
- nonGoals:不以 SIGKILL 整个 Harness 作为正常 cancel 实现。
- predecessors:P4-05 P4-07 P4-08 P4-13 P8-02
- files:[B] `packages/sdk/protocol/src/types.ts` · [B] `packages/sdk/server/src/server.ts` · [B] `packages/sdk/client/src/api.ts` · [B] `packages/core/agent/src/dispatch.ts` · [B] `packages/core/agent/src/inbox.ts` · [B] `packages/subagent/subagent/src/lifecycle.ts` · [N] `packages/api/remotes/src/run-control.ts` · [N] `packages/sdk/protocol/src/commands.ts` · [N] `packages/sdk/protocol/tests/run-lifecycle.e2e.ts`
- stages:C:4 文件 · P:1 文件 · U:5 文件 · F:2 文件
- realTask:E8 S07 S14 S15
- gate:Commands enter P4 state machine; fork filters secrets/grants; receipts/allowed transitions server-side; S07/S14/S15.
- rollback:R/D/X — disable commands, preserve Run/action state and negotiate prior protocol.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — Property tests over the explicit Record<State, Record<Command, State\|never>> table
**不用(reject,理由)**:
- statelyai/xstate — 5.32.6; ~10 states × 7 commands table must be property-tested anyway; actor runtime adds a second lifecycle owner next to the Agent loop
- temporalio/temporal — Durable-execution engines replace the Agent loop itself
- restatedev/restate — Same
- dbos-inc/dbos-transact-ts — Same
**标准(绑定词汇)**:IETF draft-ietf-httpapi-idempotency-key-header semantics (所有者 P4-12,import 其定义) · AIP-151 long-running Operation {done, metadata, response, error}  · K8s resourceVersion precondition (所有者 P8-02,import 其定义)
**自己写(residual)**:commands.ts wire types (commandId, idempotencyKey, expectedRevision, reason), command ledger sqlite table keyed (tenant, commandId) → result + fingerprint, explicit state-transition table, pause-at-checkpoint (P4-05/13), cascade cancel + compensation to subagent/workflow/world/leases, fork inheritance rules (no secrets/grants/leases), race + kill-at-boundary tests; upstream has cancel, fork, idempotent create.
**禁令/风险(risk)**:Cascade cancel/compensation touches core/agent dispatch.ts, inbox.ts, subagent lifecycle.ts (hot zones) — keep fork-side changes to hooks/events.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-multica-runtime 60★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No pause/fork/retry/reconcile/close; no commandId/idempotencyKey/expectedRevision/reason contract; no accepted/currentState/command resource; cancel cascade is single-agent + duck-typed suba
- dsh-bridge 138★ 覆盖≈0% — Proxies the existing cancel only
- dsh-remote-web-ui 6,717★ 覆盖≈0% — Proxies the existing cancel only
**裁决叠加(整改令)**:
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P8-04 · 双向 Server→Client Requests：持久审批、澄清、人工接管与 Quorum

`Bidirectional server→client requests (durable approval / clarification / takeover / quorum)` · L5_SURFACE · **CONTRACT_WRITE + REUSE_UPSTREAM** · 可省 0% · 状态 **NOT_RUN (W10)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 approval.request、clarification.request、takeover.request、credential-consent.request（只请求同意，不传 secret 明文）。
- must[1] 请求有 durable requestId、runId、action hash、deadline、eligible principals、quorum、responses、resolution 和 cancellation。
- must[2] 支持客户端注册可处理的 request scopes
- must[3] 断线后请求保留并可由另一个授权客户端接管。
- must[4] 响应必须签名/认证并经过 expectedRevision
- must[5] 晚到或重复响应不会改变已解决结果。
- acceptance[0] 客户端离线 1 小时后重连仍能读取未决请求并安全回答。
- acceptance[1] 多客户端并发响应按 quorum/policy 确定性解决。
- acceptance[2] 审批展示内容与最终 ActionManifest hash 完全绑定。
- acceptance[3] 未经授权客户端看不到请求细节，不能推断敏感 target。
- validation[0] 运行 disconnect/reconnect、deadline、quorum、revocation、late response、duplicate response tests。
- validation[1] 使用两人审批 fixture 验证 separation of duties。
- validation[2] 测试服务重启后 pending request 完整恢复。
- nonGoals:不通过协议把实际 API key/password 发送给模型或普通客户端。
- predecessors:P2-06 P2-07 P2-09 P2-12 P8-01
- files:[B] `packages/sdk/protocol/src/transport.ts` · [B] `packages/sdk/protocol/src/types.ts` · [B] `packages/sdk/server/src/server.ts` · [B] `packages/sdk/client/src/client.ts` · [B] `packages/interaction/user-approval/src/index.ts` · [B] `packages/interaction/user-approval/src/types.ts` · [N] `packages/sdk/protocol/src/server-requests.ts` · [N] `packages/api/remotes/src/human-interaction.ts` · [N] `packages/interaction/human-channel/src/index.ts` · [N] `packages/interaction/human-channel/src/types.ts` · [N] `packages/sdk/protocol/tests/server-request.e2e.ts`
- stages:C:4 文件 · P:2 文件 · U:3 文件 · F:2 文件
- realTask:E8 S04 S05 S15
- gate:No duplicate file owner; cryptographic envelope, bounded queue, server auth, reconnect; S04/S05/S15.
- rollback:R/D/X — stop new requests, retain pending approval queue/cursors, negotiate old protocol.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **@modelcontextprotocol/sdk**(npm `@modelcontextprotocol/sdk`) — 1.29.0 present; elicitation shape maps to clarification.request
- **agentclientprotocol/agent-client-protocol**(npm `@agentclientprotocol/sdk` · Apache-2.0 · 4,132★) — 1.3.0 present; request_permission maps to approval.request with options
- **node:crypto Ed25519** — Response signing bound to actionHash + expectedRevision (attest.ts pattern)
**标准(绑定词汇)**:MCP elicitation/create server→client request shape (所有者 P2-12,import 其定义) · ACP session/request_permission payload shape (所有者 P2-06,import 其定义) · CloudEvents-style id/source/subject on the request envelope (所有者 P4-06,import 其定义)
**自己写(residual)**:server-requests.ts envelope (requestId, runId, actionHash binding, deadline, eligible principals, scopes registration, expectedRevision), reconnection re-delivery of pending requests, late/duplicate response rejection, credential-consent request that never carries secrets; ~40% of scope lands in P2-07/09/12; wire already supports server→client requests both directions.
**禁令/风险(risk)**:Do not model this as MCP itself (dsh is not an MCP server to its own clients); borrow shapes so third-party MCP/ACP clients map 1:1.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-im-gateway 45★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No durable requestId, no action-hash binding (prompt shows only toolName + reason, never args/target), deadline is in-process only (120 s / 600 s), no eligible-principals or quorum, no signe
- dsh-bridge 138★ 覆盖≈15% — WeChat/QQ/Feishu/Telegram approval cards — external human-channel consumer; no durability/quorum/binding; should become a P2-12 human-channel provider

#### P8-05 · Resumable Event Streaming：Cursor、ACK、Replay、Dedupe 与 Backpressure

`Resumable event streaming (cursor/ack/replay/dedupe/backpressure)` · L5_SURFACE · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 5-10% · 状态 **NOT_RUN (W17)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 每个 tenant/stream 使用单调 cursor，事件带 eventId、resourceRevision、causationId 和 classification。
- must[1] 客户端 ACK durable cursor
- must[2] 重连时从 lastAck+1 replay，按 eventId 去重。
- must[3] 定义 retention、cursor expired、snapshot+delta recovery、max in-flight、slow-consumer disconnect。
- must[4] 关键控制事件来自 durable domain outbox，不依赖进程内 emitter
- must[5] 非关键高频 chunk 可明确标记 lossy。
- acceptance[0] 在随机断线、重复、乱序和服务重启下，逻辑资源状态最终与服务端一致。
- acceptance[1] 关键事件无遗漏
- acceptance[2] 重复物理传输经 dedupe 后逻辑重复为 0。
- acceptance[3] 慢客户端不会造成无限队列或阻塞 Agent 执行。
- acceptance[4] cursor 过期时客户端能通过 snapshot+delta 恢复，而不是静默跳过。
- validation[0] 运行 network chaos：drop/duplicate/reorder/delay/reset。
- validation[1] 10M events load test，验证 memory、disk、p95 replay 和 backpressure。
- validation[2] TS/Python 客户端在同一 fault trace 下得到相同最终资源投影。
- nonGoals:不保证 token-level assistant chunk 永久保留 / 关键状态事件必须 durable。
- predecessors:P4-06 P7-07 P8-02
- files:[B] `packages/sdk/protocol/src/transport.ts` · [B] `packages/sdk/server/src/server.ts` · [B] `packages/sdk/client/src/client.ts` · [B] `packages/api/remotes/src/remote-events.ts` · [B] `packages/session/session-persistence/src/coordinator.ts` · [N] `packages/sdk/protocol/src/event-stream.ts` · [N] `packages/api/event-stream/src/index.ts` · [N] `packages/api/event-stream/src/store.ts` · [N] `packages/api/event-stream/tests/reconnect.e2e.ts`
- stages:C:4 文件 · P:3 文件 · U:2 文件 · F:2 文件
- realTask:E8 S11 S15
- gate:Tenant/run cursor, ACK/dedupe/backpressure/checksum; 10k reconnect proposed p95 ≤1 s; no silent retention loss; S11/S15.
- rollback:R/D — stop stream, retain acknowledged cursor/store, snapshot+delta on old version.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **node:sqlite outbox (local default)** — (tenant, seq, eventId, resourceRevision, causationId, classification, payload) + consumer_cursor(tenant, clientId, lastAck); WAL configurable in storage-sqlite
**可选(optional,不进依赖不进 CI)**:
- cloudevents/sdk-javascript — 10.0.0 envelope validation/serialization — inline if its Node HTTP bindings drag deps
- nats-io/nats.js — 3.4.0 + nats-server 20,654★ Go daemon — optional provider, would delete ~40% of replay/ack/retention but only as non-default sink
- redis/ioredis — 6.0.0 Redis Streams — optional provider
**不用(reject,理由)**:
- tulios/kafkajs — Last push 2024-08-02 — stale
**标准(绑定词汇)**:CloudEvents 1.0 attributes id/source/type/time/subject + sequence extension (所有者 P4-06,import 其定义) · SSE Last-Event-ID semantics  · NATS JetStream durable-consumer ack model (ack pending, max_ack_pending, slow-consumer eviction)
**自己写(residual)**:event-stream.ts contract (eventId, resourceRevision, causationId, classification, lossy flag), per-tenant monotonic cursor over the sqlite outbox, client ACK persistence, replay from lastAck+1 with eventId dedupe, retention + cursor-expired → snapshot+delta, max in-flight + slow-consumer disconnect on the mux, chaos + 10M-event tests; upstream journal-stream.ts has snapshot-first open, resumeCursor, cursor algebra, repair, heartbeat.
**禁令/风险(risk)**:Keyless CI and local-default rules forbid a daemon as the default; JetStream/Redis only behind the same seam.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-remote-web-ui 6,717★ 覆盖≈0% — Proxies existing WS/SSE, relies on harness reconnect; no ack/replay
- dsh-pocket 900★ 覆盖≈0% — Same
- dsh-mobile 186★ 覆盖≈0% — Same
**裁决叠加(整改令)**:
- §7.11(修订 R3):CloudEvents 形状所有者是 P4-06(W5,新文件直接采用标准名);本 epic 拥有 P4-01 内部字段(id/runId/seq/occurredAt)→ CloudEvents 的映射层
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P8-06 · Authenticated Principal、Tenant Boundary、RBAC/ABAC 与 API Scope

`Authenticated principal, tenant boundary, RBAC/ABAC, API scope` · L2_PROVIDER · **PROVIDER_ADAPT + REUSE_UPSTREAM** · 可省 30-40% · 状态 **NOT_RUN (W17)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 定义 authenticated Principal、ServiceAccount、Tenant、Organization、Role、Attribute 和 scoped session。
- must[1] API/SDK handshake 验证 OIDC/JWT 或可替换 Auth Provider
- must[2] 内部调用使用短期 service token 与明确 audience。
- must[3] 所有 resource lookup 先绑定 tenant，再做 RBAC+ABAC+CapabilityToken 检查
- must[4] 禁止先全局 lookup 后过滤。
- must[5] Workspace、Run、Artifact、Memory、Approval、Plugin、World 和 Audit 全部携带不可为空的 tenant boundary。
- acceptance[0] 跨租户数据泄漏、resource existence leak 和 command execution 均为 0。
- acceptance[1] token audience、expiry、revocation、key rotation 和 clock skew 有明确行为。
- acceptance[2] 管理员权限不能自动下放给子 Agent
- acceptance[3] delegation 受 CapabilityToken depth 限制。
- acceptance[4] 匿名本地单用户模式仍可通过显式 local principal provider 使用，但不能冒充企业认证。
- validation[0] 运行横向/纵向越权 fuzz、IDOR、confused deputy、token replay 和 key rotation tests。
- validation[1] 至少 100 tenants × 1,000 resources 隔离 load test。
- validation[2] 对每个 Remote method 自动生成 authorization matrix test。
- nonGoals:不把匿名 telemetry correlation id 当作用户登录身份。
- predecessors:P2-01 P2-02 P8-02
- files:[B] `packages/identity/README.md` · [B] `packages/api/gateway/src/index.ts` · [B] `packages/host/webserver/src/index.ts` · [B] `packages/sdk/protocol/src/types.ts` · [B] `packages/workspace/workspace/src/entity.ts` · [N] `packages/identity/auth/src/index.ts` · [N] `packages/identity/auth/src/types.ts` · [N] `packages/identity/tenant/src/index.ts` · [N] `packages/identity/authorization/src/index.ts` · [N] `packages/identity/authorization/src/policy.ts` · [N] `packages/api/auth-middleware/src/index.ts` · [N] `packages/identity/authorization/tests/tenant-isolation.e2e.ts`
- stages:C:5 文件 · P:3 文件 · U:5 文件 · F:2 文件
- realTask:E8 S11 S15
- gate:Server verifies credentials and hides resource existence; caller identity/roles ignored; S11/S15.
- rollback:K/R — revoke credentials, deny remote access, retain audit; no anonymous fallback.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **panva/jose**(npm `jose` · MIT · 7,773★) — 6.2.3 JWT/JWS/JWK/JWKS, key rotation, aud/exp/nbf + clock skew; SignJWT for short-lived internal service tokens
- **panva/openid-client**(npm `openid-client` · MIT · 2,401★) — 6.8.7 discovery, PKCE, token exchange
- **cedar-policy/cedar**(npm `@cedar-policy/cedar-wasm` · Apache-2.0 · 1,704★) — 4.12.0 in-process WASM; forbid > permit, schema, explain — best semantic fit; decide ONCE with P2-10
- **stalniy/casl**(npm `@casl/ability` · MIT · 7,064★) — 7.0.1 only for projecting allowedActions to the client (packed JSON rules)
**可选(optional,不进依赖不进 CI)**:
- casbin/node-casbin — 5.51.1 pragmatic alternative (RBAC+ABAC text models, deny-override)
- openfga/openfga — 0.9.7; daemon — optional provider for orgs that already run it
- ory/kratos|hydra|keto — Go daemons (optional provider at most)
**不用(reject,理由)**:
- open-policy-agent/opa — 1.10.0 needs Go opa build toolchain
- better-auth/better-auth — 1.7.2; owns users/sessions/DB tables + web-framework request model — relocates, not deletes
- nextauthjs/next-auth — Same
- lucia-auth/lucia — v3 deprecated into a guide
- osohq/oso — Last push 2025-02-26, library deprecated
**标准(绑定词汇)**:SPIFFE ID format for ServiceAccount ids (所有者 P3-09,import 其定义) · OIDC/JWT
**自己写(residual)**:identity/auth Service Definition (Principal/ServiceAccount/Tenant/Org/Role/Attribute/scoped session), pluggable AuthProvider seam on client-connection/webServer, LocalPrincipalProvider wrapping existing browser-auth cookie + stdio parent identity, tenant-first lookup discipline in every resolver, non-null tenant on all entities (workspace entity.ts has none), CapabilityToken depth, 403/404 non-leak, authorization-matrix test generator.
**禁令/风险(risk)**:Cedar vs Casbin decision belongs with P2-10 (which plans a hand-written policy language); P2-01 principals cannot be rehydrated across the wire (BLOCKED-025) — this authority IS P8-06.
**planError**:P2-10 plans a hand-written policy language; recommend Cedar there so P8-06/P8-09 consume one engine.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-passwords 40★ 覆盖≈25% — Separate express+jsonwebtoken gateway, admin/user, per-account permissions + quotas, ACME HTTPS; patches dsh files; GPL + out-of-process + source-patching → not adoptable
- deepseek-harness-auth 24★ 覆盖≈20% [topic-sweep] — bundle·进程内·无 key \| 缺口：No Principal model beyond {username, provider}; no ServiceAccount, Tenant, Organization, Role, Attribute, scoped session or CapabilityToken. No OIDC/JWT, no SDK-handshake auth, no short-live
- @xgone/dsh-remote 54★ 覆盖≈15% — /auth/* plane, scrypt, TOTP, admin/user/guest, HMAC cookie gate — reads the core's client-connection/browser-session secret to mint the core cookie (seam violation)
- dsh-auth-gate 8★ 覆盖≈15% — Wraps http server; password/shared-token/Bearer, TOTP, rate-limit, sessions on dsh-storage-domain, launch-token-bridge
- dsh-auth-gateway / dsh-webui-auth / dsh-web-startup-auth 17★ — webServer gates (9★/8★/17★), same shape
**裁决叠加(整改令)**:
- §2.G 开工前设计决定已定(见该 epic 行)
- §3.1 共用引擎 Cedar(@cedar-policy/cedar-wasm 4.12.0)在 P2-05 开工前作为 infra slice 接入;本 epic 只写 adapter/PEP/explain
- §7.11(修订 R3):SPIFFE ID 形状所有者是 P3-09(W8),本 epic import;本 epic 拥有 P0-02/P2-01 内部 id → SPIFFE 的单向映射(ServiceAccount)+ 冻结用例
- §9.2 生态迁移目标:≥7 套登录门各自 wrap http server——AuthProvider seam 在 http server 之前;负用例:provider 拿不到 core session secret(@xgone/dsh-remote 的 seam 违规)

#### P8-07 · Schema-Generated TS/Python SDK Parity 与 Contract Test Matrix

`Schema-generated TS/Python SDK parity + contract test matrix` · L5_SURFACE · **PROVIDER_ADAPT + QUALIFICATION_REUSE** · 可省 40% · 状态 **NOT_RUN (W18)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 从 versioned schema 生成 TS/Python resource models、method clients、events、errors 和 enum
- must[1] 手写层仅保留 ergonomic wrapper。
- must[2] 统一 null/optional、integer、timestamp、binary/artifact ref、union、unknown field 和 error mapping。
- must[3] 生成双向 golden fixtures 与 wire snapshots，确保 TS encode→Python decode 及反向一致。
- must[4] CI 同时构建源码 SDK、单文件 runtime 和 wheel，并运行相同 lifecycle/cancel/reconnect/approval scenarios。
- acceptance[0] 所有公开协议类型 TS/Python 覆盖率 100%，不存在只在一端暴露的方法。
- acceptance[1] 跨语言 round-trip 无字段损失，unknown optional fields forward-compatible。
- acceptance[2] 错误 code/retryability/details 在两端语义一致。
- acceptance[3] 协议 schema 变化未更新两端生成物时 CI 必须失败。
- validation[0] 运行 generated contract matrix、property-based serialization、N-1 fixtures。
- validation[1] Python/TS 同时连接同一 server 完成 Run create→approval→pause→resume→verify→close。
- validation[2] 发布产物安装 smoke tests 不依赖 monorepo 路径。
- nonGoals:不在两个 SDK 中分别手写一套事实模型。
- predecessors:P8-01 P8-02 P8-05
- files:[B] `packages/sdk/protocol/src/types.ts` · [B] `packages/sdk/client/src/api.ts` · [B] `packages/sdk/server/src/server.ts` · [B] `python/sdk/README.md` · [B] `python/sdk-runtime/README.md` · [B] `scripts/build-exe-for-python-sdk.ts` · [B] `scripts/build-python-release.py` · [N] `packages/sdk/schema/control-protocol.json` · [N] `packages/sdk/codegen/src/index.ts` · [N] `packages/sdk/contract-tests/src/cases.ts` · [N] `python/sdk/tests/test_control_protocol_contract.py` · [N] `packages/sdk/client/tests/control-protocol.contract.spec.ts`
- stages:C:5 文件 · P:2 文件 · U:5 文件 · F:2 文件
- realTask:E8 S11 S15
- gate:One schema generates both SDKs; golden wire/unknown/compat/install smoke agree; S11/S15.
- rollback:R — publish compatible patch, retain old generated clients/wire decoder.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **colinhacks/zod**(npm `zod` · MIT · 43,759★) — 4.4.3 present; toJSONSchema from Typert-generated zod
- **koxudaxi/datamodel-code-generator**(MIT · 4,007★) — PyPI 0.76.1 emits pydantic v2 (already used) — replaces hand-written models.py; run in build-python-release.py
- **open-rpc/spec**(Apache-2.0 · 216★) — Document format only; generator tooling stale → write ~300-line codegen
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — Present; TS-side round-trip with ajv
- **HypothesisWorks/hypothesis**(8,932★) — PyPI 6.167.1 Python-side round-trip with jsonschema 4.26.0
- **json-schema-org/JSON-Schema-Test-Suite**(MIT · 745★) — Qualification corpus
**可选(optional,不进依赖不进 CI)**:
- bcherny/json-schema-to-typescript — 15.0.4 drift check
**不用(reject,理由)**:
- StefanTerdell/zod-to-json-schema — ARCHIVED — use zod 4 built-in
- openapi-ts/openapi-typescript — 7.13.0 OpenAPI-HTTP generator — wrong client shape for JSON-RPC over stdio
- hey-api/openapi-ts — 0.99.0 same
- openapi-generators/openapi-python-client — 0.29.1 same
- schemathesis/schemathesis — 4.25.2 HTTP/OpenAPI/GraphQL only — no stdio JSON-RPC driver
- pact-foundation/pact-js — 17.1.3 HTTP-only
- apiaryio/dredd — ARCHIVED
- microsoft/typespec / Smithy / Buf — Second source of truth beside Typert TS types
**标准(绑定词汇)**:JSON Schema 2020-12 as the versioned artifact (所有者 P0-06,import 其定义) · OpenRPC document format for methods
**自己写(residual)**:packages/sdk/codegen (~300 lines: walk Typert registry → control-protocol.json as OpenRPC methods + JSON Schema components; TS/Python method-client stubs), bidirectional golden fixtures + wire snapshots, error-code/retryability mapping table, CI git diff --exit-code on generated artifacts, N-1 fixture runs, wheel/exe smoke tests.
**禁令/风险(risk)**:Python method client wrapper stays hand-written (ergonomic wrapper only, per must[1]).
**裁决叠加(整改令)**:
- §7.2 R3:Confluent 兼容词汇 BACKWARD/FORWARD/FULL 在 SDK 导出处对齐;§7.8:TS/Python parity 矩阵必须含 depth-5000 argumentsHash 用例(Python JCS 库也递归,默认 recursion limit 1000)

#### P8-08 · Operator Control Plane API 与 Run/Agent/Workflow 可视化

`Operator control-plane API + Run/Agent/Workflow visualization` · L5_SURFACE · **CONSUMER_WRITE + PROVIDER_ADAPT** · 可省 25% · 状态 **NOT_RUN (W18)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 展示 Run 列表、状态、Agent/Workflow DAG、当前阶段、预算、成本、阻塞、Action、Policy 决策、Evidence、Verification 与 artifacts。
- must[1] Pause/cancel/resume/retry/approve/reject/takeover 操作调用 Remote command，UI 不直接篡改状态。
- must[2] 基于 server returned allowedActions 控制显示，但服务端仍强制鉴权
- must[3] 敏感参数按 classification 脱敏。
- must[4] 使用 resumable stream 更新，断线重连后从 snapshot+delta 恢复。
- acceptance[0] 用户能在 3 次交互内定位等待审批、失败 verifier、超预算 Agent 和孤立 world。
- acceptance[1] 所有危险操作显示绑定后的 ActionManifest diff 与影响范围。
- acceptance[2] 断线、重启和 1,000 并发 Run 下 UI 状态最终一致且不冻结。
- acceptance[3] 无权限用户既看不到按钮，也无法绕过 API 执行。
- validation[0] 运行 Playwright real-browser E2E，覆盖 reconnect、approval、cancel、repair、artifact download。
- validation[1] 测试 1,000 Run/10,000 Action 虚拟列表性能和内存。
- validation[2] 做 accessibility、keyboard、screen-reader 和 sensitive-field snapshot tests。
- nonGoals:不把 UI 作为 Policy 或状态事实来源。
- predecessors:P8-02 P8-03 P8-04 P8-05
- files:[B] `apps/web/src/main.ts` · [B] `packages/client/modules/src/index.ts` · [B] `packages/api/remotes/src/client/index.ts` · [N] `packages/client/ui-run-control/src/index.ts` · [N] `packages/client/ui-run-control/src/store.ts` · [N] `packages/client/ui-run-control/src/components/RunList.tsx` · [N] `packages/client/ui-run-control/src/components/RunGraph.tsx` · [N] `packages/client/ui-run-control/src/components/ActionTrace.tsx` · [N] `packages/client/ui-run-control/src/components/EvidencePanel.tsx` · [N] `packages/client/ui-run-control/src/components/ApprovalQueue.tsx` · [N] `packages/client/ui-run-control/tests/run-control.e2e.ts`
- stages:C:5 文件 · P:0 文件 · U:5 文件 · F:4 文件
- realTask:E8 S11 S15
- gate:UI sends commands only; server enforces; reconnect/redaction and proposed browser budgets pass; S11/S15.
- rollback:UI — disable module; canonical server/read model continues.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:N/A(registry stages.P.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **xyflow/xyflow**(npm `@xyflow/react` · MIT · 38,231★) — 12.11.6 graph rendering/pan/zoom/selection
- **dagrejs/dagre**(npm `@dagrejs/dagre` · MIT · 5,779★) — 3.1.1 layered DAG layout (elkjs alternative not verified)
- **TanStack/table**(npm `@tanstack/react-table` · MIT · 28,398★) — 9.2.4 RunList sorting/filtering/column state
- **TanStack/virtual**(npm `@tanstack/react-virtual` · MIT · 7,093★) — 3.14.9 already a client dependency
- **microsoft/playwright**(npm `playwright`) — 1.61 already installed; real-browser E2E (qualification)
**不用(reject,理由)**:
- grafana/grafana — AGPL — do not embed; optional external view over OTLP exports
- perses/perses — Whole application, not embeddable in ui-* modules
- backstage/backstage — Whole application
- temporalio/ui — Whole application
- argoproj/argo-workflows — Whole application
**自己写(residual)**:ui-run-control store (zustand) fed by the resumable stream, RunGraph/ActionTrace/EvidencePanel/ApprovalQueue components, allowedActions-driven affordances, classification-based redaction, ActionManifest diff view, a11y + sensitive-field snapshot tests; API = thin composition of P8-02/03/04/05; extend existing ui-approval/ui-workflow-run/ui-jobs/ui-subagent/ui-trajectory.
**禁令/风险(risk)**:Whole-app dashboards are not embeddable in dsh's packages/client/ui-* module system.
**planError**:Files list again cites the removed packages/host/apiproxy.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- iPolloWork 5,273★ 覆盖≈35% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：No Agent/Workflow DAG, budget/cost, Policy decisions, Evidence/Verification or ActionManifest diff views; no pause/retry/takeover; visibility driven by client token scope, not server-returne
- dsh-cost-meter 246★ — Budget/cost dashboard — partial slice
- dsh-usage-stats 140★ — Quota tracking — partial slice
- dsh-context 1,238★ — Context dashboard — partial slice
- loopx (dsh-loopx-plugin) 5,427★ — Goal/heartbeat driver with loopback /loopx channel + GoalBar — not an operator plane
- dsh-remote-web-ui 6,717★ — Remotes the same GUI via webServer routes + loopback proxy — a transport, not a control plane; expose the operator plane as a normal client module so it keeps working
**裁决叠加(整改令)**:
- §2.F planError 已解决,记录即可

#### P8-09 · Organization Governance：Policy Hierarchy、Quota、Retention、Legal Hold 与 Audit Export

`Org governance: policy hierarchy, quota, retention, legal hold, audit export` · L2_PROVIDER · **CONTRACT_WRITE + PROVIDER_ADAPT** · 可省 15-20% · 状态 **NOT_RUN (W18)**

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 实现 monotonic policy hierarchy：下层可收紧但不能放宽上层 deny、data residency、model/provider、plugin trust、budget 和 approval 要求。
- must[1] 定义 tenant/workspace/run 配额：并发 Agent、CPU、memory、network、token、cost、storage、artifact、workflow。
- must[2] 实现 retention、erase、legal hold、export jobs，并覆盖 Session/Run/Action/Evidence/Artifact/Memory/Telemetry outbox。
- must[3] 审计导出使用 versioned schema、完整性链、分页和增量 cursor，可送 SIEM 但默认脱敏。
- acceptance[0] 项目配置无法绕过组织禁止项
- acceptance[1] 冲突时 fail closed 并展示来源。
- acceptance[2] Quota 在调度前和运行中均执行，超额不产生未记录资源。
- acceptance[3] retention/erase/legal hold 对 fork、snapshot、backup 和 index 一致。
- acceptance[4] Audit export 可验证连续性和 hash chain，缺失/篡改 100% 检出。
- validation[0] 运行 policy hierarchy property tests 和 100 组织配置组合。
- validation[1] 做 quota race/overcommit、retention crash、legal hold override、audit tamper tests。
- validation[2] 将导出喂给测试 SIEM schema validator 并核对 replay。
- nonGoals:不在 Harness 内实现某个国家/行业的全部法规 / 提供可验证 Policy Pack 接口。
- predecessors:P2-10 P3-10 P6-10 P8-06
- files:[B] `packages/settings/settings/src/index.ts` · [B] `packages/interaction/permission-presets/src/index.ts` · [B] `packages/workspace/workspace/src/index.ts` · [B] `packages/storage/storage/src/index.ts` · [B] `packages/session-query/session-log-export/src/archive.ts` · [N] `packages/governance/org-policy/src/index.ts` · [N] `packages/governance/org-policy/src/types.ts` · [N] `packages/governance/quota/src/index.ts` · [N] `packages/governance/retention/src/index.ts` · [N] `packages/governance/audit-export/src/index.ts` · [N] `packages/client/ui-governance/src/index.ts` · [N] `packages/governance/org-policy/tests/hierarchy.e2e.ts`
- stages:C:5 文件 · P:4 文件 · U:4 文件 · F:2 文件
- realTask:E8 S11 S15
- gate:Org→tenant→workspace→run only tightens; quota/erase/hold/audit cover canonical stores; S11/S15.
- rollback:K/D/UI — freeze at prior floor, pause jobs, disable UI/export without loosening policy.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **ocsf/ocsf-schema**(Apache-2.0 · 885★) — SIEM schema + ajv validation of exports
- **@opentelemetry/exporter-logs-otlp-http (present)**(npm `@opentelemetry/exporter-logs-otlp-http`) — Optional transport via existing session-telemetry-otel
- **cedar-policy/cedar**(npm `@cedar-policy/cedar-wasm` · Apache-2.0 · 1,704★) — forbid always wins → lower layer may tighten, never loosen, with no re-implemented precedence; same engine as P8-06/P2-10 (Casbin deny-override alternative)
- **paulmillr/noble-hashes**(npm `@noble/hashes` · MIT) — Present; prev-hash chain + periodic Ed25519 checkpoint (attest.ts pattern) = the Trust Kernel auditAppend provider
- **ajv**(npm `ajv`) — Present; validate exports against OCSF JSON schema
**可选(optional,不进依赖不进 CI)**:
- elastic/ecs — Alternative schema
**不用(reject,理由)**:
- animir/node-rate-limiter-flexible — 11.2.0 request rate only, no sqlite store, no domain counters — write quota
- google/trillian — Transparency-log daemon — overkill
- sigstore/rekor — Daemon — overkill
**标准(绑定词汇)**:OCSF as SIEM-facing audit event schema  · OTLP logs as optional transport  · RFC 8785 JCS for hash-chain canonicalization (所有者 P2-03,import 其定义)
**自己写(residual)**:org-policy types + source attribution UI, quota admission (concurrency/CPU/mem/net/tokens/cost/storage/artifact/workflow) integrated with the scheduler, retention/erase/legal-hold jobs across Session/Run/Action/Evidence/Artifact/Memory/Telemetry outbox incl. forks/snapshots/indexes, paginated incremental export cursor, redaction-by-default.
**禁令/风险(risk)**:Transparency logs are overkill; a prev-hash chain + periodic Ed25519 checkpoint meets 'missing/tamper 100% detected'.
**planError**:Files list cites removed packages/host/apiproxy/src/session-export.ts (now packages/session/session-log-export).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- tingly-box 345★ 覆盖≈15% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：No monotonic org->workspace->run policy hierarchy (child may only tighten), no quotas (concurrency/CPU/memory/token/cost/storage) enforced pre-schedule and in-flight, no retention/erase/lega
- dsh-passwords 40★ 覆盖≈10% — Per-account token/daily quotas at the gateway — wrong layer (pre-scheduler) and license
- dsh-cost-meter / dsh-usage-stats 246★ 覆盖≈0% — Display budgets only
**裁决叠加(整改令)**:
- §2.F planError 已解决,记录即可
- §3.1 共用引擎 Cedar(@cedar-policy/cedar-wasm 4.12.0)在 P2-05 开工前作为 infra slice 接入;本 epic 只写 adapter/PEP/explain
- 执行卡 §1(JCS 所有者 P2-03):argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P8-10 · Config Provenance、Typed Dry-Run、迁移/回滚、ABI Compatibility 与 Disaster-Recovery Release Gate

`Config provenance, typed dry-run, migration/rollback, ABI compat, DR release gate` · L6_QUALIFICATION · **REUSE_UPSTREAM + QUALIFICATION_REUSE** · 可省 25% · 状态 **NOT_RUN (W19)** · 上游已部分实现

**SDD · 规格(registry 原文,唯一验收依据)**
- must[0] 编译最终配置时记录每个 row/field 的 profile、bundle、home patch、CLI patch 来源、schema version 和 shadowed value。
- must[1] 提供 `dsh config plan`：typed validation、capability graph、policy impact、plugin permissions、migration plan、diff 和 dry-run
- must[2] 不在 dry-run 执行插件代码。
- must[3] 所有持久领域定义 versioned migration，迁移前 snapshot，失败自动回滚
- must[4] 插件/协议/Service Definition 有 ABI compatibility checks。
- must[5] 建立加密 backup/restore 与 DR drill，覆盖 Run/Workflow Journal/Action Ledger/Approval/Evidence/Artifact/Memory/Policy/Plugin Lockfile
- must[6] 发布必须生成 evidence package。
- acceptance[0] 任何运行行为都能解释由哪一层配置决定
- acceptance[1] 未知/冲突关键字段 fail closed。
- acceptance[2] 旧版本真实 fixture 可以迁移到新版本并重放
- acceptance[3] 失败后能恢复到旧二进制和旧状态。
- acceptance[4] 破坏性 ABI/schema 变化未提供 migration/major version 时 release gate 失败。
- acceptance[5] 在全进程、存储节点和 execution provider 故障演练后，RPO/RTO 达到声明目标且无重复外部副作用。
- validation[0] 运行 config precedence golden tests、恶意 patch、unknown field 和 shadowed security policy tests。
- validation[1] 用 N-2 production-like fixtures 做 migrate→run→rollback→run。
- validation[2] 执行季度式 DR simulation：备份、删除工作目录、在新主机恢复、继续 pending approval/workflow 并核对 Outcome/ledger。
- validation[3] 最终运行 `pnpm general-purpose-gate`，汇总所有阶段证据
- validation[4] 任何 hard gate 失败都禁止 release。
- nonGoals:不通过隐式 deep-merge 改变现有 row replacement 语义 / 先提供明确 typed diff 和迁移。
- predecessors:P0-01 P0-07 P1-03 P4-08 P8-01 P8-09
- files:[B] `packages/boot/app-boot/src/profile.ts` · [B] `packages/boot/app-boot/src/index.ts` · [B] `apps/cli/src/profile-boot.ts` · [B] `apps/cli/src/dump-config.ts` · [B] `packages/settings/settings/src/index.ts` · [B] `packages/bundle/base/cordis.patch.yml` · [B] `package.json` · [N] `packages/boot/config-compiler/src/index.ts` · [N] `packages/boot/config-compiler/src/provenance.ts` · [N] `packages/boot/config-compiler/src/diff.ts` · [N] `packages/boot/config-migration/src/index.ts` · [N] `packages/compatibility/abi-gate/src/index.ts` · [N] `packages/backup/disaster-recovery/src/index.ts` · [N] `scripts/general-purpose-gate.ts` · [N] `tests/disaster-recovery/restore.e2e.ts` · [N] `.github/workflows/release-gate.yml`
- stages:C:5 文件 · P:3 文件 · U:5 文件 · F:5 文件
- realTask:E8 S07 S11 S14 S15
- gate:Typed provenance/dry-run, reversible migration, installed pack/ABI, new-host Run/Approval/Artifact/Memory/Audit restore; RPO=0/RTO≤5m; S07/S11/S14/S15.
- rollback:K/D/R — stop promotion, restore config/data checkpoint and old ABI/protocol; release stays NO-GO.
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结(格子 NOT_RUN)
- P:未冻结(格子 NOT_RUN)
- U:未冻结(格子 NOT_RUN)
- F:未冻结(格子 NOT_RUN)
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **microsoft/rushstack (@microsoft/api-extractor)**(npm `@microsoft/api-extractor` · MIT · 6,496★) — 7.58.12 public-API report/diff for plugin/Service Definition surfaces
- **arethetypeswrong/arethetypeswrong.github.io**(npm `@arethetypeswrong/cli` · MIT · 1,598★) — 0.18.5 package-shape regressions
- **bluwy/publint**(npm `publint` · MIT · 1,294★) — 0.3.22 present
- **sequelize/umzug**(npm `umzug` · MIT · 2,208★) — 3.8.3 ordered, ledgered up/down runner with JSON ledger under $DSH_HOME
- **node:sqlite backup()** — Verified function on Node 24; landed 23.8, backported to 22.x — pin the minimum
- **FiloSottile/typage**(npm `age-encryption` · BSD-3-Clause · 475★) — 0.3.1 pure-TS encrypted archives (passphrase or x25519 recipients)
**可选(optional,不进依赖不进 CI)**:
- actions/toolkit (@actions/attest) — 3.2.0 needs Fulcio/Rekor — optional CI provenance step
- sigstore/sigstore-js — 5.0.0 optional; local default = P0-07 evidence + attest.ts
- oasdiff/oasdiff — Only if OpenAPI is emitted
- json-schema-diff — npm 1.0.0; repo UNVERIFIED
**不用(reject,理由)**:
- restic/restic — Go CLI sidecar cost, no gain over typage + backup()
- getsops/sops — Same
**标准(绑定词汇)**:SLSA/in-toto attestation (optional) (所有者 SLICE-3.4:R1:envelope slice 在 P4-04(W9)前落地)
**自己写(residual)**:config-compiler typed diff/plan (validate rows via schemastery without executing !!js/plugin code, capability graph, policy impact, plugin permissions), config-migration per persisted domain with pre-snapshot + auto-rollback, protocol/schema ABI gate = registry FieldChange + diff of P8-07 control-protocol.json, DR drill e2e (backup → wipe → restore → resume pending approval/workflow → ledger check), release-gate.yml into the P0-07 package, pnpm general-purpose-gate; provenance already done upstream (dump-config.ts, renderConfigDump, feature-gate chains).
**禁令/风险(risk)**:K8s managedFields / Terraform plan / Flagger are patterns, not libraries; keyless-signing (sigstore) is hosted-only → optional.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-undo-savepoint 142★ 覆盖≈15% — Auto-snapshots config/plugins/settings, undo/redo, secret redaction, safe mode, out-of-process recovery UI/CLI — config-layer rollback UX only, not typed dry-run/domain migrations/ABI/DR
- dsh-desktop 22,965★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No per-row config provenance (that is upstream --dump-config), no `dsh config plan` typed dry-run, no versioned domain migrations for Run/Journal/Ledger/Evidence, no ABI compatibility check
- dsh-market 3,046★ 覆盖≈5% — backup.ts/snapshot.ts/compatibility.ts for plugin config backup + restart
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

### P9 · 扩展与打磨(9 项)

#### P9-01 · LLM Provider Conformance Kit：把模型接入面变成可测契约

`LLM provider conformance kit` · L6_QUALIFICATION · **PROVIDER_WRITE + REUSE_UPSTREAM** · 可省 25-35% · 状态 **P9 C:VERIFIED,P:VERIFIED,U:VERIFIED,F:VERIFIED**

**SDD · 规格(registry 原文,唯一验收依据)**(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)
- must[0] 覆盖六类行为：流式 tool-call 增量、并行多工具调用、中途 abort、错误→`llm-retry` 分类映射、usage/cacheRead/cacheWrite 计量一致、超长输入拒绝语义
- must[1] `llm-deepseek` 与 pi-ai 三线协议（openai-completions/openai-responses/anthropic-messages）各以 mock server 为被试全绿
- must[2] 发现的现存缺陷单独立案
- must[3] kit 不依赖真实 key
- acceptance[0] kit 对 `llm-deepseek` + pi-ai 三协议路由全绿且总 case 数 ≥ 40
- acceptance[1] 对六类行为各注入一处夹具偏差（含 SSE 单字节切分/合并帧边界），kit 逐一红
- acceptance[2] 进入 CI：任何 `packages/llm/**` 改动触发
- validation[0] 全量 kit 运行
- validation[1] 分帧边界注入
- validation[2] abort 时序（首 token 前/工具增量中/收尾）三点验证
- nonGoals:不新写任何 wire-protocol 实现（pi-ai 已有） / 不测模型输出质量，只测协议行为
- predecessors:P0-06
- files:[B] `packages/llm/llm/src/index.ts` · [B] `packages/llm/llm/src/types.ts` · [B] `packages/llm/llm-deepseek/src/adapter.ts` · [B] `packages/llm/llm-pi-ai/src/provider.ts` · [N] `packages/llm/llm-conformance/src/kit.ts` · [N] `packages/llm/llm-conformance/src/mock-server.ts` · [N] `packages/llm/llm-conformance/tests/deepseek.conformance.spec.ts` · [N] `packages/llm/llm-conformance/tests/pi-ai-routes.conformance.spec.ts`
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 13 个具名用例 / 变异证明 1/1
    - P9-01 Contract — conformance registration gate must[1]: a route demonstrating every behaviour is admitted
    - P9-01 Contract — conformance registration gate must[1]: a MISSING behaviour denies — untested is not passed
    - P9-01 Contract — conformance registration gate must[1]: an EMPTY result set denies, naming every required behaviour
    - P9-01 Contract — conformance registration gate must[1]: a failing behaviour denies and names it
    - …共 13 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 9 个具名用例 / 变异证明 1/1
    - P9-01 Provider — stream probes a conformant stream passes all three stream-observable behaviours
    - P9-01 Provider — stream probes a dropped delta fails merging, which a caller cannot detect after the stream is consumed
    - P9-01 Provider — stream probes an adapter that emits whole calls and never streams deltas FAILS rather than passes vacuously
    - P9-01 Provider — stream probes a single tool call fails parallel-tool-calls, since one cannot show the second is not dropped
    - …共 9 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 8 个具名用例 / 变异证明 1/1
    - P9-01 Provider — the complete conformance kit a correct route demonstrates all six behaviours and is ADMITTED
    - P9-01 Provider — the complete conformance kit a route that emits whole tool calls without deltas is denied on merging
    - P9-01 Provider — the complete conformance kit a route that drops the second of two tool calls is denied on parallel calls
    - P9-01 Provider — the complete conformance kit a cancelled request reported as `stop` is denied: the caller cannot tell it from a normal fini
    - …共 8 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 19 个具名用例 / 变异证明 1/1
    - P9-01 Fault — abort timing, all three points a correct route aborted before-first-token is still admitted
    - P9-01 Fault — abort timing, all three points a correct route aborted mid-tool-call-delta is still admitted
    - P9-01 Fault — abort timing, all three points a correct route aborted at-wrap-up is still admitted
    - P9-01 Fault — abort timing, all three points a route reporting stop instead of aborted is denied at before-first-token, so no timing hides t
    - …共 19 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **mswjs/msw**(npm `msw` · MIT · 18,180★) — 2.15.0; in-process handlers for /v1/messages and /responses with ReadableStream SSE bodies
- **rexxars/eventsource-parser**(npm `eventsource-parser` · MIT · 497★) — 3.1.0; byte-split SSE injector framing
**可选(optional,不进依赖不进 CI)**:
- nock/nock — nock 14 works but msw is the cleaner fetch/undici story
**不用(reject,理由)**:
- stoplightio/prism — OpenAPI mock, weak SSE streaming
- Netflix/pollyjs — npm 2023, repo 2025-05 — stale
**只读参考(reference)**:
- openai/openai-openapi — Request/response schema oracle
- badlogic/pi-mono — packages/ai/test already covers wire-level SSE parsing upstream — do not re-test
**自己写(residual)**:Six behaviour cases, retry-classification map to llm-retry, usage/cacheRead/cacheWrite accounting, over-long-input semantics, per-route fixtures (≥40 cases); extend llm-mock-server beyond /chat/completions.
**禁令/风险(risk)**:Do not re-test pi-ai wire parsing (upstream twin is a settled seam); test dsh's observable LlmAdapter seam behaviour.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-agy 28★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·需 key/服务 \| 缺口：Tests are adapter-specific, not a reusable kit; no mock server package; no visible usage/cacheRead/cacheWrite metering assertions, no parallel-multi-tool or overlong-input cases; does not ex
- dsh-llm-newapi 7★ 覆盖≈0% — LlmAdapter for OpenAI-compatible gateways — a test subject for the kit, not the kit
- dsh-plugin-subscriptions 312★ 覆盖≈0% — Codex/Claude/Grok/Copilot routes — test subject, not the kit

#### P9-02 · 激活 pi-ai 多协议路由：让"任何 API"成为出货能力

`Activate pi-ai multi-protocol routes ("any API")` · L2_PROVIDER · **REUSE_UPSTREAM + CONSUMER_WRITE** · 可省 50% · 状态 **P9 C:VERIFIED,P:VERIFIED,U:VERIFIED,F:VERIFIED**

**SDD · 规格(registry 原文,唯一验收依据)**(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)
- must[0] 路由声明含 protocol/baseURL/model/apiKeyEnv/超时
- must[1] schema 校验 fail closed，错误信息指明字段
- must[2] key 只经 env/credentials 路径，不落日志与 session 事件
- must[3] 三类协议模板各过 conformance
- must[4] catalog 变更不破坏 `deepseek-official` 默认行为
- must[5] 与 P5-02 Model Router 的接口保持：路由只提供可选项，不做选择策略
- acceptance[0] 只写一段 settings（无代码改动）即可让 headless 任务经 mock openai-compat 服务全链路完成（含 ≥3 次工具调用）
- acceptance[1] 三类协议模板 conformance 全绿
- acceptance[2] 无 key 时该路由状态为显式 dormant，`deepseek-official` 不受影响
- validation[0] mock 服务 headless E2E + 配置负例 5 类（缺字段/坏 URL/坏协议名/重复路由/key env 缺失）全部 fail closed + conformance 全量
- nonGoals:不写新 wire protocol / 不做 per-vendor 深度特化（能力差异走 P5-03 协商声明） / 不动上游 `llm` 核心抽象（上游 llm 月 206 commits，避撞）
- predecessors:P9-01
- files:[B] `packages/llm/llm-pi-ai/src/provider.ts` · [P] `packages/llm/llm-pi-ai/src/catalog.ts` · [P] `packages/llm/llm-pi-ai/src/config.ts` · [P] `packages/bundle/base/cordis.patch.yml` · [N] `packages/llm/llm-pi-ai/tests/route-activation.spec.ts` · [N] `docs/user/guide/providers.md`
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 11 个具名用例 / 变异证明 1/1
    - P9-02 Contract — route templates must[0]: each protocol template carries protocol, endpoint, model, credential ref, and timeout
    - P9-02 Contract — route templates must[0]: all three protocol families have a template, and they are distinct
    - P9-02 Contract — route templates must[2]: a key pasted where the variable NAME goes is refused
    - P9-02 Contract — route templates must[2]: the refusal does NOT echo the suspected key back into a log or a bug report
    - …共 11 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 4 个具名用例 / 变异证明 1/1
    - P9-02 Provider — templates resolve through the real config layer acceptance[0]: a settings fragment built from a template resolves to a usab
    - P9-02 Provider — templates resolve through the real config layer acceptance[2]: no configured route at all is the dormant posture, not an er
    - P9-02 Provider — templates resolve through the real config layer acceptance[2]: a template route resolves alongside a hand-written route wit
    - P9-02 Provider — templates resolve through the real config layer the credential stays a REFERENCE through resolution, never a materialized v
- U:1 条有效冻结 / 2 个具名用例 / 变异证明 1/1
    - P9-02 Usage — a settings fragment alone activates a template route acceptance[0]: a headless task completes over a mock gateway after three
    - P9-02 Usage — a settings fragment alone activates a template route must[2]: the key reaches the gateway from the environment, and only from
- F:1 条有效冻结 / 2 个具名用例 / 变异证明 1/1
    - P9-02 Fault — an unserviceable settings fragment stops the run a protocol name nothing implements is refused, naming the route
    - P9-02 Fault — an unserviceable settings fragment stops the run a credential reference whose variable is unset fails the request rather than
**用(adapt)**:
- **sst/models.dev**(MIT · 6,686★) — 212 providers with api baseURL, env key names, npm protocol hint → generate protocol templates from a vendored snapshot at build time (keyless)
- **@earendil-works/pi-ai**(npm `@earendil-works/pi-ai` · MIT · 100,867★) — 0.80.10 already dep; createProvider/createModels; llm-pi-ai catalog.ts maps openai-completions/openai-responses/anthropic-messages
**不用(reject,理由)**:
- BerriAI/litellm — Prices JSON — license unclear
**自己写(residual)**:Route schema fail-closed validation (schemastery), bundle templates, route-activation.spec.ts, docs, 5 negative configs, mock-service headless E2E; dormancy is pure config in cordis.patch.yml.
**禁令/风险(risk)**:models.dev is community-maintained data — pin a snapshot and verify baseURLs in the conformance kit; per-vendor quirks are P5-03's job.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-subscriptions 312★ 覆盖≈25% — Registers vendor-specific routes into the native picker; per-vendor specialisation is an explicit non-goal
- dsh-llm-newapi 7★ 覆盖≈25% — Per-vendor route plugin; proves the plugin path
- @volcengine/ark-plan-api 116★ 覆盖≈25% — Per-vendor route plugin
- dsh-codex 51★ 覆盖≈25% [topic-sweep] — bundle·进程内·需 key/服务 \| 缺口：It is the pi-ai `openai-codex` OAuth provider bound to a fixed chatgpt.com endpoint, not the openai-compat / openai-responses / anthropic-messages templates with baseURL/apiKeyEnv/timeout th

#### P9-03 · Provider/Model 选择面：零代码切换与 `--model`

`Provider/model selection surface (--model)` · L3_CONSUMER · **CONSUMER_WRITE** · 可省 0% · 状态 **P9 C:VERIFIED,P:VERIFIED,U:VERIFIED,F:VERIFIED**

**SDD · 规格(registry 原文,唯一验收依据)**(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)
- must[0] `--model` 解析→路由存在性校验→不存在时列出可用路由 fail closed
- must[1] headless 与交互两路径均生效
- must[2] 选择进 session 事件（可审计），不写死进代码
- acceptance[0] 同一 headless 任务，仅换 `--model` 参数分别经 2 条不同路由（mock）跑通，session 事件记录正确路由
- acceptance[1] 错误 model 参数 fail closed 且提示可用列表
- validation[0] e2e 切换 + 负例 + `--help` 文本与实际行为一致性检查（现有 `--help` 仍宣传已删除的 tui profile，顺带修正）
- nonGoals:不做自动选型（P5-02） / 不做图形配置 UI / 不改上游 args 框架结构
- predecessors:P9-02
- files:[P] `apps/cli/src/args.ts` · [B] `packages/boot/app-boot` · [B] `packages/llm/llm/src/call-config.ts` · [N] `tests/e2e/model-switch.e2e.ts` · [P] `docs/user/guide/providers.md`
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 9 个具名用例 / 变异证明 1/1
    - P9-03 Contract — --model resolution must[0]: splits a registered route from its model
    - P9-03 Contract — --model resolution must[0]: an unregistered route is refused AND the refusal names the routes that exist
    - P9-03 Contract — --model resolution must[0]: a missing separator is refused, because a bare model id names no adapter
    - P9-03 Contract — --model resolution an empty half is refused by the half that is empty, so the message says which one
    - …共 9 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 5 个具名用例 / 变异证明 1/1
    - P9-03 Provider — --model selects the route the run uses must[0]: a registered route and model become the agent's options
    - P9-03 Provider — --model selects the route the run uses acceptance[0]: the SAME task on a different --model differs only in the route it ran
    - P9-03 Provider — --model selects the route the run uses acceptance[1]: an unregistered route exits non-zero and names the routes that exist
    - P9-03 Provider — --model selects the route the run uses acceptance[1]: a malformed argument fails the same way, rather than being read as a
    - …共 5 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 2 个具名用例 / 变异证明 1/1
    - P9-03 Usage — --model reaches a real dsh --profile headless run acceptance[0]: the same task on two --model values is answered by two differ
    - P9-03 Usage — --model reaches a real dsh --profile headless run acceptance[1]: an unregistered route exits non-zero, names the registered ro
- F:1 条有效冻结 / 1 个具名用例 / 变异证明 1/1
    - P9-03 Fault — --model against a profile with no registered route says the profile has no routes rather than printing an empty list
**用(adapt)**:
- **commander**(npm `commander`) — Already dep; no library needed
**标准(绑定词汇)**:provider/model id syntax (models.dev/opencode)  · -m/--model flag naming (codex/claude CLIs)
**自己写(residual)**:Pure wiring: apps/cli/src/args.ts, boot, call-config.ts, session event, e2e; fix the --help drift (tui profile) which upstream HEAD still has.
**禁令/风险(risk)**:Keep <route:model> syntax aligned with provider/model so users can paste ids.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-multica-runtime 60★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Not a `--model <route:model>` CLI flag on headless/interactive paths; failure does not list available routes; no session-event audit of the selection beyond what dsh writes itself.
- dsh-AuthInOne 105★ 覆盖≈5% — Web-side model switching GUI, not headless CLI (0–10%)
- dsh-lark 覆盖≈5% — /model command in IM bridge — GUI, not headless CLI
- dsh-plugin-subscriptions 312★ 覆盖≈5% — Picker UI, not headless CLI

#### P9-04 · 编辑工具容错强化：从精确匹配到分级回退

`Edit tool tolerant fallback (exact → whitespace → indent)` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 0% · 状态 **P9 C:VERIFIED,P:VERIFIED,U:VERIFIED,F:VERIFIED**

**SDD · 规格(registry 原文,唯一验收依据)**(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)
- must[0] 三级回退逐级尝试，任何一级多重命中即 `FS_AMBIGUOUS_EDIT`
- must[1] 回退命中时结果 diff 标注实际匹配层级
- must[2] 版本守卫（现有 version-guard）语义不变
- must[3] 错误消息包含最近似片段定位提示（行号+相似度），帮模型一次改对
- acceptance[0] 夹具集：尾随空白差异、CRLF/LF 差异、整体缩进 +2/-2 三类均一次命中且 diff 标注层级
- acceptance[1] 歧义夹具（两处近似）仍 fail closed
- acceptance[2] 现有全部 fs 测试不回归
- validation[0] 夹具全量 + fs 包回归 + 一次 headless 真实编辑任务对比（改动前后各跑同一任务记录重试次数）
- nonGoals:不引入模糊语义匹配/AST 匹配 / 不改 str_replace_editor 的对外 schema / 不做 patch/hunk 新格式（避免与上游工具面撞车）
- files:[P] `packages/fs/fs-local/src/fsio.ts` · [P] `packages/fs/tool-fs/src/edit.ts` · [N] `packages/fs/fs-local/tests/edit-fallback.spec.ts`
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 21 个具名用例 / 变异证明 1/1
    - P9-04 Contract — graded edit fallback must[0]: an exact match is located at the exact tier, so the ladder never runs for text that already m
    - P9-04 Contract — graded edit fallback must[0]: a trailing-whitespace difference falls to the trailing-whitespace tier
    - P9-04 Contract — graded edit fallback must[0]: a uniform indent shift falls to the indentation tier and reports the delta
    - P9-04 Contract — graded edit fallback CRLF is already handled by normalization, NOT by a fallback tier — the tier stays exact
    - …共 21 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 7 个具名用例 / 变异证明 1/1
    - P9-04 Provider — the ladder wired into applyLiteralEdit an exact match still reports tier "exact", so the fallback cannot claim credit for t
    - P9-04 Provider — the ladder wired into applyLiteralEdit must[0]: a trailing-whitespace miss is rescued and reports the tier that matched
    - P9-04 Provider — the ladder wired into applyLiteralEdit must[0]: an indentation miss is rescued and the replacement lands at the FILE indent
    - P9-04 Provider — the ladder wired into applyLiteralEdit replaceAll never falls back: "every approximate place" is a different request and st
    - …共 7 条(分布在 1 个冻结条目),见 command-freeze.json
- U:1 条有效冻结 / 5 个具名用例 / 变异证明 1/1
    - P9-04 Usage — what the model is told about the tier must[1]: an exact match adds NOTHING, so an ordinary edit spends no tokens reporting the
    - P9-04 Usage — what the model is told about the tier must[1]: a trailing-whitespace match tells the model its old_string did not match as wri
    - P9-04 Usage — what the model is told about the tier must[1]: an indentation match names indentation as what was ignored
    - P9-04 Usage — what the model is told about the tier the tier note is added to the replace_all sentence too, not only the single-edit one
    - …共 5 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 9 个具名用例 / 变异证明 1/1
    - P9-04 Fault — the fallback must not weaken the version guard (must[2]) a stale version is refused even when the fallback WOULD have matched
    - P9-04 Fault — the fallback must not weaken the version guard (must[2]) the same edit succeeds at the current version, so the guard bounds ra
    - P9-04 Fault — acceptance[0], indentation in both directions a search text indented +2 relative to the file is rescued and re-indented down
    - P9-04 Fault — acceptance[0], indentation in both directions a search text indented -2 relative to the file is an exact SUBSTRING hit, not a
    - …共 9 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:
- **jsdiff (diff)**(npm `diff`) — Already dep; diffLines for nearest-region hint
**可选(optional,不进依赖不进 CI)**:
- ka-weihe/fastest-levenshtein — 1.0.16, 2022 — stable, tiny
**不用(reject,理由)**:
- google/diff-match-patch — Archived 2024
**只读参考(reference)**:
- sst/opencode — packages/opencode/src/tool/edit.ts replacer cascade (SimpleReplacer → LineTrimmedReplacer → WhitespaceNormalizedReplacer → IndentationFlexibleReplacer …) — port ~150 lines under MIT attribution
- openai/codex — codex-rs/apply-patch/src/seek_sequence.rs exact → trim_end → trim
- cline/cline — Similar fallback but file path moved — UNVERIFIED path
**自己写(residual)**:Port only 3 levels (exact → line-trim → indent-shift) into fs-local/src/fsio.ts applyLiteralEdit, keep FS_AMBIGUOUS_EDIT at every level, annotate diff with level, add line+similarity hint.
**禁令/风险(risk)**:Do not import opencode (an app, not a library); do not add AST/fuzzy semantic matching.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-better-edit 21★ 覆盖≈0% — Hash-anchored line edits — a different tool schema (non-goal forbids changing str_replace_editor)

#### P9-05 · token-meter 真实分词：替换 4 字符/词启发

`token-meter real tokenizer (replace 4-chars/token)` · L2_PROVIDER · **PROVIDER_ADAPT** · 可省 60-70% · 状态 **P9 C:VERIFIED,P:VERIFIED,U:SCHEDULED_BLOCKED,F:SCHEDULED_BLOCKED**

**SDD · 规格(registry 原文,唯一验收依据)**(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)
- must[0] 官方 DeepSeek 路径精确计数
- must[1] 每次真实响应的 usage 与预估对比进校准状态（会话内自适应）
- must[2] 无 tokenizer 路由 p95 相对误差 ≤ 阈值（对照夹具：TS 代码/中文散文/JSON/混合 4 类语料）
- must[3] 估计接口保持同步纯函数（不阻塞循环）
- acceptance[0] 4 类语料夹具上 DeepSeek 精确路径误差=0
- acceptance[1] 启发路径 p95 ≤ 冻结阈值
- acceptance[2] 校准闭环在含 3 次真实（mock usage）响应的会话内把误差单调收窄
- acceptance[3] compaction-basic 现有测试不回归
- validation[0] 语料夹具 + 校准收敛测试 + compaction 触发点前后对比
- nonGoals:不为每家第三方模型 vendor 打包 tokenizer / 不改 compaction 策略本身（P6-06 域）
- files:[P] `packages/llm/token-meter/src/estimate.ts` · [B] `packages/llm/token-meter/src/index.ts` · [N] `packages/llm/token-meter/src/tokenizer-deepseek.ts` · [N] `packages/llm/token-meter/src/usage-calibration.ts` · [N] `packages/llm/token-meter/tests/accuracy.spec.ts`
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 10 个具名用例 / 变异证明 1/1
    - P9-05 Contract — must[1]: each response narrows the estimate an uncalibrated session changes nothing, so the first request is priced exactly
    - P9-05 Contract — must[1]: each response narrows the estimate acceptance[2]: three real responses narrow the error MONOTONICALLY
    - P9-05 Contract — must[1]: each response narrows the estimate the factor converges toward the real density rather than overshooting past it
    - P9-05 Contract — must[1]: each response narrows the estimate one outlier cannot swing the next estimate by its whole error
    - …共 10 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 5 个具名用例 / 变异证明 1/1
    - P9-05 Provider — calibration is advisory must[1]: a real response yields a correction derived from what the provider reported
    - P9-05 Provider — calibration is advisory a session with no real response reports NO correction rather than an invented one
    - P9-05 Provider — calibration is advisory a call that reported no usage teaches nothing
    - P9-05 Provider — calibration is advisory BLOCKED-120: measure() does NOT apply it — the numbers are identical either way
    - …共 5 条(分布在 1 个冻结条目),见 command-freeze.json
- U:未冻结
- F:未冻结
**用(adapt)**:
- **huggingface/tokenizers.js**(npm `@huggingface/tokenizers` · Apache-2.0 · 55★) — 0.1.3, 301 KB pure JS/TS, sync encode; exact BPE with vendored DeepSeek tokenizer.json
- **johannschopplich/tokenx**(npm `tokenx` · MIT · 175★) — 2.1.0, 67 KB, CJK rules, tunable charsPerToken — replaces CHARS_PER_TOKEN=4 heuristic
- **DeepSeek-V3 tokenizer.json (HF asset)** — 7.85 MB LlamaTokenizerFast (or DeepSeek official 1.98 MB zip); lazy-load or optional package
**不用(reject,理由)**:
- lenML @lenml/tokenizer-deepseek_v3 — 60 MB unpacked
- @huggingface/transformers — 4.2.0 pulls onnxruntime
- tokenizers (napi) — 0.13.3 native, old
- dqbd/js-tiktoken / niieani/gpt-tokenizer — OpenAI vocabularies — wrong for DeepSeek; usable only for openai routes
**自己写(residual)**:usage-calibration.ts closed loop from real usage, lazy preload so the sync pure-function contract holds, 4-corpus accuracy fixtures, compaction non-regression.
**禁令/风险(risk)**:tokenizers.js is 0.1.x/55★ (young, official HF port) — keep behind the token-meter seam; bundle defaults are deepseek-v4-* while the public tokenizer is V3's — BLOCKED if vocabularies differ.
**planError**:Must confirm V4 tokenizer parity at implementation (public asset is V3).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-context 1,238★ 覆盖≈0% — Displays host estimates; consumer
- dsh-live-stats 覆盖≈0% — Displays host estimates; consumer
**裁决叠加(整改令)**:
- §7.10:planError(V4 tokenizer 与公开 V3 资产的一致性待验)——must[0] 官方精确计数尚未做(现仍 fixed-density heuristic,U/F SCHEDULED_BLOCKED);U 开工时先验 V4 词表 parity,写 preFlight;不一致则 must[0] 只对 V3 成立并记 known-limitation

#### P9-06 · Headless 脚本化：`--resume` / `--output-format json` / stdin

`Headless scripting: --resume / --output-format json|stream-json / stdin` · L3_CONSUMER · **CONSUMER_WRITE** · 可省 0% · 状态 **P9 C:VERIFIED,P:VERIFIED,U:VERIFIED,F:VERIFIED**

**SDD · 规格(registry 原文,唯一验收依据)**(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)
- must[0] `--resume` 恢复既有会话继续任务（复用 session 层既有恢复语义与崩溃修复）
- must[1] `stream-json` 逐事件行输出与 SDK 既有 `stream-json.expected.jsonl` 口径一致
- must[2] stdin 输入与位置参数互斥且报错清晰
- must[3] 退出码：任务完成=0，`BLOCKED`/失败=非 0 且 JSON 里带 typed 原因
- acceptance[0] e2e：任务 A 运行→中断→`--resume` 完成，全程 stream-json 可逐行 parse 且事件序完整
- acceptance[1] `echo task \| dsh --profile headless --output-format json` 输出可 parse 且含最终消息与 usage
- acceptance[2] 退出码矩阵 4 类夹具全对
- validation[0] e2e 三件套 + 与 SDK expected.jsonl 口径 diff + 崩溃中断恢复夹具
- nonGoals:不做 TUI / 不改 session 存储格式 / 不做多任务队列（P4 域）
- files:[P] `packages/bundle/headless/src/startup.ts` · [P] `packages/bundle/headless/src/index.ts` · [P] `apps/cli/src/args.ts` · [N] `packages/bundle/headless/tests/scriptability.e2e.ts` · [N] `docs/user/guide/headless.md`
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 16 个具名用例 / 变异证明 1/1
    - P9-06 Contract — resolveTaskInput must[2]: a positional task alone resolves to the argument source
    - P9-06 Contract — resolveTaskInput must[2]: piped text alone resolves to the stdin source
    - P9-06 Contract — resolveTaskInput must[2]: supplying BOTH is refused rather than ranked, so a script is told about its bug
    - P9-06 Contract — resolveTaskInput must[2]: supplying neither is refused
    - …共 16 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 3 个具名用例 / 变异证明 1/1
    - headless runner exits 1 with a typed unknown reason when the final turn does not complete
    - headless runner prints the durable model failure when the final turn ends in error
    - headless runner exits 1 with a typed unknown reason when the owned interval contains no turn
- U:1 条有效冻结 / 3 个具名用例 / 变异证明 1/1
    - P9-06 Usage — stream-json is emitted by the product, in the recorded format must[1]: every line parses, events precede exactly one final res
    - P9-06 Usage — stream-json is emitted by the product, in the recorded format must[1]: the emitted envelopes carry the same keys as the record
    - P9-06 Usage — stream-json is emitted by the product, in the recorded format an unknown --output-format is refused with the accepted list, no
- F:1 条有效冻结 / 6 个具名用例 / 变异证明 1/1
    - P9-06 Fault — acceptance[2], the exit-code matrix through the real runner a 'completed' run exits +0
    - P9-06 Fault — acceptance[2], the exit-code matrix through the real runner a 'blocked' run exits 2
    - P9-06 Fault — acceptance[2], the exit-code matrix through the real runner a 'aborted' run exits 3
    - P9-06 Fault — acceptance[2], the exit-code matrix through the real runner a 'max-tokens' run exits 5
    - …共 6 条(分布在 1 个冻结条目),见 command-freeze.json
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**标准(绑定词汇)**:NDJSON stream-json shape frozen by headless expected fixtures  · codex exec --json / Claude Code --output-format flag names
**自己写(residual)**:Pure wiring over existing agents.resume(); exit-code matrix; stdin/positional exclusivity; prerequisite for P9-08.
**禁令/风险(risk)**:apps/cli is a hot zone (374 commits/month) — keep the args delta minimal, put logic in the headless bundle; upstream HEAD has no resume/output-format/stdin so re-diff before starting.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-multica-runtime 60★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Lives in its own 'multica' profile behind --stdio, not on `dsh --profile headless` flags; its frame schema is not the SDK stream-json.expected.jsonl shape; exit-code matrix diverges (cancell
- dsh-eval-harness 14★ 覆盖≈0% — Works around this gap by forking dsh --profile headless --patch overlay and reading session.jsonl
- DSH-taskboard 282★ 覆盖≈0% — Has its own headless JSON CLI

#### P9-07 · Agent Loop 硬预算：maxTurns / 花费上限 / 超限语义

`Agent-loop hard budgets (maxTurns / cost cap)` · L3_CONSUMER · **CONSUMER_WRITE + CONTRACT_WRITE** · 可省 0% · 状态 **P9 C:VERIFIED,P:VERIFIED,U:VERIFIED,F:VERIFIED**

**SDD · 规格(registry 原文,唯一验收依据)**(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)
- must[0] 预算在 loop 内强制，非 prompt 建议
- must[1] 超限=typed `budget-exceeded` 事件 + 当前候选状态完整落盘（可 `--resume` 续），绝不静默截断
- must[2] 默认值保守且可 profile 覆盖
- must[3] `0/undefined`=不限（显式）
- must[4] 成本预算基于 token-meter 计量（P9-05 落地后自动变准）
- acceptance[0] 夹具：maxTurns=3 的循环在第 3 turn 边界停且事件/落盘齐全，`--resume` 可继续
- acceptance[1] 花费上限夹具同理
- acceptance[2] 不设预算时行为与现状 bit-for-bit 一致（回归）
- validation[0] 预算夹具 + 恢复续跑 + 无预算回归对照
- nonGoals:不做多 agent 全局调度预算（P4-10） / 不做计费系统（P3-10 资源配额域）
- files:[P] `packages/core/agent-loop/src/agent.ts` · [P] `packages/core/agent-loop/src/constants.ts` · [P] `packages/bundle/headless/src/startup.ts` · [N] `packages/core/agent-loop/tests/budget.spec.ts`
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 16 个具名用例 / 变异证明 1/1
    - P9-07 Contract — hard loop budget must[3]: an ABSENT maxTurns is unlimited, so a long run is never stopped by a field nobody set
    - P9-07 Contract — hard loop budget must[3]: a ZERO maxTurns is unlimited too, NOT a run that may take no turns
    - P9-07 Contract — hard loop budget must[3]: a ZERO maxSpendUsd is unlimited, on the same rule
    - P9-07 Contract — hard loop budget must[0]: the turn BEFORE the limit is admitted
    - …共 16 条(分布在 1 个冻结条目),见 command-freeze.json
- P:1 条有效冻结 / 4 个具名用例 / 变异证明 1/1
    - P9-07 Provider — the loop enforces its own budget must[0]: maxTurns=1 stops the loop after one turn, and the second prompt is never run
    - P9-07 Provider — the loop enforces its own budget must[1]: the refusal is APPENDED before stopping, so a resume can read why
    - P9-07 Provider — the loop enforces its own budget must[3]: a budget of 0 is unlimited, so a second turn still runs
    - P9-07 Provider — the loop enforces its own budget acceptance[2]: an unbudgeted run logs no budget event at all, so existing sessions are unc
- U:1 条有效冻结 / 7 个具名用例 / 变异证明 1/1
    - P9-07 Usage — the configured-agent row carries a budget must[2]: a budget written on a cordis.yml agent row survives config validation
    - P9-07 Usage — the configured-agent row carries a budget must[3]: an explicit zero survives too, so "unlimited" can be stated in a profile
    - P9-07 Usage — the configured-agent row carries a budget a row with no budget stays absent rather than acquiring a default that would bound e
    - P9-07 Usage — the configured-agent row carries a budget a negative maxTurns is refused at load, not carried into a loop that can never admit
    - …共 7 条(分布在 1 个冻结条目),见 command-freeze.json
- F:1 条有效冻结 / 4 个具名用例 / 变异证明 1/1
    - P9-07 Fault — a budget stop is durable, resumable, and per-run acceptance[0]: a session stopped by its budget persists whole, and the reason
    - P9-07 Fault — a budget stop is durable, resumable, and per-run acceptance[0]: resuming with a raised budget continues the run rather than st
    - P9-07 Fault — a budget stop is durable, resumable, and per-run the turn allowance is PER RUN, so a resume at the same limit gets a fresh one
    - P9-07 Fault — a budget stop is durable, resumable, and per-run BLOCKED-114: maxSpendUsd cannot bind today, and this pins that rather than im
**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**只读参考(reference)**:
- openai/openai-agents-js — 0.17.0; naming reference only
- anthropics/claude-agent-sdk-typescript — 0.3.246; naming reference only
**标准(绑定词汇)**:maxTurns / MaxTurnsExceeded naming (openai-agents-js, claude-agent-sdk)  · LangGraph recursion_limit
**自己写(residual)**:Loop-internal enforcement, typed budget-exceeded event + durable candidate state, headless flags, cost via token-meter.
**禁令/风险(risk)**:packages/core is a hot zone (303 commits/month) — small increment, re-diff first; upstream HEAD has no maxTurns/maxSteps/budget.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-quota-meter 16★ 覆盖≈30% [topic-sweep] — bundle·进程内·无 key \| 缺口：No maxTurns/maxSteps budget at all. No typed `budget-exceeded` event in the session log (rejection is only a hook return + console.log + UI overlay), so it violates 'model-visible <=> logged
- dsh-gov 1★ 覆盖≈20% — Per-agent token quotas via host tokenMeter; over-limit injects a warning (fail-safe) — opposite of an in-loop hard stop (≤20%)
- loopx 5,424★ 覆盖≈20% — Python CLI sidecar keeps quota/gate state above dsh via skills (≤20%)
- dsh-cost-meter 245★ 覆盖≈15% — Budget % + alerts, dashboard only (≤15%)

#### P9-08 · 任务成功率基准 v1：给"厉害"一个可回归的数字

`Task success-rate benchmark v1 (20–50 auto-judged tasks)` · L6_QUALIFICATION · **QUALIFICATION_REUSE + PROVIDER_WRITE** · 可省 70-80% · 状态 **P9 C:PREMATURE,P:PREMATURE,U:PREMATURE,F:PREMATURE**

**SDD · 规格(registry 原文,唯一验收依据)**(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)
- must[0] 判分确定性（测试通过/文件断言/exit code），禁 LLM-as-judge 做主判
- must[1] 报告含 per-task 原始输出+判分依据+成本（token-meter）
- must[2] 同一 SHA 双跑成功率方差 ≤ 冻结阈值
- must[3] 无 key 时全套件显式 `BLOCKED` 不伪造
- must[4] 预算上限走决策 A5
- must[5] 沿用 coding-task e2e 的反作弊要点（判分器对执行者不可见、防直接改判分文件）
- acceptance[0] 固定 SHA + 固定路由/模型上产出 ≥20 任务基线报告，双跑方差达标
- acceptance[1] 判分器负例（伪造输出/改判分文件）必须判 FAIL
- acceptance[2] nightly 在 fork 真实跑通一次（成功或显式 BLOCKED-无 key，均为合法结果）
- validation[0] 双跑对比 + 判分负例 + 成本与 token-meter 核对
- nonGoals:不追公开榜单可比口径 / 不在本项内做提升（P9-09） / 不测安全/混沌（P7-10 已有）
- predecessors:P0-08 P7-09 P9-06
- files:[P] `BENCHMARK.md` · [B] `apps/cli/tests/profiles/headless/tests/coding-task.e2e.ts` · [N] `benchmarks/tasks/` · [N] `benchmarks/judge/` · [N] `scripts/benchmark/run.mjs` · [N] `scripts/benchmark/report.mjs` · [N] `.github/workflows/benchmark-nightly.yml`
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:1 条有效冻结 / 11 个具名用例 / 变异证明 1/1
    - P9-08 Contract — task scoring is mechanical must[0]: a task passes only when every declared check was satisfied
    - P9-08 Contract — task scoring is mechanical must[0]: one unsatisfied check fails the task, and the verdict names which
    - P9-08 Contract — task scoring is mechanical a check with NO observation is unobserved, not passed
    - P9-08 Contract — task scoring is mechanical acceptance[1]: an observation for a check the task never declared adds no credit
    - …共 11 条(分布在 1 个冻结条目),见 command-freeze.json
- P:未冻结
- U:未冻结
- F:未冻结
**用(adapt)**:
- **laude-institute/harbor**(Apache-2.0 · 4,874★) — Installed-agent pattern (agents/installed/{codex,claude_code,...}.py) + 40+ benchmark adapters; containerised deterministic judging; Python+Docker sidecar
- **laude-institute/terminal-bench**(Apache-2.0 · 2,559★) — Via harbor adapter
- **SWE-bench/SWE-bench**(MIT · 5,765★) — SWE-bench_Verified subset via harbor; Docker
**可选(optional,不进依赖不进 CI)**:
- multi-swe-bench/multi-swe-bench — TS-language tasks
- Aider-AI/polyglot-benchmark — No license — consume only via harbor's adapter
- promptfoo/promptfoo — exec: provider for the 5–10 self-built tasks; 30 MB
**不用(reject,理由)**:
- SWE-agent/mini-swe-agent — An agent, not a harness
**自己写(residual)**:dsh.py installed agent (~100 lines Python), anti-cheat self-built tasks (judge invisible/immutable), run.mjs/report.mjs aggregating success/cost/variance (Wilson), nightly workflow with explicit BLOCKED when keyless.
**禁令/风险(risk)**:Python + Docker sidecar (macOS+Linux OK); keyless CI → BLOCKED by design.
**planError**:计划引用的 examples/headless-agent/tests/coding-task.e2e.ts 路径已失效——文件实际在 apps/cli/tests/profiles/headless/tests/coding-task.e2e.ts（本会话核实）；registry 的 files[] 要改路径而不是当作缺失重建。
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-eval-harness 14★ 覆盖≈30% — Closest shape (YAML cases, trials, baseline gate) but unlicensed, LLM-judge, no real-repo tasks — reference only
- oh-my-knowledge 18★ 覆盖≈30% [topic-sweep] — cordis-plugin·进程内·需 key/服务 \| 缺口：No task fixtures for real repo fixes / terminal tasks, no test-run-in-sandbox grader, no anti-cheat 'grader invisible to executor / grader files protected' design, no SWE-bench/terminal-benc
- dsh-experience-library — '100% vs 60% success' claim — unverifiable
**裁决叠加(整改令)**:
- §7.1:harbor + terminal-bench + SWE-bench 作 Python sidecar nightly;PREMATURE(parallelWithR10=false),R10 后
- §7.10:planError(registry-extension.json:385 路径已失效,实际在 apps/cli/tests/profiles/headless/tests/coding-task.e2e.ts)——**现在就改路径**(files[] 路径修正,provenance 记 pathCorrected),不等 R10;不当作缺失重建

#### P9-09 · 系统提示词准则 v1 + 评测驱动迭代（Champion–Challenger）

`System-prompt guidelines v1 + champion–challenger A/B` · L1_CONTRACT · **CONTRACT_WRITE + QUALIFICATION_REUSE** · 可省 30-40% · 状态 **P9 C:PREMATURE,P:PREMATURE,U:PREMATURE,F:PREMATURE**

**SDD · 规格(registry 原文,唯一验收依据)**(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)
- must[0] 准则 v1 是受版本控制的完整声明，进默认 bundle
- must[1] 每个 challenger 是完整 prompt/工具描述变体声明，禁运行时手改
- must[2] A/B 显著性达标才可晋级
- must[3] 晋级/否决与证据入 Evidence Package（P0-07 门）
- must[4] 准则改动必须过 P9-08 基准回归门（分数不得显著降）
- acceptance[0] 准则 v1 落进默认 bundle 且 headless 冒烟不回归
- acceptance[1] 完成至少一轮真实 champion–challenger：变体/双方分数/显著性/决定记录齐全
- acceptance[2] 注入已知更差变体，门必须拒绝晋级
- validation[0] `ab-gate.spec.ts` 以 vitest 覆盖晋级门负例（更差变体拒晋、显著性不足拒晋、报告篡改检出），使本项具备标准 RED→GREEN 落点
- nonGoals:不做在线自动 prompt 演化（每次晋级人批） / 不动模型参数策略（P5-02/04） / 不做 per-vendor prompt 编译管道（P5-03 已有，本项产出作为其输入内容）
- predecessors:P9-08 P5-03 P7-10
- files:[P] `packages/preset/persona` · [P] `packages/bundle/base/cordis.patch.yml` · [B] `packages/core/system-prompt` · [B] `packages/core/agent-tool-presentation` · [N] `benchmarks/ab/` · [N] `scripts/benchmark/ab-compare.mjs` · [N] `benchmarks/ab/tests/ab-gate.spec.ts` · [N] `docs/engineering/prompt-iteration.md`
**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**
- C:未冻结
- P:未冻结
- U:未冻结
- F:未冻结
  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)
**用(adapt)**:
- **promptfoo/promptfoo**(npm `promptfoo` · MIT · 24,755★) — 0.122.2; prompt-variant × test-case matrix + CI, but no Wilson/significance in src
**可选(optional,不进依赖不进 CI)**:
- simple-statistics — 7.11.0 for the Wilson lower-bound gate (~50 lines otherwise)
**不用(reject,理由)**:
- stanfordnlp/dspy — Optimiser = explicit non-goal; offline challenger generation only
- gepa-ai/gepa — Optimiser = non-goal; offline only
- ax-llm/ax — 24.0.17; optimiser = non-goal; offline only
- langfuse/langfuse — Prompt registry = hosted path; variants live in git per MUST
**只读参考(reference)**:
- openai/codex prompt.md — Licensed content reference for guidelines v1
- sst/opencode prompts — Licensed content reference
- cline/cline — Licensed content reference
**自己写(residual)**:Guidelines v1 text in packages/preset/persona (currently persona: ''), variant declaration format, ab-compare.mjs significance + promotion record into the Evidence Package, ab-gate.spec.ts negatives; 0% of content deleted.
**禁令/风险(risk)**:promptfoo's runner overlaps P9-08's runner — if P9-08 does not use promptfoo, write ab-compare over P9-08 reports instead.
**planError**:promptfoo has no significance testing — the Wilson gate is dsh code.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- oh-my-knowledge 18★ 覆盖≈44% [topic-sweep] — cordis-plugin·进程内·需 key/服务 \| 缺口：Guideline v1 content itself (half the epic) is authoring work, not tooling. Significance rule is bootstrap CI, not the epic's Wilson-lower-bound rule (adaptable, but a residual). systemPromp
- Aegis 1,164★ 覆盖≈30% — Python-hosted skill pack overlapping ~30% of guideline topics; ships as skills not a persona, no A/B
- dsh-better-input 覆盖≈0% — User-prompt polish
- dsh-evolution-lab 1★ — Arena/canary/rollback for skills — concept match, not adoptable
**裁决叠加(整改令)**:
- PREMATURE(parallelWithR10=false),R10 后
- §7.10:planError(promptfoo 无显著性检验,Wilson 门是 dsh 代码)——写进 preFlight;与 R10 Q3 的 Wilson 下界门同一实现

---

<details><summary>生成器源码(从仓库根目录运行,输出重定向到本文件)</summary>

```python
#!/usr/bin/env python3
"""Render spec/first100/exec/make-vs-use-plan.md from make-vs-use-ledger.json + ledger.json + p9-verification.json.
Derived document: never hand-edit the output; edit the ledger JSON or the overlay map below and re-run.
Run from the repo root:  python3 render-mvu-plan.py > spec/first100/exec/make-vs-use-plan.md
"""
import json, re, hashlib, datetime, sys, collections

LEDGER = 'spec/first100/exec/make-vs-use-ledger.json'
STATUS = 'spec/first100/exec/ledger.json'
P9 = 'spec/first100/exec/p9-verification.json'
RECT = 'spec/first100/exec/plan-rectification-2026-09-06.md'

raw = open(LEDGER, encoding='utf-8').read()
ledger_sha = hashlib.sha256(raw.encode()).hexdigest()[:16]
L = json.loads(raw)
rows = L['rows']
status_rows = json.load(open(STATUS))['rows']
p9 = json.load(open(P9))
p9_status = collections.defaultdict(list)
for c in p9['cells']:
    p9_status[c['epic']].append(f"{c['stage']}:{c['status']}")
CH = L['source']['artifactSections']['CHAPTERS']
import subprocess as _sp
_reg = json.loads(_sp.check_output(['git','show','fork/first100-exec:tests/first100/registry.json']))['epics']
_ext = json.loads(_sp.check_output(['git','show','fork/first100-exec:tests/first100/registry-extension.json']))['epics']
REG = {e['id']: e for e in _reg + _ext}
# program epics absent from the ledger get a stub card (P3-13 admitted 2026-09-02, same day the ledger was generated)
for _id, _e in REG.items():
    if not any(r['id'] == _id for r in rows):
        rows.append({'id': _id, 'chapter': _id.split('-')[0], 'layer': _e.get('primaryLayer', ''), 'titleEn': '(not in ledger)', 'titleZh': _e['title'],
                     'verdict': '未判定', 'verdictSecondary': None, 'standards': [], 'oss': [], 'community': [], 'deletedPct': None,
                     'deletedPctRange': None, 'upstreamPartial': False, 'residual': '账本 2026-09-02 生成时本 epic 同日才收录;开工时按 §4.1 补一次单条 make-vs-use 判断并写进本卡(delegate 维护 overlay)。',
                     'risk': '—', 'planError': None, '_stub': True})
rows.sort(key=lambda r: (r['chapter'], r['id']))
FZ = json.loads(_sp.check_output(['git','show','fork/first100-exec:spec/first100/exec/command-freeze.json']))['entries']
FZ_BY = collections.defaultdict(list)
for t in FZ: FZ_BY[(t['epic'], t['stage'])].append(t)
LED_FULL = json.load(open(STATUS))['rows']
def cell_status(eid, stage):
    r = LED_FULL.get(eid)
    if not r: return None
    c = (r.get('cells') or {}).get(stage)
    if isinstance(c, dict): return c.get('status') or c.get('state')
    return c
VD = L['source']['artifactSections']['VERDICTS']

# ---- overlay: rulings from plan-rectification-2026-09-06.md, keyed by epic ----
OV = collections.defaultdict(list)
def add(ids, text):
    for i in ids.split(): OV[i].append(text)
add('P4-06', '§2.A 子句措辞改(标题/must[0]/acc[0] → at-least-once + 幂等消费,BEGIN IMMEDIATE 事务)')
add('P3-09 P3-11 P1-06 P2-07', '§2.B 子句不动、加实现约束(见该 epic 小节)')
add('P5-07 P5-08 P5-03 P4-14 P7-07 P2-10', '§2.C 缩范围:files[] 删与上游/已有实现重复的 [N] 文件,residual 收窄')
add('P3-01 P3-05 P3-07 P5-05 P5-06', '§2.D 热区改接法:[B] 热区文件换 [N] 新 rung / contribution')
add('P3-12', '§2.E 代码级 must-fix:四处 `limitInputPixels:false` 显式设上限;§7.8 pointer:参数深度上限(拒绝而非溢出)是本 epic 主体')
add('P8-02 P8-08 P8-09 P5-10 P4-05', '§2.F planError 已解决,记录即可')
add('P2-03', '§2.F 已解决(durable append 先于 pre-execute);§7.4/§7.5/§7.6/§7.8 R2:保留迭代 canonicalizer、删 NFC、canonicalize@2.1.0 作 devDep 差分 oracle、validation[2] 重述、C+F supersede 重观测')
add('P1-05 P5-04 P6-01 P6-08 P8-06 P2-05', '§2.G 开工前设计决定已定(见该 epic 行)')
add('P2-05 P2-08 P2-10 P8-06 P8-09', '§3.1 共用引擎 Cedar(@cedar-policy/cedar-wasm 4.12.0)在 P2-05 开工前作为 infra slice 接入;本 epic 只写 adapter/PEP/explain')
add('P3-04 P3-05 P3-06 P3-07 P3-13', '§3.2 共用引擎 sandbox-runtime(@anthropic-ai/sandbox-runtime,exact pin)在 W7 前作为 sandbox-srt rung 接入;该 slice 同时把 sandbox-local 的 PLATFORM_CHAINS 表改成 contribution point')
add('P7-07 P6-05', '§3.3 OTel:在既有 packages/session/session-telemetry-otel 上加 TracerProvider pipeline;不建 otel-exporter 包;gen_ai.* 用 @opentelemetry/semantic-conventions')
add('P2-02', '§3 账本判定已被事实超越:Biscuit 的 attenuation 在 Fiber Option A 之后由 kernel 签名的 capability token 自写(锁在 Fiber);Biscuit 降为 optional')
add('P0-01 P0-07 P1-02', '§7.2 R1:in-toto Statement v1 + DSSE 信封由 §3.4 attestation-envelope slice(P4-04 开工前)统一;P0-07 attest.ts 改发 Statement+DSSE;不重开格子')
add('P1-11 P1-12 P2-03 P3-07 P3-09 P4-04 P4-09 P6-08 P6-09 P7-01 P7-02 P7-04 P7-05 P7-10 P8-10',
    '§3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份')
add('P4-03 P4-04 P7-01 P7-05 P8-09', '执行卡 §1(JCS 所有者 P2-03):argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份')
add('P1-03', '§7.2 R4:P1-01 `dshVersionRange` 只查是字符串(validate.ts:393)→ 本 epic 加 semver.validRange + 拒绝用例;R5:P1-02 的 SBOM(CycloneDX)与 lockfile 同源,在本 epic 建')
add('P1-12', '§7.2 R5:P1-02 未建的 SLSA provenance / 信任等级在本 epic 接(slsa-framework)')
add('P8-06', '§7.11(修订 R3):SPIFFE ID 形状所有者是 P3-09(W8),本 epic import;本 epic 拥有 P0-02/P2-01 内部 id → SPIFFE 的单向映射(ServiceAccount)+ 冻结用例')
add('P8-05', '§7.11(修订 R3):CloudEvents 形状所有者是 P4-06(W5,新文件直接采用标准名);本 epic 拥有 P4-01 内部字段(id/runId/seq/occurredAt)→ CloudEvents 的映射层')
add('P7-04', '§7.11(修订 R3):PROV-DM 形状所有者是 P6-09(W10),本 epic import;P5-11/P6-02 内部名的映射在首次对外处做')
add('P8-07', '§7.2 R3:Confluent 兼容词汇 BACKWARD/FORWARD/FULL 在 SDK 导出处对齐;§7.8:TS/Python parity 矩阵必须含 depth-5000 argumentsHash 用例(Python JCS 库也递归,默认 recursion limit 1000)')
add('P7-07', '§7.11(修订 R3):OTel 名字来自 @opentelemetry/semantic-conventions 常量包,无人定形状;§3.3 slice 提前到 W11 前(P5-03/P5-06 首发 gen_ai.usage.*);本 epic 做 P2-01 enduser.id 映射')
add('P0-03 P0-04', '§7.2 R6 + §7.9:账本 leverage2 建议退掉手写扫描器换 dependency-cruiser,**推翻**——两者均为 TS AST 实现、三通道覆盖动态 import/require/path alias、规则逻辑(dated allowlist/ADR 豁免/kernel-vendor 绑定)dependency-cruiser 不提供;无下游传播;不为行数重写在跑的门')
add('P1-08 P8-01', '§7.2 R7:整数 API level / 手排 fingerprint 记录不改;P8-07 若需 Python 复算 fingerprint 则换 JCS')
add('P0-08', '§7.1:harbor 未接,归 P9-08(其 adapt 亦为 harbor)')
add('P9-08', '§7.1:harbor + terminal-bench + SWE-bench 作 Python sidecar nightly;PREMATURE(parallelWithR10=false),R10 后')
add('P9-09', 'PREMATURE(parallelWithR10=false),R10 后')
add('P3-03 P4-10 P4-11 P5-09 P6-06 P6-10 P7-08 P8-03 P8-05 P8-10', '§6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目')
add('P0-02', '§7.10:planError(kernel 不依赖 Cordis 产品包应由 P0-04 层规则机械强制)**已解决**——check-layer-deps.mjs `KERNEL_PERMITTED_CORDIS_BINDINGS={Context}`(layering.md 规则 4)+ collectKernelVendorEdges')
add('P0-06', '§7.10:planError(registry 只是 TS 类型、无机器可读 schema)**未解决**;§7.1 的 toJSONSchema ✓ 是误归(命中在 typert/registry 与 plugin-manifest)。处置:不重开格子;P8-07(schema-generated SDK)开工前 schema-registry 必须能发 JSON Schema 2020-12,归 P8-07 preFlight 硬前置;P2-11 的 --dump 导出同源')
add('P0-08', '§7.10:planError(上游已有确定性 lane,勿重建)——runner.ts:105 接受外部 scenarios,框架未重建 lane;上游 13 个 golden scenarios 是否接入由 P7-09 接线时核')
add('P2-01', '§7.10:planError(files 已存在,缩到接线缺口)——已按缺口验收;residual 的 IdentityContext 接线归 P2-05 PEP 与 P5-05')
add('P5-11', '§7.10:planError(应提升 agent-team 的 DAG/mailbox 而非新建 collaboration/*)——核实 agent-team 2452 行无 claim/lease/mailbox/DAG 原语(0 提及),前提不成立;taskboard 自带 dependsOn。**不是重复**')
add('P9-05', '§7.10:planError(V4 tokenizer 与公开 V3 资产的一致性待验)——must[0] 官方精确计数尚未做(现仍 fixed-density heuristic,U/F SCHEDULED_BLOCKED);U 开工时先验 V4 词表 parity,写 preFlight;不一致则 must[0] 只对 V3 成立并记 known-limitation')
add('P9-08', '§7.10:planError(registry-extension.json:385 路径已失效,实际在 apps/cli/tests/profiles/headless/tests/coding-task.e2e.ts)——**现在就改路径**(files[] 路径修正,provenance 记 pathCorrected),不等 R10;不当作缺失重建')
add('P9-09', '§7.10:planError(promptfoo 无显著性检验,Wilson 门是 dsh 代码)——写进 preFlight;与 R10 Q3 的 Wilson 下界门同一实现')
add('P6-01', '§9.2 生态迁移目标:136 个 memory 插件手搓 store,注入挂 agent/pre-step 或 ctx.systemPrompt 段——两种形态必须 wire-compatible;dsh-memento 的 ctx.memory provider 形态直接可挂;borrow 其 conformance suite + JSON schema + golden;冻结"现有形态插件不改代码可作 provider"用例')
add('P8-06', '§9.2 生态迁移目标:≥7 套登录门各自 wrap http server——AuthProvider seam 在 http server 之前;负用例:provider 拿不到 core session secret(@xgone/dsh-remote 的 seam 违规)')
add('P2-05', '§9.2 生态迁移目标:5 个权限插件挂 tools/pre-execute + approval answerer 链——PEP 坐该位置;现有 YAML 规则可作 policy source 导入;负用例:first-match 非单调(dsh-permission-rules)必须转换为 forbid > permit')
add('P3-11 P1-10', '§9.2 生态迁移目标:≥5 个快照/回滚实现互相竞争——区分工作区检查点与执行世界快照,P3-11 只做后者')
add('P7-07', '§9.2 生态迁移目标:4 个各接 OTel 或自签 HMAC 链——session-telemetry-otel 唯一 backend,插件只加 processor/exporter')
add('P1-02 P1-04 P1-06', '§9.2 生态迁移目标:~70 个 market 类插件走裸 pnpm add——安装必须经 harness 的 lockfile/--ignore-scripts/隔离;负用例:自动批 build scripts(dsh-plugin-mall)、扫描器搞崩 boot')
add('P2-04', '§9:第一条按 §9 走的 epic——preFlight 含全部 community 缺口逐项对子句;§9.1 的 verify-make-vs-use 门在其 preFlight 前建好')
add('P4-06', '§7.11:CloudEvents 属性名形状所有者——新 [N] 文件直接采用标准名(id/source/type/time/subject/datacontenttype),不自造')
add('P3-09', '§7.11:SPIFFE ID 格式形状所有者(P0-02/P2-01 未采用,顺延);P8-06 import')
add('P6-09', '§7.11:W3C PROV-DM 与 OCI image-spec Descriptor 两个形状的所有者;P7-04 import PROV')
add('P2-04', '§7.11:MCP ToolAnnotations 形状所有者(P2-03 未采用,顺延)')
add('P2-05', '§7.11:AuthZEN 形状所有者(P2-03 字段由 registry must[0] 定,不采用 AuthZEN 名;顺延至此作 decide() 输入形状)')
add('P2-03', '§7.11:MCP ToolAnnotations / AuthZEN 不采用——registry must[0] 定死字段名,这不是词汇债;所有权顺延 P2-04 / P2-05')
add('P2-02', '§10 L2:四格全绿上锁——解锁 = §3.5 SLICE-fiber-A(vendored Cordis Fiber.store,Option A)+ §10.3-3 内核 signatureRoots 每安装 Ed25519 密钥对 → must[1] supersession 用例;同时解锁 P2-05 内核执行点')
add('P1-03', '§10.3-1 裁决 BLOCKED-094:profile 字段 plugins.lock required|warn(显式 resolve);production-controlled=required;有 lock 而 digest 漂移一律拒绝;lock 生成所有者 = 本 epic U 阶段(dsh plugin lock)→ composeProfile 调用点 → 验收')
add('P4-06', '§10 L3 + §10.3-2:(b) BEGIN IMMEDIATE 事务;(a) 去重信号 = 认领 turn 的既有 turn/end 事件(reason 非 interrupted → consumed;interrupted/缺失 → 可恢复),不新增事件类型')
add('P4-05', '§10 L3:供给方 P4-07 已验收 → 按 BLOCKED-092 第二步写 acceptance[2] 的 supersession 用例(重启后孤儿 agent 经 lease store 回收/安全失败)→ 验收;排在 P4-06 之后(共 dispatch.ts/inbox.ts)')
add('P5-10', '§10.3-4:actions 半供给方钉为 P2-03(in-flight = 已 append manifest 无配对终态记录);P2-03 验收后写该用例;world 半等 P3-01')
add('P2-05', '§10:开工前置 = §3.1 Cedar slice + §3.5 SLICE-fiber-A(内核执行点);不等 P2-02 验收(predecessors 非机械门),但共用 Fiber A')
add('P3-13', '§6:不在账本内(09-02 同日收录);开工时补单条 make-vs-use 判断,预期 CONSUMER_WRITE,依赖 §3.2 rung')

# ledger oss notes overridden by a ruling: (epic, oss name) -> what stands now
SUP = {
 ('P2-03','erdtman/canonicalize'): '§7.8:不换库、不删 canonicalize.ts;保留迭代实现(库全递归,depth 5000 溢出)、删 NFC;canonicalize@2.1.0 进 devDependencies 作差分 oracle',
 ('P2-06','erdtman/canonicalize'): '§1/§7.8:import P2-03 的 canonicalizeArguments,不接库',
 ('P4-03','erdtman/canonicalize'): '§1/§7.8:import P2-03 的 canonicalizeArguments,不接库',
 ('P4-04','erdtman/canonicalize'): '§1/§7.8:import P2-03 的 canonicalizeArguments,不接库',
 ('P7-01','erdtman/canonicalize'): '§1/§7.8:import P2-03 的 canonicalizeArguments;attest.ts 的 canonicalJson 随 R1 收敛',
 ('P8-01','erdtman/canonicalize'): '§7.2 R7:已验收,手排 fingerprint 记录不改;P8-07 若需 Python 复算再换',
 ('P2-02','eclipse-biscuit/biscuit'): '§3:Biscuit 降为 optional;attenuation 在 Fiber Option A 后由 kernel 签名 capability token 自写',
 ('P2-02','eclipse-biscuit/biscuit-rust'): '§3:同上',
 ('P2-02','eclipse-biscuit/biscuit-wasm'): '§3:同上',
 ('P0-03','sverweij/dependency-cruiser'): '§7.9:已验收,不采用;判据见 §7.9',
 ('P0-04','sverweij/dependency-cruiser'): '§7.9:已验收,不采用;判据见 §7.9',
 ('P0-07','sigstore/sigstore-js'): 'R1:签名由 §3.4 envelope slice 用 kernel Ed25519 做 DSSE;Sigstore 只在 P1-02 验证器',
}

# accepted-row audit verdicts (§7.1)
AUD = {
 'P0-01':'整改-传播(R1):in-toto Statement 0 · ResourceDescriptor 0',
 'P0-02':'OK;SPIFFE 词汇债 → P8-06',
 'P0-03':'沉没成本,不重写(R6/§7.9)',
 'P0-04':'沉没成本,不重写(R6/§7.9)',
 'P0-05':'OK',
 'P0-06':'planError 未解决(§7.10):registry 无机器可读 schema(§7.1 的 toJSONSchema ✓ 是误归);zod/ajv ✓;Confluent 词汇债 → P8-07',
 'P0-07':'整改-传播(R1):自造信封,in-toto/DSSE/SLSA/@sigstore/sign 全 0',
 'P0-08':'OK(fast-check ✓);harbor → P9-08',
 'P1-01':'代码缺陷(R4 → P1-03):dshVersionRange 未校验',
 'P1-02':'半做:sigstore ✓;tuf-js/CycloneDX/SLSA 0 → P1-03/P1-12(R5)',
 'P1-07':'OK',
 'P1-08':'设计偏离记录(R7):整数 API level 而非 semver',
 'P1-09':'OK;保留 scope 词汇债(轻)',
 'P2-01':'词汇债(R3):SPIFFE/RFC 8693/enduser.id 全 0 → P8-06 / P7-07',
 'P4-01':'词汇债(R3):CloudEvents/A2A 0 → P8-05',
 'P4-07':'OK(注入时钟等价 fake-timers)',
 'P4-08':'OK',
 'P5-11':'OK(非重复:agent-team 无 claim/lease);PROV 词汇债 → P7-04',
 'P6-02':'词汇债(R3):PROV/DPV 0,bitemporal 半 → P6-03',
 'P6-07':'OK',
 'P8-01':'设计偏离记录(R7):手排 fingerprint,不外发',
}

# standards families (finer than rectification §7.3, which is now historical; this table is the only ownership table)
FAM = [
 ('in-toto / DSSE / SLSA', r'in-toto|DSSE|SLSA'), ('RFC 8785 JCS', r'8785|JCS'), ('CloudEvents', r'CloudEvents'),
 ('SPIFFE ID format', r'SPIFFE(-style| ID)'), ('SPIFFE SVID lifetime rules', r'SPIFFE SVID'), ('W3C PROV-DM', r'PROV'),
 ('OTel GenAI semconv gen_ai.*', r'gen_ai|GenAI'), ('OTel resource/error/process semconv', r'OTel semconv (enduser|error|process)'),
 ('A2A TaskState', r'A2A TaskState'), ('A2A Message/Part/Artifact', r'A2A (Message|Artifact)'),
 ('MCP ToolAnnotations', r'MCP ToolAnnotations'), ('MCP TaskStatus names', r'MCP TaskStatus'), ('MCP initialize/capabilities', r'MCP initialize'),
 ('MCP elicitation/create', r'MCP elicitation'), ('AuthZEN (+MCP profile)', r'AuthZEN'),
 ('ACP request_permission payload', r'ACP (RequestPermissionRequest|session/request_permission|allow_always)'), ('ACP session/* lifecycle', r'ACP (1\.4\.0 session|session/cancel|session/update)'),
 ('OCI runtime-spec', r'OCI (runtime-spec|linux\.resources)'), ('OCI image-spec Descriptor', r'OCI image-spec'), ('OCI-style sha256:<hex> refs', r'OCI-style'),
 ('JSON Schema 2020-12', r'JSON Schema'), ('RFC 6902 JSON Patch', r'6902|JSON Patch'), ('semver', r'semver'), ('W3C DPV', r'DPV'),
 ('Sigstore bundle', r'Sigstore'), ('Idempotency-Key', r'Idempotency|idempotency-key'), ('K8s resource model', r'Kubernetes|K8s|resourceVersion'), ('OpenFeature', r'OpenFeature'),
]
order = {r['id']: i for i, r in enumerate(rows)}
ACCEPTED_IDS = {k for k, v in status_rows.items() if v.get('status') == 'ACCEPTED'}
NOT_ADOPTED = {  # rows that did (or by design will) not adopt the standard they list (§7.1 / §7.11); ownership passes on
 ('in-toto / DSSE / SLSA','P0-01'), ('in-toto / DSSE / SLSA','P0-07'), ('in-toto / DSSE / SLSA','P1-02'),   # P1-02 adopted Sigstore bundle only
 ('RFC 8785 JCS','P8-01'),                                   # hand-sorted fingerprint of its own surface (R7)
 ('OTel resource/error/process semconv','P2-01'), ('A2A TaskState','P4-01'), ('MCP TaskStatus names','P4-01'), ('CloudEvents','P4-01'),
 ('SPIFFE ID format','P0-02'), ('SPIFFE ID format','P2-01'), ('W3C PROV-DM','P5-11'), ('W3C PROV-DM','P6-02'),
 ('semver','P1-01'), ('W3C DPV','P6-02'),
 ('MCP ToolAnnotations','P2-03'), ('AuthZEN (+MCP profile)','P2-03'),   # by design: registry must[0] fixes P2-03's field names (§7.11)
}
OWNER_OVERRIDE = {  # a ruling names the owner instead of the earliest pending consumer
 'in-toto / DSSE / SLSA': ('SLICE-3.4', 'R1:envelope slice 在 P4-04(W9)前落地'),
 'semver': ('P1-03', 'R4:validRange 在 P1-03 加'),
 'OTel GenAI semconv gen_ai.*': ('SLICE-3.3', '§3.3:名字来自 @opentelemetry/semantic-conventions 常量包,slice 接 pipeline;时点改为 W11 前(P5-03/P5-06 首发 gen_ai.usage.*)'),
 'OTel resource/error/process semconv': ('npm @opentelemetry/semantic-conventions', '常量包按需 import,无人定形状'),
}
def owner_of(name, ids):
    """owner = ruling override; else earliest accepted row that actually adopted; else earliest not-yet-accepted row that will adopt."""
    if name in OWNER_OVERRIDE: return OWNER_OVERRIDE[name][0], 'override'
    for i in ids:
        if i in ACCEPTED_IDS and (name, i) not in NOT_ADOPTED: return i, 'accepted'
    for i in ids:
        if i not in ACCEPTED_IDS and (name, i) not in NOT_ADOPTED: return i, 'pending'
    return ids[0], 'all-accepted-none-adopted'
first = {}
for name, pat in FAM:
    ids = sorted([r['id'] for r in rows if any(re.search(pat, s) for s in r['standards'])], key=lambda i: order[i])
    if ids: first[name] = owner_of(name, ids)[0]
ADOPTED = {  # accepted first adopters: did they actually adopt (from §7.1)
 ('in-toto / DSSE / SLSA','P0-01'):'✗ 未采用 → R1 slice 定形状', ('RFC 8785 JCS','P2-03'):'在途,R2 后由差分 oracle 担保',
 ('OTel semconv','P2-01'):'✗ 未采用 → P7-07 拥有', ('JSON Schema 2020-12','P0-06'):'△ zod 在,schema-registry 无 JSON Schema 输出 → P8-07 硬前置', ('MCP','P2-03'):'在途',
 ('A2A','P4-01'):'✗ 未采用 → P4-05/P5-05 首次对外时定', ('CloudEvents','P4-01'):'✗ 未采用 → P8-05 拥有映射',
 ('SPIFFE','P0-02'):'✗ 未采用 → P8-06 拥有', ('W3C PROV-DM','P5-11'):'✗ 未采用 → P7-04/P6-03 拥有',
 ('semver','P1-01'):'✗ 未采用(R4 → P1-03)', ('W3C DPV','P6-02'):'✗ 未采用 → P6-10', ('Sigstore bundle','P1-02'):'✓', ('OpenFeature','P0-05'):'△ optional,1 提及',
}

def status_of(eid):
    if eid.startswith('P9-'):
        s = p9_status.get(eid); return 'P9 ' + (','.join(s) if s else 'UNFROZEN')
    r = status_rows.get(eid)
    if not r: return 'NOT IN LEDGER'
    return f"{r['status']} (W{r.get('wave','?')})"

def esc(s): return str(s or '').replace('|', '\\|').replace('\n', ' ')

out = []
w = out.append
w('# First-100 造用执行表(派生文档)')
w('')
import subprocess
rect_sha = subprocess.check_output(['git','log','-1','--format=%h','--',RECT]).decode().strip()
w(f'**派生自** `spec/first100/exec/make-vs-use-ledger.json`(sha256 前 16 位 `{ledger_sha}`)+ `ledger.json` 状态 + `p9-verification.json` + 整改令裁决叠加(整改令最近提交 `{rect_sha}`);**生成时间** {datetime.datetime.now().astimezone().isoformat(timespec="minutes")};生成器源码在文末 `<details>`。**不要手改本文件**——改账本 JSON / 整改令 + 生成器 overlay,重新生成。')
w('')
w('## 0. 文档优先级(执行者与 delegate 共同遵守)——**流程入口是 `EPIC-LIFECYCLE.md`**,本节只讲文件角色')
w('')
w('1. `tests/first100/registry.json` —— **做什么**(must / acceptance / validation / files);唯一验收依据。')
w('2. `plan-rectification-2026-09-06.md` —— **裁决**:与账本冲突时以它为准(§2 逐条、§3 共用引擎、§7 审计与 R1–R7、§8 OSS 接入 SOP)。')
w('3. 本文件 —— **每条 epic 的造/用执行卡**(派生),开工第四问按它答,`preFlight.makeVsUse` 引用本文件的 epic 小节 + `rows[].id` + 所用 `oss[].name`。')
w('4. `make-vs-use-ledger.json` —— 数据源(artifact 2e874903 的完整镜像:ROWS + META + MARKET + VERDICTS + CHAPTERS)。')
w('')
w('**状态列是生成时快照**(见文首生成时间);实时状态以 `ledger.json` / `p9-verification.json` 为准。')
w('')
w('**维护规则**:卡片 = 账本行(自动)+「裁决叠加」(生成器里的 overlay 表,**由 delegate 手工维护**)。整改令每追加一条裁决,delegate 同步更新 overlay 并重新生成;生成器源码在文末,执行者也可重跑但不改 overlay。卡片上 **⟶ 裁决取代** 标记的是被裁决推翻的账本 note。')
w('')
w('**`preFlight.makeVsUse` 唯一字段规范**(§4.1 / §7 / §8 / §9 四处增量合并于此,以此为准;写在 `clause-subject-audit.json` → `preFlight[<epic 或 SLICE-id>].makeVsUse`;`verify-make-vs-use` 门按此校验,缺字段 = UNRECORDED):')
w('')
w('```jsonc')
w('{')
w('  "ledgerRow": "P2-05",                 // rows[].id;账本外的(P3-13 / SLICE-*)填 null 并在 residual 说明')
w('  "card": { "heading": "#### P2-05", "sheetCommit": "<make-vs-use-plan.md 当时的 git 短 sha>" },   // 卡片 = 本文件里以该 heading 开头的小节;不是行号')
w('  "verdict": "PROVIDER_ADAPT", "verdictSecondary": null,          // P2-05 真实值;有副判定的填账本原文')
w('  "adopted": [ { "name": "cedar-policy/cedar",            // 账本 oss[].name 原文')
w('                 "npm": "@cedar-policy/cedar-wasm", "version": "4.12.0",')
w('                 "form": "runtime" | "oracle" | "optional" | "vendored",')
w('                 "reason": "为什么是这个形态(oracle 必须指向复现硬约束的冻结用例)" } ],')
w('  "rejectedAbsent": [ "@openfeature/server-sdk", "…" ],   // preFlight 时 = 账本 reject 条目里**有 npm 名的**名单(无 npm 名的不可核,不列);')
w('                                                          // 门 (b) 对这些名在 files[] 里核 0 import;结果写进 realized.rejectedAbsent(布尔),不在这里')
w('  "standardsOwned": [],                                   // P2-05 不是任何标准的形状所有者(AuthZEN 的所有者是 P2-03,见 §1 表)')
w('  "standardsImported": [ { "standard": "AuthZEN request/response vocabulary", "from": "P2-03" } ],')
w('  "residual": "接完还要自己写什么(账本 residual,可收窄,收窄写原因)",')
w('  "probes": [ { "claim": "forbid overrides permit",        // 账本 note 里“verified locally”的那句')
w('                "how": "node -e … | 或 tests/…spec.ts 的用例标题",   // 可重跑')
w('                "result": "ok" | "hard-constraint" | "differs",')
w('                "evidence": "数字/输出摘要(硬约束必须有数字,如 depth 5000 THREW)" } ],')
w('  "gapCheck": [ { "community": "dsh-auto-mode", "gap": "缺口原句", "clause": "must[1]" | "outOfScope: P2-07" } ],   // §9.2;P2-04 起必填;之前三条 preFlight 回填')
w('  "expectedDeletedPct": "50" | "0-5" | null,')
w('  "recordedBeforeFirstLine": true,')
w('  "realized": null   // F 阶段填:{ "adoptedOnPath": [{ "name", "importedIn": ["packages/…/src/x.ts"] }], "rejectedAbsent": true, "note": "…" }')
w('}')
w('```')
w('')
w('**判定含义**(账本 VERDICTS 原文):' + ' · '.join(f'`{k}` {v}' for k, v in VD.items()))
w('')
w('**`oss[].role`**:`adapt` 接进依赖(按 note)· `optional` 不进依赖不进 CI · `reject` 不接(note 是理由)· `reference` 只读设计。**接法 `form`**(preFlight 字段,不是账本 role):`runtime` 默认 · `oracle`(§7.8:有记录的硬约束 → devDependencies 作差分 oracle)· `optional` · `vendored`。')
w('')
# summary counts
cnt = collections.Counter(r['verdict'] for r in rows)
w('**109 行判定分布**:' + ' · '.join(f'{k} {v}' for k, v in cnt.most_common()))
sec = sum(1 for r in rows if r['verdictSecondary']); std = sum(1 for r in rows if r['standards'])
adapt_n = sum(1 for r in rows for o in r['oss'] if o['role'] == 'adapt')
w(f'**副判定** {sec}/109 · **带标准** {std}/109 · **adapt 级 OSS 条目** {adapt_n} · **CATALOG_ADOPT** 0(对抗复核后最高 47%)')
w('')
w('## 1. 标准词汇所有权(首个采用者定形状,其余 import)')
w('')
w('| 标准(按子规范) | 形状所有者 | 依据 | 全部涉及者(registry 顺序;~~划掉~~ = 已验收但未采用,所有权已转移) |')
w('|---|---|---|---|')
for name, pat in FAM:
    ids = sorted([r['id'] for r in rows if any(re.search(pat, s) for s in r['standards'])], key=lambda i: order[i])
    if not ids: continue
    own, why = owner_of(name, ids)
    basis = {'override': OWNER_OVERRIDE.get(name, ('', ''))[1], 'accepted': '已验收且已采用', 'pending': ('最早将采用的未验收涉及者(先前者未采用,所有权顺延)' if any((name, i) in NOT_ADOPTED for i in ids if own in order and order[i] < order[own]) else '最早涉及者(未验收)'), 'all-accepted-none-adopted': '全部已验收且均未采用'}[why]
    shown = ' '.join((f'~~{i}~~' if (name, i) in NOT_ADOPTED else i) for i in ids)
    w(f'| {name} | **{own}** | {basis} | {shown} |')
w('')
w('**规则**:形状所有者 = 最早**已验收且真正采用**该标准的 epic;没有则为最早的未验收涉及者。已验收但未采用的(划掉)不再拥有,由 R3 指定的下游拥有(卡片"裁决叠加"里写明)。所有权按**子规范**算——MCP / ACP / OCI 各含多个互不相干的子规范,一个 epic 只拥有自己那条。')
w('')
w('## 2. 逐条执行卡')
w('')
cur = None
for r in rows:
    if r['chapter'] != cur:
        cur = r['chapter']
        n = sum(1 for x in rows if x['chapter'] == cur)
        w(f'### {cur} · {CH.get(cur, cur)}({n} 项)')
        w('')
    eid = r['id']
    rt = REG.get(eid, {}).get('title', '')
    if rt and re.sub(r'\s+','',rt) != re.sub(r'\s+','',r['titleZh']):
        w(f'#### {eid} · {rt}')
        w(f'(账本原题「{r["titleZh"]}」;registry 已重述,provenance `rewordedFrom`,见整改令 §2.A)')
    else:
        w(f'#### {eid} · {r["titleZh"]}')
    w('')
    v = r['verdict'] + (f' + {r["verdictSecondary"]}' if r['verdictSecondary'] else '')
    pct = (r['deletedPctRange'] + '%') if r['deletedPctRange'] else f'{r["deletedPct"]}%'
    w(f'`{r["titleEn"]}` · {r["layer"]} · **{v}** · 可省 {pct} · 状态 **{status_of(eid)}**' + (' · 上游已部分实现' if r.get('upstreamPartial') else ''))
    w('')
    e = REG.get(eid, {})
    if e and not r.get('_stub'):
        w('**SDD · 规格(registry 原文,唯一验收依据)**' + ('(registry-extension:P9 无 nonGoals/stages/fixtures/realTask/gate/rollback 字段,stage 见 p9-verification.json)' if eid.startswith('P9-') else ''))
        for ch, label in (('must', 'must'), ('acceptance', 'acceptance'), ('validation', 'validation')):
            v = e.get(ch, [])
            if isinstance(v, str):   # registry-extension (P9) stores validation as one string
                w(f'- {label}(单字符串,extension 形状) {esc(v)}'); continue
            for i, c in enumerate(v):
                w(f'- {label}[{i}] {esc(c)}')
        ng = [x for x in e.get('nonGoals', []) if x and x != 'YAML 来源缺失']
        if ng: w('- nonGoals:' + ' / '.join(esc(x) for x in ng))
        if e.get('predecessors'): w('- predecessors:' + ' '.join(e['predecessors']))
        fl = e.get('files') or []
        if fl: w('- files:' + ' · '.join(f'[{f.get("kind","?")}] `{f["path"]}`' for f in fl))
        st = e.get('stages') or {}
        if st:
            parts = []
            for sg in ('C', 'P', 'U', 'F'):
                v = st.get(sg)
                if v is None: continue
                if isinstance(v, dict): parts.append(f'{sg}:{v.get("count", len(v.get("files") or []))} 文件')
                else: parts.append(f'{sg}:{esc(str(v))}')
            w('- stages:' + ' · '.join(parts))
        rt = e.get('realTask') or {}
        if rt: w(f'- realTask:{rt.get("evidenceClass","")} {" ".join(rt.get("scenarios") or [])}')
        if e.get('gate'): w(f'- gate:{esc(e["gate"])}')
        if e.get('rollback'): w(f'- rollback:{esc(e["rollback"])}')
        # TDD block
        w('**TDD · 冻结用例(command-freeze.json;开工时按 B4/B5 冻结:dry-run 发现 ≥1 测试、RED 在 parent SHA 上有断言失败、expectCases 与 acceptance 1:1)**')
        any_frozen = False
        for sg in ('C', 'P', 'U', 'F'):
            ents = FZ_BY.get((eid, sg), [])
            stv = st.get(sg) if st else None
            if (isinstance(stv, str) and stv.upper().startswith('N/A')) or (isinstance(stv, dict) and stv.get('nOf') == 'N/A'):
                w(f'- {sg}:N/A(registry stages.{sg}.nOf = N/A;accept 谓词按 registry 判,ledger 格子显示 NOT_RUN 是渲染惯例)'); continue
            cs = cell_status(eid, sg)
            live = [t for t in ents if not t.get('supersededBy')]
            if isinstance(cs, str) and cs.upper().startswith('N/A') and not ents:
                w(f'- {sg}:N/A(ledger 格子 {cs})'); continue
            if not ents:
                w(f'- {sg}:未冻结' + (f'(格子 {cs})' if cs else '')); continue
            any_frozen = True
            n_cases = sum(len(t.get('expectCases') or []) for t in live)
            chain = ''
            if any(t.get('supersedes') for t in ents): chain += ' · 有 supersede'
            if any(t.get('supplements') for t in ents): chain += ' · 有 supplement'
            sp = sum(1 for t in live if t.get('sensitivityProof'))
            w(f'- {sg}:{len(live)} 条有效冻结 / {n_cases} 个具名用例 / 变异证明 {sp}/{len(live)}' + (f' / 格子 {cs}' if cs else '') + chain)
            titles = [ti for t in live for ti in (t.get('expectCases') or [])]
            for title in titles[:4]: w(f'    - {esc(title)[:140]}')
            if len(titles) > 4: w(f'    - …共 {len(titles)} 条(分布在 {len(live)} 个冻结条目),见 command-freeze.json')
        if not any_frozen: w('  (本 epic 尚无任何冻结条目——TDD 目前只有计划层:validation 子句 + stages 文件 + realTask 场景)')
    elif e and r.get('_stub'):
        w('**SDD · 规格**:见 registry(P3-13 由 C8 收录);TDD 未冻结。')
    elif eid.startswith('P9-'):
        pass
    adapt = [o for o in r['oss'] if o['role'] == 'adapt']
    opt = [o for o in r['oss'] if o['role'] == 'optional']
    rej = [o for o in r['oss'] if o['role'] == 'reject']
    ref = [o for o in r['oss'] if o['role'] == 'reference']
    if adapt:
        w('**用(adapt)**:')
        for o in adapt:
            meta = ' · '.join(x for x in [o.get('npm') and f'npm `{o["npm"]}`', o.get('license'), o.get('stars') and f'{o["stars"]:,}★'] if x)
            line = f'- **{o["name"]}**' + (f'({meta})' if meta else '') + (f' — {esc(o.get("note"))}' if o.get('note') else '')
            sup = SUP.get((eid, o['name']))
            if sup: line += f' **⟶ 裁决取代:{sup}**'
            w(line)
    else:
        w('**用(adapt)**:— 不在账本内,开工时补判' if r.get('_stub') else '**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)')
    if opt:
        w('**可选(optional,不进依赖不进 CI)**:')
        for o in opt: w(f'- {o["name"]}' + (f' — {esc(o["note"])}' if o.get('note') else ''))
    if rej:
        w('**不用(reject,理由)**:')
        for o in rej: w(f'- {o["name"]}' + (f' — {esc(o["note"])}' if o.get('note') else ''))
    if ref:
        w('**只读参考(reference)**:')
        for o in ref: w(f'- {o["name"]}' + (f' — {esc(o["note"])}' if o.get('note') else ''))
    if r['standards']:
        owned = []
        for s in r['standards']:
            fams = [n for n, p in FAM if re.search(p, s)]
            own = ''
            if fams:
                fa = first.get(fams[0])
                if fa == eid:
                    own = '(**本 epic 是形状所有者**)' if eid not in ACCEPTED_IDS or (fams[0], eid) not in NOT_ADOPTED else '(本 epic 已验收但未采用,所有权已转移,见裁决叠加)'
                elif (fams[0], eid) in NOT_ADOPTED:
                    own = f'(本 epic 未采用/不采用;所有者 {fa},见裁决叠加)'
                else:
                    my_w = status_rows.get(eid, {}).get('wave'); ow_w = status_rows.get(fa, {}).get('wave')
                    if fa not in status_rows:
                        own = f'(所有者 {fa}:{OWNER_OVERRIDE.get(fams[0], ("", "见 §1 表"))[1]})'; owned.append(f'{esc(s)} {own}'); continue
                    if isinstance(my_w, int) and isinstance(ow_w, int) and ow_w > my_w:
                        own = f'(所有者 {fa} 在 W{ow_w},晚于本 epic W{my_w}:本 epic 用内部名不声明该标准形状,所有者落地时提供单向映射)'
                    else:
                        own = f'(所有者 {fa},import 其定义)'
            owned.append(f'{esc(s)} {own}')
        w('**标准(绑定词汇)**:' + ' · '.join(owned))
    w(f'**自己写(residual)**:{esc(r["residual"])}')
    w(f'**禁令/风险(risk)**:{esc(r["risk"])}')
    if r['planError']:
        w(f'**planError**:{esc(r["planError"])}')
    if r['community']:
        cs = sorted(r['community'], key=lambda c: -(c.get('coverage') or 0))
        w('**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:')
        for c in cs:
            note = esc(c.get('note') or '')
            head = f'{c["name"]}' + (f' {c["stars"]:,}★' if c.get('stars') else '') + (f' 覆盖≈{c["coverage"]}%' if c.get('coverage') is not None else '') + (f' [{c["source"]}]' if c.get('source') else '')
            w(f'- {head}' + (f' — {note}' if note else ''))
    ovl = list(OV.get(eid, []))
    if eid in AUD: ovl.insert(0, f'§7.1 已验收核验:{AUD[eid]}')
    if ovl:
        w('**裁决叠加(整改令)**:')
        for x in ovl: w(f'- {x}')
    w('')
w('---')
w('')
w('<details><summary>生成器源码(从仓库根目录运行,输出重定向到本文件)</summary>')
w('')
w('```python')
w(open(sys.argv[0], encoding='utf-8').read().rstrip())
w('```')
w('')
w('</details>')
print('\n'.join(line.rstrip() for line in out))
```

</details>
