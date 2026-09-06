# First-100 造用执行表(派生文档)

**派生自** `spec/first100/exec/make-vs-use-ledger.json`(sha256 前 16 位 `3b481dc50e866f16`)+ `ledger.json` 状态 + `p9-verification.json` + 整改令裁决叠加(整改令最近提交 `03586cb790`);**生成时间** 2026-09-06T14:28-04:00;生成器源码在文末 `<details>`。**不要手改本文件**——改账本 JSON / 整改令 + 生成器 overlay,重新生成。

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
  "verdict": "PROVIDER_ADAPT", "verdictSecondary": "PROVIDER_WRITE" | null,
  "adopted": [ { "name": "cedar-policy/cedar",            // 账本 oss[].name 原文
                 "npm": "@cedar-policy/cedar-wasm", "version": "4.12.0",
                 "form": "runtime" | "oracle" | "optional" | "vendored",
                 "reason": "为什么是这个形态(oracle 必须指向复现硬约束的冻结用例)" } ],
  "rejectedAbsent": [ "@openfeature/server-sdk", "…" ],   // preFlight 时 = 账本 reject 条目里**有 npm 名的**名单(无 npm 名的不可核,不列);
                                                          // 门 (b) 对这些名在 files[] 里核 0 import;结果写进 realized.rejectedAbsent(布尔),不在这里
  "standardsOwned": [ "AuthZEN request/response vocabulary" ],           // 本 epic 是首个采用者的标准(§7.3);不是则 []
  "standardsImported": [ { "standard": "RFC 8785 JCS", "from": "P2-03" } ],
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

| 标准族 | 首个采用者 | 采用情况 | 全部采用者(registry 顺序) |
|---|---|---|---|
| in-toto / DSSE / SLSA | P0-01 | ✗ 未采用 → R1 slice 定形状 | P0-01 P0-07 P1-02 P1-11 P1-12 P2-03 P3-07 P3-09 P4-04 P4-09 P6-08 P6-09 P7-01 P7-02 P7-04 P7-05 P7-10 P8-10 |
| RFC 8785 JCS | P2-03 | 在途,R2 后由差分 oracle 担保 | P2-03 P4-03 P4-04 P7-01 P7-05 P8-01 P8-09 |
| CloudEvents | P4-01 | ✗ 未采用 → P8-05 拥有映射 | P4-01 P4-06 P8-04 P8-05 |
| SPIFFE | P0-02 | ✗ 未采用 → P8-06 拥有 | P0-02 P2-01 P3-06 P3-09 P8-06 |
| W3C PROV-DM | P5-11 | ✗ 未采用 → P7-04/P6-03 拥有 | P5-11 P6-02 P6-09 P7-04 |
| OTel semconv | P2-01 | ✗ 未采用 → P7-07 拥有 | P2-01 P3-03 P3-10 P5-03 P5-06 P6-05 P7-07 P8-09 |
| A2A | P4-01 | ✗ 未采用 → P4-05/P5-05 首次对外时定 | P4-01 P4-05 P5-05 P5-06 |
| MCP | P2-03 | 在途 | P2-03 P2-04 P2-12 P4-01 P4-05 P8-01 P8-04 |
| ACP | P2-06 | 未开工 | P2-06 P2-07 P2-12 P5-06 P5-09 P8-04 |
| AuthZEN | P2-03 | 未开工 | P2-03 P2-05 P2-07 |
| OCI runtime/image-spec | P3-01 | 未开工 | P3-01 P3-02 P3-08 P3-10 P5-05 P6-09 |
| JSON Schema 2020-12 | P0-06 | △ zod 在,schema-registry 无 JSON Schema 输出 → P8-07 硬前置 | P0-06 P1-01 P2-11 P4-02 P5-03 P5-05 P7-01 P8-07 |
| RFC 6902 JSON Patch | P4-13 | 未开工 | P4-13 P7-08 |
| semver | P1-01 | ✗ 未采用(R4 → P1-03) | P1-01 |
| W3C DPV | P6-02 | ✗ 未采用 → P6-10 | P6-02 P6-10 |
| Sigstore bundle | P1-02 | ✓ | P1-02 |
| Idempotency-Key | P4-12 | 未开工 | P4-12 P8-03 |
| K8s resource model | P8-02 | 未开工 | P8-02 P8-03 |
| OpenFeature | P0-05 | △ optional,1 提及 | P0-05 P7-10 |

## 2. 逐条执行卡

### P0 · 地基(8 项)

#### P0-01 · 锁定可复现审计基线与仓库指纹

`Reproducible audit baseline + repo fingerprint (DONE)` · L6_QUALIFICATION · **CONSUMER_WRITE + CONTRACT_WRITE** · 可省 0% · 状态 **ACCEPTED (W1)**

**用(adapt)**:
- **in-toto/attestation**(NOASSERTION · 371★) — Emit fingerprint as in-toto subject[] {name, digest:{sha256}} so P0-07 binds by digest
- **node:crypto sha256** — Already used in scripts/release/baseline-fingerprint.mjs:130; no dependency needed
**标准(绑定词汇)**:in-toto Statement v1 subject[]/ResourceDescriptor (**本 epic 首个采用者,未采用 → 见裁决叠加**)
**自己写(residual)**:Everything except the hash primitive stays (291-line walker + spec); only representational alignment to in-toto subject[] remains.
**禁令/风险(risk)**:None; keep as built and do not add a dependency for sha256 of ~100 files.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-vetting 5★ 覆盖≈0% — Keeps an official-package hash baseline for npm tarballs — different object
**裁决叠加(整改令)**:
- §7.1 已验收核验:整改-传播(R1):in-toto Statement 0 · ResourceDescriptor 0
- §7.2 R1:in-toto Statement v1 + DSSE 信封由 §3.4 attestation-envelope slice(P4-04 开工前)统一;P0-07 attest.ts 改发 Statement+DSSE;不重开格子

#### P0-02 · 确立 Minimal Immutable Trust Kernel 边界

`Minimal Immutable Trust Kernel boundary (DONE)` · L0_KERNEL · **KERNEL_WRITE** · 可省 0% · 状态 **ACCEPTED (W2)**

**用(adapt)**:
- **paulmillr/noble-hashes**(npm `@noble/hashes` · MIT · 913★) — Crypto primitives only (already a dep); signature roots must not be hand-rolled crypto
- **Node WebCrypto** — Crypto primitives allowed inside the kernel
**标准(绑定词汇)**:SPIFFE-style URI ids (**本 epic 首个采用者,未采用 → 见裁决叠加**)
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

**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**不用(reject,理由)**:
- open-feature/js-sdk — npm 1.23.0; would cover only flag evaluation + override chain (~15%) — not worth a boot-path dependency
- scientist (npm) — 1.1.1 from 2022 — stale
- uber/piranha — Code-rewrite tool for expired flags, not applicable to YAML gates
**只读参考(reference)**:
- github/scientist — Shadow pattern reference
**标准(绑定词汇)**:OpenFeature evaluation API (optional) (**本 epic 首个采用者,定形状**)
**自己写(residual)**:Tri-state off\|shadow\|enforce semantics, redacted shadow-diff record, owner/introducedVersion/removalVersion, kernel-gated non-downgrade of enforce, --dump-config provenance chain (>80% dsh-specific; 611 lines built).
**禁令/风险(risk)**:OpenFeature adds an SDK in the boot path for little deletion and cannot model 'run legacy AND new, record diff'; keep hand-rolled.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-evolution-lab 1★ 覆盖≈0% — Canary + rollback for skills, not a feature-gate system
- dsh-smart-restart 覆盖≈0% — Canary boot check, not a feature-gate system
**裁决叠加(整改令)**:
- §7.1 已验收核验:OK

#### P0-06 · 建立统一 Schema Registry 与兼容性规则

`Unified schema registry + compatibility rules (ACCEPTED/in-flight)` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 20-30% · 状态 **ACCEPTED (W2)**

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
**标准(绑定词汇)**:JSON Schema 2020-12 as interchange (**本 epic 首个采用者,定形状**) · Confluent compatibility vocabulary BACKWARD/FORWARD/FULL[_TRANSITIVE]
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

