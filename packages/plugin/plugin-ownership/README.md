---
description: "The Contract-stage type surface and pure decision-function signatures for Epic P1-09's Service/Tool/Event namespace and ownership conflict detection, for maintainers picking up the RED-scaffold fix-round."
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-ownership

## Summary

`dsh-plugin-ownership` fixes the type surface and function signatures for Epic P1-09's Service/Tool/Event namespace and ownership conflict detection: every registration carries a `PluginIdentity`, `Namespace`, `StableCapabilityId`, and a registry-minted `OwnershipToken` (must[0]); the officially reserved `dsh.*` namespace tree cannot be claimed by a plugin outside `RegistryPolicy.officialPluginIdentities` (must[1]); overriding an existing registration requires an explicit `ReplaceContract`, itself gated by `RegistryPolicy.allowReplace` (must[2]); and unloading a plugin revokes only the effects whose stored `OwnershipToken` matches the one presented (must[3]).

This package currently ships this epic's Contract-stage RED scaffold only: `src/types.ts`'s types and `src/index.ts`'s function signatures are real and epic-accurate, but every decision function (`claimCapability`, `requestReplace`, `revokeByOwnershipToken`, `buildInventoryChain`, `mintOwnershipToken`) throws `'not implemented: ...'` — the pure decision logic itself is a later fix-round's deliverable, proven by `tests/ownership.spec.ts`'s real assertions against that (currently failing) behavior. `isReservedNamespace`/`RESERVED_NAMESPACE_ROOT` are the one exception: a real, already-correct one-line predicate directly grounded in the registry's own validation text, not itself the adjudication logic under test. No invariant companion is published because this Contract-stage slice constructs no registry or `Context` value yet to check an owned relation over.

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

Every export is a pure function over already-computed data: no export in this package reads a file, spawns a process, or constructs a Cordis `Context` — a later Usage-stage caller supplies `existing`/`policy` from a real registry and Cordis `Fiber` state.

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
| [`src/index.ts`](src/index.ts) | `isReservedNamespace`/`RESERVED_NAMESPACE_ROOT` (real), and `claimCapability`/`requestReplace`/`revokeByOwnershipToken`/`buildInventoryChain`/`mintOwnershipToken` (Contract-stage RED scaffold — real signatures, `'not implemented'` bodies) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/ownership.spec.ts`](tests/ownership.spec.ts) — the Contract-stage RED scaffold: one case per registry-declared acceptance clause (acceptance[0] split into its three named fail-closed scenarios) plus every structurally testable must[] clause.
- [`packages/extensions/cordis-host-runner/src/registry.ts`](../../extensions/cordis-host-runner/src/registry.ts) — the dynamic Cordis plugin/package registry acceptance[2] requires this epic's rules to also cover (Usage-stage wiring, not this package's job).
- [`packages/host/plugin-inventory/src/index.ts`](../../host/plugin-inventory/src/index.ts) — the real Inventory surface acceptance[1]'s replaced/replacing chain (`buildInventoryChain`) is meant to feed (Usage-stage wiring, not this package's job).
- [`@deepseek-ai/dsh-plugin-manifest`](../plugin-manifest/README.md) — this repo's other Contract-stage plugin-capability package, followed here for package layout and pure-function conventions.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure decision-function signatures only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No wiring into real Cordis registration exists yet.** `packages/extensions/cordis-host-runner/src/registry.ts`/`lifecycle.ts`, `packages/core/tools/src/index.ts`, and `packages/host/plugin-inventory/src/index.ts` do not call into this package (registry's own `stages.U.files`) — this package alone cannot reject a real tool/service/event registration or enforce anything at a real plugin boot or unload.
- **`StableCapabilityId`'s exact string grammar is unfixed.** This Contract stage does not commit to a concrete `${Namespace}:${string}` separator or a validation regex for it — the Usage-stage integration, once it has a real `ctx` key/tool name/event name to namespace, decides that grammar and any format validation.
- **`buildInventoryChain` never populates `replacedBy`.** It reports only each capability id's terminal (current-owner) state, consistent with the type's "absent while current still owns it" contract — no frozen case exercises the non-terminal, already-superseded shape.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
