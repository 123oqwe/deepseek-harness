# Trust Kernel Boundary

Epic P0-02 (`确立 Minimal Immutable Trust Kernel 边界`) is the first exception to [`docs/architecture.md`](../architecture.md)'s claim that "there is no privileged core to patch" and "every part of the product is a plugin." This page names that exception precisely: what the Trust Kernel owns, why none of it is a Cordis plugin, and what stays a plugin around it. A later slice of this same epic corrects `docs/architecture.md` itself to cross-reference this page instead of repeating the unqualified claim.

## What the kernel owns

The kernel owns exactly six capabilities — no more:

- **Root identity** — the process's one root identity.
- **Signature roots** — the process's signature-verification trust anchors.
- **A policy-enforcement entrypoint** — a narrow, domain-agnostic allow/deny call.
- **Audit append** — an append-only entrypoint into the audit-chain root.
- **A secret-broker handle** — an opaque reference callers present to a secret-broker consumer, never a secret value.
- **A sandbox-attestation verifier** — a narrow, side-effect-free check.

[`packages/kernel/trust-kernel/src/types.ts`](../../packages/kernel/trust-kernel/src/types.ts) declares this surface as the `TrustKernel` interface: exactly these six `readonly` members, each a narrow function type or an opaque, unforgeable handle. The kernel's own type surface carries no model-visible text, no business-domain logic, and no concrete provider implementation — every payload it accepts (`TrustKernelPolicyQuery.payload`, `TrustKernelAuditEntry.payload`, `TrustKernelSandboxAttestation.payload`) is `unknown` to the kernel; interpreting that payload is the calling plugin's job, not the kernel's.

## Why the kernel is never a Cordis Service

Every other part of dsh is a plugin: contributed through `ctx.plugin(...)`, resolved through the Loader, replaceable by a config row, a patch, or a plugin unload. The Trust Kernel cannot be, because a plugin that can replace the service that limits itself makes every production invariant the kernel is meant to hold conditional on no other plugin choosing to override it.

`packages/kernel/trust-kernel/src/types.ts` reflects this at the type level:

- It exports no `Config` schema and no `apply(ctx, config)` plugin entry — nothing in it has the shape the Loader mounts.
- Its `TrustKernelRootIdentity`, `TrustKernelSignatureRoots`, and `TrustKernelSecretBrokerHandle` handles are branded by a symbol the module declares but never exports, so no caller — including a plugin that imports this module — can construct one without an explicit unsafe cast. This is deliberately not the `Branded<B>` string-brand idiom from `@deepseek-ai/dsh-brand`: that brand is a bare string at runtime and its `brandString()` helper casts any string to it, which fits a nominal *identifier* but not an unforgeable *capability*.
- Every member is `readonly`; nothing in the surface is a setter.

A later slice constructs the one `TrustKernel` value before the Cordis `Context` exists at all, deep-freezes it, and pins it into the context with `ctx.provide('trustKernel', kernel)` — the same mechanism `packages/boot/app-boot/src/index.ts` already uses for `ctx.provide('dshHomePath', dshHomePath)`. `ctx.provide` writes a value the Loader never sees: no config row, patch, or plugin unload can reach it, because none of those act on anything the Loader did not itself mount. Contrast `ctx.plugin(...)`, which registers through the Loader and is exactly what stays reachable by config, patches, and unload — the mechanism every other capability in this list correctly uses.

## What remains a plugin

Everything the kernel does not name above stays an ordinary, replaceable Cordis plugin, composed and patched the same way as the rest of dsh:

- **Models** — the model adapter and every LLM provider.
- **Tools** — the tool registry and every model-facing tool.
- **Storage providers** — session persistence, settings, storage, and credential-record backends.
- **Workflow** — the workflow engine and its providers.
- **Memory provider** — compaction and session-projection providers.
- **UI** — the web client, host gateway, and every other surface.

A plugin in this list may itself call into the kernel's narrow entrypoints (`policyEnforcement`, `auditAppend`, `sandboxAttestationVerifier`) or present its `secretBroker` handle to a consumer that expects one; it can never replace what issued them.

## What is never a plugin

The inverse of the owned-capability list above: root identity, deny enforcement (the kernel's policy-enforcement entrypoint), the audit-chain root, and the signature-verification root never move behind `ctx.plugin(...)`, regardless of what composition, patch, or profile is loaded.

## Scope of this page

This page documents the Contract-stage type surface (`packages/kernel/trust-kernel/src/types.ts`, [`packages/kernel/trust-kernel/tests/boundary.spec.ts`](../../packages/kernel/trust-kernel/tests/boundary.spec.ts)) and the boundary it fixes. It does not cover the later construction slice (`src/index.ts`) or its boot-time behavior — initializing the kernel before the Cordis `Context` exists, and the production fail-closed / development insecure-mode-warning split when it is not initialized. Those are Epic P0-02's U-stage acceptance clauses, verified once that slice lands.
