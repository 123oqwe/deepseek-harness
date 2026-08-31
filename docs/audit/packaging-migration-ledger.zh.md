# First-100 Packaging Migration Ledger (R0.3B)

[English](packaging-migration-ledger.md) | 中文

Status: OPEN — active planning ledger; updated as waves land
Clean base: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (frozen baseline, master tip)
Recovery branch: `codex/first100-recovery` — carries only governance/planning artifacts (39 files), **no product code**
Last updated: 2026-08-27

## 1. Clean-base declaration

First-100 合并回退的干净基数是冻结基线 `b150a551b8`。R0.3A 证明了原生
install/build/pack 为绿，且打包闭合健全；全套件 `pnpm test` 退出 0 仍需
安静机器或 CI 的确认，R0 exit gate 第 1 项才关闭
（见 `docs/audit/baseline-b150a551.md`）。干净基线中没有预创建任何 First-100
特性，下面也没有任何 PR95 pack/运行时闭合故障在它的 owner wave 之前被移植。
recovery 分支只持有 registry / wave-map / spec-source / R0-runner 工件；那些是
规划，不是产品。

## 2. Merge-back rule

- 每个 wave 集成 PR 把该 wave 的 epic 一并并入干净基线，并且每个 wave 只提升一次
  DSH release-family 版本号。
- 首次进入 shipping 组成的包，必须在其所在 micro-PR 内通过 tarball pack/install +
  运行时闭合 smoke（`pnpm run release:pack -- --family dsh` + `pnpm run
  release:verify-packed-install`），绝不推迟到 R10。
- PR95 专属故障在它的 owner wave 上修复，并通过该 wave 的 PR 合并回退；它们
  **不**被预应用到干净基线。

## 3. PR95-known pack/runtime-closure fault register

每一行都是 REGISTERED（未移植）：owner wave 必须在其自己的集成 PR 上添加正确的
export，或者当契约不需要任何 remote entry 时删除错误的 import。指派按实际 consumer
进行；在 owner wave 实现期间重新解析具体 consumer。

| # | PR95 fault class | Concrete package(s) | Owning epic / wave | Action | Status |
|---|---|---|---|---|---|
| 1 | `/remote` export — commands | `packages/interaction/commands` | P8-02 Remote Resources (W16) | 在 consumer wave 添加 remote `commands` export；契约不需要时删除错误 import | REGISTERED — not ported |
| 2 | `/remote` export — goal | plan/goal surface (`P4-03`/`P4-04` RunPlan) | P4-14 Durable Schedule / Goal Trigger (W14) | 在 consumer wave 添加 remote goal export；不需要时删除错误 import | REGISTERED — not ported |
| 3 | `/remote` export — host-runner | host / runner (`P4-01` Run Service, `P4-02` TaskProfile) | P8-02 Remote Resources (W16) / P8-08 Operator Control Plane (W18) | 在 consumer wave 添加 remote runner export；不需要时删除错误 import | REGISTERED — not ported |
| 4 | `/remote` export — file-reference | `packages/fs/*`, `tool-fs` | P3-12 Workspace path / attachment boundary (W8) | 在 consumer wave 添加 remote file-reference export；不需要时删除错误 import | REGISTERED — not ported |
| 5 | `/remote` export — inventory | `packages/host/plugin-inventory` (`P1-01` manifest v2, `P1-03` lockfile) | P1-12 Official Plugin Verifier / market trust (W10) | 在 consumer wave 添加 remote inventory export；不需要时删除错误 import | REGISTERED — not ported |
| 6 | `/remote` export — message-feedback | `packages/interaction/*` (`P5-10`, `P2-12`) | P8-04 Server→Client requests / quorum (W10) | 在 consumer wave 添加 remote message-feedback export；不需要时删除错误 import | REGISTERED — not ported |
| 7 | `/remote` export — session-reference | `packages/session/*` (`P6-07` session lifecycle) | P8-02 Remote Resources (W16) | 在 consumer wave 添加 remote session-reference export；不需要时删除错误 import | REGISTERED — not ported |
| 8 | Typert `commands` type | Typert type registry | P8-02 Remote Resources (W16) — 引入 remote command 的协议 wave | 在引入协议 wave 修复 Typert `commands` type | REGISTERED — not ported |
| 9 | `@deepseek-ai/dsh-trust-kernel` source / build / package export + runtime dependency closure | `packages/kernel/trust-kernel`（干净基线中**不存在**） | P0-02 Minimal Immutable Trust Kernel (W2) | 创建该包、其 exports 与运行时依赖闭合；在 W2 micro-PR 中通过 pack/install smoke | REGISTERED — package not pre-created |

