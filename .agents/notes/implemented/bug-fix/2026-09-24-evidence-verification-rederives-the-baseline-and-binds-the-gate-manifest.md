# Agent Note: Evidence verification re-derives the baseline, binds the gate manifest, and reports the accepted status

Status: implemented

English | [中文](2026-09-24-evidence-verification-rederives-the-baseline-and-binds-the-gate-manifest.zh.md)

## Problem

`scripts/release/verify-evidence.mjs` re-hashed `.dsh/baseline.json` against the digest the package recorded, but never re-derived the fingerprint that file records from the checkout. A change to a file the fingerprint covers, made after collection, therefore passed verification as long as `.dsh/baseline.json` itself was untouched (BLOCKED-304). The sidecar `manifest.json`, which lists the required gate ids and artifact paths declared at `collect-evidence.mjs init`, was not bound to the package either, so an edit to it after collection also passed. And the verifier's result line named the package but not its `accepted` status, the second fact a report of this gate cites.

## Decision

- **Verification re-derives the baseline.** When `.dsh/baseline.json` still matches the recorded digest, `verify` calls P0-01's `verifyBaseline` on the checkout and reports each drift entry as a mismatch.
- **The gate manifest is bound to the package.** `collect-evidence.mjs init` writes `manifest.json` before signing and records its digest as the package's optional `sidecarManifestDigest`, which the package signature covers. `verify` reports a manifest whose digest differs, and a package that lacks the field.
- **The result line reports the accepted status.** Both the success line and the failure line carry `accepted=<value>` next to the package path.

## Alternatives considered

- **Exclude the toolchain fields from drift.** Not chosen: the smallest change keeps P0-01's fingerprint whole. An offline re-verification therefore needs the collecting checkout's HEAD, Node and pnpm, which the exact-SHA workflow's upload comment states.
- **A required `sidecarManifestDigest` field.** Not chosen: the frozen Contract-stage cases build package literals without it, and an optional field keeps them valid while `verify` still refuses a package that lacks it.

## Consequences

- An offline re-verification must run on the collecting checkout's HEAD with the same Node and pnpm versions; anything else is reported as drift. When it finds drift, `verifyBaseline` writes `.dsh/rebase-report.json`.
- Each verification now runs `git`, `node --version` and `pnpm --version`.
- A package collected before this change has no `sidecarManifestDigest` and fails verification.
