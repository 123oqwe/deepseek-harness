# Trust Kernel Specification

Release deliverable for Epic P0-02 (`确立 Minimal Immutable Trust Kernel 边界`, First-100 requirements matrix). This spec fixes the Trust Kernel's owned capability surface and the boundary between what the kernel owns and what stays an ordinary Cordis plugin. Design rationale lives in [`docs/architecture/trust-kernel-boundary.md`](../docs/architecture/trust-kernel-boundary.md); this page states the normative surface and its acceptance conditions.

## Scope

The Trust Kernel is the minimal, non-replaceable trust base every other part of dsh composes around. It is deliberately not a microkernel rewrite of the harness — everything outside the six capabilities below stays a plugin, composed and patched the way the rest of dsh already is.

## Owned capability surface

The kernel owns exactly six capabilities. `TrustKernel` (`packages/kernel/trust-kernel/src/types.ts`) is the normative type:

| Capability | `TrustKernel` member | Type |
|---|---|---|
| Root identity | `rootIdentity` | `TrustKernelRootIdentity` — unforgeable opaque handle |
| Signature roots | `signatureRoots` | `TrustKernelSignatureRoots` — unforgeable opaque handle |
| Policy-enforcement entrypoint | `policyEnforcement` | `TrustKernelPolicyEnforcement` — `(query: TrustKernelPolicyQuery) => TrustKernelPolicyVerdict` |
| Audit append | `auditAppend` | `TrustKernelAuditAppend` — `(entry: TrustKernelAuditEntry) => void` |
| Secret-broker handle | `secretBroker` | `TrustKernelSecretBrokerHandle` — unforgeable opaque handle |
| Sandbox-attestation verifier | `sandboxAttestationVerifier` | `TrustKernelSandboxAttestationVerifier` — `(attestation: TrustKernelSandboxAttestation) => boolean` |

No `TrustKernel` member is a setter, and the interface declares no seventh member. Every payload type the entrypoints accept (`TrustKernelPolicyQuery.payload`, `TrustKernelAuditEntry.payload`, `TrustKernelSandboxAttestation.payload`) is `unknown`: the kernel routes and appends opaque domain data, and never interprets it.

## Must clauses

1. A `TrustKernel` is initialized before the Cordis `Context` it will be pinned into exists. *(U-stage: construction and boot ordering, not this Contract-stage slice.)*
2. `TrustKernel` owns only the six capabilities above — nothing else.
3. `TrustKernel` is never registered as a replaceable Cordis Service: no `Config` schema, no `apply(ctx, config)` plugin export, no path through `ctx.plugin(...)`.
4. The runtime receives only narrow interfaces and unforgeable handles — never a mutable, replaceable, or broad-surface object.
5. Documentation states explicitly what remains a plugin (models, tools, storage providers, workflow, memory provider, UI) and what is never a plugin (root identity, deny enforcement, the audit-chain root, the signature-verification root). See [`docs/architecture/trust-kernel-boundary.md`](../docs/architecture/trust-kernel-boundary.md).

## Acceptance clauses

1. No plugin unload, service override, or dynamic mount can replace the kernel's policy, audit, or signature verifier. At the Contract stage this is a structural guarantee: `TrustKernel`'s type surface exports nothing shaped like a replaceable Cordis service, and its three opaque handle types cannot be constructed without an explicit unsafe cast that this package does not export. Full runtime enforcement — a constructed kernel value surviving an attempted override at boot — is a later, U-stage acceptance case.
2. The Kernel API surface carries no model-visible text, no business-domain logic, and no concrete provider implementation. [`packages/kernel/trust-kernel/tests/boundary.spec.ts`](../packages/kernel/trust-kernel/tests/boundary.spec.ts) verifies this structurally: `src/types.ts` has no imports, only type-only top-level statements, and exactly the six required `readonly` members.
3. When the kernel is not initialized, a production profile fails closed; a development profile may explicitly enable an insecure mode and displays a permanent warning. *(U-stage: boot behavior, not this Contract-stage slice.)*

## Contract-stage slice

This spec's Contract-stage evidence is:

- `packages/kernel/trust-kernel/src/types.ts` — the `TrustKernel` type surface above.
- `packages/kernel/trust-kernel/src/invariant.ts` — the package's invariant companion; explained-empty at this stage (no constructed `TrustKernel` value exists yet to check).
- `packages/kernel/trust-kernel/tests/boundary.spec.ts` — structural verification of must clauses 2–4 and acceptance clause 2 above.
- `docs/architecture/trust-kernel-boundary.md` — the boundary rationale.

Must clause 1, and acceptance clauses 1 (full runtime enforcement) and 3, require a constructed `TrustKernel` and profile-boot wiring; they are owned by the later slice that adds `packages/kernel/trust-kernel/src/index.ts` and the corresponding `packages/boot/app-boot` changes.
