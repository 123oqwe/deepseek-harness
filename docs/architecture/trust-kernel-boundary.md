# Trust Kernel Boundary

English | [中文](trust-kernel-boundary.zh.md)

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
- Its `TrustKernelRootIdentity`, `TrustKernelSignatureRoots`, and `TrustKernelSecretBrokerHandle` handles are branded by a symbol the module declares but never exports: no exported value or function in this package produces one. Forging one still requires a deliberate, greppable unsafe operation at the call site — an `as` cast, `Object.create`, or an unconstrained generic — not something this module makes convenient or accidental. This is deliberately not the `Branded<B>` string-brand idiom from `@deepseek-ai/dsh-brand`: that brand is a bare string at runtime and its `brandString()` helper casts any string to it, which fits a nominal *identifier* but not an unforgeable *capability*.
- Every member is `readonly`; nothing in the surface is a setter.

A later slice constructs the one `TrustKernel` value before the Cordis `Context` exists at all, deep-freezes it, and pins it into the context with `ctx.provide('trustKernel', kernel)` — the same mechanism `packages/boot/app-boot/src/index.ts` already uses for `ctx.provide('dshHomePath', dshHomePath)`. `ctx.provide` writes a value the Loader never sees: no config row, patch, or plugin unload can reach it, because none of those act on anything the Loader did not itself mount. Contrast `ctx.plugin(...)`, which registers through the Loader and is exactly what stays reachable by config, patches, and unload — the mechanism every other capability in this list correctly uses.

`ctx.provide` alone only guards double-registration by checking whether `ctx.reflect.store`'s entry is already set — and that store is a plain, mutable object any plugin with `ctx` access can read. `@deepseek-ai/dsh-trust-kernel`'s `pinTrustKernel(ctx, kernel)` closes the resulting delete-then-reprovide bypass by freezing that specific store entry (`Object.defineProperty(..., { writable: false, configurable: false })`) immediately after `ctx.provide` succeeds, so both a direct `delete` and a direct reassignment throw; `apps/cli/src/profile-boot.ts` calls `pinTrustKernel`, never a bare `ctx.provide`, for this reason.

A later review found that freeze alone left three further live bypasses open, all closed in the same `pinTrustKernel` call: the frozen slot's `Impl` record was itself a mutable object (`impl.value = forged` forged `ctx.get('trustKernel')` too, without touching the slot); `ctx.trustKernel` PROPERTY access resolves through the ROOT fiber's own separately mutable `store`, never through `ctx.reflect.store`, and was globally poisonable from any plugin; and `ctx.reflect.props['trustKernel']` could be overwritten with a substitute accessor intercepting that same property access ahead of everything else. `pinTrustKernel` now also freezes the `Impl` record, locks the root fiber's store entry, and locks the `reflect.props` registration — see `packages/kernel/trust-kernel/src/index.ts`'s `pinTrustKernel` doc comment for each fix's vendored-Cordis citation, and `packages/kernel/trust-kernel/tests/pin-hardening.spec.ts` for the runtime proof.

### Known residual: self-subtree property-access poisoning

`pinTrustKernel` now protects `ctx.get('trustKernel')` fully, and protects `ctx.trustKernel` property access globally against every OTHER plugin, at the root, and across siblings. One residual survives: a plugin can still assign into ITS OWN fiber's `store` cache (`ctx.fiber.store['trustKernel'] = forged`) — a write the parent-fiber-chain walk finds before it ever reaches the root fiber's store entry `pinTrustKernel` locks. This durably poisons what `ctx.trustKernel` (property access only, never `ctx.get`) resolves to for that plugin and its own descendants, never for siblings or the root (proven live, not merely theoretical). No defensive wrapper in this repository's own code closes this without touching vendored Cordis's `Fiber` class, which this repository's vendoring policy forbids. `ctx.get('trustKernel')` has no residual at all; prefer it over `ctx.trustKernel` regardless. A CI-enforced gate, `verify-trust-kernel-property-access` (wired into `doc-sync`/`ci-primary`/`ci-static`/`check-all`), now rejects any real, non-vendor, non-test source reading the bare `ctx.trustKernel` property, forcing every consumer through `ctx.get('trustKernel')` — this residual is structurally maintained unreachable going forward, not merely unreachable today by grep (`spec/first100/exec/BLOCKED-QUEUE.md`, BLOCKED-011).

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
