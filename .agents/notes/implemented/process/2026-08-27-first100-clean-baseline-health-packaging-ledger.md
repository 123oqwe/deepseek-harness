# Agent Note: First-100 clean-baseline health and packaging ledger (R0.3A/3B)

Status: implemented

English | [中文](2026-08-27-first100-clean-baseline-health-packaging-ledger.zh.md)

## Problem

First-100 merge-back starts from a clean baseline: the frozen master tip
`b150a551b8`, with no First-100 feature pre-created and none of the PR95
pack/runtime-closure faults ported early. Before W1 may open, the R0 exit gate
item 1 requires the clean-branch native CI/pack to be green, and item 3 requires
every feature to have an assigned owner and merge-back path. Without captured
evidence, "the baseline is healthy" is an assertion, not a fact, and the
packaging migration would be an unowned plan.

## Decision

Two artifacts now record the baseline's state:

- `docs/audit/baseline-b150a551.md` — the R0.3A receipt. On a pristine worktree
  detached at the frozen SHA, the native keyless pipeline was run and each exit
  captured directly from `$?`: `pnpm install --frozen-lockfile` exit 0; the CI
  build (`DSH_BUILD_CLIENT_PROFILE=official pnpm run build`) exit 0 with the
  official client-build record digest-bound to HEAD; `pnpm run build` exit 0;
  `release:pack --family dsh` exit 0 (227 tarballs) and `--family vendor` exit 0
  (9 tarballs); the full controlled vitest suite (14,707 tests, `--maxWorkers 4`)
  exited 1 with exactly 12 failures across 8 files, all proven environmental
  (11 load-timing/watch/lazy-load under external load ~52 on 10 cores + the
  `executor.spec.ts` `/tmp`→`/private/tmp` symlink artifact of the worktree's
  placement).
- `docs/audit/packaging-migration-ledger.md` — the R0.3B ledger: a merge-back
  rule (one version bump per wave; first-entry packages must pass pack/install +
  closure smoke in the same micro-PR), a 9-row PR95 fault register (REGISTERED,
  not ported; owner wave per row), and a W1–W19 feature-owner table.

Two pack findings are recorded honestly rather than "fixed": the official
`verify-packed-install` script exits 1 on this macOS host — first from a stale
local npm cache serving a capped `@earendil-works/pi-ai` packument (fresh cache
resolves the lockfile's `0.82.1` fine), then because the script's hardcoded
`--omit=optional` drops koffi@3.1.1's `@koromix/koffi-darwin-arm64` prebuilt
(declared as an `optionalDependency`), forcing a native source build that fails
to link libuv symbols on arm64/Node 24. A supplementary keyless install of the
same 236 tarballs with optional deps included exits 0 and the installed
`@deepseek-ai/dsh --version` probe prints `0.1.1-rc.2`, proving the packed
payload and runtime closure are sound. The receipt therefore concludes R0 exit
gate item 1 stays **OPEN** pending a quiet-machine or Linux CI full-suite exit-0
confirmation.

## Alternatives considered

**Claim the baseline green because install/build/pack all exited 0.** Rejected:
the receipt must not overstate. A full-suite exit-1 — even with every failure
individually proven environmental — leaves item 1's wording unsatisfied, so the
receipt records strong health evidence and leaves item 1 OPEN.

**Modify or bypass `verify-packed-install` to force a pass on macOS.** Rejected:
the baseline is frozen and the script is a shipped gate. The macOS exit-1 is a
documented limitation of its `--omit=optional` design on this toolchain, not a
payload defect; the supplementary install proves the closure instead.

## Consequences

The clean base's health is now a captured, reviewable fact rather than an
assertion, and the packaging migration has an owner per feature and an explicit
merge-back rule. First-100 stays 0/100 ACCEPTED and W1 stays BLOCKED: the R0
exit gate items 1 (full-suite exit-0 confirmation), 3 (ledger owners — now
written, still requires the gate's full confirmation), and 5 (R0-7 maintainer
approval + signed envelope) remain outstanding. Nothing in this slice ports a
First-100 feature or a PR95 fault into the clean base.
