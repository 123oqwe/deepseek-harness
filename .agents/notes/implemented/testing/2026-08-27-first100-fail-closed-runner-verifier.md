# Agent Note: First-100 fail-closed runner/verifier (R0-4)

Status: implemented

English | [中文](2026-08-27-first100-fail-closed-runner-verifier.zh.md)

## Problem

The R0 qualification runner had to be reimplemented so the §4 exploit paths
from the maintainer decision package are impossible. An executor could
self-report ACCEPTED on a non-empty string, fabricate `testCounts` without a
raw log, point `rawLogPath` outside the observations directory, bind an
observation to a non-frozen baseline, or emit a single-lane observation that
aggregated to ACCEPTED. The 7-item audit deferred the `testCounts`
passed+failed+skipped==total constraint to R0-4 (finding N2), and
R0-slice-contracts.md R0-4 + decision package §5.2 mandate the fail-closed
rules verbatim: real keyring + detached Ed25519 attestation verified against a
pinned trusted identity, `baselineSha` equal to the frozen `b150a551…`, raw log
with non-zero size confined to `.artifacts/first100/observations/`, one
`${id}.${lane}.json` per (issue, lane), all 4 lanes required for ACCEPTED, and
no `--commit` override.

## Decision

Five modules under `scripts/first100/`, a negative test suite, and the wiring
to run them; all read the **committed** canonical registry
(`tests/first100/registry.json`) and the committed evidence schema
(`spec/first100-evidence.schema.json`), never a fresh render:

- `scripts/first100/common.ts` — shared types (`Observation`,
  `VerdictStatus`, the 4 `LANES`), cwd-independent repo-root resolution, and
  registry / schema / pinned-identity loaders.
- `scripts/first100/attest.ts` — canonical JSON serialization (sorted keys,
  signature field stripped), Ed25519 detached sign/verify, and identity
  generation that persists **only** the public pin at
  `tests/first100/trusted-identity.json` while installing the private key at
  `~/.config/dsh-first100/first100-signing.key` (0600) or reading
  `DSH_FIRST100_SIGNING_KEY` (base64 PKCS8). The private key is never
  committed.
- `scripts/first100/issue-runner.ts` — `dry` validates the 100-id catalog and
  lane classification with `accepted` always 0 (unrun is never PASS); `run
  <id> <lane>` spawns the real command, captures the raw log and real exit
  code, parses `testCounts` (refusing to fabricate on an empty or inconsistent
  log), and writes `${id}.${lane}.json` under `.artifacts/first100/observations/`.
  There is no `--commit` override: `baselineSha` is always the frozen baseline.
- `scripts/first100/verify.ts` — fail-closed per-observation checks in order:
  draft-07 schema via ajv (strict; `schemaVersion` whitelisted as an
  annotation keyword), detached signature against the pinned identity,
  `baselineSha`===frozen, id in the registry, `testCounts` sum
  (passed+failed+skipped==total, total>=1 — resolving N2), empty `skipReason`,
  `worldState` never `"unobserved"`, `rawLogPath` confined with non-zero size
  and sha256 match, and `exitSemantics` re-derived from the evidence — a
  model/executor self-report never constitutes evidence. An ACCEPTED claim
  also requires the fixture to exist.
- `scripts/first100/report.ts` — scans `${id}.${lane}.json`, rejects any file
  whose content id/lane does not match its filename, and aggregates per issue:
  REJECTED evidence anywhere invalidates the issue, ACCEPTED requires all 4
  lanes, a genuine FAIL or BLOCKED surfaces as such, and partial coverage is
  NOT_RUN — never ACCEPTED. It writes a signed `verdicts.json`.
- `tests/first100/first100.spec.ts` — 30 tests proving every §5.2 rejection
  rule with a focused negative (forged / mis-keyed / unsigned signature,
  unknown baseline, fabricated counts, non-empty skipReason, `"unobserved"`
  world, path-traversal `rawLogPath`, empty / missing / sha256-mismatched raw
  log, exitSemantics contradiction, missing fixture, single-lane not ACCEPTED,
  filename/content mismatch) plus positive round-trips: a genuinely observed
  run passes attestation and an issue aggregates ACCEPTED only with all 4
  attested lanes.
- Wiring — `ajv` as a root devDependency, `first100:*` package scripts,
  `tests/**/*.spec.ts` in the vitest `testIncludes`, and the tests override in
  `.oxlintrc.json`.

## Alternatives considered

**Relax ajv strict mode (`strictSchema: false`).** Rejected: strict mode is the
fail-closed property that rejects a schema we do not fully understand. The
only non-standard keyword is the `schemaVersion` metadata field, so it is
whitelisted explicitly and every other unknown keyword still throws.

**Trust a self-reported `exitSemantics` when the evidence is internally
consistent.** Rejected: the whole point of §5.2 is that the verifier re-derives
semantics from the raw evidence. The schema couples `exitSemantics` to
`exitCode` (ACCEPTED->0, FAIL->>=1, NOT_RUN/BLOCKED->null), and `verify.ts`
cross-checks the derivation, so a contradiction (exit 0 with failing tests, or
BLOCKED claimed where the evidence implies NOT_RUN) is rejected.

**Mark an issue ACCEPTED from any attested lane.** Rejected: R0-slice-contracts
requires all 4 lanes. The aggregate is fail-closed — partial coverage is
NOT_RUN, and a single REJECTED lane invalidates the issue.

## Consequences

`pnpm run test` now also discovers `tests/**/*.spec.ts`, so the negative suite
runs in CI alongside the R0-3 checker. `pnpm run first100:dry` validates the
catalog (exit 0) and `pnpm run first100:verify` writes a signed `verdicts.json`
reporting unrun issues as NOT_RUN — never PASS. The R0-4 slice and R0-6
negative controls are green at this SHA; finding N2 from the R0-2 review is
resolved (the `testCounts` sum check is enforced in `verify.ts` and proven by
the fabricated-counts negative).

First-100 stays 0/100 ACCEPTED, thresholds stay
PROPOSED_PENDING_MAINTAINER, the v1.1 envelope stays UNSIGNED, and W1 stays
BLOCKED: the R0 exit gate still fails honestly (R0.3A clean-baseline CI/pack,
R0.3B packaging ledger, and R0-7 maintainer approval + signed envelope remain
outstanding). Nothing in this slice self-approves.
