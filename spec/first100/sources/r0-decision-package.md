# R0 Decision Package — Synthesized from Three Read-Only Sub-Agent Extractions

**Status: First-100 = NO-GO; Second-100 = BLOCKED; PR #95 = DO NOT MERGE**

Date: 2026-08-24 · Source: three parallel read-only sub-agents (A/B/C) run per the governing directive's mid-turn authorization. No code was written, reset, or committed during extraction. All code writes remain serialized in the main session and remain gated on the start-gate preconditions.

## 1. What changed vs. the six-blocker review

The review (`r0-drafts-review.md`) established that all six hard blockers were **UNRESOLVED**. This package converts each blocker from "blocked on missing data" to "blocked only on the start-gate" — the per-item data needed to fix blockers 1 and 2 now exists with citations and hashes; the fail-closed rule set for blockers 3/4/5/6 is now enumerated against concrete `file:line` evidence.

| Blocker | Status after extraction | What unblocks it |
|---|---|---|
| 1. `primaryLayer` per-item | **DATA READY** — full 100-row mapping (§2) | Maintainer copies §2 mapping; repair test asserts exact layer per id, not enum membership |
| 2. acceptance/non-goals/owner + hash | **DATA READY** — verbatim text extracted, hashes pinned (§3) | Maintainer pastes verbatim text; binds each item to source SHA; replaces `epic-owner/PX-YY` with the 9 real owners + `UNASSIGNED_UNTIL_APPROVAL` for 91 |
| 3. Verifiable attestation | **DESIGN READY** — exploit path confirmed at `verify.ts:44-45` + `report.ts:16-22` (§4.1) | Implement keyring + detached signature; ACCEPTED only on verified attestation |
| 4. Fail-closed | **RULE LIST READY** — 23 findings, 5 fail-open classes (§4) | Apply the rejection rules in §5.2 |
| 5. Single canonical source | **DESIGN READY** — 4 files + 4 schema copies enumerated (§4.4) | Canonical `registry.json`; generate the rest; digest-verify |
| 6. R0.1/R0.4 slice split | **CONFIRMED** — C found the full slice content (§6) | Land R0.1 manifest/spec first; R0.4 runner/verifier on top |

## 2. Per-item `primaryLayer` (Agent A) — fixes Blocker 1

**Layer distribution after correction** (was 100× `L6_QUALIFICATION`):

| Layer | Count | Meaning |
|---|---|---|
| L0_KERNEL | 1 | P0-02 trust kernel |
| L1_CONTRACT | 17 | canonical schemas / Service Definitions / contracts |
| L2_PROVIDER | 62 | provider implementations |
| L3_CONSUMER | 5 | consumers / projection consumers |
| L4_COMPOSITION | 0 | none owned as primary |
| L5_SURFACE | 6 | CLI/UI/SDK/control-plane surface |
| L6_QUALIFICATION | 9 | gates, evidence/release/DR infra, qualification suite |

**Decision rules applied by Agent A** (from `02-target-architecture.md` + `implementation-wave-map.md` P=N/A reasons + `architecture-audit.md` §5/§6):
- Owns a canonical `spec/*` file → L1, EXCEPT P8-10 (dominant deliverable is the release/DR gate → L6) and P0-07 (dominant is the evidence gate → L6).
- `P=N/A` reasons decide: "kernel"→L0; "qualification/harness/static gate"→L6; "canonical type/codec, no provider"→L1; "derived from effects / state persisted by another"→L3; "UI is a consumer"→L5.
- Per audit §4.6/§4.7: product-side evidence chain (P7-02 collector, P7-03 verifier, P7-04 claim-graph) → **L2**; release/qualification side (P0-07, P7-09, P7-10, P8-10) → **L6**. This is exactly the seam the draft collapsed.

### Full mapping (100 rows)

