# First-100 Packaging Migration Ledger (R0.3B)

English | [中文](packaging-migration-ledger.zh.md)

Status: OPEN — active planning ledger; updated as waves land
Clean base: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (frozen baseline, master tip)
Recovery branch: `codex/first100-recovery` — carries only governance/planning artifacts (39 files), **no product code**
Last updated: 2026-08-27

## 1. Clean-base declaration

The clean base for First-100 merge-back is the frozen baseline `b150a551b8`.
R0.3A proves native install/build/pack green with a sound packed closure; the
full-suite `pnpm test` exit-0 still needs a quiet-machine/CI confirmation before
R0 exit gate item 1 closes (see `docs/audit/baseline-b150a551.md`). No
First-100 feature is pre-created in the clean base, and none of the PR95
pack/runtime-closure faults below is ported before its owning wave. The recovery
branch holds only registry / wave-map / spec-source / R0-runner artifacts; those
are planning, not product.

## 2. Merge-back rule

- Each wave integration PR brings that wave's epics into the clean base
  together and bumps the DSH release-family version **once** per wave.
- A package that first enters shipping composition in a micro-PR MUST pass
  tarball pack/install + runtime-closure smoke in the **same** micro-PR
  (`pnpm run release:pack -- --family dsh` + `pnpm run
  release:verify-packed-install`), never deferred to R10.
- PR95-only faults are corrected at their owning wave and merged back through
  that wave's PR; they are **not** pre-applied to the clean base.

## 3. PR95-known pack/runtime-closure fault register

Every row is REGISTERED (not ported): the owning wave must add the correct
export at its own integration PR, or delete the wrong import when the contract
needs no remote entry. Assignment is by actual consumer; re-resolve the concrete
consumer during the owning wave's implementation.

| # | PR95 fault class | Concrete package(s) | Owning epic / wave | Action | Status |
|---|---|---|---|---|---|
| 1 | `/remote` export — commands | `packages/interaction/commands` | P8-02 Remote Resources (W16) | Add the remote `commands` export at the consumer wave; delete the wrong import if the contract needs none | REGISTERED — not ported |
| 2 | `/remote` export — goal | plan/goal surface (`P4-03`/`P4-04` RunPlan) | P4-14 Durable Schedule / Goal Trigger (W14) | Add remote goal export at the consumer wave; delete the wrong import if unneeded | REGISTERED — not ported |
| 3 | `/remote` export — host-runner | host / runner (`P4-01` Run Service, `P4-02` TaskProfile) | P8-02 Remote Resources (W16) / P8-08 Operator Control Plane (W18) | Add remote runner export at the consumer wave; delete the wrong import if unneeded | REGISTERED — not ported |
| 4 | `/remote` export — file-reference | `packages/fs/*`, `tool-fs` | P3-12 Workspace path / attachment boundary (W8) | Add remote file-reference export at the consumer wave; delete the wrong import if unneeded | REGISTERED — not ported |
| 5 | `/remote` export — inventory | `packages/host/plugin-inventory` (`P1-01` manifest v2, `P1-03` lockfile) | P1-12 Official Plugin Verifier / market trust (W10) | Add remote inventory export at the consumer wave; delete the wrong import if unneeded | REGISTERED — not ported |
| 6 | `/remote` export — message-feedback | `packages/interaction/*` (`P5-10`, `P2-12`) | P8-04 Server→Client requests / quorum (W10) | Add remote message-feedback export at the consumer wave; delete the wrong import if unneeded | REGISTERED — not ported |
| 7 | `/remote` export — session-reference | `packages/session/*` (`P6-07` session lifecycle) | P8-02 Remote Resources (W16) | Add remote session-reference export at the consumer wave; delete the wrong import if unneeded | REGISTERED — not ported |
| 8 | Typert `commands` type | Typert type registry | P8-02 Remote Resources (W16) — the protocol wave that introduces the remote command | Fix the Typert `commands` type in the introducing protocol wave | REGISTERED — not ported |
| 9 | `@deepseek-ai/dsh-trust-kernel` source / build / package export + runtime dependency closure | `packages/kernel/trust-kernel` (does **not** exist in the clean base) | P0-02 Minimal Immutable Trust Kernel (W2) | Create the package, its exports, and its runtime dependency closure; pass pack/install smoke in the W2 micro-PRs | REGISTERED — package not pre-created |

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

- Clean base `b150a551b8` installs/builds/packs natively per R0.3A with a sound
  packed closure; its full-suite exit-0 is pending a quiet-machine/CI
  confirmation (R0 exit gate item 1 still OPEN). No First-100 feature has been
  ported into it.
- First-100 stays 0/100 ACCEPTED; W1 is BLOCKED until the R0 exit gate passes.
- The trust-kernel package does not exist in the clean base and is not
  pre-created; its runtime closure is owned by W2 (fault-row #9).
