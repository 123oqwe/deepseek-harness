---
description: "The assurance package group: release-time evidence and completion-gate type surfaces every release process composes around, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/assurance

English | [中文](README.zh.md)

## Summary

The assurance group holds Epic P0-07's Release Evidence Package: the type surface a release process uses to prove, per gate, what actually ran (command, timestamps, exit code, environment, log/artifact digests, test counts, skip reasons — must[0]) and to bind that evidence to a baseline fingerprint, a Git diff, and build-artifact digests into one aggregate package whose `accepted` field cannot type-check as `true` while any required gate is skipped or missing (must[1]/must[2]). This group currently ships one package's Contract-stage slice only: the `EvidencePackage`/`GateEvidence` type surface, with no `collect-evidence.mjs`/`verify-evidence.mjs` producer or verifier yet — that is a later P-stage slice's deliverable.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`evidence-format`](evidence-format/README.md) | Contract-stage type surface for the Release Evidence Package: per-gate evidence records, the aggregate package binding baseline fingerprint/Git diff/build-artifact digests, and the `accepted=true` structural invariant | none (no Cordis plugin surface at any stage) |

-----

<a id="related-documentation"></a>
## Related documentation

- [`docs/testing.md`](../../docs/testing.md#boot-time-baseline-preflight) — the existing baseline-fingerprint precedent (`@deepseek-ai/dsh-baseline-preflight`, P0-01) this group's `BaselineFingerprintBinding` binds by digest.
- [`tests/release/evidence-package.spec.ts`](../../tests/release/evidence-package.spec.ts) — the Contract-stage type-surface proof for this group's one package.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