| id | primaryLayer | rationale | source |
|---|---|---|---|
| P0-01 | L6_QUALIFICATION | reproducible baseline fingerprint + release preflight/verify + drift gate | wave-map:105; matrix:36 |
| P0-02 | L0_KERNEL | minimal immutable Trust Kernel, deliberately not replaceable | wave-map:111; matrix:50; audit§5:383 |
| P0-03 | L6_QUALIFICATION | capability-seam architecture checker (static qualification rule) | wave-map:118; matrix:64 |
| P0-04 | L6_QUALIFICATION | layer dependency / cycle static gate | wave-map:128; matrix:78 |
| P0-05 | L2_PROVIDER | shadow/enforce feature-gate canonical service/provider | wave-map:119; matrix:92; audit§5:387 |
| P0-06 | L1_CONTRACT | canonical Schema Registry (schemaId/major-minor/compat/migration) | wave-map:112; matrix:106; audit§5:417 |
| P0-07 | L6_QUALIFICATION | non-forgeable Release Evidence Package gate | wave-map:120; matrix:120 |
| P0-08 | L6_QUALIFICATION | capability benchmark framework (qualification harness) | wave-map:129; matrix:134 |
| P1-01 | L1_CONTRACT | Plugin Manifest v2 → owns `spec/capability-manifest.schema.json` | wave-map:121; matrix:153; audit§5:397 |
| P1-02 | L2_PROVIDER | plugin signature/provenance/SBOM verifier provider | wave-map:130; matrix:167; audit§5:400 |
| P1-03 | L2_PROVIDER | reproducible plugin lock (candidate-lock durable provider) | wave-map:144; matrix:181; audit§5:396 |
| P1-04 | L2_PROVIDER | isolated transactional plugin installer | wave-map:176; matrix:195; audit§5:395 |
| P1-05 | L2_PROVIDER | plugin static/dynamic scanner provider | wave-map:195; matrix:209; audit§5:401 |
| P1-06 | L2_PROVIDER | out-of-process plugin host (child process, authenticated RPC) | wave-map:177; matrix:223; audit§5:394 |
| P1-07 | L2_PROVIDER | workspace Trust Definition + durable provider | wave-map:131; matrix:237; audit§5:426 |
| P1-08 | L2_PROVIDER | deterministic plugin compat/ABI/schema solver provider | wave-map:132; matrix:251; audit§5:392 |
| P1-09 | L3_CONSUMER | registration ownership/collision enforced in host-runner consumers | wave-map:133; matrix:265; audit§5:399 |
| P1-10 | L2_PROVIDER | transactional plugin migration/upgrade/rollback provider | wave-map:178; matrix:279; audit§5:398 |
| P1-11 | L2_PROVIDER | governed Extension Proposal pipeline/provider | wave-map:211; matrix:293; audit§5:377 |
| P1-12 | L6_QUALIFICATION | official Plugin Verifier / trust-level certification gate | wave-map:212; matrix:307; audit§5:391 |
| P2-01 | L1_CONTRACT | Principal/tenant/actor identity context: `Identity` Service Definition | wave-map:122; matrix:326; audit§5:379 |
| P2-02 | L2_PROVIDER | attenuating capability tokens (Token Definition/provider, kernel-signed) | wave-map:134; matrix:340; audit§5:402 |
| P2-03 | L1_CONTRACT | canonical ActionManifest → owns `spec/action-manifest.schema.json` | wave-map:135; matrix:354; audit§5:340 |
| P2-04 | L2_PROVIDER | action risk taxonomy classifier service/provider | wave-map:145; matrix:368; audit§5:405 |
| P2-05 | L2_PROVIDER | monotonic Policy Decision Service | wave-map:155; matrix:382; audit§5:431 |
| P2-06 | L2_PROVIDER | approval bound to exact ActionManifest digest/precondition | wave-map:163; matrix:396 |
| P2-07 | L2_PROVIDER | durable Approval Queue (sqlite, CAS) | wave-map:179; matrix:410; audit§5:381 |
| P2-08 | L2_PROVIDER | durable scoped grants/revocation (Policy durable provider) | wave-map:196; matrix:424; audit§5:403 |
| P2-09 | L2_PROVIDER | quorum/separation-of-duties durable provider | wave-map:197; matrix:438; audit§5:380 |
| P2-10 | L2_PROVIDER | policy-as-code compiler/provider | wave-map:164; matrix:452; audit§5:404 |
| P2-11 | L2_PROVIDER | complete permission Policy Profile compiler/provider | wave-map:198; matrix:466 |
| P2-12 | L2_PROVIDER | durable HumanControl / emergency epoch provider | wave-map:165; matrix:480; audit§5:382 |
| P3-01 | L1_CONTRACT | ExecutionWorld Capability Seam: `ExecutionWorld` Service Definition | wave-map:166; matrix:499; audit§5:373 |
| P3-02 | L2_PROVIDER | full-dimensional sandbox policy vocabulary + enforcement adapter | wave-map:180; matrix:513 |
| P3-03 | L1_CONTRACT | structured OOB denial / typed outcome (canonical types) | wave-map:181; matrix:527 |
| P3-04 | L2_PROVIDER | egress proxy / destination enforcement provider | wave-map:199; matrix:541; audit§5:370 |
| P3-05 | L2_PROVIDER | process/syscall/IPC/device isolation — real OS providers | wave-map:200; matrix:555; audit§5:374 |
| P3-06 | L2_PROVIDER | Secrets Broker (Definition + KMS/reference broker provider) | wave-map:182; matrix:569; audit§5:361 |
| P3-07 | L2_PROVIDER | local sandbox fail-closed capability probe provider | wave-map:213; matrix:583 |
| P3-08 | L2_PROVIDER | Container ExecutionWorld provider (real OCI) | wave-map:214; matrix:597; audit§5:371 |
| P3-09 | L2_PROVIDER | Remote ExecutionWorld / attestation provider | wave-map:183; matrix:611; audit§5:372 |
| P3-10 | L2_PROVIDER | resource budgets/accounting (admission/runtime provider) | wave-map:184; matrix:625; audit§5:375 |
| P3-11 | L2_PROVIDER | ExecutionWorld snapshot/restore provider | wave-map:225; matrix:639; audit§5:376 |
| P3-12 | L2_PROVIDER | path/attachment hostile admission provider | wave-map:185; matrix:653; audit§5:353 |
| P4-01 | L2_PROVIDER | canonical durable Run service/journal | wave-map:136; matrix:672; audit§5:412 |
| P4-02 | L1_CONTRACT | versioned TaskProfile → owns `spec/task-profile.schema.json` | wave-map:156; matrix:686; audit§5:414 |
| P4-03 | L1_CONTRACT | executable RunPlan → owns `spec/run-plan.schema.json` | wave-map:186; matrix:700; audit§5:411 |
| P4-04 | L1_CONTRACT | signed frozen RunPlan / amendment protocol | wave-map:201; matrix:714 |
| P4-05 | L3_CONSUMER | agent lifecycle projection (state persisted by P4-01) | wave-map:146; matrix:728 |
| P4-06 | L2_PROVIDER | durable message bus / effective-once handoff provider | wave-map:147; matrix:742; audit§5:410 |
| P4-07 | L2_PROVIDER | leases/heartbeat/fencing durable provider | wave-map:157; matrix:756; audit§5:432 |
| P4-08 | L2_PROVIDER | workflow journal / step resume durable provider | wave-map:167; matrix:770; audit§5:424 |
| P4-09 | L2_PROVIDER | detached/saved/versioned/nested workflow registry provider | wave-map:187; matrix:784; audit§5:425 |
| P4-10 | L2_PROVIDER | scheduler/backpressure/fairness/locks provider | wave-map:202; matrix:798; audit§5:413 |
| P4-11 | L2_PROVIDER | retry/circuit/retry-budget provider | wave-map:188; matrix:812; audit§5:406 |
| P4-12 | L2_PROVIDER | durable Action Ledger / idempotency provider | wave-map:168; matrix:826; audit§5:339 |
| P4-13 | L3_CONSUMER | reconciliation/saga compensation (audit/action consumer) | wave-map:246; matrix:840; audit§5:341-342 |
| P4-14 | L2_PROVIDER | partial-turn resume + durable Trigger provider | wave-map:254; matrix:854; audit§5:415-416 |
| P5-01 | L2_PROVIDER | Strategy Router provider | wave-map:203; matrix:873; audit§5:409 |
| P5-02 | L2_PROVIDER | outcome-aware Model Router provider | wave-map:215; matrix:887; audit§5:407 |
| P5-03 | L2_PROVIDER | PromptIR / provider-specific prompt compiler provider | wave-map:226; matrix:901; audit§5:384 |
| P5-04 | L2_PROVIDER | provider fallback/hedging/rate-limit provider | wave-map:227; matrix:915; audit§5:408 |
| P5-05 | L1_CONTRACT | structured SubagentRequest (canonical type, no provider) | wave-map:204; matrix:929 |
| P5-06 | L1_CONTRACT | structured SubagentResult (result contract only) | wave-map:228; matrix:943 |
| P5-07 | L2_PROVIDER | native Codex adapter (Subagent Provider) | wave-map:237; matrix:957; audit§5:423 |
| P5-08 | L2_PROVIDER | native Claude Code adapter (Subagent Provider) | wave-map:238; matrix:971; audit§5:422 |
| P5-09 | L2_PROVIDER | native ACP provider (Subagent Provider) | wave-map:285; matrix:985; audit§5:421 |
| P5-10 | L2_PROVIDER | continuation/steer/cancel convergence provider | wave-map:169; matrix:999 |
| P5-11 | L2_PROVIDER | Taskboard/mailbox/blackboard durable provider | wave-map:170; matrix:1013; audit§5:356 |
| P5-12 | L2_PROVIDER | real git worktree provider + coordination guard | wave-map:216; matrix:1027; audit§5:355,427 |
| P6-01 | L1_CONTRACT | provider-neutral Memory Service Definition | wave-map:137; matrix:1046; audit§5:386 |
| P6-02 | L1_CONTRACT | canonical MemoryRecord (record/codec only) | wave-map:148; matrix:1060 |
| P6-03 | L2_PROVIDER | memory proposal/verify/merge/forget/export provider | wave-map:189; matrix:1074; audit§5:385 |
| P6-04 | L2_PROVIDER | Context Graph + Retrieval Planner providers | wave-map:229; matrix:1088; audit§5:357,360 |
| P6-05 | L2_PROVIDER | per-agent context topology + telemetry contract provider | wave-map:239; matrix:1102; audit§5:359 |
| P6-06 | L2_PROVIDER | compaction fidelity/provenance/tool-pairing provider | wave-map:230; matrix:1116 |
| P6-07 | L2_PROVIDER | session lifecycle/repair durable provider | wave-map:138; matrix:1130; audit§5:419 |
| P6-08 | L2_PROVIDER | encryption, tenant keyring, tamper-evident audit, residency | wave-map:205; matrix:1144; audit§5:354,362,420 |
| P6-09 | L1_CONTRACT | provider-neutral ArtifactRef + Artifact Service Definition | wave-map:217; matrix:1158; audit§5:343-344 |
| P6-10 | L2_PROVIDER | privacy classification/redaction/fork-snapshot lineage | wave-map:231; matrix:1172 |
| P7-01 | L1_CONTRACT | frozen VerificationContract → owns `spec/verification-contract.schema.json` | wave-map:218; matrix:1191; audit§5:351 |
| P7-02 | L2_PROVIDER | raw EvidenceCollector/store (product-side `RuntimeEvidenceService`) | wave-map:240; matrix:1205; audit§5:348 |
| P7-03 | L2_PROVIDER | Independent Verifier provider (`RuntimeVerifierProvider`) | wave-map:247; matrix:1219; audit§5:352 |
| P7-04 | L2_PROVIDER | persistent ClaimGraph provider | wave-map:255; matrix:1233; audit§5:346 |
| P7-05 | L1_CONTRACT | AcceptanceGate + OutcomePackage → owns `spec/outcome-package.schema.json` | wave-map:262; matrix:1247; audit§5:345,349 |
| P7-06 | L3_CONSUMER | bounded repair/replan loop (verifier outcome consumer) | wave-map:268; matrix:1261; audit§5:350 |
| P7-07 | L2_PROVIDER | causal trace + durable telemetry outbox provider | wave-map:248; matrix:1275; audit§5:388-390 |
| P7-08 | L3_CONSUMER | deterministic replay/decision diff (session/eval consumer) | wave-map:256; matrix:1289; audit§5:368 |
| P7-09 | L6_QUALIFICATION | 15-world general-purpose qualification suite | wave-map:269; matrix:1303 |
| P7-10 | L6_QUALIFICATION | evaluation/chaos/security/scale gates + champion–challenger + promotion | wave-map:276; matrix:1317; audit§5:363-367 |
| P8-01 | L1_CONTRACT | protocol negotiation/capability discovery → owns `spec/control-protocol.schema.json` | wave-map:149; matrix:1336 |
| P8-02 | L5_SURFACE | authorized remote resources control-plane API | wave-map:270; matrix:1350 |
| P8-03 | L5_SURFACE | remote lifecycle commands control-plane surface | wave-map:277; matrix:1364 |
| P8-04 | L5_SURFACE | bidirectional server→client requests / human adapter | wave-map:219; matrix:1378 |
| P8-05 | L5_SURFACE | resumable event streaming surface | wave-map:278; matrix:1392 |
| P8-06 | L2_PROVIDER | server-authenticated tenant/API scope providers | wave-map:279; matrix:1406; audit§5:378 |
| P8-07 | L5_SURFACE | schema-generated TS/Python SDK parity + contract test matrix | wave-map:286; matrix:1420; audit§5:418 |
| P8-08 | L5_SURFACE | operator control-plane UI | wave-map:287; matrix:1434 |
| P8-09 | L2_PROVIDER | org governance: policy hierarchy, quota, retention, audit-export | wave-map:288; matrix:1448 |
| P8-10 | L6_QUALIFICATION | config/ABI/DR release gate + `pnpm general-purpose-gate` + DR drill | wave-map:294; matrix:1462 |