**用(adapt)**:
- **in-toto/attestation**(NOASSERTION · 371★) — predicates/test-result.md: result PASSED\|WARNED\|FAILED, configuration[], passedTests/warnedTests/failedTests
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Envelope format for the reserved signature field
- **slsa-framework/slsa**(1,921★) — Provenance v1 for artifact binding
- **sigstore/sigstore-js**(npm `@sigstore/sign` · Apache-2.0 · 181★) — @sigstore/sign 5.0.0 / verify 4.1.2 / bundle 5.0.0; pluggable Signer → local-key DSSE bundle offline; Fulcio/Rekor keyless optional **⟶ 裁决取代:R1:签名由 §3.4 envelope slice 用 kernel Ed25519 做 DSSE;Sigstore 只在 P1-02 验证器**
**可选(optional,不进依赖不进 CI)**:
- ctrf-io/ctrf — npm 0.3.0 for test-count JSON
**不用(reject,理由)**:
- in-toto/witness — Go binary via subprocess, unaware of dsh gates
**标准(绑定词汇)**:in-toto Attestation Statement v1 (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · DSSE envelope (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · in-toto test-result/v0.1 predicate (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · SLSA Provenance v1 (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
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

**用(adapt)**:
- **npm/node-semver**(npm `semver` · ISC · 5,460★) — 7.8.5 already transitive in pnpm-lock; semver.validRange for dshVersionRange
**标准(绑定词汇)**:JSON Schema 2020-12 (already) (首个采用者 P0-06,import 其定义) · semver ranges (**本 epic 首个采用者,未采用 → 见裁决叠加**) · VS Code contributes/capabilities.untrustedWorkspaces vocabulary  · Chrome MV3 permissions/host_permissions vocabulary
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
**标准(绑定词汇)**:in-toto Statement v1 (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · SLSA provenance v1 (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · Sigstore bundle v0.3 (**本 epic 首个采用者,定形状**) · CycloneDX 1.6  · SPDX
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

#### P1-04 · 隔离安装与默认禁止生命周期脚本

`Isolated install, no lifecycle scripts` · L2_PROVIDER · **PROVIDER_ADAPT + REUSE_UPSTREAM** · 可省 45% · 状态 **NOT_RUN (W8)**

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

**用(adapt)**:
- **packages/extensions/cordis-host-runner (existing)** — Approval queue (DynamicCordisPendingRequest), guard façade, node:vm sandbox, inspect providers
**不用(reject,理由)**:
- temporalio/temporal — Server — violates local keyless
- restatedev/restate — Server
- inngest/inngest — Server
- dbos-inc/dbos-transact-ts — Postgres
- timgit/pg-boss — Postgres
- taskforcesh/bullmq — Redis
**标准(绑定词汇)**:in-toto Statement as the proposal artifact (subject = definition digest) (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
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

**用(adapt)**:
- **slsa-framework/slsa**(1,921★) — Level vocabulary
- **in-toto/attestation**(371★) — Subject digest binding → acceptance[1] is the standard's semantics
**可选(optional,不进依赖不进 CI)**:
- ossf/scorecard — Sidecar
- MicroMilo/upstream-radar — 0.45.0, 15,045 dl; compat evidence input
**标准(绑定词汇)**:SLSA levels (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · in-toto attestation bundle bound to package digest (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · SARIF sections  · OpenSSF Scorecard checks
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

**用(adapt)**:
- **spiffe/spiffe**(Apache-2.0 · 1,843★) — Id format only, no JS lib needed
**不用(reject,理由)**:
- w3c/did-core — DIDs add key-resolution machinery a local harness does not need
- decentralized-identity/did-jwt — 8.0.18; same reason
**标准(绑定词汇)**:SPIFFE ID URI for principal ids (首个采用者 P0-02,✗ 未采用 → P8-06 拥有) · RFC 8693 act nesting for delegation chain  · OTel semconv enduser.id/service.name (**本 epic 首个采用者,未采用 → 见裁决叠加**)
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

#### P2-03 · 一等公民 ActionManifest

`First-class ActionManifest` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 25% · 状态 **NOT_RUN (W4)**

**用(adapt)**:
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0 ESM, 17 KB, RFC 8785 reference-conformant — deletes canonicalize.ts and its fuzz surface **⟶ 裁决取代:§7.8:不换库、不删 canonicalize.ts;保留迭代实现(库全递归,depth 5000 溢出)、删 NFC;canonicalize@2.1.0 进 devDependencies 作差分 oracle**
- **in-toto/attestation**(371★) — Statement {_type, subject[], predicateType, predicate} envelope
- **openid/authzen**(156★) — Authorization API 1.0 + MCP profile mapping tools/call into subject/action/resource
- **modelcontextprotocol spec**(npm `@modelcontextprotocol/sdk` · 9,112★) — ToolAnnotations (readOnlyHint/destructiveHint/idempotentHint/openWorldHint) already in installed sdk
**只读参考(reference)**:
- cyberphone/json-canonicalization — Java reference impl
**标准(绑定词汇)**:RFC 8785 JCS (**本 epic 首个采用者,定形状**) · in-toto Statement envelope (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · MCP ToolAnnotations as side-effect hint input (**本 epic 首个采用者,定形状**) · AuthZEN subject/action/resource/context (+ MCP profile / COAZ-MCP binding) (**本 epic 首个采用者,定形状**)
**自己写(residual)**:Manifest type (actionId/runId/actor/capability/target/argumentsHash/sideEffectClass/idempotencyKey/preconditions/expectedDiff/compensation/evidence), durable append before tools/pre-execute at prepareExecution (~line 1450), code-mode/PTC and plugin-RPC coverage, replay pairing test.
**禁令/风险(risk)**:JCS forbids non-finite numbers and big ints — define the argument value domain (JSON only) explicitly; do not write a second canonicalizer.
**planError**:Today the tools/pre-execute waterfall runs before any durable record.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-permission-rules 102★ 覆盖≈0% — src/call-id.ts binds decisions to call ids; not a manifest
**裁决叠加(整改令)**:
- §2.F 已解决(durable append 先于 pre-execute);§7.4/§7.5/§7.6/§7.8 R2:保留迭代 canonicalizer、删 NFC、canonicalize@2.1.0 作 devDep 差分 oracle、validation[2] 重述、C+F supersede 重观测
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

#### P2-04 · 通用副作用与风险分类体系

`Universal side-effect & risk taxonomy` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 10-15% · 状态 **NOT_RUN (W5)**

**用(adapt)**:
- **OWASP/www-project-top-10-for-large-language-model-applications**(1,383★) — Tag vocabulary, not code
- **mitre-atlas/atlas-data**(179★) — Tag vocabulary (AML.T00xx), data only
- **@modelcontextprotocol/sdk ToolAnnotations**(npm `@modelcontextprotocol/sdk`) — 4 hints map onto the 8 classes as inputs, never trusted outputs
**标准(绑定词汇)**:MCP ToolAnnotations (首个采用者 P2-03,import 其定义) · P1-01 SideEffectClass  · OWASP LLM Top-10 2025 (LLM06 Excessive Agency)  · MITRE ATLAS technique ids
**自己写(residual)**:Classifier with confidence+evidence, org policy override table with kernel hard-deny floor, unknown → higher class, 200-fixture corpus, mapping table from P1-01's 6 classes to the epic's 8.
**禁令/风险(risk)**:No OSS 'action risk classifier' exists for tool calls; LLM-based classification is deliberately not the answer (adversarial descriptions).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-auto-mode 146★ 覆盖≈30% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No formal class enum (read/local-reversible/internal-write/external-communication/destructive/financial/security-sensitive/safety-critical), no numeric confidence, no plugin-declared domain
- dsh-permission-rules 102★ 覆盖≈23% — Built-in high-risk baseline + shell argv decomposition + network target extraction — seed for the fixture corpus (20–25% together with dsh-auto-approve)
- dsh-auto-approve 12★ 覆盖≈23% — Deterministic danger list (rm -rf, dd/mkfs, force-push, curl\|sh, destructive SQL, fork bombs)
**裁决叠加(整改令)**:
- §9:第一条按 §9 走的 epic——preFlight 含全部 community 缺口逐项对子句;§9.1 的 verify-make-vs-use 门在其 preFlight 前建好

#### P2-05 · Policy Decision Service 与单调拒绝

`Policy Decision Service + monotonic deny` · L2_PROVIDER · **PROVIDER_ADAPT** · 可省 50% · 状态 **NOT_RUN (W6)**

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
**标准(绑定词汇)**:AuthZEN request/response vocabulary (首个采用者 P2-03,import 其定义)
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

#### P2-06 · 审批绑定完整规范化参数、资源与前置状态

`Approval bound to canonical args, resources, preconditions` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 5% · 状态 **NOT_RUN (W7)**

**用(adapt)**:
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — Digest = JCS(manifest) from P2-03 **⟶ 裁决取代:§7.3/§7.8:import P2-03 的 canonicalizeArguments,不接库**
- **@agentclientprotocol/sdk**(npm `@agentclientprotocol/sdk`) — 1.4.0 already installed; RequestPermissionRequest {sessionId, toolCall, options[]}
**标准(绑定词汇)**:ACP RequestPermissionRequest.toolCall as the wire projection (**本 epic 首个采用者,定形状**)
**自己写(residual)**:Extend ApprovalRequest with manifest digest + redacted view + riskClass + expectedDiff + expiresAt, preconditions.ts (inode/mtime/etag/remote version capture and re-check), re-validate digest+token+policy version before dispatch, invalidate-on-change, one-to-one approval↔action audit link.
**禁令/风险(risk)**:TOCTOU/precondition semantics are dsh-specific; Unicode-confusable display via NFC + highlighting, hash stays over raw canonical value.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-auto-mode 146★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No ActionManifest digest or canonicalized-argument hash; binding is by string equality of reason/justification, not by hash over canonical args. Preconditions/inode identity are re-validated
- dsh-auto-review 129★ 覆盖≈10% — Caches verdicts by tool+arguments fingerprint, redacts args for reviewer — lives in the answerer, no pre-dispatch re-validation
- dsh-permission-rules 102★ 覆盖≈10% — Call-id binding in the answerer

#### P2-07 · 持久化、可跨 Turn/进程的 Approval Queue

`Durable cross-turn/cross-process approval queue` · L2_PROVIDER · **PROVIDER_WRITE** · 可省 0-10% · 状态 **NOT_RUN (W8)**

**用(adapt)**:
- **openid/authzen access-request-approval profile**(156★) — State vocabulary + 'approval never is access, re-evaluate at enforcement'
- **node:sqlite** — CAS via UPDATE … WHERE state='approved' AND revision=? + changes()==1
**不用(reject,理由)**:
- restatedev/restate — Awakeables are exactly approval waits but needs a server; optional P4-01 provider only
- temporalio/temporal — Server (signals); optional P4-01 provider only
- dbos-inc/dbos-transact-ts — Postgres required
- inngest/inngest — Go server
- timgit/pg-boss — 12.29 Postgres
**标准(绑定词汇)**:AuthZEN Access Request & Approval Profile Draft 1 (首个采用者 P2-03,import 其定义) · ACP allow_always/reject_always option kinds (首个采用者 P2-06,import 其定义)
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

**用(adapt)**:
- **schemastery (vendored)** — Settled seam for the ProfileSpec schema; profiles are dsh config composition
**标准(绑定词汇)**:Codex sandbox_mode/approval_policy names (already mirrored)  · JSON Schema export for serialization/--dump (首个采用者 P0-06,import 其定义)
**自己写(residual)**:schema.ts (execution world, fs/network/process/secrets vocab from P3-02, risk thresholds from P2-04, approval rules, plugin trust, budget, retention), 4 shipped profiles, capability-diff-before-switch, hot demotion vs approval-gated promotion, provenance display.
**禁令/风险(risk)**:Keep custom derivation semantics (derive() in permission-presets) — profiles must remain a fold over knob events so replay stays truthful.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-auto-mode 146★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Profile is only sandbox+approval; no execution-world/fs/network/process/secrets/risk-threshold/plugin-trust/budget/retention fields, no schema, no serialization with provenance, no capabilit
- dsh-auto-approve 12★ 覆盖≈15% — Proves presets are plugin-extensible (inserts auto between workspace-write and danger-full-access)
- dsh-permission-rules 102★ 覆盖≈15% — Network modes deny-all/whitelist/allow-all keyed off the 3 presets

#### P2-12 · 全局 Emergency Stop 与通用 Human Interaction Channel

`Global emergency stop + generic human channel` · L2_PROVIDER · **PROVIDER_WRITE + CONTRACT_WRITE** · 可省 0-10% · 状态 **NOT_RUN (W7)**

**用(adapt)**:
- **@modelcontextprotocol/sdk**(npm `@modelcontextprotocol/sdk`) — 1.29.0 installed; elicitation form/URL mode payload shape
- **@agentclientprotocol/sdk**(npm `@agentclientprotocol/sdk`) — 1.4.0 installed; request_permission allow_once\|allow_always\|reject_once\|reject_always
**不用(reject,理由)**:
- open-feature/js-sdk — 1.23.0; evaluation API only, no persistence/broadcast/lease semantics → relocation not deletion
- open-feature/flagd — Same reason
**标准(绑定词汇)**:MCP elicitation/create (首个采用者 P2-03,import 其定义) · ACP session/request_permission / elicitation_create (首个采用者 P2-06,import 其定义) · ACP session/cancel (首个采用者 P2-06,import 其定义)
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

**用(adapt)**:
- **opencontainers/runtime-spec**(Apache-2.0 · 3,669★) — State vocabulary + lifecycle ordering
**只读参考(reference)**:
- e2b-dev/E2B — npm e2b 2.46.0 MIT; SDK surface as reference (already dep 2.29.1)
- daytonaio/daytona — gh license field null; npm 0.207.1 Apache-2.0
- kubernetes-sigs/agent-sandbox — CRD naming (Sandbox/SandboxTemplate/SandboxWarmPool) informative
**标准(绑定词汇)**:OCI runtime-spec lifecycle/state (creating/created/running/stopped) (**本 epic 首个采用者,定形状**) · E2B/Daytona SDK shape as reference
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

**用(adapt)**:
- **opencontainers/runtime-spec**(Apache-2.0 · 3,669★) — Field names/semantics for process/IPC/device/resource dimensions — adopt names, not the container-centric JSON wholesale
- **anthropics/sandbox-runtime**(npm `@anthropic-ai/sandbox-runtime` · Apache-2.0 · 5,113★) — 0.0.75; sandbox-schemas.ts zod: network allow/deny domains(+port), allowUnixSockets, allowLocalBinding, fs denyRead/allowRead/allowWrite/denyWrite; supportedPolicyFeatures
- **moby/moby default seccomp profile**(Apache-2.0 · 72,030★) — Baseline syscall allowlist
**标准(绑定词汇)**:OCI runtime-spec config.json linux.{namespaces,seccomp,devices,resources,rlimits}, mounts (首个采用者 P3-01,import 其定义) · Landlock ABI rights names  · srt SandboxRuntimeConfig schema
**自己写(residual)**:dsh union type, closed-allowlist validator, supportedPolicyFeatures per provider + solver (weak cannot impersonate strong), serialization/audit fields; srt's seccomp-availability warning must become fail-closed.
**禁令/风险(risk)**:Don't adopt OCI JSON wholesale (container-centric, huge); Windows WFP fence covers TCP/UDP only (named pipes need ACLs) → record partial.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- axern 59★ 覆盖≈35% [topic-sweep] — not-a-plugin·非插件·无 key \| 缺口：No FileSystemPolicy/ProcessPolicy/IpcPolicy/DevicePolicy/SecretPolicy vocabulary; filesystem policy is only rootfsReadonly + volumes; process visibility comes implicitly from runsc, not a de
- dsh-movein-permissions 15★ 覆盖≈0% — Tool-call gate, not world policy
- dsh-permgate 5★ 覆盖≈0% — Tool-call gate, not world policy

#### P3-03 · 结构化 Out-of-Band Denial 与执行错误

`Typed out-of-band denial & execution outcomes` · L1_CONTRACT · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 50% · 状态 **NOT_RUN (W8)** · 上游已部分实现

**用(adapt)**:
- **anthropics/sandbox-runtime**(npm `@anthropic-ai/sandbox-runtime` · Apache-2.0 · 5,113★) — sandbox-violation-store.ts, linux-violation-monitor.ts, seatbelt log tap — violations keyed by commandId = true OOB channel for local worlds
**标准(绑定词汇)**:RFC 9457 problem details on SDK/web wire  · OTel semconv error.type (首个采用者 P2-01,✗ 未采用 → P7-07 拥有) · POSIX/GNU exit-status conventions 124/125/126/127/128+n
**自己写(residual)**:Full outcome union (policy_denied/sandbox_unavailable/resource_exhausted/timeout/cancelled/tool_failed/world_lost), mapping table per provider, artifact/control separation, retry-policy hook; upstream already gives SANDBOX_UNAVAILABLE + denialSignatures + runnerFailureRules.
**禁令/风险(risk)**:Upstream denial model is stderr-substring based (model-controllable text); OOB via srt only on local — container/remote need exit-code + API status.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- axern 59★ 覆盖≈30% [topic-sweep] — not-a-plugin·非插件·无 key \| 缺口：No per-execution policy_denied outcome: egress denials are REFUSED/dropped on the wire and never reported to the caller through a control channel; no world_lost/resource_exhausted typed outc
**裁决叠加(整改令)**:
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P3-04 · 统一 Network Egress Proxy 与目的地策略

`Egress proxy + destination policy` · L2_PROVIDER · **PROVIDER_ADAPT + REUSE_UPSTREAM** · 可省 65% · 状态 **NOT_RUN (W9)**

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
**标准(绑定词汇)**:OAuth token-exchange RFC 8693 delegation semantics (borrowed)  · SPIFFE SVID lifetime rules (borrowed) (首个采用者 P0-02,✗ 未采用 → P8-06 拥有)
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

**用(adapt)**:
- **in-toto/attestation**(NOASSERTION · 371★) — Statement {subject: world id, predicateType: dsh/sandbox-attestation/v1}
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Envelope; ~40 lines to hand-roll with node:crypto ed25519 if sigstore-js bundle is unwanted
- **anthropics/sandbox-runtime (probe/violation logic + e2e fixtures)**(npm `@anthropic-ai/sandbox-runtime` · Apache-2.0 · 5,113★) — Test fixtures seed for the conformance/escape corpus (qualification)
**可选(optional,不进依赖不进 CI)**:
- sigstore/sigstore-js — 5.0.0 / @sigstore/sign 5.0.0 / @sigstore/verify 4.1.2; DSSE signing with a local key (no Fulcio needed); adds ~2 MB deps
**标准(绑定词汇)**:in-toto Statement v1 + DSSE envelope for the attestation artifact (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · SLSA-style predicate (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
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

**用(adapt)**:
- **apocas/dockerode**(npm `dockerode` · Apache-2.0 · 4,945★) — 5.0.1; Docker + Podman docker-compat socket; create/start/exec/attach/commit/remove/wait, image pull by digest, HostConfig knobs
- **testcontainers/testcontainers-node**(npm `testcontainers` · MIT · 2,596★) — 12.0.4; lifecycle + Ryuk reaper for crash cleanup — qualification only, not shipped in provider
**可选(optional,不进依赖不进 CI)**:
- google/gvisor — runsc via HostConfig.Runtime
- containers/podman — Rootless default
- sigstore/sigstore-js @sigstore/verify — cosign-signed image digests / SLSA provenance when a public key is pinned
**标准(绑定词汇)**:OCI runtime-spec HostConfig knobs (ReadonlyRootfs, Tmpfs, SecurityOpt no-new-privileges/seccomp, CapDrop ALL, PidsLimit, Memory, NanoCpus) (首个采用者 P3-01,import 其定义)
**自己写(residual)**:WorldSpec→HostConfig mapping, egress-proxy wiring (network=none + unix-socket or proxy sidecar sharing netns — design decision), secret-lease injection (tmpfs file/FD, not env), attestation predicate (image digest, runtime, rootless), validator rejecting docker.sock/$HOME mounts, conformance provider tests.
**禁令/风险(risk)**:Docker/Podman daemon optional (macOS CI has no Docker by default → provider reports unavailable, fail-closed).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-worlds 3★ 覆盖≈50% — 本会话复核：frozo-ai/dsh-worlds 仓库里没有 LICENSE 文件（gh api license=null），无授权即不可依赖，直接出局；且原审计已记它安全 MUST 覆盖 0%（强制 danger-full-access）。仅作参考。
- dsh-plugin-container 4★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key·一次性提交 \| 缺口：Not on the ExecutionWorld/SandboxExecution seam at all: it is a parallel model-facing docker_* tool surface, so dsh shell/file tools never run inside it and no snapshot/terminate/attest cont

#### P3-09 · MicroVM / Remote ExecutionWorld 与 Attestation

`MicroVM / remote world + attestation` · L2_PROVIDER · **PROVIDER_ADAPT + CONTRACT_WRITE** · 可省 50% · 状态 **NOT_RUN (W8)**

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
**标准(绑定词汇)**:in-toto/DSSE attestation (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · SPIFFE ID format for tenant/world identity (首个采用者 P0-02,✗ 未采用 → P8-06 拥有)
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

#### P3-10 · CPU/Memory/Disk/Time/Process/Network 资源配额

`Resource quotas (CPU/mem/disk/time/pids/net)` · L2_PROVIDER · **PROVIDER_WRITE + PROVIDER_ADAPT** · 可省 35% · 状态 **NOT_RUN (W8)**

**用(adapt)**:
- **systemd-run** — --scope -p MemoryMax -p CPUQuota -p TasksMax (Linux w/ systemd, no npm)
- **apocas/dockerode HostConfig**(npm `dockerode` · Apache-2.0 · 4,945★) — Memory/NanoCpus/PidsLimit/StorageOpt
- **soyuka/pidusage**(npm `pidusage` · MIT · 546★) — 4.0.1 cross-platform CPU/mem sampling
- **packages/subprocess/win32-process (existing)** — FFI base for CreateJobObject/SetInformationJobObject
**可选(optional,不进依赖不进 CI)**:
- google/nsjail — --cgroup_mem_max --cgroup_pids_max --cgroup_cpu_ms_per_sec --rlimit_* --time_limit
**标准(绑定词汇)**:OCI linux.resources names (首个采用者 P3-01,import 其定义) · OTel process.* semconv (首个采用者 P2-01,✗ 未采用 → P7-07 拥有)
**自己写(residual)**:BudgetSpec (per action/run/tenant; wall, cpu, mem, disk, pids, net bytes, tool calls, agents), scheduler reservation, hierarchical accounting across subagents, typed resource_exhausted outcome + cleanup, reconciliation with telemetry.
**禁令/风险(risk)**:macOS local has no cgroup equivalent (ulimit soft caps, -v breaks binaries) → provider reports partial and attests it; disk quota on local = polling or tmpfs size.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-plugin-container 4★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key·一次性提交 \| 缺口：All limits are opt-in per call (no default budget), only per-container not per action/run/tenant, no network-bytes / tool-call / agent-count budgets, no scheduler reservation or telemetry re
- dsh-passwords 39★ 覆盖≈0% — Per-subuser token/daily quotas — model-token budgets, not world resources; license blocks reuse
- dsh-cost-meter 243★ 覆盖≈0% — Cost, not resources

#### P3-11 · ExecutionWorld Snapshot / Restore / Rollback

`World snapshot / restore / rollback` · L2_PROVIDER · **PROVIDER_ADAPT + CATALOG_ADOPT** · 可省 50% · 状态 **NOT_RUN (W11)**

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

**用(adapt)**:— 不在账本内,开工时补判
**自己写(residual)**:账本 2026-09-02 生成时本 epic 同日才收录;开工时按 §4.1 补一次单条 make-vs-use 判断并写进本卡(delegate 维护 overlay)。
**禁令/风险(risk)**:—
**裁决叠加(整改令)**:
- §3.2 共用引擎 sandbox-runtime(@anthropic-ai/sandbox-runtime,exact pin)在 W7 前作为 sandbox-srt rung 接入;该 slice 同时把 sandbox-local 的 PLATFORM_CHAINS 表改成 contribution point
- §6:不在账本内(09-02 同日收录);开工时补单条 make-vs-use 判断,预期 CONSUMER_WRITE,依赖 §3.2 rung

### P4 · 任务编排(14 项)

#### P4-01 · 一等公民 Run Service 与 Run Event Log

`Run service + append-only run event log` · L2_PROVIDER · **PROVIDER_WRITE + CONTRACT_WRITE** · 可省 0-5% · 状态 **ACCEPTED (W4)**

**用(adapt)**:
- **cloudevents/spec**(Apache-2.0 · 5,885★) — Attribute names only; do not depend on the cloudevents SDK (HTTP binding focus)
**不用(reject,理由)**:
- temporalio/temporal — sdk-typescript 905★ MIT; needs server + native core-bridge; would own run state outside the session log
- restatedev/restate — BSL server
- dbos-inc/dbos-transact-ts — Postgres-only
- statelyai/xstate — 5.32.6; v5 silently ignores unhandled events, no append-only log
- event-driven-io/emmett — License unverified; sqlite adapter peer-deps native sqlite3
**标准(绑定词汇)**:CloudEvents attribute names (id/source/type/time/subject/datacontenttype) (**本 epic 首个采用者,未采用 → 见裁决叠加**) · A2A TaskState / MCP TaskStatus names at surfaces (**本 epic 首个采用者,未采用 → 见裁决叠加**)
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

**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**不用(reject,理由)**:
- W3C PROV (per-field provenance) — Overkill
**只读参考(reference)**:
- a2aproject/A2A Task/Message — Naming reference only
**标准(绑定词汇)**:JSON Schema for the profile via zod (none exists for the concept) (首个采用者 P0-06,import 其定义)
**自己写(residual)**:Pure dsh vocabulary: goal ref, hard/soft constraints with source+confidence, side-effect class (unknown ≠ none), open questions routed to packages/interaction/user-questions; vitest golden fixtures.
**禁令/风险(risk)**:Vertical creep is the risk, not OSS; keep fields generic per must#1.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-trajectory-governor 13★ 覆盖≈30% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No per-inference source/confidence (only a scalar complexity score); no question emission for ambiguous or high-risk fields (it guesses); no side-effect field at all, so 'unknown side effect

#### P4-03 · RunPlan：模型、Agent、工具、世界、预算与验证的可执行计划

`RunPlan (executable plan data)` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 5% · 状态 **NOT_RUN (W8)**

**用(adapt)**:
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0; JCS + sha256 via existing @noble/hashes → byte-stable plan ids **⟶ 裁决取代:§7.3/§7.8:import P2-03 的 canonicalizeArguments,不接库**
**不用(reject,理由)**:
- serverlessworkflow/specification — Control-flow DSL; RunPlan is a resource/topology/budget/gate plan (sdk-typescript 88★)
- ChristopheBougere/asl-validator — AWS ASL control-flow DSL — no fit
- z3 wasm / logic-solver — SAT solver adds MBs for a ~100 LOC deletion-based minimal conflict set
**标准(绑定词汇)**:RFC 8785 JCS + sha256 for deterministic plan id (首个采用者 P2-03,import 其定义)
**自己写(residual)**:Satisfiability over typed constraints (capability ⊆ available, budget ≤ cap, policy allow) + deletion-based minimal conflict set (~100 LOC); verificationContractRef as versioned opaque ref (P7-01 fills it).
**禁令/风险(risk)**:Keep verificationContractRef opaque and versioned.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh_workflow 113★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key·一次性提交 \| 缺口：The plan is not data: the executable part is arbitrary JavaScript run in QuickJS, directly contrary to 'Plan 是数据，不包含任意可执行代码'. No TaskProfile input or requirement traceability, no determinist
**裁决叠加(整改令)**:
- §7.3 JCS 消费者:argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P4-04 · RunPlan Freeze、签名与 Amendment Protocol

`Plan freeze, kernel signature, amendment CAS` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 10-15% · 状态 **NOT_RUN (W9)**

**用(adapt)**:
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0 (alt snowyu/json-canonicalize 9★ MIT 3.0.0) **⟶ 裁决取代:§7.3/§7.8:import P2-03 的 canonicalizeArguments,不接库**
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Envelope; payloadType application/vnd.dsh.runplan+json
- **in-toto/attestation**(371★) — Later supply-chain alignment
- **node:crypto Ed25519** — Zero new crypto dep rather than @noble/curves
**标准(绑定词汇)**:DSSE envelope over RFC 8785 JCS (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · Ed25519 via node:crypto  · in-toto/attestation alignment for later P5/P6 (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
**自己写(residual)**:Trust-kernel signing entrypoint (signatureRoots is an empty placeholder, index.ts:79), mutable-field declaration, amendment record + sqlite CAS on active_revision, re-run policy/budget/approval, replay from run_events.
**禁令/风险(risk)**:Don't invent an envelope; DSSE keeps P4-04 compatible with supply-chain chapters.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：Hash is not a signature (any party can recompute); no kernel signing, no PlanAmendment protocol, no declared-mutable fields, no re-policy/re-budget on structural change. Only actions are fro
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §7.3 JCS 消费者:argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P4-05 · 扩展 Agent Lifecycle 状态机

`Agent lifecycle state machine (PARTIAL)` · L3_CONSUMER · **REUSE_UPSTREAM + CONSUMER_WRITE** · 可省 0% · 状态 **NOT_RUN (W5)** · 上游已部分实现

**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — 'Every non-listed edge throws' property
**可选(optional,不进依赖不进 CI)**:
- @xstate/graph — 3.0.4 path enumeration — unnecessary with 10 states
**不用(reject,理由)**:
- statelyai/xstate — Would add a 30k★ runtime dep to reject 10 illegal edges
- matthewp/robot — Same reason
**标准(绑定词汇)**:A2A TaskState / MCP TaskStatus mapping at surfaces (waiting_human ↔ input_required) (首个采用者 P4-01,✗ 未采用 → P4-05/P5-05 首次对外时定)
**自己写(residual)**:10-state validated transition table with {reason, runId, leaseEpoch}, stale-epoch rejection, orphan reclaim on restart, back-compat mapping to idle\|running (~150 LOC + fast-check); upstream already has inbox projection, consumed-work, holder model.
**禁令/风险(risk)**:Wave inversion: P4-05 (wave 5) needs leaseEpoch from P4-07 (wave 6) — declare leaseEpoch as opaque number now, enforce fencing in P4-07.
**planError**:P4-05 depends on lease epoch from P4-07 scheduled a wave later — declare the field early.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No lease epoch on transitions, no stale-worker write rejection (no fencing), lifecycle is per task/work-unit not per agent, no waiting_tool/waiting_human/cancelling distinctions, unverified
- DSH-taskboard 282★ — Exclusive claims, orphaned claims stay visible (no epoch/heartbeat) — prior art
**裁决叠加(整改令)**:
- §2.F planError 已解决,记录即可

#### P4-06 · Durable Inbox / Outbox 与 At-Least-Once 投递 + 幂等消费
(账本原题「Durable Inbox / Outbox 与 Exactly-Once Effect Handoff」;registry 已重述,provenance `rewordedFrom`,见整改令 §2.A)

`Durable inbox/outbox, effectively-once handoff (PARTIAL)` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_WRITE** · 可省 0-5% · 状态 **BLOCKED_ON_ACCEPTANCE (W5)** · 上游已部分实现

**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**可选(optional,不进依赖不进 CI)**:
- taskforcesh/bullmq — Redis — optional provider only, never default
- timgit/pg-boss — Postgres — optional
- graphile/worker — Postgres — optional
- NATS JetStream — Optional provider
**不用(reject,理由)**:
- cloudevents/sdk-javascript — 10.0.0; adopt attribute names, not the HTTP-binding SDK
- better-queue — Stale 2024-06
**标准(绑定词汇)**:CloudEvents attribute names; dedup on id (首个采用者 P4-01,✗ 未采用 → P8-05 拥有映射)
**自己写(residual)**:Outbox tables + BEGIN IMMEDIATE transactional write (cannot use KV seam), dispatcher receipts, consumer dedup by (messageId, epoch), priority/deadline/DLQ/backpressure, tenant column checks (~400 LOC + fault matrix).
**禁令/风险(risk)**:'Exactly-once' is at-least-once + idempotent consumer; say so in the contract.
**planError**:P4-06 should say 'at-least-once + idempotent consumer' not 'exactly-once'; transactional outbox cannot use the storage KV seam (single-statement by design).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No dead-letter, no per-message priority/deadline, no consumer-side epoch dedup, no tenant isolation, no crash-campaign evidence in the tests I read. Python/sqlite only.
- dsh-lark-link 覆盖≈0% — 'At-least-once zero-loss' is a notify bridge
**裁决叠加(整改令)**:
- §2.A 子句措辞改(标题/must[0]/acc[0] → at-least-once + 幂等消费,BEGIN IMMEDIATE 事务)

#### P4-07 · Worker Lease、Heartbeat 与 Fencing Token

`Worker lease, heartbeat, fencing token` · L2_PROVIDER · **PROVIDER_WRITE + QUALIFICATION_REUSE** · 可省 0% · 状态 **ACCEPTED (W6)**

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

**用(adapt)**:
- **packages/storage/storage-sqlite KV unit (existing)** — Registry store keyed by digest, value = DSSE envelope
**不用(reject,理由)**:
- serverlessworkflow/specification — Saved format — rejected
- OCI artifacts / ORAS — Overkill
**标准(绑定词汇)**:sha256 content digest + DSSE signature (P4-04) for saved definitions (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
**自己写(residual)**:Signed-artifact load path that never executes unverified code, detached ownership by the Run service, nested budget/capability/trace decay, recursion/cycle rejection at compile, parent-cancel propagation (~400 LOC).
**禁令/风险(risk)**:Detached runs need durable job records — jobs-local is in-memory and can't own them; the Run service must.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh_workflow 113★ — Capsules (digest/version/catalog) = prior art
- dsh-agent-team-gui 163★ — Persistent teams — UI
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

#### P4-10 · Workflow 预算、Scheduler、Backpressure、公平性与资源锁

`Budget, scheduler, backpressure, fairness, locks (PARTIAL)` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_WRITE** · 可省 15% · 状态 **NOT_RUN (W9)** · 上游已部分实现

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

**用(adapt)**:— 无(账本找过,没有合适的开源;主体自写)
**不用(reject,理由)**:
- idempotency-key (npm) — Does not exist on npm; other idempotency packages are Express middlewares / in-memory
**标准(绑定词汇)**:IETF draft-ietf-httpapi-idempotency-key-header-07 Idempotency-Key passthrough (**本 epic 首个采用者,定形状**) · Stripe same-key-different-params reject
**自己写(residual)**:sqlite ledger(key, params_digest, state prepared\|sent\|confirmed\|ambiguous\|compensated, epoch, receipt_digest) with CAS reserve, stale-epoch rejection from P4-07, ambiguous → P4-13 (~300 LOC + fast-check crash campaign).
**禁令/风险(risk)**:Batch actions need per-item rows; provider-native keys must be passed through verbatim per the IETF header semantics.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No prepared/sent/confirmed/ambiguous/compensated ledger states, no native-provider-key passthrough, no target-state query for ambiguous, no 10k crash campaign, no same-key-different-args rej

#### P4-13 · Reconciliation Engine 与 Saga Compensation

`Reconciliation engine + saga compensation` · L3_CONSUMER · **CONSUMER_WRITE** · 可省 5-10% · 状态 **NOT_RUN (W13)**

**用(adapt)**:
- **Starcounter-Jack/JSON-Patch**(npm `fast-json-patch` · MIT · 1,982★) — 3.1.1 RFC 6902 patch documents
- **AsyncBanana/microdiff**(npm `microdiff` · MIT · 3,866★) — Compute diffs
**不用(reject,理由)**:
- node-sagas — Stale 2023-01
- workflow-es sagas — Stale, mongo/redis
- @node-ts/bus — Not on npm
**标准(绑定词汇)**:JSON Patch RFC 6902 for StateDiff/repair-option representation (**本 epic 首个采用者,定形状**)
**自己写(residual)**:observeState/compareExpected/compensate tool-declared hooks; engine as a workflow over the Run service emitting compensation ActionManifests (policy/approval/ledger/evidence); compensation runs as a nested run (P4-09) (~350 LOC).
**禁令/风险(risk)**:Never fabricate rollback: irreversible ⇒ manual intervention; verify external state, not agent self-report.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈15% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No observeState/compareExpected/compensate declarations for tools, no StateDiff/repair options, no saga compensation, no manual-intervention marking for irreversible actions.

#### P4-14 · Partial-Turn Resume、Durable Schedule/Goal Trigger

`Partial-turn resume, durable schedule/goal triggers (PARTIAL)` · L2_PROVIDER · **REUSE_UPSTREAM + CONSUMER_WRITE** · 可省 0% · 状态 **NOT_RUN (W14)** · 上游已部分实现

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

**用(adapt)**:
- **badlogic/pi-mono (@earendil-works/pi-ai)**(npm `@earendil-works/pi-ai` · MIT · 100,867★) — 0.84.2 already dep: compat flags for reasoning format, maxTokensField, Bedrock/Anthropic/Responses translation — the adapter compiler already exists
**不用(reject,理由)**:
- microsoft/vscode-prompt-tsx — 0.4.0-alpha; priority pruning is precisely the silent clause-dropping the epic forbids
- BoundaryML/baml — Own DSL + codegen — second language
- vercel/ai — Second IR next to the settled pi-ai twin
- microsoft/prompty — Asset format
**标准(绑定词汇)**:JSON Schema for the output contract (首个采用者 P0-06,import 其定义) · OTel GenAI semconv gen_ai.usage.* for token-estimate telemetry (首个采用者 P2-01,✗ 未采用 → P7-07 拥有)
**自己写(residual)**:PromptIR types (instructions / context slices / tool surface / output contract / policy notices), IR→dsh Message[] lowering (one function), clause-preservation golden tests, negotiation + IR hash written into EpochHeader via request-header.ts foldRequestHeader.
**禁令/风险(risk)**:Do not create a second provider-translation layer; token estimate uses CHARS_PER_TOKEN=4 until the tokenizer epic lands.
**planError**:Planned packages/llm/prompt-compiler/src/compile.ts per provider already exists as pi-ai compat + llm-pi-ai/src/context.ts toPiContext + llm-deepseek/src/translate.ts.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-vision-router 1,051★ 覆盖≈10% — 'Unsupported image → explicit vision degrade' is the one negotiation case the community built; core already has projectImagesForTextModel
**裁决叠加(整改令)**:
- §2.C 缩范围:files[] 删与上游/已有实现重复的 [N] 文件,residual 收窄

#### P5-04 · Provider Fallback、Hedging、Rate Limit 与一致预算

`Provider fallback, hedging, rate limit, budget` · L2_PROVIDER · **PROVIDER_ADAPT + REUSE_UPSTREAM** · 可省 30-40% · 状态 **NOT_RUN (W11)**

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

**用(adapt)**:
- **a2aproject/A2A**(npm `@a2a-js/sdk` · Apache-2.0 · 25,602★) — @a2a-js/sdk 1.1.0 types verified: Task, TaskStatus, TaskState, Message, Part, Artifact, AgentCard
**不用(reject,理由)**:
- ucan-wg/ts-ucan — Stale 2024-03; token format belongs to P4-03/Trust Kernel, not here
- biscuit-auth/biscuit — Token format is not this epic's concern — carry only a reference
**标准(绑定词汇)**:A2A Message/Part/Artifact vocabulary (首个采用者 P4-01,✗ 未采用 → P4-05/P5-05 首次对外时定) · JSON Schema for outputSchema (首个采用者 P0-06,import 其定义) · W3C Trace Context traceparent  · OCI-style sha256:<hex> content-addressed refs (首个采用者 P3-01,import 其定义)
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

**用(adapt)**:
- **a2aproject/A2A**(npm `@a2a-js/sdk` · Apache-2.0 · 25,602★) — Artifact{artifactId,name,description,parts,metadata}, TaskState
- **@agentclientprotocol/sdk**(npm `@agentclientprotocol/sdk` · Apache-2.0 · 4,132★) — 1.4.0 already dep; update vocabulary
**标准(绑定词汇)**:A2A Artifact + TaskState enum (incl. input-required/auth-required/rejected) as failure class (首个采用者 P4-01,✗ 未采用 → P4-05/P5-05 首次对外时定) · ACP session/update tool_call ids for tool-trace refs (首个采用者 P2-06,import 其定义) · OTel GenAI gen_ai.usage.* for usage/cost (首个采用者 P2-01,✗ 未采用 → P7-07 拥有)
**自己写(residual)**:result.ts (status, summary, artifact refs, state diffs, action receipts, tool trace refs, usage/cost, verification hints, continuation token), Artifact Store spill for large results, per-provider capability flags; keep structured validation provider-owned.
**禁令/风险(risk)**:Same hot-zone caveat; cost reconciliation needs token-meter route pricing (route-pricing.ts exists).
**planError**:P5-06 patches the upstream subagent hot zone — land upstream first.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- allinluna 51★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No usage/cost, tool-trace refs, action-receipt list, or continuation token. JSON-Schema + Python only. The DSH plugin never maps a DSH child result back — the child must finalize its lane vi
**裁决叠加(整改令)**:
- §2.D 热区改接法:[B] 热区文件换 [N] 新 rung / contribution

#### P5-07 · Codex Adapter：结构化流、继续执行、审批与证据映射

`Codex adapter: structured stream, continuation, approval, evidence` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_ADAPT** · 可省 60-70% · 状态 **NOT_RUN (W12)** · 上游已部分实现

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

**用(adapt)**:
- **agentclientprotocol/agent-client-protocol**(npm `@agentclientprotocol/sdk` · Apache-2.0 · 4,132★) — SDK 1.4.0 (fork pin; npm latest 1.3.0) methods verified in dist; no event cursor
**可选(optional,不进依赖不进 CI)**:
- a2aproject/A2A — tasks/resubscribe + push notifications fit HTTP-remote better — a future subagent-a2a provider, not an ACP extension
**标准(绑定词汇)**:ACP 1.4.0 session/load, session/resume, session/fork, session/list, session/request_permission, authenticate, sessionCapabilities (首个采用者 P2-06,import 其定义)
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

#### P5-11 · 通用 Taskboard、Mailbox 与 Blackboard 原语

`Generic taskboard / mailbox / blackboard primitives` · L2_PROVIDER · **REUSE_UPSTREAM + PROVIDER_WRITE** · 可省 40-50% · 状态 **ACCEPTED (W7)** · 上游已部分实现

**用(adapt)**:
- **packages/experimental/agent-team (existing)** — task-board.ts DAG/blockedBy/writeScopes/revision CAS, task-graph.ts cycle reject, mailbox.ts durable point-to-point — promote into the Service Definition
**不用(reject,理由)**:
- timgit/pg-boss — Postgres-only
- taskforcesh/bullmq — Redis-only
- graphile/worker — Postgres; claim+lease is ~100 lines over node:sqlite BEGIN IMMEDIATE
**标准(绑定词汇)**:W3C PROV-DM field names for blackboard provenance (wasGeneratedBy, wasAttributedTo, wasDerivedFrom) (**本 epic 首个采用者,未采用 → 见裁决叠加**)
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

**用(adapt)**:
- **w3c/prov**(2★) — Relation vocabulary
- **w3c/dpv**(81★) — Purpose/personal-data vocabulary shared with P6-10
- **dubzzz/fast-check**(npm `fast-check` · MIT) — Already dev dep; arbitraries over the zod schema
**只读参考(reference)**:
- getzep/graphiti — Field naming precedent
**标准(绑定词汇)**:W3C PROV-DM relations wasDerivedFrom/wasGeneratedBy/wasAttributedTo (首个采用者 P5-11,✗ 未采用 → P7-04/P6-03 拥有) · Graphiti-style bitemporal fields created_at/valid_at/invalid_at/expired_at  · W3C DPV for purpose & personal-data categories (**本 epic 首个采用者,未采用 → 见裁决叠加**)
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
**裁决叠加(整改令)**:
- §7.2 R3:W3C PROV-DM 词汇(wasDerivedFrom/wasGeneratedBy/wasAttributedTo)由本 epic 首次对外使用;P5-11/P6-02 内部名保留 + 映射

#### P6-04 · Context Graph 与 Retrieval Planner

`Context graph + retrieval planner` · L2_PROVIDER · **PROVIDER_WRITE + PROVIDER_ADAPT** · 可省 15-20% · 状态 **NOT_RUN (W11)**

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

**用(adapt)**:
- **open-telemetry/semantic-conventions**(npm `@opentelemetry/semantic-conventions` · Apache-2.0 · 642★) — 1.43.0; @opentelemetry/* already deps; carried by existing session-telemetry-otel
**标准(绑定词汇)**:OTel semconv gen_ai.* attribute names (+ dsh.context.source_id / selection_reason) (首个采用者 P2-01,✗ 未采用 → P7-07 拥有)
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
**标准(绑定词汇)**:RFC 6962-style hash chain  · DSSE/in-toto statements for signed tree heads (P0-07 format) (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
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
**标准(绑定词汇)**:OCI image-spec Descriptor {mediaType, digest sha256:…, size, annotations} for ArtifactRef (首个采用者 P3-01,import 其定义) · OpenLineage Run/Job/Dataset + facets for lineage events  · W3C PROV vocabulary (首个采用者 P5-11,✗ 未采用 → P7-04/P6-03 拥有) · in-toto attestation for verification links (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
**自己写(residual)**:ArtifactRef schema (OCI Descriptor + tenant/producer/parents/retention/sensitivity/schema), lineage edges/DAG, signed access tokens, range reads over cacache streams, retention hooks to P6-07; keep attachment-local untouched.
**禁令/风险(risk)**:cacache is single-directory, no ACL, no ranges natively; per-tenant roots cost cross-tenant dedup; OpenLineage standardizes the event shape but the store is still dsh.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-research-report 41★ — Content-addressed evidence ledger, sealed versions — demand evidence
- dsh-science 33★ — Versioned artifacts with provenance
- dsh-popout-sidebar 197★ — Artifact listing UI
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

#### P6-10 · Privacy Classification、Redaction、Fork/Snapshot Lineage 与导出/擦除

`Privacy classification, redaction, fork lineage, export/erase` · L2_PROVIDER · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 15-25% · 状态 **NOT_RUN (W11)** · 上游已部分实现

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
**标准(绑定词汇)**:W3C DPV for purpose/personal-data categories (首个采用者 P6-02,✗ 未采用 → P6-10) · public/internal/confidential/restricted tiers (convention, no formal standard)
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

**用(adapt)**:
- **in-toto/attestation**(Apache-2.0 · 371★) — Statement v1 envelope
- **in-toto/in-toto**(Apache-2.0 · 1,036★) — Layout spec only (functionaries = VerifierIndependence, threshold = quorum); not the Python verifier or Link metadata
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0; or reuse scripts/first100/attest.ts canonicalJson — pick one **⟶ 裁决取代:§7.3/§7.8:import P2-03 的 canonicalizeArguments;attest.ts 的 canonicalJson 随 R1 收敛**
- **colinhacks/zod**(npm `zod` · MIT) — 4.4.3 in 38 pkgs; native toJSONSchema for TS↔Python codec contract
**标准(绑定词汇)**:in-toto Statement v1 + in-toto layout semantics (steps/inspections/functionaries/threshold) (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · JSON Schema 2020-12 via zod4 toJSONSchema (首个采用者 P0-06,import 其定义) · RFC 8785 JCS canonical hash (首个采用者 P2-03,import 其定义)
**自己写(residual)**:Claim/CheckSpec/EvidenceRequirement/AcceptanceRule/confidence policy types, freeze semantics inside RunPlan, PlanAmendment re-approval path, ledger events with schemaVersion.
**禁令/风险(risk)**:Predecessors P4-03/P4-04 (RunPlan) do not exist in the tree; freeze semantics have nowhere to attach yet.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- deepseek-harness-reliability-governor 2★ 覆盖≈40% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No RunPlan or PlanAmendment binding (P4-03/04 do not exist upstream); contract is opt-in per model tool call, so a Run can execute with no contract at all (docs/LIMITATIONS.md admits 'contra
- loopx (dsh-loopx-plugin) 5,424★ 覆盖≈10% — Python control plane keeping gate/evidence state outside dsh — not a contract in the ledger (<10%)
- Aegis 1,164★ 覆盖≈10% — Skill/prompt pack, not machine-checkable (<10%)
- odai-dsh-plugin 107★ 覆盖≈10% — 'Verified completion' = governance/routing bundle (<10%)
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §7.3 JCS 消费者:argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P7-02 · EvidenceCollector：内容寻址、可追溯、不可伪造的证据层

`EvidenceCollector: content-addressed, unforgeable` · L2_PROVIDER · **PROVIDER_ADAPT + CONTRACT_WRITE** · 可省 35% · 状态 **NOT_RUN (W12)**

**用(adapt)**:
- **npm/cacache**(npm `cacache` · ISC · 300★) — 21.0.1; SRI-addressed, atomic writes, verify() integrity sweep + GC, index — deletes store.ts and tamper-detection loop
- **npm/ssri**(npm `ssri` · ISC · 61★) — 14.0.0
- **in-toto/attestation**(371★) — ResourceDescriptor {name, uri, digest{sha256}, mediaType, downloadLocation, annotations}
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Signed-envelope format
**可选(optional,不进依赖不进 CI)**:
- multiformats/js-multiformats — 14.0.5 CID id format only
**不用(reject,理由)**:
- isomorphic-git/isomorphic-git — Git object store — heavier; fair alternative only if artifacts must be git-addressable
**标准(绑定词汇)**:in-toto ResourceDescriptor as EvidenceRef (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · DSSE envelope for sealed EvidenceEnvelope (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
**自己写(residual)**:Collection hooks at tool-completion / subagent-result / artifact-commit / approval boundaries, raw-vs-projection split with permission+token-budget filter, dedupe keyed by (hash, principal, time-context), retention policy, HTTP request/response summary capture, crash ordering (CAS commit before ledger ref).
**禁令/风险(risk)**:cacache stores in its own dir layout; if the storage chapter mandates storage-sqlite, cacache is a second store → fall back to a ~150-LOC CAS over node:sqlite blobs.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-research-report 42★ 覆盖≈25% — Content-addressed ledger objects/<sha256> + JSONL journals, sealed manifest hash, claim↔evidence binding, SARIF verifier CLI — a vertical with internal ledger; reference implementation
- oh-my-knowledge 18★ 覆盖≈20% [topic-sweep] — cordis-plugin·进程内·需 key/服务 \| 缺口：No EvidenceEnvelope vocabulary (producer/actionId/worldId/classification/freshness/retention), no collection at artifact-commit/external-observation/human-approval boundaries, no projection-
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份

#### P7-03 · Independent Verifier：与执行者隔离的验证 Provider Seam

`Independent Verifier provider seam` · L2_PROVIDER · **PROVIDER_WRITE + REUSE_UPSTREAM** · 可省 10% · 状态 **NOT_RUN (W13)**

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

**用(adapt)**:
- **in-toto/attestation (spec/predicates/scai.md)**(371★) — Attribute assertion + evidence + conditions — adopt names
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — 'No verified claim without evidence' property
**可选(optional,不进依赖不进 CI)**:
- graphology/graphology — 0.26.0 graph + traversal + cycle detection (~15%); a Map<claimId, edges> is fine if the graph stays small
**标准(绑定词汇)**:W3C PROV-DM relations (wasDerivedFrom, wasGeneratedBy, wasInvalidatedBy, wasAttributedTo) (首个采用者 P5-11,✗ 未采用 → P7-04/P6-03 拥有) · in-toto SCAI predicate (attributes + evidence + conditions) (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
**自己写(residual)**:Status lattice (proposed/verified/stale/conflicted/unverified), propagation on expiry/revocation/contradiction, verifier-only verified transition, projector from ledger, OutcomePackage rendering that never drops contradictions.
**禁令/风险(risk)**:graphology is optional; vertical scoring tables are out of scope (nonGoal).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- grove 22★ 覆盖≈25% [topic-sweep] — external-product-with-dsh-integration·非插件·无 key \| 缺口：No ContradictionEdge/conflicted state or automatic conflict propagation; no confidence, scope or freshness-by-evidence-type rules; not run-scoped; the agent itself sets B validated (no verif
- dsh-research-report 42★ 覆盖≈20% — Claim verdict lattice unverified/insufficient/disproven/contradicted, negative-knowledge disproofs.jsonl, falsification ledger — best in-ecosystem reference, vertical
- dsh-deepread 44★ — Claim-evidence-data reports — vertical
- graph-memory 591★ — Typed-node memory — not claims
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §7.2 R3:W3C PROV-DM 词汇(wasDerivedFrom/wasGeneratedBy/wasAttributedTo)由本 epic 首次对外使用;P5-11/P6-02 内部名保留 + 映射

#### P7-05 · AcceptanceGate 与 OutcomePackage：只有被证明的结果才能完成 Run

`AcceptanceGate + OutcomePackage (signed, content-addressed)` · L1_CONTRACT · **CONTRACT_WRITE** · 可省 20% · 状态 **NOT_RUN (W15)**

**用(adapt)**:
- **in-toto/attestation (vsa.md, test-result.md)**(371★) — verifier id, policy ref, verificationResult PASSED/FAILED, verifiedLevels, inputAttestations
- **secure-systems-lab/dsse**(Apache-2.0 · 110★) — Envelope
- **scripts/first100/attest.ts (existing)** — canonicalJson + ed25519 sign/verify + pinned identity — promote to a package
**可选(optional,不进依赖不进 CI)**:
- sigstore/sigstore-js — 5.x; keyless Fulcio/Rekor = hosted → optional only
- open-policy-agent/npm-opa-wasm — 1.10.0; AcceptanceRule engine only if the policy chapter standardizes on it
- cedar-policy/cedar — 4.12.0; same — decide once with P2/P3/P5
**标准(绑定词汇)**:SLSA Verification Summary Attestation (in-toto vsa.md) (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · in-toto Statement + DSSE envelope (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状) · RFC 8785 JCS (首个采用者 P2-03,import 其定义) · Ed25519 via node:crypto under Trust Kernel signatureRoots
**自己写(residual)**:Run-state machine (verifying/accepted/rejected/needs-human/compensating), OutcomePackage fields, hand-written pure gate truth table, ledger reconstruction, SDK contract change ('final assistant text ≠ success'); reuse evidence-format's accepted:true structural trick.
**禁令/风险(risk)**:Do NOT make sigstore keyless the default (needs Fulcio/Rekor network + OIDC); DSSE + local ed25519 satisfies keyless CI.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- deepseek-harness-reliability-governor 2★ 覆盖≈35% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No Run-level state machine (verifying/accepted/rejected/needs-human/compensating) — the turn still stops and the gate acts by steering a message, not by changing Run status; no OutcomePackag
- odai-dsh-plugin 107★ 覆盖≈0% — 'Verified completion' heuristic
- evidence-first 3★ 覆盖≈0% — Regex-detects 完成/成功 claims without a nearby tool/result — heuristic, not a gate
- dsh-nuke-plugin 覆盖≈0% — Hash-chain audit — unrelated
**裁决叠加(整改令)**:
- §3.4/R1 消费者:in-toto/DSSE 信封 import `packages/attestation/envelope`,不再声明一份
- §7.3 JCS 消费者:argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P7-06 · Bounded Repair/Replan Loop：验证失败后的有限修复与计划修订

`Bounded repair / replan loop` · L3_CONSUMER · **CONSUMER_WRITE + QUALIFICATION_REUSE** · 可省 5% · 状态 **NOT_RUN (W16)**

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
**标准(绑定词汇)**:OTel GenAI semantic conventions (gen_ai.agent.*, conversation.id, operation.name, request/response.*, usage.*, evaluation.*) (首个采用者 P2-01,✗ 未采用 → P7-07 拥有) · W3C Trace Context traceparent/tracestate  · OTLP/HTTP wire (首个采用者 P2-01,✗ 未采用 → P7-07 拥有)
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
- §7.2 R3:OTel enduser.id / gen_ai.* 由本 epic 拥有;P2-01 内部字段映射
- §9.2 生态迁移目标:4 个各接 OTel 或自签 HMAC 链——session-telemetry-otel 唯一 backend,插件只加 processor/exporter

#### P7-08 · Deterministic Replay、Simulation 与 Decision Diff

`Deterministic replay, simulation, decision diff` · L3_CONSUMER · **REUSE_UPSTREAM + PROVIDER_ADAPT** · 可省 50% · 状态 **NOT_RUN (W14)**

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
**标准(绑定词汇)**:RFC 6902 JSON Patch for DecisionDiff (首个采用者 P4-13,import 其定义)
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
**标准(绑定词汇)**:OpenFeature as the champion/challenger flag standard (only if the routing chapter also adopts it) (首个采用者 P0-05,import 其定义) · DSSE-signed EvolutionProposal (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
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

**用(adapt)**:
- **modelcontextprotocol/modelcontextprotocol**(NOASSERTION · 9,112★) — Spec only; initialize shape
- **erdtman/canonicalize**(npm `canonicalize` · Apache-2.0 · 61★) — 4.0.0; fingerprint = sha256(JCS(JSON Schema)); ~100 lines — inline the sort if the dependency bar is not met **⟶ 裁决取代:§7.2 R7:已验收,手排 fingerprint 记录不改;P8-07 若需 Python 复算再换**
- **npm/node-semver**(npm `semver` · ISC · 5,460★) — 7.8.5 range matching
- **colinhacks/zod**(npm `zod` · MIT) — 4.4.3 z.toJSONSchema from Typert zod (already dep of typert/registry)
- **paulmillr/noble-hashes**(npm `@noble/hashes` · MIT) — Present
**不用(reject,理由)**:
- microsoft/vscode-languageserver-node (vscode-jsonrpc) — 9.0.2 frames with LSP Content-Length not NDJSON, no Python twin — would break the hand-written Python client
- open-rpc/generator — Last push 2025-10-22 (stale)
**标准(绑定词汇)**:MCP initialize protocolVersion + capabilities shape (首个采用者 P2-03,import 其定义) · LSP ClientCapabilities pattern  · RFC 8785 JCS for schema fingerprints (首个采用者 P2-03,import 其定义)
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
**标准(绑定词汇)**:Kubernetes resource model (metadata.uid/resourceVersion/creationTimestamp, spec/status, list+watch, resourceVersion precondition) (**本 epic 首个采用者,定形状**) · Google AIP-158 page_token pagination  · Google AIP-160 filter grammar
**自己写(residual)**:5 resource projections (action/approval/artifact/verification/world) as @Remote Typert methods reading P4-01/P6-09/P7-05/P2-07 definitions, shared ResourceEnvelope (tenant, classification, revision, timestamps, provenance, allowedActions), opaque keyset cursor, filter parser, watch = existing mux stream, 100k/1M sqlite pagination test; upstream has session(~Run)+agent get/list with cursor+limit+authorized filtering.
**禁令/风险(risk)**:Any OpenAPI/tRPC/Connect/ts-rest adoption is a THIRD RPC seam beside stdio JSON-RPC and Typert Remote — violates 'not a settled seam'.
**planError**:Files list references packages/host/apiproxy/src/api-proxy.ts which no longer exists (removed 2026-08-10; session.export is now an exact Fetch route in session-log-export).
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- sandbase-harness 641★ 覆盖≈10% — Exposes manage agents/sessions, stream turns, inspect artifacts, cancel over stdio MCP — competing surface on a different runtime; no envelope/tenant/revision
**裁决叠加(整改令)**:
- §2.F planError 已解决,记录即可

#### P8-03 · 远程生命周期控制：Pause、Resume、Cancel、Fork、Retry、Reconcile、Close

`Remote lifecycle control (pause/resume/cancel/fork/retry/reconcile/close) w/ idempotency + version check` · L5_SURFACE · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 0% · 状态 **NOT_RUN (W17)** · 上游已部分实现

**用(adapt)**:
- **dubzzz/fast-check**(npm `fast-check` · MIT · 5,129★) — Property tests over the explicit Record<State, Record<Command, State\|never>> table
**不用(reject,理由)**:
- statelyai/xstate — 5.32.6; ~10 states × 7 commands table must be property-tested anyway; actor runtime adds a second lifecycle owner next to the Agent loop
- temporalio/temporal — Durable-execution engines replace the Agent loop itself
- restatedev/restate — Same
- dbos-inc/dbos-transact-ts — Same
**标准(绑定词汇)**:IETF draft-ietf-httpapi-idempotency-key-header semantics (首个采用者 P4-12,import 其定义) · AIP-151 long-running Operation {done, metadata, response, error}  · K8s resourceVersion precondition (首个采用者 P8-02,import 其定义)
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

**用(adapt)**:
- **@modelcontextprotocol/sdk**(npm `@modelcontextprotocol/sdk`) — 1.29.0 present; elicitation shape maps to clarification.request
- **agentclientprotocol/agent-client-protocol**(npm `@agentclientprotocol/sdk` · Apache-2.0 · 4,132★) — 1.3.0 present; request_permission maps to approval.request with options
- **node:crypto Ed25519** — Response signing bound to actionHash + expectedRevision (attest.ts pattern)
**标准(绑定词汇)**:MCP elicitation/create server→client request shape (首个采用者 P2-03,import 其定义) · ACP session/request_permission payload shape (首个采用者 P2-06,import 其定义) · CloudEvents-style id/source/subject on the request envelope (首个采用者 P4-01,✗ 未采用 → P8-05 拥有映射)
**自己写(residual)**:server-requests.ts envelope (requestId, runId, actionHash binding, deadline, eligible principals, scopes registration, expectedRevision), reconnection re-delivery of pending requests, late/duplicate response rejection, credential-consent request that never carries secrets; ~40% of scope lands in P2-07/09/12; wire already supports server→client requests both directions.
**禁令/风险(risk)**:Do not model this as MCP itself (dsh is not an MCP server to its own clients); borrow shapes so third-party MCP/ACP clients map 1:1.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-im-gateway 45★ 覆盖≈25% [topic-sweep] — cordis-plugin·进程内·无 key \| 缺口：No durable requestId, no action-hash binding (prompt shows only toolName + reason, never args/target), deadline is in-process only (120 s / 600 s), no eligible-principals or quorum, no signe
- dsh-bridge 138★ 覆盖≈15% — WeChat/QQ/Feishu/Telegram approval cards — external human-channel consumer; no durability/quorum/binding; should become a P2-12 human-channel provider

#### P8-05 · Resumable Event Streaming：Cursor、ACK、Replay、Dedupe 与 Backpressure

`Resumable event streaming (cursor/ack/replay/dedupe/backpressure)` · L5_SURFACE · **REUSE_UPSTREAM + CONTRACT_WRITE** · 可省 5-10% · 状态 **NOT_RUN (W17)** · 上游已部分实现

**用(adapt)**:
- **node:sqlite outbox (local default)** — (tenant, seq, eventId, resourceRevision, causationId, classification, payload) + consumer_cursor(tenant, clientId, lastAck); WAL configurable in storage-sqlite
**可选(optional,不进依赖不进 CI)**:
- cloudevents/sdk-javascript — 10.0.0 envelope validation/serialization — inline if its Node HTTP bindings drag deps
- nats-io/nats.js — 3.4.0 + nats-server 20,654★ Go daemon — optional provider, would delete ~40% of replay/ack/retention but only as non-default sink
- redis/ioredis — 6.0.0 Redis Streams — optional provider
**不用(reject,理由)**:
- tulios/kafkajs — Last push 2024-08-02 — stale
**标准(绑定词汇)**:CloudEvents 1.0 attributes id/source/type/time/subject + sequence extension (首个采用者 P4-01,✗ 未采用 → P8-05 拥有映射) · SSE Last-Event-ID semantics  · NATS JetStream durable-consumer ack model (ack pending, max_ack_pending, slow-consumer eviction)
**自己写(residual)**:event-stream.ts contract (eventId, resourceRevision, causationId, classification, lossy flag), per-tenant monotonic cursor over the sqlite outbox, client ACK persistence, replay from lastAck+1 with eventId dedupe, retention + cursor-expired → snapshot+delta, max in-flight + slow-consumer disconnect on the mux, chaos + 10M-event tests; upstream journal-stream.ts has snapshot-first open, resumeCursor, cursor algebra, repair, heartbeat.
**禁令/风险(risk)**:Keyless CI and local-default rules forbid a daemon as the default; JetStream/Redis only behind the same seam.
**社区(不采用;缺口 = 我们的必备项,形态 = 要接住的 hook,§9.2)**:
- dsh-remote-web-ui 6,717★ 覆盖≈0% — Proxies existing WS/SSE, relies on harness reconnect; no ack/replay
- dsh-pocket 900★ 覆盖≈0% — Same
- dsh-mobile 186★ 覆盖≈0% — Same
**裁决叠加(整改令)**:
- §7.2 R3:CloudEvents 属性名在本 epic 首次跨线;P4-01 内部字段(id/runId/seq/occurredAt)保留,本 epic 拥有映射层
- §6:REUSE_UPSTREAM 已按 gap-over-upstream 缩范围,开工时读 spec/first100/sources/base-align-v2/23-partial-rescope-spec.md 对应条目

#### P8-06 · Authenticated Principal、Tenant Boundary、RBAC/ABAC 与 API Scope

`Authenticated principal, tenant boundary, RBAC/ABAC, API scope` · L2_PROVIDER · **PROVIDER_ADAPT + REUSE_UPSTREAM** · 可省 30-40% · 状态 **NOT_RUN (W17)**

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
**标准(绑定词汇)**:SPIFFE ID format for ServiceAccount ids (首个采用者 P0-02,✗ 未采用 → P8-06 拥有) · OIDC/JWT
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
- §7.2 R3:SPIFFE ID 格式在本 epic 首次跨线,本 epic 拥有 PrincipalId/TenantId/ServiceAccount 的 SPIFFE 映射(P0-02/P2-01 内部 id 保留,单向映射 + 冻结用例)
- §9.2 生态迁移目标:≥7 套登录门各自 wrap http server——AuthProvider seam 在 http server 之前;负用例:provider 拿不到 core session secret(@xgone/dsh-remote 的 seam 违规)

#### P8-07 · Schema-Generated TS/Python SDK Parity 与 Contract Test Matrix

`Schema-generated TS/Python SDK parity + contract test matrix` · L5_SURFACE · **PROVIDER_ADAPT + QUALIFICATION_REUSE** · 可省 40% · 状态 **NOT_RUN (W18)** · 上游已部分实现

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
**标准(绑定词汇)**:JSON Schema 2020-12 as the versioned artifact (首个采用者 P0-06,import 其定义) · OpenRPC document format for methods
**自己写(residual)**:packages/sdk/codegen (~300 lines: walk Typert registry → control-protocol.json as OpenRPC methods + JSON Schema components; TS/Python method-client stubs), bidirectional golden fixtures + wire snapshots, error-code/retryability mapping table, CI git diff --exit-code on generated artifacts, N-1 fixture runs, wheel/exe smoke tests.
**禁令/风险(risk)**:Python method client wrapper stays hand-written (ergonomic wrapper only, per must[1]).
**裁决叠加(整改令)**:
- §7.2 R3:Confluent 兼容词汇 BACKWARD/FORWARD/FULL 在 SDK 导出处对齐;§7.8:TS/Python parity 矩阵必须含 depth-5000 argumentsHash 用例(Python JCS 库也递归,默认 recursion limit 1000)

#### P8-08 · Operator Control Plane API 与 Run/Agent/Workflow 可视化

`Operator control-plane API + Run/Agent/Workflow visualization` · L5_SURFACE · **CONSUMER_WRITE + PROVIDER_ADAPT** · 可省 25% · 状态 **NOT_RUN (W18)**

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
**标准(绑定词汇)**:OCSF as SIEM-facing audit event schema  · OTLP logs as optional transport (首个采用者 P2-01,✗ 未采用 → P7-07 拥有) · RFC 8785 JCS for hash-chain canonicalization (首个采用者 P2-03,import 其定义)
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
- §7.3 JCS 消费者:argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份

#### P8-10 · Config Provenance、Typed Dry-Run、迁移/回滚、ABI Compatibility 与 Disaster-Recovery Release Gate

`Config provenance, typed dry-run, migration/rollback, ABI compat, DR release gate` · L6_QUALIFICATION · **REUSE_UPSTREAM + QUALIFICATION_REUSE** · 可省 25% · 状态 **NOT_RUN (W19)** · 上游已部分实现

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
**标准(绑定词汇)**:SLSA/in-toto attestation (optional) (首个采用者 P0-01,✗ 未采用 → R1 slice 定形状)
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
add('P4-03 P4-04 P7-01 P7-05 P8-09', '§7.3 JCS 消费者:argumentsHash/plan id/contract hash 复用 P2-03 的 canonicalizer(差分 oracle 已证),不再写一份')
add('P1-03', '§7.2 R4:P1-01 `dshVersionRange` 只查是字符串(validate.ts:393)→ 本 epic 加 semver.validRange + 拒绝用例;R5:P1-02 的 SBOM(CycloneDX)与 lockfile 同源,在本 epic 建')
add('P1-12', '§7.2 R5:P1-02 未建的 SLSA provenance / 信任等级在本 epic 接(slsa-framework)')
add('P8-06', '§7.2 R3:SPIFFE ID 格式在本 epic 首次跨线,本 epic 拥有 PrincipalId/TenantId/ServiceAccount 的 SPIFFE 映射(P0-02/P2-01 内部 id 保留,单向映射 + 冻结用例)')
add('P8-05', '§7.2 R3:CloudEvents 属性名在本 epic 首次跨线;P4-01 内部字段(id/runId/seq/occurredAt)保留,本 epic 拥有映射层')
add('P7-04 P6-03', '§7.2 R3:W3C PROV-DM 词汇(wasDerivedFrom/wasGeneratedBy/wasAttributedTo)由本 epic 首次对外使用;P5-11/P6-02 内部名保留 + 映射')
add('P8-07', '§7.2 R3:Confluent 兼容词汇 BACKWARD/FORWARD/FULL 在 SDK 导出处对齐;§7.8:TS/Python parity 矩阵必须含 depth-5000 argumentsHash 用例(Python JCS 库也递归,默认 recursion limit 1000)')
add('P7-07', '§7.2 R3:OTel enduser.id / gen_ai.* 由本 epic 拥有;P2-01 内部字段映射')
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
add('P3-13', '§6:不在账本内(09-02 同日收录);开工时补单条 make-vs-use 判断,预期 CONSUMER_WRITE,依赖 §3.2 rung')

# ledger oss notes overridden by a ruling: (epic, oss name) -> what stands now
SUP = {
 ('P2-03','erdtman/canonicalize'): '§7.8:不换库、不删 canonicalize.ts;保留迭代实现(库全递归,depth 5000 溢出)、删 NFC;canonicalize@2.1.0 进 devDependencies 作差分 oracle',
 ('P2-06','erdtman/canonicalize'): '§7.3/§7.8:import P2-03 的 canonicalizeArguments,不接库',
 ('P4-03','erdtman/canonicalize'): '§7.3/§7.8:import P2-03 的 canonicalizeArguments,不接库',
 ('P4-04','erdtman/canonicalize'): '§7.3/§7.8:import P2-03 的 canonicalizeArguments,不接库',
 ('P7-01','erdtman/canonicalize'): '§7.3/§7.8:import P2-03 的 canonicalizeArguments;attest.ts 的 canonicalJson 随 R1 收敛',
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

# standards families (same map as §7.3)
FAM = [
 ('in-toto / DSSE / SLSA', r'in-toto|DSSE|SLSA'), ('RFC 8785 JCS', r'8785|JCS'), ('CloudEvents', r'CloudEvents'),
 ('SPIFFE', r'SPIFFE'), ('W3C PROV-DM', r'PROV'), ('OTel semconv', r'OTel|OTLP'), ('A2A', r'\bA2A\b'), ('MCP', r'\bMCP\b'),
 ('ACP', r'\bACP\b'), ('AuthZEN', r'AuthZEN'), ('OCI runtime/image-spec', r'\bOCI\b'), ('JSON Schema 2020-12', r'JSON Schema'),
 ('RFC 6902 JSON Patch', r'6902|JSON Patch'), ('semver', r'semver'), ('W3C DPV', r'DPV'), ('Sigstore bundle', r'Sigstore'),
 ('Idempotency-Key', r'Idempotency|idempotency-key'), ('K8s resource model', r'Kubernetes|K8s|resourceVersion'), ('OpenFeature', r'OpenFeature'),
]
order = {r['id']: i for i, r in enumerate(rows)}
first = {}
for name, pat in FAM:
    ids = sorted([r['id'] for r in rows if any(re.search(pat, s) for s in r['standards'])], key=lambda i: order[i])
    if ids: first[name] = ids[0]
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
w('  "verdict": "PROVIDER_ADAPT", "verdictSecondary": "PROVIDER_WRITE" | null,')
w('  "adopted": [ { "name": "cedar-policy/cedar",            // 账本 oss[].name 原文')
w('                 "npm": "@cedar-policy/cedar-wasm", "version": "4.12.0",')
w('                 "form": "runtime" | "oracle" | "optional" | "vendored",')
w('                 "reason": "为什么是这个形态(oracle 必须指向复现硬约束的冻结用例)" } ],')
w('  "rejectedAbsent": [ "@openfeature/server-sdk", "…" ],   // preFlight 时 = 账本 reject 条目里**有 npm 名的**名单(无 npm 名的不可核,不列);')
w('                                                          // 门 (b) 对这些名在 files[] 里核 0 import;结果写进 realized.rejectedAbsent(布尔),不在这里')
w('  "standardsOwned": [ "AuthZEN request/response vocabulary" ],           // 本 epic 是首个采用者的标准(§7.3);不是则 []')
w('  "standardsImported": [ { "standard": "RFC 8785 JCS", "from": "P2-03" } ],')
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
w('| 标准族 | 首个采用者 | 采用情况 | 全部采用者(registry 顺序) |')
w('|---|---|---|---|')
for name, pat in FAM:
    ids = sorted([r['id'] for r in rows if any(re.search(pat, s) for s in r['standards'])], key=lambda i: order[i])
    if not ids: continue
    fa = ids[0]; ad = ADOPTED.get((name, fa), '未开工')
    w(f'| {name} | {fa} | {ad} | {" ".join(ids)} |')
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
                fa = first.get(fams[0]); ad = ADOPTED.get((fams[0], fa), '')
                if fa == eid:
                    own = '(**本 epic 首个采用者,未采用 → 见裁决叠加**)' if ad.startswith('✗') else '(**本 epic 首个采用者,定形状**)'
                else:
                    own = f'(首个采用者 {fa}' + (f',{ad}' if ad.startswith('✗') else ',import 其定义') + ')'
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
