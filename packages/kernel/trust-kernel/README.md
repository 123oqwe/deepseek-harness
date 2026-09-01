---
description: "The minimal, non-replaceable Trust Kernel type surface for users and maintainers who need to know exactly what the kernel owns and what stays a plugin around it."
kind: "package-library"
---

# @deepseek-ai/dsh-trust-kernel

English | [中文](README.zh.md)

## Summary

`dsh-trust-kernel` fixes the narrow, unforgeable capability surface Epic P0-02's Trust Kernel may ever hand to the runtime: one root identity, one signature-roots handle, a policy-enforcement entrypoint, an audit-append entrypoint, a secret-broker handle, and a sandbox-attestation verifier — six members, no more. Everything else in dsh — models, tools, storage providers, workflow, memory providers, UI — stays an ordinary, replaceable Cordis plugin; see `docs/architecture/trust-kernel-boundary.md` for the full boundary and why none of the six is a Cordis Service.

This package currently ships its Contract-stage slice only: the `TrustKernel` type surface (`src/types.ts`) and its invariant companion (`src/invariant.ts`). It has no `src/index.ts` yet — no constructed `TrustKernel` value and no `ctx.provide` wiring exist in this slice. See [Known Limitations and Deferred Work](#known-limitations-and-deferred-work).

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

There is no exported constructor for `TrustKernel` or for its three opaque handle members (`TrustKernelRootIdentity`, `TrustKernelSignatureRoots`, `TrustKernelSecretBrokerHandle`) in this package. A later slice's `src/index.ts` is the one place that constructs a `TrustKernel` value and pins it into a Cordis `Context` with `ctx.provide('trustKernel', kernel)`, before that context otherwise exists.

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
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: explained-empty at this Contract-stage slice — no constructed `TrustKernel` value exists yet to check |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- `docs/architecture/trust-kernel-boundary.md` — what the kernel owns, why none of it is a Cordis Service, and the plugin/never-plugin split around it.
- [`spec/trust-kernel.md`](../../../spec/trust-kernel.md) — the normative capability surface and Epic P0-02's must/acceptance clauses.
- [`packages/boot/app-boot`](../../boot/app-boot/README.md) — owns `ctx.provide('dshHomePath', ...)`, the precedent for how a later slice pins a constructed `TrustKernel` into a Cordis `Context`.

-----

<a id="model-experience"></a>
## Model Experience

### Kernel type surface

#### What the model sees

Nothing. This Contract-stage slice exports types only — `src/types.ts` contributes no runtime value, so nothing in this package can render into a model request, system prompt, or tool schema.

#### Token effect

Zero-direct: the package contributes no prompt or schema text.

#### KV Cache effect

Independent: the package registers nothing that participates in a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No constructed `TrustKernel` value yet** — this Contract-stage slice ships only the type surface and an explained-empty invariant companion; `src/index.ts` (construction, `ctx.provide` wiring, and the runtime-frozen deep-immutability check) is a later slice's deliverable. See [`spec/trust-kernel.md`](../../../spec/trust-kernel.md#contract-stage-slice).
- **No boot-time enforcement yet** — the production fail-closed / development insecure-mode-warning behavior when the kernel is not initialized belongs to that same later slice and `packages/boot/app-boot`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
