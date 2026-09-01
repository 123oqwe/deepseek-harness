---
description: "The Contract-stage type surface for Epic P0-05's Shadow/Enforce feature gates: unified state, per-gate lifecycle metadata, settings-namespace interop, override-chain shape, and the shadow/legacy decision-diff record."
kind: "package-reference"
---

# @deepseek-ai/dsh-feature-gates

## Summary

`dsh-feature-gates` fixes the Contract-stage type surface for Epic P0-05 (Shadow/Enforce feature gates for major capabilities): the unified `off | shadow | enforce` {@link FeatureGateState}, the fixed lifecycle metadata every gate records (`owner`, `introducedVersion`, `defaultByProfile`, `removalVersion`), the JSON-safe settings-namespace value shape a `feature-gates` registration would carry, the `--dump-config` override-chain shape, the sanitized shadow/legacy decision-diff record, and the release-gate expiry check signature.

This package currently has no runtime code: `src/index.ts` is a pure `export type *` re-export of `src/types.ts`, and `src/invariant.ts` is an explained-empty companion. Gate registration and evaluation (Provider stage) and CLI/profile wiring (`--dump-config`, Usage stage) are later slices' deliverables — see [Known Limitations and Deferred Work](#known-limitations-and-deferred-work).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Import the contract types to describe a gate and its resolution -- there is no runtime constructor yet:

```ts
import type { FeatureGateDeclaration, FeatureGateState } from '@deepseek-ai/dsh-feature-gates'

declare const permissionGate: FeatureGateDeclaration
const state: FeatureGateState = 'shadow'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals -- click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The full Contract-stage type surface: `FeatureGateState`, `FeatureGateDeclaration`, `FeatureGateNamespaceValue` (settings interop), `FeatureGateOverrideSource`/`FeatureGateResolution` (override chain), `FeatureGateShadowDecisionRecord` (sanitized diff), `FeatureGateExpiryStatus`/`FeatureGateExpiryCheck` |
| [`src/index.ts`](src/index.ts) | Pure `export type *` re-export -- zero runtime surface |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: explained-empty -- no gate registry or decision event stream exists yet to check a relation over |

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Contract type surface

#### What the model sees

Nothing. This Contract-stage slice exports only types; nothing here renders into a model request, system prompt, or tool schema.

#### Token effect

Zero-direct: the package contributes no prompt or schema text.

#### KV Cache effect

Independent: the package registers nothing that participates in a model request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No runtime gate registry, evaluation, or `--dump-config` wiring yet** -- this is a Contract-stage-only slice (Epic P0-05); a Provider-stage slice must add real registration/evaluation against `packages/settings/settings/src/index.ts`'s `SettingsProvider`, and a Usage-stage slice must wire `--dump-config` (`apps/cli/src/dump-config.ts`) to render `FeatureGateResolution`'s override chain and `apps/cli/src/profile-boot.ts`/`packages/bundle/base/cordis.patch.yml` to carry `defaultByProfile`.
- **No release-gate check implementation** -- `FeatureGateExpiryCheck` fixes the check's signature only; the actual comparison against a release version, and wiring it into the repository's release gate, is a later slice's deliverable (Epic P0-05 acceptance[2]).
