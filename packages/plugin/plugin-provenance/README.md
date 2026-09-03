---
description: "The Contract-stage type surface and stub verification-function signatures for Epic P1-02's plugin signature, source provenance, and dependency SBOM verification, for maintainers picking up the RED-scaffold fix-round."
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-provenance

## Summary

`dsh-plugin-provenance` fixes the type surface and function signatures for Epic P1-02's plugin signature, source provenance, and dependency SBOM verification: every claim carries Sigstore-style keyless identity/provenance or an organization's offline-signing evidence (must[0]); verification checks package digest, source commit, builder identity, and dependency SBOM together (must[1]); every trust anchor is registered under a real `TrustKernelSignatureRoots` handle from `@deepseek-ai/dsh-trust-kernel`, which only that package's `createTrustKernel()` can produce (must[2]/must[3]); and an `unsigned-dev` fallback is admitted only for an explicit, policy-recognized development profile, always carrying a persistent untrusted-status banner (must[4]).

This package currently ships this epic's Contract-stage RED scaffold only: `src/signature.ts` and `src/sbom.ts`'s types and function signatures are real and epic-accurate, but every verification/decision function (`verifyPackageSignature`, `registerTrustAnchor`, `admitUnsignedDevMode`, `generateSbom`, `verifySbomCoverage`, `computeSbomDigest`, and `src/index.ts`'s `verifyPluginProvenance`, `verifyLockedPackageOffline`, `recordProvenanceAudit`) throws `'not implemented: ...'` — the pure decision logic itself is a later fix-round's deliverable, proven by `tests/provenance.spec.ts`'s real assertions against that (currently failing) behavior. No invariant companion is published because this Contract-stage slice constructs no registry, `Context`, or trust-anchor set yet to check an owned relation over.

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

The verification surface, once implemented, is called with plain data plus a real `TrustKernel` handle — no file, network, or Cordis `Context` access:

```ts
import { verifyPluginProvenance } from '@deepseek-ai/dsh-plugin-provenance'
import type { PluginProvenanceInput } from '@deepseek-ai/dsh-plugin-provenance'
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'

const kernel = createTrustKernel() // the process's one TrustKernel; kernel.signatureRoots is the trust root

declare const input: PluginProvenanceInput // claim + observed facts + SBOM + installed dependency names

const result = verifyPluginProvenance(input, kernel.signatureRoots)
// result.trust is 'trusted' (naming the trustAnchorId) or 'rejected' (naming one
// ProvenanceRejectionReason: a digest, source-repo, builder-identity, or SBOM mismatch)
```

Every export is a pure function over already-computed data: no export in this package reads a file, spawns a process, makes a network call, or constructs a Cordis `Context` — a later Usage-stage caller supplies real digests, source-commit lookups, and SBOM data from `apps/cli/src/plugin.ts`'s real install/verify flow.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Branded, not bare, cross-boundary ids.** `PackageDigest`, `SourceCommitHash`, `BuilderIdentity`, `TrustAnchorId`, `PublicKeyFingerprint`, and `SbomDigest` each use `@deepseek-ai/dsh-brand`'s `Branded<B>` per this repo's opaque-cross-boundary-id rule.
- **The trust root is `@deepseek-ai/dsh-trust-kernel`'s own handle, never a type this package defines.** Every function that reads or registers a trust anchor accepts a real `TrustKernelSignatureRoots` — a value opaque and deep-frozen at construction, with no exported constructor besides `createTrustKernel()`. This is the structural proof behind must[2] ("TrustKernel 持有可信根") and must[3] ("普通插件不能修改"): no function in this package accepts a plugin-supplied substitute, and no ordinary caller can construct one.
- **Digest binds source repo and commit together.** `SourceCommitReference` pairs `repoUrl` with `commitHash` in one fact, so a source-repo swap (acceptance[0]) is detectable even when an attacker finds a colliding commit hash in a different repo.
- **SBOM verification is two checks, not one.** `computeSbomDigest` catches a swapped SBOM (integrity, against `PackageProvenanceClaim.sbomDigest`); `verifySbomCoverage` catches an incomplete one (coverage, against what is actually installed) — must[1]'s "依赖 SBOM" check covers both.
- **`unsigned-dev` cannot silently become the default.** `UnsignedDevProfileDeclaration.explicitDevOptIn` is typed as the literal `true`, and `UntrustedStatusBanner.persistent` is likewise a literal `true` — there is no constructible admitted state that omits the opt-in or the continuously-shown untrusted marker (must[4]).
- **Offline replay reuses the online input shape verbatim.** `verifyLockedPackageOffline` accepts the identical `PluginProvenanceInput` `verifyPluginProvenance` does, with no network-shaped parameter added — acceptance[1]'s "同一锁定包在离线模式可验证" is structural, not a special case to remember to add later.
- **The audit record cannot carry a key.** `ProvenanceAuditRecord` has no field for `OfflineSignedProvenanceEvidence.signature`, a `publicKeyFingerprint`, or any other key material — only a package digest, verdict, reason, and an opaque `trustAnchorId` (acceptance[2]).

### Source map

| File | Role |
|---|---|
| [`src/signature.ts`](src/signature.ts) | must[0]/must[1]'s digest, source-commit, and builder-identity checks; must[2]/must[3]'s trust-anchor registration under a real `TrustKernelSignatureRoots`; must[4]'s `unsigned-dev` admission |
| [`src/sbom.ts`](src/sbom.ts) | must[1]'s dependency-SBOM generation, digest binding, and coverage check |
| [`src/index.ts`](src/index.ts) | `verifyPluginProvenance`/`verifyLockedPackageOffline` (the combined must[1] check, online and offline) and `recordProvenanceAudit` (acceptance[2]'s key-free record) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/provenance.spec.ts`](tests/provenance.spec.ts) — the Contract-stage RED scaffold: one case per registry-declared acceptance clause (acceptance[0]'s three named fail-closed scenarios split into three) plus every must[] clause that is structurally testable at this Contract level.
- [`packages/kernel/trust-kernel/README.md`](../../kernel/trust-kernel/README.md) — the real, already-implemented `TrustKernel` this package's trust-root parameter comes from (Epic P0-02, predecessor).
- [`apps/cli/src/plugin.ts`](../../../apps/cli/src/plugin.ts) — the real install/verify flow this epic's Usage stage wires `verifyPluginProvenance`/`admitUnsignedDevMode` into (Usage-stage wiring, not this package's job).
- [`packages/host/plugin-inventory/src/types.ts`](../../host/plugin-inventory/src/types.ts) — the real Inventory surface acceptance[2]'s `recordProvenanceAudit` output is meant to feed (Usage-stage wiring, not this package's job).
- [`@deepseek-ai/dsh-plugin-manifest`](../plugin-manifest/README.md) — this repo's other Contract-stage plugin-capability package, followed here for package layout and pure-function conventions.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure verification-function signatures only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Every verification/decision function throws `'not implemented'`.** `verifyPackageSignature`, `registerTrustAnchor`, `admitUnsignedDevMode`, `generateSbom`, `verifySbomCoverage`, `computeSbomDigest`, `verifyPluginProvenance`, `verifyLockedPackageOffline`, and `recordProvenanceAudit` are Contract-stage RED-scaffold stubs: real signatures and real JSDoc-documented behavior, no working body. `tests/provenance.spec.ts` fails every case against this today, by design — a later fix-round implements the logic these signatures and tests already commit to.
- **No wiring into a real install/verify flow exists yet.** `apps/cli/src/plugin.ts` and `packages/host/plugin-inventory/src/types.ts` (this epic's own `stages.U.files`) do not call into this package — this package alone cannot reject a real plugin install or feed a real Inventory row.
- **No real cryptography.** `verifyPackageSignature` does not yet call any Sigstore/Rekor client or `node:crypto` signature verification, and `computeSbomDigest`/`generateSbom` do not yet hash or serialize anything real — the Contract stage fixes only the shapes these later calls will fill.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
