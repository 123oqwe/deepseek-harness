---
description: "The Contract-stage type surface and pure decision-function signatures for Epic P1-09's Service/Tool/Event namespace and ownership conflict detection, covering namespace claims, ownership tokens, replacement adjudication, and the inventory chain."
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-ownership

## Summary

`dsh-plugin-ownership` fixes the type surface and function signatures for Epic P1-09's Service/Tool/Event namespace and ownership conflict detection: every registration carries a `PluginIdentity`, `Namespace`, `StableCapabilityId`, and a registry-minted `OwnershipToken` (must[0]); the officially reserved `dsh.*` namespace tree cannot be claimed by a plugin outside `RegistryPolicy.officialPluginIdentities` (must[1]); overriding an existing registration requires an explicit `ReplaceContract`, itself gated by `RegistryPolicy.allowReplace` (must[2]); and unloading a plugin revokes only the effects whose stored `OwnershipToken` matches the one presented (must[3]).

This package ships this epic's Contract stage, and its decisions now run on the real registration path — see [Known Limitations](#known-limitations-and-deferred-work) for what that does and does not cover: `src/types.ts`'s types and `src/index.ts`'s decision functions — `claimCapability`, `requestReplace`, `revokeByOwnershipToken`, `buildInventoryChain`, `mintOwnershipToken`, plus the `isReservedNamespace`/`RESERVED_NAMESPACE_ROOT` predicate — are implemented and proven by `tests/ownership.spec.ts`'s 13 cases, one per registry-declared acceptance clause (acceptance[0] split into its three named fail-closed scenarios) plus every structurally testable must[] clause. Every export is a pure function over caller-supplied data: none reads a file, spawns a process, or constructs a Cordis `Context`. No invariant companion is published because this Contract-stage slice constructs no registry or `Context` value yet to check an owned relation over.

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

The registry decision surface, once implemented, is called with plain data — no file, process, or Cordis `Context` access:

```ts
import { claimCapability, requestReplace, revokeByOwnershipToken, isReservedNamespace } from '@deepseek-ai/dsh-plugin-ownership'
import type { CapabilityRegistration, RegistryPolicy } from '@deepseek-ai/dsh-plugin-ownership/types'

declare const existing: readonly CapabilityRegistration[] // every registration the registry already admitted
declare const policy: RegistryPolicy // officialPluginIdentities + allowReplace, supplied by configuration

const decision = claimCapability(
  { pluginIdentity, namespace, capabilityId, kind: 'tool', origin: 'static' },
  existing,
  policy,
)
// decision.admitted is false with reason 'namespace-reserved' | 'capability-collision'
// when the namespace is reserved (isReservedNamespace) and pluginIdentity is unofficial,
// or when capabilityId already has a different active owner
```

Every export is a pure function over already-computed data: no export in this package reads a file, spawns a process, or constructs a Cordis `Context`. `@deepseek-ai/dsh-tools` is the real caller — it supplies `existing` from its live ownership records and `policy` from its validated `ownership` config.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Branded, not bare, cross-boundary ids.** `PluginIdentity`, `Namespace`, `StableCapabilityId`, and `OwnershipToken` each use `@deepseek-ai/dsh-brand`'s `Branded<B>`, mirroring `@deepseek-ai/dsh-cordis-host-runner`'s `CordisDynamicPluginId`/`CordisDynamicPackageId` rather than accepting bare, interchangeable `string`s for identities this repo's own house rules require to stay unforgeable at the type level.
- **Reserved-namespace policy is order-independent.** `claimCapability` decides `'namespace-reserved'` from `RegistryPolicy.officialPluginIdentities` alone, never from whether an existing registration is present — an attacker registering first (acceptance[0]'s load-order attack) gains no standing this fixed allowlist does not already grant.
- **No hidden fallback revocation path.** `revokeByOwnershipToken` accepts only a token, never a capability id or plugin identity a caller could substitute to bypass ownership — acceptance[0]'s cross-plugin revocation has no API surface to attempt through.
- **Origin-blind rules.** `CapabilityOrigin` (`'static'` | `'dynamic'`) is threaded through every type, but no exported function branches on it — acceptance[2]'s requirement that dynamically defined Cordis capabilities (`@deepseek-ai/dsh-cordis-host-runner`'s `define` RPC) obey the same rules as statically loaded ones is structural, not a special case to remember to add later.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The registration/policy/decision type surface: `CapabilityRegistration`, `ReplaceContract`, `RegistryPolicy`, `RegistrationDecision`, `InventoryChainEntry`, `RevocationResult` |
| [`src/index.ts`](src/index.ts) | `isReservedNamespace`/`RESERVED_NAMESPACE_ROOT`, and the `claimCapability`/`requestReplace`/`revokeByOwnershipToken`/`buildInventoryChain`/`mintOwnershipToken` decision functions |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`packages/core/tools/README.md`](../../core/tools/README.md) — the real tool registry that calls `claimCapability`/`requestReplace`/`revokeByOwnershipToken` on every registration.
- [`tests/ownership.spec.ts`](tests/ownership.spec.ts) — 13 cases: one case per registry-declared acceptance clause (acceptance[0] split into its three named fail-closed scenarios) plus every structurally testable must[] clause.
- [`packages/extensions/cordis-host-runner/src/guard.ts`](../../extensions/cordis-host-runner/src/guard.ts) — the sandbox context façade that applies the reserved-namespace rule to a dynamically defined package's `ctx.provide`/`ctx.on`.
- [`packages/host/plugin-inventory/src/index.ts`](../../host/plugin-inventory/src/index.ts) — `buildToolOwnershipChain`, the real Inventory surface `buildInventoryChain` feeds.
- [`@deepseek-ai/dsh-plugin-manifest`](../plugin-manifest/README.md) — this repo's other Contract-stage plugin-capability package, followed here for package layout and pure-function conventions.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure decision-function signatures only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Service and Event registration is enforced for the dynamic origin only.** The Usage stage wired these decisions into `packages/core/tools/src/index.ts` (every tool registration, both origins), `packages/extensions/cordis-host-runner/src/guard.ts` (a dynamically defined package's `ctx.provide`/`ctx.on`), and `packages/host/plugin-inventory/src/index.ts` (the replaced/replacing chain). A STATICALLY loaded plugin's `ctx.provide`/`ctx.on` are still ungated: both are implemented in `vendor/cordis`, and the Trust Kernel boundary puts a vendored enforcement point behind the `Fiber` fix. Closing that residual belongs to whoever lands it.
- **`StableCapabilityId`'s string grammar is fixed by its callers, not here.** The Usage-stage integration settled on a dotted grammar — a name's namespace is everything before its last `.`, so `dsh.core.read_file` sits under `dsh.core` — matching this epic's own `dsh.*` validation text. This package still commits to no separator or validation regex of its own.
- **`buildInventoryChain` never populates `replacedBy`.** It reports only each capability id's terminal (current-owner) state, consistent with the type's "absent while current still owns it" contract — no frozen case exercises the non-terminal, already-superseded shape.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
