---
description: "The minimal, non-replaceable Trust Kernel type surface for users and maintainers who need to know exactly what the kernel owns and what stays a plugin around it."
kind: "package-reference"
---

# @deepseek-ai/dsh-trust-kernel

English | [中文](README.zh.md)

## Summary

`dsh-trust-kernel` fixes the narrow, unforgeable capability surface Epic P0-02's Trust Kernel may ever hand to the runtime: one root identity, one signature-roots handle, a policy-enforcement entrypoint, an audit-append entrypoint, a secret-broker handle, and a sandbox-attestation verifier — six members, no more. Everything else in dsh — models, tools, storage providers, workflow, memory providers, UI — stays an ordinary, replaceable Cordis plugin; see `docs/architecture/trust-kernel-boundary.md` for the full boundary and why none of the six is a Cordis Service.

`src/index.ts`'s `createTrustKernel` constructs and deep-freezes the one `TrustKernel` value; `apps/cli/src/profile-boot.ts` calls it before the Cordis `Context` exists and pins the result with `pinTrustKernel(ctx, kernel)`. Beyond `ctx.provide('trustKernel', kernel)`, `pinTrustKernel` locks every reachable path a plugin could use to forge or replace the pin: the service-store slot, the `Impl` record living at that slot, the root fiber's own store entry (one path `ctx.trustKernel` property access resolves through), and the `reflect.props` registration a plugin could otherwise substitute with a forging accessor. `ctx.get('trustKernel')` is fully protected in every case; `ctx.trustKernel` (property access) carries a residual reachable across the plugin tree — a sibling plugin or one mounted later, not merely the attacker's own descendants — that a CI-enforced gate keeps unreachable in today's real source rather than closed at the mechanism level; see [Known Limitations and Deferred Work](#known-limitations-and-deferred-work).

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

Import the `TrustKernel` type surface to type a capability a plugin receives — never to construct one:

```ts
import type { TrustKernel, TrustKernelPolicyQuery } from '@deepseek-ai/dsh-trust-kernel/types'

declare function handleRequest(kernel: TrustKernel): void

function checkPolicy(kernel: TrustKernel, payload: unknown): boolean {
  const query: TrustKernelPolicyQuery = { payload }
  return kernel.policyEnforcement(query) === 'allow'
}
```

There is no exported constructor for `TrustKernelRootIdentity`, `TrustKernelSignatureRoots`, or `TrustKernelSecretBrokerHandle` individually — only `createTrustKernel()` produces a complete, frozen `TrustKernel`:

```ts
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'

const kernel = createTrustKernel() // called before the Cordis Context exists
// ...then, inside boot()'s prepare closure, once the Context does exist:
// pinTrustKernel(ctx, kernel) -- never ctx.plugin(...), never a bare ctx.provide()
```

`apps/cli/src/profile-boot.ts` is the one caller: it constructs the kernel before `boot()` creates the Cordis `Context` at all, then pins it into that context from the `prepare` closure `boot()` already exposes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Exactly six owned capabilities, never more.** `TrustKernel` declares only what Epic P0-02's must clause names: root identity, signature roots, a policy-enforcement entrypoint, audit-append, a secret-broker handle, and a sandbox-attestation verifier.
- **Unforgeable handles, not branded strings.** `TrustKernelRootIdentity`, `TrustKernelSignatureRoots`, and `TrustKernelSecretBrokerHandle` are each branded by a symbol this module declares but never exports, so no caller can construct one without an explicit unsafe cast. This is deliberately not the `Branded<B>` string-brand idiom from `@deepseek-ai/dsh-brand`: a `Branded<B>` is a bare string at runtime, and its `brandString()` helper casts any string to it — correct for a nominal *identifier*, wrong for an unforgeable *capability*.
- **Domain-agnostic entrypoints.** `policyEnforcement`, `auditAppend`, and `sandboxAttestationVerifier` accept only opaque (`unknown`) payloads. The kernel routes and appends; it never interprets what a query, an audit entry, or an attestation means — that stays business-domain logic in the calling plugin.
- **Never a Cordis plugin.** The package exports no `Config` schema and no `apply(ctx, config)` entry, so nothing here can be mounted with `ctx.plugin(...)`, patched by a `cordis.patch.yml` row, or replaced by a plugin unload.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The `TrustKernel` type surface: its six capability members, the three opaque handle types, and the three narrow entrypoint function types |
| [`src/index.ts`](src/index.ts) | `createTrustKernel()`: constructs and deep-freezes the one `TrustKernel` value; `policyEnforcement` denies, `sandboxAttestationVerifier` rejects, and `auditAppend` no-ops until a later epic wires real providers. `pinTrustKernel()`: pins it into a `Context` with `ctx.provide`, then locks the service-store slot, its `Impl` record, the root fiber's store entry, and the `reflect.props` registration so no plugin can forge, delete-then-reprovide, or substitute-an-accessor-for the pin |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: explained-empty — the single-pin identity guarantee is enforced by Cordis's own service-store semantics, not by any event or mutable data this package owns |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- `docs/architecture/trust-kernel-boundary.md` — what the kernel owns, why none of it is a Cordis Service, and the plugin/never-plugin split around it.
- [`spec/trust-kernel.md`](../../../spec/trust-kernel.md) — the normative capability surface and Epic P0-02's must/acceptance clauses.
- [`packages/boot/app-boot`](../../boot/app-boot/README.md) — owns `ctx.provide('dshHomePath', ...)`, the pattern `apps/cli/src/profile-boot.ts` follows to pin the constructed `TrustKernel` into a Cordis `Context`.

-----

<a id="model-experience"></a>
## Model Experience

### Kernel type surface

#### What the model sees

Nothing. `createTrustKernel()`'s six members carry no model-visible text (per `spec/trust-kernel.md` acceptance clause 2), so nothing in this package can render into a model request, system prompt, or tool schema.

#### Token effect

Zero-direct: the package contributes no prompt or schema text.

#### KV Cache effect

Independent: the package registers nothing that participates in a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No concrete policy/audit/attestation provider yet** — `policyEnforcement` denies, `sandboxAttestationVerifier` rejects, and `auditAppend` no-ops unconditionally; wiring a real policy engine, audit-chain persistence, or attestation verifier behind these entrypoints is a later epic's deliverable (`spec/trust-kernel.md` acceptance clause 2 keeps this package's own API surface free of any concrete provider implementation).
- **Boot-time fail-closed/insecure-opt-in enforcement lives in `apps/cli`, not this package** — `apps/cli/src/profile-boot.ts`'s `enforceTrustKernelPosture` and the `DSH_TRUST_KERNEL_INSECURE` opt-in own the production-fails-closed / development-insecure-warning split (Epic P0-02 acceptance clause 3); this package only constructs and freezes the value that decision pins or omits.
- **`pinTrustKernel` protects `ctx.get('trustKernel')` fully; `ctx.trustKernel` property access carries a residual reachable across the plugin tree, not merely the attacker's own subtree** — `ctx.trustKernel` resolves by walking each fiber's own `Fiber.store` cache up to the root fiber's store, and `pinTrustKernel` locks only the `trustKernel` key inside that root store object. Three vectors reach past that lock: poisoning an ANCESTOR (non-root) fiber's store reaches every plugin nested under it, siblings included, not merely the attacker's descendants; wholesale replacement of the root fiber's `store` object (a plain, public, writable field `pinTrustKernel` never locks as a whole) silently voids the key-lock for every context that subsequently reaches the root; and a registry-wide sweep poisons every currently-live fiber in one pass — all proven live in `tests/pin-hardening.spec.ts`'s "vector G"/"vector H" (the sweep vector shares vector G's mechanism, applied to every fiber). `ctx.get('trustKernel')` stays correct in every vector, and so does the root Context's own DIRECT property read (`ctx.root.trustKernel`, not through another context reference) — Cordis's proxy `get` trap short-circuits to `ReflectService.get` for the root fiber specifically, never walking the poisoned chain. Reads through any OTHER context, including a sibling or a plugin mounted later, are exposed. No defensive wrapper in this repository's own code closes the ancestor or sweep vectors without touching vendored Cordis's `Fiber` class — a maintainer decision, not this slice's to make unilaterally; see `docs/architecture/trust-kernel-boundary.md#known-residual-cross-plugin-property-access-poisoning`. Prefer `ctx.get('trustKernel')` regardless — it has no residual at all. A CI-enforced gate, `verify-trust-kernel-property-access`, rejects any real, non-vendor, non-test source reading the bare `ctx.trustKernel` property — dotted, bracket, destructured, or a key resolving to `'trustKernel'` only through the type checker — so this residual is maintained unreachable in today's real source, not closed at the Cordis mechanism level: the gate stops this repository's own code from exercising the unsafe path, it does not change what Cordis itself does (`spec/first100/exec/BLOCKED-QUEUE.md`, BLOCKED-011).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
