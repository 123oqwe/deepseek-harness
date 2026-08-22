# P0-01: Reproducible audit baseline and repository fingerprint

**Date:** 2026-08-22
**Issue:** P0-01
**Status:** E2E_VERIFIED

## Context

The first-100 recovery manifest requires a machine-verifiable baseline fingerprint that binds every downstream issue to a known source state. The prototype PR (#1) bound the fingerprint to the stale fork SHA `47f943859b` instead of the required upstream baseline `b150a551b8`.

## What changed

- Created `scripts/release/baseline-fingerprint.mjs` with capture and verify subcommands.
- The fingerprint covers 6 schema files, 3 manifest files, 78 bundle row IDs, and 236 workspace packages.
- `verify()` now checks that the current HEAD matches the recorded `git_sha` (manifest requirement).
- Added `baseline:capture` and `baseline:verify` to `package.json` scripts.
- Added 9 `first100:*` gate commands backed by `scripts/first100/run-gates.ts`.
- Created `.dsh/baseline.json` on the `integration/first-100-rebuild` branch with HEAD `b150a551b8`.
- Added `docs/audit/baseline-b150a551.md` documentation.
- Updated `BENCHMARK.md` with baseline verification reference.
- Added `scripts/release/baseline-fingerprint.spec.ts` with 11 integration tests covering existence, coverage, drift detection (schema, manifest, bundle), recovery, and HEAD verification.

## Verification

- `node scripts/release/baseline-fingerprint.mjs capture` produces `.dsh/baseline.json` with `git_sha` = `b150a551b8`.
- `node scripts/release/baseline-fingerprint.mjs verify` exits 0 on clean checkout.
- Tampering schema, manifest, or bundle files causes verify to exit 1 with minimal diff.
- 11 vitest tests pass on the integration branch.
- `pnpm first100:preflight` runs `baseline:verify` and reports issue status.