### Layer adjudication list (34 ids Agent A flagged as genuinely ambiguous)

These must be adjudicated (ideally via ADR, per `02-target-architecture.md:194-206`) **before** the manifest is re-signed — not silently defaulted:

`P0-05, P0-06, P1-05, P1-09, P1-10, P1-11, P1-12, P2-02, P2-05, P2-10, P2-11, P3-01, P3-02, P3-10, P3-12, P4-01, P4-13, P4-14, P5-10, P5-12, P6-01, P6-03, P6-07, P6-09, P7-05, P7-06, P7-08, P7-10, P8-04, P8-05, P8-07, P8-10` (32 ids listed above + 2 more where Agent A table chose one but listed an alternative; the UNCERTAINTIES table in the agent transcript has the full candidate lists per id).

The dominant conflict is **wave-map (implementation plan, authoritative for what the issue builds) vs architecture-audit §5 (target role)** for ~8 issues (P1-09, P1-10, P1-12, P2-09, P3-12, P4-13, P6-07, P7-06), plus the **L1-vs-L6 "gate" seam** (P7-05, P8-10) and the **L1-vs-L2 Definition-vs-provider seam** (P0-06, P3-01, P4-01, P6-01, P6-09).

## 3. Verbatim acceptance / non-goals / owner + hashes (Agent B) — fixes Blocker 2

