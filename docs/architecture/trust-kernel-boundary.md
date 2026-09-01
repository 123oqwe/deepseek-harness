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

### Known residual: cross-plugin property-access poisoning

`pinTrustKernel` protects `ctx.get('trustKernel')` fully in every case tested, including every vector below. `ctx.trustKernel` (property access, not `ctx.get`) carries a residual that is reachable much more broadly than an earlier slice of this same review documented: **not** self-subtree only. Cordis's proxy `get` trap resolves `ctx.trustKernel` by walking each fiber's own `store` cache up the parent-fiber chain (`vendor/cordis/src/reflect.ts:150-167`); `pinTrustKernel` locks only the `trustKernel` key inside the ROOT fiber's `store` object (`vendor/cordis/src/fiber.ts:198,324`). Three vectors reach past that lock:

- **Poisoning an ancestor (non-root) fiber's store** (`ctx.fiber.parent.fiber.store['trustKernel'] = forged`) — a plain mutable object `pinTrustKernel` never touches — poisons `ctx.trustKernel` for every plugin nested under that ancestor, including an unrelated sibling, never merely the attacker's own descendants.
- **Wholesale replacement of the root fiber's `store` object** (`ctx.root.fiber.store = { ...forged }`) — `Fiber.store` is itself a plain, public, writable field; `pinTrustKernel`'s `Object.defineProperty` locks the `trustKernel` KEY inside the original store object, but any plugin can replace the entire store OBJECT with no throw, silently voiding that lock for every context whose lookup subsequently reaches the root.
- **A registry-wide sweep** — iterating every runtime's fibers and poisoning each one's `store` entry in one pass — reaches every currently-live fiber at once.

The one invariant that survives every vector: `ctx.get('trustKernel')` stays correct always (it never consults `Fiber.store`), and the root Context's own DIRECT property read (`ctx.root.trustKernel`, not through any other context reference) stays correct — the root fiber's `runtime === null` makes Cordis's proxy `get` trap short-circuit straight to `ReflectService.get` for the root itself, never walking the fiber-store chain the vectors above poison (`vendor/cordis/src/reflect.ts`). Reads through any OTHER context object, including a freshly-mounted sibling or a plugin mounted later, are exposed. `packages/kernel/trust-kernel/tests/pin-hardening.spec.ts`'s "vector G" and "vector H" tests reproduce the first two vectors live; the sweep vector follows the same mechanism as vector G, applied to every fiber instead of one.

Wholesale store-object replacement (the second vector) is not trivially closable inside `pinTrustKernel`: freezing `ctx.root.fiber.store` itself as a slot would break real teardown (`Fiber._unload()` sets `this.store = undefined`; root-fiber disposal is `restart()`). The ancestor and sweep vectors need a vendored Cordis `Fiber` change to close fully; this repository's vendoring policy reserves that as a maintainer decision, not something this slice may do unilaterally.

This residual is **maintained unreachable in today's real (non-test, non-vendor) source** by a CI-enforced gate, `verify-trust-kernel-property-access` (wired into `doc-sync`/`ci-primary`/`ci-static`/`check-all`): it rejects any real source reading the bare `ctx.trustKernel` property — dotted access, bracket access, destructuring, or a key resolving to `'trustKernel'` only through the type checker (`const K = 'trustKernel' as const; ctx[K]`, a template-literal-typed key, `Reflect.get(ctx, 'trustKernel')`) — forcing every real consumer through `ctx.get('trustKernel')`. **The gate does not change what Cordis itself does.** It prevents this repository's own code from exercising the unsafe path; the underlying mechanism (Cordis's fiber-local property resolution) remains genuinely exploitable by any code that writes such an access, inside or outside this repository's gated surface (`spec/first100/exec/BLOCKED-QUEUE.md`, BLOCKED-011).

An exhaustive grep of this repository's real, non-test, non-vendor TypeScript source (`grep -rn '\.trustKernel\b' packages apps`, excluding `vendor`/`tests`) found zero property-access reads before this fix and finds zero after it — the ONLY real (non-test) consumer, `apps/cli/src/profile-boot.ts`, exclusively uses `ctx.get('trustKernel')`. This proves **"no real property-read consumer exists in this repository today,"** re-verified as still true after this slice's fixes — it does NOT prove the underlying Cordis mechanism is structurally safe, and does not by itself explain why a future consumer can't reintroduce the read: the gate above is what does that, mechanically, going forward.

**Status as of 2026-09-01 (user decision, BLOCKED-011): deferred, not permanently accepted.** Four independent adversarial review rounds each found the gate could still be defeated by a genuinely new form (most decisively: `<K extends 'trustKernel'>(c: Context, k: K) => c[k]`, a plain TypeScript generic with no cast or `any` anywhere, reading the live kernel through a type parameter the gate's AST walk never sees a literal at) — proof that a purely static, source-level gate cannot structurally close this class for good, only narrow it. The user accepted P0-02.F's close on this basis specifically because the residual is *currently* unreachable (no real consumer exists) — not because the gate is airtight. **Before any future epic wires a real policy/audit/signature-verifier enforcement point consuming the Trust Kernel (P2-05 and similar, expected around W6), the vendored Cordis `Fiber` structural fix (Option A) is a hard prerequisite**, with a real negative-case proof it preserves `Fiber._unload()`/normal fiber teardown. That triggering epic's Reviewer must explicitly verify Option A has landed before proceeding — see `.claude/goal.md`'s standing rules and `spec/first100/exec/BLOCKED-QUEUE.md`'s BLOCKED-011 entry.

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
