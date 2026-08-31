# Agent Note: First-100 spec-repair checker (R0-3 / M0.C)

Status: implemented

English | [中文](2026-08-25-first100-spec-repair-checker.zh.md)

## Problem

The First-100 recovery program needs a CI-executable guard that the canonical
registry and its generated spec projections still satisfy the ownership/DAG
contract from implementation-wave-map.md M0.C. Without one, a silent edit to
`tests/first100/registry.json` — a forged layer, a placeholder owner, an
unrecorded same-wave writer, a dropped predecessor, or an oversized slice —
would pass review and corrupt the wave plan. R0-slice-contracts.md R0-3
mandates exactly this checker and pins its location and vitest discovery.

## Decision

The checker lives under `spec/` as a contract-named module plus a thin vitest
adapter, both reading the **committed** artifacts (never a fresh render):

- `spec/first100-spec-repair-tests.ts` — the checker: `checkRegistry`,
  `checkArtifacts`, `readRegistry`, `readJson`, `deepCopy`, the pinned L0–L6
  distribution, and the recorded same-wave conflict set. It is the R0-3
  artifact name from R0-slice-contracts.md and is reusable by R0-4's runner.
- `spec/first100-spec-repair-tests.spec.ts` — the vitest spec discovered by
  the added `spec/**/*.spec.ts` testIncludes entry; it exercises the module
  (2 green assertions on the committed R0-1+R0-2 state, 9 negative controls).
- `vitest.config.ts` — adds `'spec/**/*.spec.ts'` to `testIncludes`, so the
  checker and R0-4's future `first100.spec.ts` run under `pnpm run test`.
- `.oxlintrc.json` — adds `spec/**/*.spec.{ts,tsx}` to the existing tests
  override, mirroring `scripts/**/*.spec.ts` so the spec file is linted with
  the repository's test-appropriate rules.

The checker proves, against the committed state: exact 100-ID set and unique
ids; group counts equal to the registry's own `groupCounts`; every
`primaryLayer` is a `layerEnum` member **and** matches the pinned L0–L6
distribution (L0:1 L1:17 L2:62 L3:5 L4:0 L5:6 L6:9), not enum membership alone;
every predecessor exists and lands in a strictly earlier wave (no same-wave,
no reverse edge, no self-dependency); every same-wave multi-writer N/P file is
one of the 4 recorded adjudication-pending conflicts; C/P/U/F stages all
present with a schema-valid shape and at most 5 files per slice (a stage IS a
micro-PR slice); waves 1–19 all non-empty; a 13-key evidence schema with no
duplicate keys; `verifyCommand` present on every epic; spec owners are real
`{epic}.{stage}` refs with a matching epic; thresholds stay recorded as
`PROPOSED_PENDING_MAINTAINER` (nothing self-approves). `checkArtifacts` then
cross-checks owner-map / dependency-graph / command-registry / evidence-schema
so each generated artifact projects exactly the 100 registry epics.

Negative controls mutate a deep copy of the real registry and assert the
checker rejects each failure mode: absent artifacts (fails closed via a throw),
a forged layer value, a placeholder `epic-owner/*` owner, an unrecorded
same-wave duplicate owner, a missing predecessor, a reverse edge, an empty
wave, a missing stage, and a >5-file slice.

The base registry stays honest: `canonicalOwner` is `UNASSIGNED_UNTIL_APPROVAL`
or a self-owning spec epic (the extracted-pending state), while the effective
100-owner projection is validated on the owner-map artifact. Signing the
checker's raw output belongs to R0-4's fail-closed runner and detached
attestation; R0-3 asserts structure and consistency only.

## Alternatives considered

**One self-contained `.spec.ts` file only.** Rejected because R0-slice-contracts
names `spec/first100-spec-repair-tests.ts` as the R0-3 artifact, and R0-4's
runner needs the same ownership/DAG checks. Keeping the checker in the
contract-named module and a thin adapter in the discoverable spec satisfies
both the named artifact and the `spec/**/*.spec.ts` discovery contract.

**Add `spec/**/*.{ts,tsx}` to the shared strict oxlint override.** Rejected:
`spec/` is in no tsconfig program, so oxlint's type-aware resolution produced
garbage (`JSON` typed as `error`, `!` flagged as unnecessary). Forcing real
type-aware lint would require a new compiler face, out of scope here; only the
`.spec.ts` file is linted, under the tests override. The module's behavior is
pinned by the spec that exercises it.

**Create a `spec/tsconfig.json` compiler face.** Rejected for this slice: it
would be a third config change beyond the R0-3 artifacts and affect `tsc
--build` and tsx path resolution, with no contract requirement.

**Validate the effective overlay as the base registry.** Rejected: the base
registry is deliberately extracted-pending; the overlay carries the granted
A/B/C approvals. The checker validates the base's honesty and the artifacts'
100-owner projection separately, so neither side can fake the other.

## Consequences

`pnpm run test` now discovers `spec/**/*.spec.ts`, so the checker runs in CI
and in the repository-wide suite. `spec/` gains a tests-only lint override; it
is not a TypeScript program, so `pnpm run typecheck` does not cover it and
oxlint applies no type-aware rules to it — behavior is verified by the spec
itself. The R0 exit gate now has a real guard on the ownership/DAG contract;
R0-4 will consume the module for its runner and add its own `first100.spec.ts`
under the same include. Absence of the committed artifacts fails the green
assertions, keeping the gate fail-closed.