### Pinned source hashes (sha256)

| Source file | sha256 | size |
|---|---|---|
| `first100-requirements-matrix.md` | `401a3c63b7639b2df0f6ef81349df28667313deaa2d4f8e777d8f7eb531ce4fa` | 1481 lines |
| `sdd-coding-plan.md` | `5d659f84ed50a68abfe36b323cc9bed9d6a0694825328bf6c995d7bd4b37513b` | 446 lines |
| `implementation-wave-map.md` | `491b3484896e6a140104f934b3131523c138118de70b82e5d8245d68c6077a97` | 302 lines |
| `deepseek-harness-optimization-manifest-v1.yaml` | `eff0a6fbf7cae69d9e5eedce677dd7a474725ea77eec9c3c8cbc5c5fd590b72f` | 518930 B (in `~/Downloads/`) |
| `deepseek-harness-general-purpose-optimization-v1.md` | `1e6fb98b557fed2ec94cc08e8a7e9e2ac8fafc3b32e3b16d58d6ca10a73cc8bf` | 628448 B (in `~/Downloads/`) |
| `deepseek-harness-master-execution-prompt-v1.md` | `0d8eb428d5760694bd1b3cce421b276306824fa04fda5fba926ae796de29ecfd` | 9574 B (in `~/Downloads/`) |
| `deepseek-harness-artifact-manifest-v1.json` | `d7ea4860379f0896a4b95d5cf46cf4be907ab969221bb87b2ebb4078191d0c24` | 783 B (in `~/Downloads/`) |