## 4. Feature owner and merge-back ledger (W1–W19)

| Wave | Epics | Owner (implementing wave) | Merge-back path |
|---|---|---|---|
| W1 | P0-01 | baseline fingerprint | W1 integration PR — baseline + repo fingerprint |
| W2 | P0-02, P0-06 | trust kernel + schema registry | W2 integration PR — includes fault-row #9 |
| W3 | P0-03, P0-05, P0-07, P1-01, P2-01 | capability/evidence/plugin/identity roots | W3 integration PR |
| W4 | P0-04, P0-08, P1-02, P1-07, P1-08, P1-09, P2-02, P2-03, P4-01, P6-01, P6-07 | layering/plugin provenance/run/session roots | W4 integration PR — first shipping composition for run + session |
| W5 | P1-03, P2-04, P4-05, P4-06, P6-02, P8-01 | plugin lockfile / lifecycle / protocol v0 | W5 integration PR — first protocol-negotiation composition |
| W6 | P2-05, P4-02, P4-07 | policy + task profile + worker lease | W6 integration PR |
| W7 | P2-06, P2-10, P2-12, P3-01, P4-08, P4-12, P5-10, P5-11 | approval / policy-as-code / ExecutionWorld / workflow journal | W7 integration PR |
| W8 | P1-04, P1-06, P1-10, P2-07, P3-02, P3-03, P3-06, P3-09, P3-10, P3-12, P4-03, P4-09, P4-11, P6-03 | sandbox / secrets / RunPlan / detached workflows | W8 integration PR — includes fault-row #4 |
| W9 | P1-05, P2-08, P2-09, P2-11, P3-04, P3-05, P4-04, P4-10, P5-01, P5-05, P6-08 | security scan / grants / network isolation / RunPlan freeze | W9 integration PR |
| W10 | P1-11, P1-12, P3-07, P3-08, P5-02, P5-12, P6-09, P7-01, P8-04 | self-modification / sandbox hardening / model router / artifact store | W10 integration PR — includes fault-rows #5, #6 |
| W11 | P3-11, P5-03, P5-04, P5-06, P6-04, P6-06, P6-10 | snapshot / fallback / context graph / compaction / privacy | W11 integration PR |
| W12 | P5-07, P5-08, P6-05, P7-02 | Codex/Claude adapters + evidence layer | W12 integration PR |
| W13 | P4-13, P7-03, P7-07 | reconciliation / independent verifier / causal trace | W13 integration PR |
| W14 | P4-14, P7-04, P7-08 | durable schedule / claim graph / replay | W14 integration PR — includes fault-row #2 |
| W15 | P7-05 | AcceptanceGate / OutcomePackage | W15 integration PR |
| W16 | P7-06, P7-09, P8-02 | repair loop / scenario suite / Remote Resources | W16 integration PR — includes fault-rows #1, #3, #7, #8 |
| W17 | P7-10, P8-03, P8-05, P8-06 | evaluation plane / lifecycle control / streaming / RBAC API | W17 integration PR |
| W18 | P5-09, P8-07, P8-08, P8-09 | ACP / SDK parity / operator API / governance | W18 integration PR |
| W19 | P8-10 | config provenance / ABI / DR release gate | W19 integration PR — final release composition |

## 5. Honesty

- 干净基线 `b150a551b8` 按 R0.3A 原生 install/build/pack，闭合健全；其全套件
  退出 0 待安静机器/CI 确认（R0 exit gate 第 1 项仍 OPEN）。没有任何 First-100
  特性被移植进去。
- First-100 保持 0/100 ACCEPTED；W1 在 R0 exit gate 通过前保持 BLOCKED。
- trust-kernel 包在干净基线中不存在且未被预创建；其运行时闭合由 W2 负责
  （fault-row #9）。
