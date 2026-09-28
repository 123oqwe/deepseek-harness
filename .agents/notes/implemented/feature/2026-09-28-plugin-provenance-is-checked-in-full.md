# Agent Note: Plugin provenance is checked in full

Status: implemented

English | [中文](2026-09-28-plugin-provenance-is-checked-in-full.zh.md)

## Problem

P1-02's sign-off needs what its A stroke (B-572) left out; the delegate ruled after B-685 (2026-09-28) that each gap blocks the sign-off. must[1] reads 「验证 package digest、source commit、builder identity 和依赖 SBOM。」. The install path checked the SBOM's coverage but not its integrity: `verifyPluginProvenance` never compared `claim.sbomDigest` with the SBOM supplied, so an SBOM swapped after signing passed whenever its runtime entries matched the installed set (A0).

## Decision

- **The SBOM a claim names is the SBOM checked.** After the signature verifies, `verifyPluginProvenance` refuses with `sbom-digest-mismatch` unless `computeSbomDigest(input.sbom)` equals `claim.sbomDigest`, and checks coverage only after that. The signature covers `sbomDigest`, so the claim's digest is authentic, and the comparison binds the supplied SBOM to it.

## Alternatives considered

- **Compare in the install path instead of the library.** `verifyLockedPackageOffline`, which replays the same verification, and any later caller would miss it; the library is where must[1] is decided.

## Consequences

- Frozen P1-02 cases whose fixture claims carry a placeholder `sbomDigest` (`tests/provenance.spec.ts`, `tests/package-digest.spec.ts`) now refuse where they expected `trusted` or `sbom-coverage-mismatch`. Lane A adapts those fixtures and the freezes are superseded, as the delegate ruled.
- This note supersedes in part [`dsh plugin add` verifies the provenance claim beside a local tarball](2026-09-26-dsh-plugin-add-verifies-a-tarball-provenance-claim.md): its "Not covered" item A0 no longer holds.