### The 9 real spec owners (triple-confirmed: sdd-coding-plan §2.1, wave-map §2.1, registry `specOwners`)

| Issue (owner id) | Spec file |
|---|---|
| P0-02.C | `spec/trust-kernel.md` |
| P1-01.C | `spec/capability-manifest.schema.json` |
| P2-03.C | `spec/action-manifest.schema.json` |
| P4-02.C | `spec/task-profile.schema.json` |
| P4-03.C | `spec/run-plan.schema.json` |
| P7-01.C | `spec/verification-contract.schema.json` |
| P7-05.C | `spec/outcome-package.schema.json` |
| P8-01.C | `spec/control-protocol.schema.json` |
| P8-10.C | `spec/release-gates.yaml` |

**All 91 other issues are `UNASSIGNED`.** The draft's `epic-owner/PX-YY` strings are placeholders, not assignments. R0.1 must replace them with either a real assignee or an explicit `UNASSIGNED_UNTIL_APPROVAL` state — and the owner-uniqueness check in `registry.ts:92` must stop treating placeholder strings as real owners.

### Verbatim text status

- All 100 items now have **verbatim `acceptance`** copied from the matrix row's Acceptance section (clauses split at `；`), and **verbatim `nonGoals`** from the matrix's non-goal line — replacing both `["matrix-row:PX-YY"]` and the identical 2-line boilerplate. Full extraction lives in Agent B's transcript; pasting it into the canonical registry is a serialized main-session write.
- Representative verbatim anchors (for reference): P0-02 kernel boundary "任意插件卸载、覆盖 service 或动态 mount 都不能替换 kernel policy/audit/signature verifier"; P4-12 "10,000 次随机 crash campaign 中 duplicate external effect 为 0"; P7-01 "任何进入 executing 状态的 Run 都有不可变 VerificationContract；缺失时 fail closed".
- Cross-issue file-contract conflicts already patched in the registry `corrections` block are **confirmed correct** and must be kept: P6-09.owner (provider-neutral ArtifactRef), P6-03/P8-04.predecessors → P2-12, P3-04.predecessors → P1-06.

