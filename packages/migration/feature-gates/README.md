---
description: "Epic P0-05's Shadow/Enforce feature gates: the unified state and lifecycle metadata, a pure override-chain resolver, a shadow-vs-legacy decision evaluator with redacted diff recording, and a real-version-aware release-gate expiry check."
kind: "package-reference"
---

# @deepseek-ai/dsh-feature-gates

English | [中文](README.zh.md)

## Summary

`dsh-feature-gates` fixes the type surface AND the Provider-stage runtime for Epic P0-05 (Shadow/Enforce feature gates for major capabilities): the unified `off | shadow | enforce` {@link FeatureGateState}, the fixed lifecycle metadata every gate records (`owner`, `introducedVersion`, `defaultByProfile`, `removalVersion`), the JSON-safe settings-namespace value shape a `feature-gates` registration would carry, the `--dump-config` override-chain shape, the sanitized shadow/legacy decision-diff record, and the release-gate expiry check signature — plus real, pure functions that compute all of it: {@link resolveFeatureGate} (must[3]'s override chain), {@link evaluateFeatureGate} (must[1]/acceptance[0]/acceptance[1]'s shadow-vs-legacy decision harness), {@link redactDecisionSummary} (acceptance[1]'s real redaction call site), and {@link checkFeatureGateExpiry} (acceptance[2]'s SemVer-precedence expiry check).

Gate registration for a real capability (the policy/plugin-trust/run-journal shadow fixtures this epic's own `validation` clause calls for) and CLI/profile wiring (`--dump-config`, `defaultByProfile` in the bundle/profile-boot layer) stay later slices' deliverables — see [Known Limitations and Deferred Work](#known-limitations-and-deferred-work).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Resolve a gate's state, then run its decision logic under that state -- `shadow` always applies `legacy`'s value while also recording a redacted diff against `candidate`:

```ts
import { evaluateFeatureGate, resolveFeatureGate } from '@deepseek-ai/dsh-feature-gates'
import type { FeatureGateDeclaration } from '@deepseek-ai/dsh-feature-gates'

declare const permissionGate: FeatureGateDeclaration
const { resolved } = resolveFeatureGate(permissionGate, 'headless', { env: 'shadow' })

const { value, shadowRecord } = evaluateFeatureGate(
  permissionGate.id,
  resolved.value,
  () => ({ value: 'deny', summary: { outcome: 'deny' } }), // legacy
  () => ({ value: 'allow', summary: { outcome: 'allow' } }), // candidate
  ['outcome'],
)
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals -- click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The full Contract-stage type surface: `FeatureGateState`, `FeatureGateDeclaration`, `FeatureGateNamespaceValue` (settings interop), `FeatureGateOverrideSource`/`FeatureGateResolution` (override chain), `RedactedJsonValue`/`FeatureGateShadowDecisionRecord` (nominally-branded diff), `FeatureGateExpiryStatus`/`FeatureGateExpiryCheck` |
| [`src/index.ts`](src/index.ts) | Re-exports every Contract-stage type, plus the real Provider-stage runtime: `resolveFeatureGate` (must[3]), `evaluateFeatureGate`/`redactDecisionSummary` (must[1]/acceptance[0]/acceptance[1]), `checkFeatureGateExpiry` (acceptance[2]) |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: explained-empty -- this package still owns no mutable registry or decision-event stream; every Provider-stage function here is pure, taking its full input as arguments |

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Provider-stage runtime

#### What the model sees

Nothing. Every export here is a pure data function or a type; nothing renders into a model request, system prompt, or tool schema.

#### Token effect

Zero-direct: the package contributes no prompt or schema text.

#### KV Cache effect

Independent: the package registers nothing that participates in a model request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **No gate is declared for a real capability yet** -- this package computes override resolution, shadow-vs-legacy evaluation, and expiry against any `FeatureGateDeclaration` a caller supplies, but declares none itself. The policy/plugin-trust/run-journal shadow fixtures this epic's own `validation` clause calls for, and registering the `feature-gates` settings namespace (`packages/settings/settings/src/index.ts`'s `SettingsProvider.register`) for a real capability, are Composition-stage deliverables.
- **No `--dump-config`/profile wiring yet** -- `resolveFeatureGate` computes the exact `FeatureGateResolution` must[3] requires, but a Usage-stage slice must still wire `apps/cli/src/dump-config.ts` to call it and render the result, and `apps/cli/src/profile-boot.ts`/`packages/bundle/base/cordis.patch.yml` to carry a real `defaultByProfile`/env override into it.
- **No repository release-gate wiring yet** -- `checkFeatureGateExpiry` is a real, tested SemVer-precedence check, but nothing in the repository's release pipeline calls it yet (Epic P0-05 acceptance[2]'s "fails the release gate" half).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers -- click to expand</summary>

`@deepseek-ai/dsh-brand` sits in both `peerDependencies` and `devDependencies`, matching `dsh-trust-kernel`/`dsh-settings`'s own classification (still `import type`-only here). `@deepseek-ai/dsh-util-values` moved to a plain `dependencies` entry once `src/index.ts` started calling its runtime exports (`deepEqualJson`, `assertNever`) directly -- `dsh-util-values` never appears in any workspace package's `peerDependencies`, and plain `dependencies` is what every OTHER runtime consumer of it uses (`dsh-time-context` and ~35 further workspace packages), matching this package's own new usage.

</details>
