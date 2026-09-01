---
description: "The Contract-stage type surface for the Release Evidence Package, for users and maintainers who need to know exactly what a gate must report and how the accepted invariant is structurally enforced."
kind: "package-library"
---

# @deepseek-ai/dsh-evidence-format

English | [中文](README.zh.md)

## Summary

`dsh-evidence-format` fixes the type surface of Epic P0-07's Release Evidence Package: a per-gate {@link GateEvidence} record (command, timestamps, exit code, environment, log/artifact digests, test counts, skip reasons — must[0]) and an aggregate {@link EvidencePackage} that binds a baseline fingerprint, a Git diff, and build-artifact digests together (must[1]). `EvidencePackage`'s `accepted` field is the discriminant of a tagged union: `AcceptedEvidencePackage`'s `requiredGates` and `requiredBuildArtifacts` are complete `Record<K, V>` maps keyed by the release's real required-id literal unions, so a caller cannot type-check an `accepted: true` literal that omits a required gate or build artifact, or that assigns a skipped/missing gate's evidence where a completed one is required (must[2]).

This package currently ships its Contract-stage slice only: the `EvidencePackage`/`GateEvidence` type surface (`src/types.ts`) and its invariant companion (`src/invariant.ts`). It has no `scripts/release/collect-evidence.mjs`/`verify-evidence.mjs` producer or verifier yet — no constructed `EvidencePackage` value exists in this slice. See [Known Limitations and Deferred Work](#known-limitations-and-deferred-work).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import the type surface to type evidence a gate produces, or a release's aggregate package — never to construct one:

```ts
import type { AcceptedEvidencePackage, CompletedGateEvidence } from '@deepseek-ai/dsh-evidence-format/types'

type RequiredGateId = 'typecheck' | 'lint' | 'test:coverage'
type RequiredArtifactPath = 'lib/index.js'

declare function publishRelease(evidence: AcceptedEvidencePackage<RequiredGateId, RequiredArtifactPath>): void

function isBlockingFailure(gate: CompletedGateEvidence): boolean {
  return gate.exitCode !== 0
}
```

Instantiating `RequiredGateId`/`RequiredArtifactPath` with the release's real literal union (rather than leaving them at their `string` default) is what makes `requiredGates`/`requiredBuildArtifacts` completeness checks fire — omitting a required key, or assigning a `SkippedGateEvidence`/`MissingGateEvidence` where a `CompletedGateEvidence` is required, fails to compile. There is no exported constructor for `EvidencePackage`, `GateEvidence`, or any branded id/digest type in this package: a later P-stage slice's `scripts/release/collect-evidence.mjs` is the one place that constructs these values from a real release run, and `scripts/release/verify-evidence.mjs` is the one place that checks a persisted package's `signature` before trusting it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **`accepted` is a discriminant, not a settable boolean field.** `EvidencePackage<RequiredGateId, RequiredArtifactPath>` is `AcceptedEvidencePackage<...> | UnacceptedEvidencePackage<...>`; only the `accepted: true` arm requires complete, all-`CompletedGateEvidence` `requiredGates` and a complete `requiredBuildArtifacts` map.
- **Branded plain strings, never opaque `unique symbol` handles.** Unlike `@deepseek-ai/dsh-trust-kernel`'s in-memory-only capability handles, every id/digest here (`Digest`, `Signature`, `CommitSha`, `GateId`) is a `Branded<B>` from `@deepseek-ai/dsh-brand` — a plain string at runtime. An evidence package is written to disk and verified fully offline (acceptance[1]), so it must round-trip through `JSON.stringify`/`JSON.parse`; a symbol-keyed property is silently dropped by `JSON.stringify` and would make the persisted JSON this package's data is FOR unrepresentable.
- **The completeness check is real but has an honest, documented limit.** With `RequiredGateId`/`RequiredArtifactPath` instantiated as the release's real literal union, `Record<K, CompletedGateEvidence>` rejects both a missing key and a wrongly-shaped value — a genuine compile-time proof. Left at their `string` default (the shape a `JSON.parse`-loaded, dynamically-typed package necessarily has), the same map only rejects a wrongly-shaped VALUE at any key present; it cannot detect a missing key, since a `string`-indexed map has no fixed key set to check against. `tests/release/evidence-package.spec.ts` proves and documents this degraded case rather than hiding it — closing it is `scripts/release/verify-evidence.mjs`'s job (P-stage), cross-referencing the release's actual configured blocking-gate manifest at runtime.
- **The type system proves shape, never provenance.** Nothing here stops a caller from hand-writing a `CompletedGateEvidence` object literal for a gate that never ran — TypeScript's structural typing checks shape, not truthfulness. Closing that gap is `signature`'s job: a detached attestation this Contract-stage slice only reserves a field for, verified offline by `verify-evidence.mjs` against a pinned trust anchor.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The `GateEvidence`/`EvidencePackage` type surface: the three gate-outcome variants, the branded id/digest types, and the `accepted`-discriminated aggregate package |
| [`src/index.ts`](src/index.ts) | Pure type re-export of `./types.ts` — zero runtime exports, zero Cordis registration (this Contract-stage slice's mandatory B4(f) scaffold) |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: explained-empty — no constructed `EvidencePackage` value or producer exists yet in this slice |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`docs/testing.md`](../../../docs/testing.md#boot-time-baseline-preflight) — the existing baseline-fingerprint precedent (`@deepseek-ai/dsh-baseline-preflight`, Epic P0-01) `BaselineFingerprintBinding` binds by digest.
- [`tests/release/evidence-package.spec.ts`](../../../tests/release/evidence-package.spec.ts) — the Contract-stage type-surface proof, including the real `tsc` diagnostic assertions for the `accepted` completeness invariant.
- [`packages/kernel/trust-kernel`](../../kernel/trust-kernel/README.md) — the precedent this package's opaque-vs-branded design choice explicitly contrasts against.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No constructed `EvidencePackage` value yet** — this Contract-stage slice ships only the type surface and an explained-empty invariant companion; `scripts/release/collect-evidence.mjs` (construction from a real release run) and `scripts/release/verify-evidence.mjs` (signature/offline verification) are later P-stage deliverables.
- **`requiredGates`/`requiredBuildArtifacts` completeness is a compile-time property only when `RequiredGateId`/`RequiredArtifactPath` are instantiated as the release's real literal union** — left at their `string` default, an `AcceptedEvidencePackage` literal with an EMPTY `requiredGates`/`requiredBuildArtifacts` map still type-checks (proven and documented, not hidden, in `tests/release/evidence-package.spec.ts`). Verifying membership against the release's actual configured blocking-gate manifest is P-stage's runtime job.
- **The type system proves shape, not truthfulness** — a caller can hand-write a well-shaped `CompletedGateEvidence` for a gate that never ran; nothing in this Contract-stage slice can prevent that. `signature`'s offline verification against a pinned trust anchor (P-stage) is what closes this gap, not TypeScript.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