### Agent B uncertainties requiring a maintainer decision (do NOT guess)

1. **Canonical v1.0 files live in `~/Downloads/`, not the repo** — the four reference hashes match files there, not under the repo/search dirs. Decide whether `sourceAuthority` references the Downloads path or the canonical files are copied into the repo first.
2. **Artifact-manifest naming**: the canonical file matching `d7ea4860…` is `deepseek-harness-artifact-manifest-v1.json` (JSON, not YAML). Confirm it is the intended canonical.
3. **Acceptance binding target**: agent bound acceptance to the matrix (which self-describes as "保留 YAML 的全部实质条款，仅压缩标点"). If raw v1.0 YAML clause binding is required, per-issue extraction from the 518 KB YAML was NOT performed.
4. **Unquantified thresholds inside verbatim text** must stay verbatim, not resolved by guessing: P1-06 p95, P2-08 revocation, P3-10 measurement error, P4-07 clock skew, P5-07 cancellation, P5-12 deadlock, P7-09 ≥99% (v1.1 rules 300/300), P8-02/P8-05/P8-08 budgets, P8-10 RPO/RTO.

## 4. Adversarial findings (Agent C) — fixes Blockers 3/4/5

### 4.1 Confirmed fail-open at the trust root (blockers 3, 5)

- `verify.ts:44-45`: any non-empty `signature` string → `ACCEPTED` + `signed:true`. **No `crypto.verify` anywhere in the package** (grep: zero hits). No key, no payload, no verifier identity.
- `report.ts:16-22`: `status:"ACCEPTED"` produced from a plain, unauthenticated `verdicts.json`. The `--commit` argument is **parsed by nobody** (`report.ts` has no `parseArgs`). A committed or hand-written `verdicts.json` from any commit passes. report.ts does not re-read observations at all.
- **Combined exploit**: hand-write 100 observations + `verdicts.json` (or just `verdicts.json`) → `pnpm first100:report` prints ACCEPTED, exit 0.
- The draft only *appears* fail-closed today because every fixture is missing and every run dies on dirty-tree/exit 1. **The moment one fixture exists and a non-empty signature string is written, the full chain emits ACCEPTED.**

### 4.2 Required-but-unknown values accepted (blocker 4)

| Finding | file:line | Current behavior |
|---|---|---|
| baselineSha "unknown" accepted; frozen baseline referenced nowhere | `verify.ts:33-35`; `issue-runner.ts:101` | `git merge-base` failure → `"unknown"` → passes; constant `b150a551…` absent from code |
| testCounts fabricated string passes; only literal `"unknown"` rejected; never parsed from log | `verify.ts:43`; `issue-runner.ts:111` | any string ≠ "unknown" passes |
| skipReason never rejected; runner injects it on every green run | `issue-runner.ts:112`; verify.ts (no check) | `skipReason:"independent verifier required"` on exit-0 — self-contradictory with any reject-skip rule |
| worldState "unobserved" accepted | `issue-runner.ts:113-114`; `verify.ts:33` | presence-only check |
| exitSemantics never read | registry all-issues; `verify.ts:38` | only `exitCode==="0"` checked |
| fixture existence never validated | `registry.ts:88`; registry 400 commands | all 400 commands target `tests/first100/fixtures/PX-YY.*.spec.ts` which does not exist |

### 4.3 Evidence authenticity / binding (blockers 3, 4)

- `rawLogPath` attacker-chosen (no confinement to `.artifacts`, no `isAbsolute`/`realpath`); empty raw log (`sha256('')`) passes — `verify.ts:39-41`.
- All 13 checked fields come from one untrusted JSON; no runner/process/world binding — `verify.ts:33,42`.
- Observation not lane-bound: `${id}.json` overwrites across lanes, last-lane-wins; `verify.ts` checks only one lane — `issue-runner.ts:94-95`.
- `issue.status` (`NOT_RUN` ×100) never consulted; dual status truth vs `verdicts.json` with no reconciliation — `registry.ts:22`, `report.ts`.
- `runnerVerdict` written, never read — `issue-runner.ts:116`. "Independent verifier" = same scripts package, same process tree.

### 4.4 Manifest / validation vacuity (blockers 1, 2, 5)

- `primaryLayer` check runs against the owner-map **copy**, not the registry field; L6 in allowed-set ⇒ vacuous pass — `first100-spec-repair-tests.ts:36-40`.
- **Four** hand-maintained 100-issue files (manifest, registry, dependency-graph, owner-map) + **four** evidence-schema copies (registry field, manifest field, `verify.ts` hardcoded list, `spec/first100-evidence.schema.json`), none generated deterministically, none digest-pinned. Schema file is never imported (grep: zero refs).
- acceptance is a pointer; `acceptanceSource` points at a file absent from the worktree and never hash-checked.

### 4.5 Test / CI (blockers 3, 4, 6)

- `first100.spec.ts:54` uses `signature:"untrusted"` as its **valid** baseline → the test **encodes** the false-green; it never asserts clean+forged-signature is rejected (it would be ACCEPTED).
- No CI workflow invokes any first100 script; `first100:qualify:q1/q2/q3` don't exist in package.json.

### 4.6 Credits (survives adversarial review)

- `spawn` without a shell makes `;|&&` rejection redundant but the code is injection-safe regardless (`issue-runner.ts:20-26`).
- `vitest.config.ts:90-93` `include` globs currently make any fixture run exit 1 — fail-closed **by accident** (a future `passWithNoTests:true` flips it false-green; Agent C flags this as uncertainty #1).

## 5. Decision: concrete R0.1 / R0.4 rework

### 5.1 R0.1 (manifest/spec) — content determined

1. **Single canonical source** `tests/first100/registry.json`; deterministically generate `…manifest-v1.1.yaml`, `first100-owner-map.json`, `first100-dependency-graph.json`, and the evidence schema from it; commit a digest + regeneration check so manual dual-maintenance is structurally impossible (fixes blocker 5). Delete/convert the byte-identical duplicate (`tests/first100/registry.yaml` vs `spec/…manifest-v1.1.yaml`).
2. **`primaryLayer` per item** from §2 table; repair test asserts exact per-id layer (not enum membership) (fixes blocker 1). The 34 ambiguous ids go through ADR before re-sign.
3. **Verbatim `acceptance` + `nonGoals`** from Agent B extraction; `acceptanceSource` = source path + **sha256** (`401a3c63…` for the matrix); keep the 4 registry `corrections` (fixes blocker 2).
4. **Owners**: the 9 real spec owners; all others `UNASSIGNED_UNTIL_APPROVAL`. The uniqueness check must reject placeholder `epic-owner/*` strings.
5. **Schema**: add required `lane`, `id`, `signature`, `rawLogPath`; freeze `baselineSha` to `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`; `verify.ts` must consume the schema, not a separate hardcoded list. Reconcile `formatVersion` vs `evidenceSchema.version` drift.
6. **Fixture registration**: only commands whose fixture paths exist; validation error on missing fixture.
7. R0.1 lands with **no** runner/verifier changes and **no** runner-related package.json scripts.

### 5.2 R0.4 (runner/verifier) — rule set determined

1. **Verifiable attestation**: real keyring + detached signature over a canonical serialization of all evidence fields, verified against a pinned trusted verifier identity. ACCEPTED only on verified attestation; never on non-empty string. `report.ts` must re-derive verdicts by re-running `verifyObservation` over raw observations + frozen SHA, and sign `verdicts.json` (fixes blocker 3; kills F1/F2/F18/F23).
2. **Fail-closed value checks**: `baselineSha` === frozen baseline (reject `"unknown"`); `testCounts` parsed from the raw log (require parse success + count>0); reject non-empty `skipReason` (and stop injecting it on success); reject `worldStateBefore/After: "unobserved"`; enforce per-issue `exitSemantics` (fixes blocker 4; kills F3/F4/F5/F6/F8).
3. **Observation integrity**: one file per `(issue, lane)` as `${id}.${lane}.json`; `lane` required and must equal filename lane; require all 4 lanes present; assert `observation.id === issue.id`; confine `rawLogPath` to `.artifacts/first100/observations/` and require non-zero size; remove the `--commit` override or validate it against the frozen baseline only (kills F7/F10/F19/F20).
4. **Tests**: extend `first100.spec.ts` negatives — forged sig, unknown baseline, fabricated counts, skipReason set, missing lane, "unobserved" world, path-traversal rawLogPath, empty raw log, missing fixture; replace the bug-encoding `signature:"untrusted"` baseline (kills F16). Fix the status enum to include `REJECTED`/`BLOCKED` and reconcile `issue.status` with verdicts (kills F17).
5. **Ordering**: R0.1 lands first; R0.4 builds on the canonical registry only (fixes blocker 6).

## 6. Gate status (unchanged, honest)

Start-gate preconditions, re-verified as of the last check before extraction: (1) old processes stopped — **FAIL** (codex PIDs 22536/63144/79955, playwright-mcp 43971/44127/59131/59189, `node -e` 57405/85871, vitest fork 142 observed running); (2) target worktree clean — **FAIL** (`M package.json` + untracked `scripts/first100/`, `spec/`, `tests/`, `.agents/notes/proposed/process/`); (3) HEAD `b150a551…` — **PASS**.

Per the governing directive's fail-closed rule ("任一不满足，只报告并停止"), **no R0.1/R0.4 code was written during this extraction.** The decision package above is ready for the maintainer: fix the two failing preconditions (stop old processes; resolve the dirty-tree question — the uncommitted drafts are themselves the input R0.1/R0.4 will replace), and the serialized main-session implementation can proceed slice-by-slice with focused negative tests.

**First-100 = NO-GO; Second-100 = BLOCKED; PR #95 = DO NOT MERGE**
