---
description: "The type surface, pure validation logic, and declared-vs-observed comparison for Plugin Manifest v2, for users and maintainers who need to know exactly what a plugin must declare, how the schema/wildcard checks work, and how a quarantine decision is derived."
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-manifest

English | [中文](README.zh.md)

## Summary

`dsh-plugin-manifest` fixes the type surface and pure validation logic of Epic P1-01's Plugin Manifest v2: the `dsh.manifestVersion=2` shape a plugin package carries under `package.json`'s `dsh` field (must[0]) — services, tools, skills, MCP servers/resources/prompts, events, filesystem, network, process, secrets, UI surfaces, data stores, migrations, execution mode, and compatibility. Every Tool/MCP capability and every remote Skill/MCP Provider declares a side-effect class, an auth audience, allowed destinations, and a data classification (must[1]/acceptance[3]). The package also reads the pre-existing `dsh.bundle` format for compatibility, always tagged `legacy-untrusted` (must[3]), and detects wildcard-permission requests (acceptance[0]).

`src/index.ts` re-exports every Contract-stage runtime function alongside the types, and adds this package's Provider-stage logic: `compareDeclaredToObserved` diffs a validated manifest's declared capabilities against what a plugin actually registered into a live Cordis `Context`, and `decidePluginTrust` turns that comparison into acceptance[0]'s quarantine decision. Usage-stage (Epic P1-01.U) adds `evaluatePreMountAdmission`, the real pre-mount policy `packages/boot/app-boot/src/profile.ts`'s `partitionProfileLayersByAdmission` and `apps/cli/src/plugin.ts`'s `pnpm plugin:verify <fixture>` both call; `packages/host/plugin-inventory` now builds the real `ObservedPluginCapabilities` value from a live Cordis `Context` (`buildObservedPluginCapabilities`), and `apps/cli/src/profile-boot.ts` wires both halves into real profile boot — a denied bundle layer's patches never reach `boot()`, and a post-mount `'quarantined'` entry has its fiber disposed. See [Known Limitations and Deferred Work](#known-limitations-and-deferred-work).

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

Classify a `package.json` `dsh` field and validate a manifest against the schema — from the package root or the documented `/validate` subpath, interchangeably:

```ts
import { classifyPluginDeclaration, validatePluginManifestV2, detectWildcardPermissions } from '@deepseek-ai/dsh-plugin-manifest'

declare const dshField: unknown // package.json's parsed "dsh" field

const declaration = classifyPluginDeclaration(dshField)
// declaration.kind is 'manifest-v2' | 'legacy-untrusted' | 'missing'

const result = validatePluginManifestV2(dshField)
if (result.valid) {
  const wildcards = detectWildcardPermissions(result.manifest)
  // wildcards is non-empty for a manifest requesting '*', '**', or '/' as a destination pattern
}
```

Compare a validated manifest's declarations against what a plugin actually registered, and derive a quarantine decision from the result:

```ts
import { compareDeclaredToObserved, decidePluginTrust, type ObservedPluginCapabilities } from '@deepseek-ai/dsh-plugin-manifest'

declare const observed: ObservedPluginCapabilities // built by a later stage from a live Cordis Context

if (result.valid) {
  const comparison = compareDeclaredToObserved(result.manifest, observed)
  // comparison.mismatches: capability names declared but never registered, or registered but never declared
  // comparison.wildcardFindings: same wildcard findings detectWildcardPermissions already reports
  const trust = decidePluginTrust(comparison)
  // trust is 'active' when comparison has neither, 'quarantined' otherwise
}
```

Decide whether a classified declaration is admitted into a production boot before any of its code runs:

```ts
import { evaluatePreMountAdmission } from '@deepseek-ai/dsh-plugin-manifest'

const admission = evaluatePreMountAdmission(declaration, /* production */ true)
if (!admission.admitted) {
  // admission.reason is 'missing-manifest' | 'legacy-untrusted' | 'wildcard-permission'
  // admission.wildcardFindings is non-empty only for the wildcard-permission reason
}
```

Every export is a pure function over already-computed data — none reads a file, spawns a process, imports the plugin package it validates, or constructs a Cordis `Context`. There is no exported constructor for `PluginManifestV2` itself: a plugin author writes the manifest as literal JSON in their own `package.json`, and this package only reads, checks, and compares it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Additive to, never replacing, `dsh.bundle`/`dsh.profile`.** `package.json`'s `dsh` field already carries `dsh.profile` (a profile's bundle list) and `dsh.bundle` (a bundle's `cordis.patch.yml` pointer, see [`docs/architecture.md#profiles-and-bundles`](../../../docs/architecture.md#profiles-and-bundles)). `PluginManifestV2` is a third shape, `dsh.manifestVersion === 2`; a package may carry a manifest alongside a bundle patch.
- **Static data, not generated code (must[2]).** Every type in `src/types.ts` describes a plain JSON-serializable value — no function-typed field, no method, no class instance — and `src/validate.ts`'s `assertJsonSerializable` rejects a value carrying a function, a `symbol`, or `undefined` nested inside an array: none of these three kinds can survive `JSON.parse`, so their presence proves the value was built by running code, not by parsing a file.
- **Legacy `dsh.bundle` reads as `legacy-untrusted`, always (must[3]).** The old format declares no capability at all — only a patch-file pointer — so there is no declared permission surface to trust, by construction. `isDeniedInProductionByDefault` denies both `'legacy-untrusted'` and `'missing'` declarations.
- **Grounded in this repo's existing vocabulary, not invented from scratch.** `ExecutionMode` mirrors `@deepseek-ai/dsh-code-runtime`'s `CodeRuntime.isolation` well-known values; `EventCapabilityDeclaration.mode` is `@deepseek-ai/cordis`'s own `DispatchMode`; `McpServerDeclaration`'s transport and `serverName` grammar mirror `@deepseek-ai/dsh-mcp-client`'s real `Config`; `SkillCapabilityDeclaration.name` mirrors `@deepseek-ai/dsh-skill`'s real `SKILL_NAME` grammar. `sideEffectClass`, `authAudience`, `allowedDestinations`, and `dataClassification` have no prior precedent in this repo — `src/types.ts`'s own doc comments record the interpretation this slice commits to.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The `PluginManifestV2` type surface: every must[0] field, must[1]'s Tool/MCP effect fields, and the `PluginDeclaration`/`LegacyBundleDeclaration` classification types |
| [`src/validate.ts`](src/validate.ts) | Pure schema validation (`validatePluginManifestV2`), the static-data check (`assertJsonSerializable`), wildcard-permission detection (`detectWildcardPermissions`), and the legacy `dsh.bundle` compatibility read (`parseLegacyBundleDeclaration`, `classifyPluginDeclaration`) |
| [`src/index.ts`](src/index.ts) | The package's real runtime entry: re-exports every `./types.ts` type and `./validate.ts` function, adds `ObservedPluginCapabilities`, `compareDeclaredToObserved`, and `decidePluginTrust` (declared-vs-observed comparison and quarantine decision), and `evaluatePreMountAdmission` (Usage-stage's real pre-mount policy) |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: explained-empty — no constructed manifest value or installer exists yet in this slice |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`docs/plugins/manifest-v2.md`](../../../docs/plugins/manifest-v2.md) — the manifest format's user-facing documentation.
- [`spec/capability-manifest.schema.json`](../../../spec/capability-manifest.schema.json) — the JSON Schema (draft 2020-12) mirroring this package's type surface field-for-field.
- [`tests/manifest.spec.ts`](tests/manifest.spec.ts) — the Contract-stage proof, including golden-fixture agreement between this package's TypeScript validator and the JSON Schema document (ajv).
- [`tests/manifest.provider.spec.ts`](tests/manifest.provider.spec.ts) — the Provider-stage proof for `compareDeclaredToObserved`/`decidePluginTrust`.
- [`docs/architecture.md#profiles-and-bundles`](../../../docs/architecture.md#profiles-and-bundles) — the pre-existing `dsh.bundle`/`dsh.profile` vocabulary this package's manifest is additive to.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure validation functions only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Real reader/CLI/boot wiring now exists** — `apps/cli/src/plugin.ts`'s `pnpm plugin:verify <fixture>`, `apps/cli/src/profile-boot.ts`'s `composeProfile`/`applyPostMountPluginEnforcement`, and `packages/host/plugin-inventory`'s `buildObservedPluginCapabilities`/`buildPluginPermissionStates` all call `classifyPluginDeclaration`/`evaluatePreMountAdmission`/`compareDeclaredToObserved`/`decidePluginTrust` for real installs and profile boots (Epic P1-01.U). This package itself still performs no I/O and constructs no `Context` — that boundary is intentional and unchanged; see `packages/host/plugin-inventory`'s own README for the live-`Context` walk.
- **`decidePluginTrust`'s quarantine is now really enforced** — `apps/cli/src/profile-boot.ts`'s `applyPostMountPluginEnforcement` disposes a `'quarantined'` entry's live Cordis fiber after boot; `evaluatePreMountAdmission` (called from `composeProfile` before `boot()` mounts anything) fails a `'missing'`/`'legacy-untrusted'` declaration or a wildcard-requesting manifest at pre-mount time, matching `isDeniedInProductionByDefault`'s own axis. Enforcement is opt-in per boot via `DSH_PLUGIN_MANIFEST_ENFORCEMENT=enforce` (`apps/cli/src/profile-boot.ts`'s `resolvePluginEnforcementMode`) — off by default, since no bundle package shipped in this installation declares a Manifest v2 yet; turning it on for a real profile today denies every one of that profile's bundles. This is a real, disclosed migration gap, not a formality: the mechanism is real and tested against fixtures, but no shipped profile can pass it yet.
- **`compareDeclaredToObserved` compares by capability identity (name), not by field content, and only at the top level (BLOCKED-027, re-examined at U-stage, ratified as the real design)** — a tool declared and observed under the same name but with a drifted `sideEffectClass`/`authAudience`/`allowedDestinations`/`dataClassification` produces no mismatch; an `McpServerDeclaration`'s nested `resources`/`prompts` are never compared, only its top-level server name. Concretely confirmed at U-stage: `packages/host/plugin-inventory`'s real `buildObservedPluginCapabilities` — built from `Fiber.getEffects()` labels and the global Cordis `ReflectService` store, the only real per-plugin registration signals this codebase exposes — cannot recover these fields from any live registration (`ToolDefinition`, a service `Impl`, an MCP-client `Fiber.config`, a `SkillDefinition` each carry none of them). A field-content comparison would therefore compare against a field that structurally does not exist on the observed side, which is not a weaker check but a vacuous one. Closing this for real needs a separate, larger change threading effect metadata through every tool/skill/MCP/event registration call site repo-wide — out of this package's and this stage's scope, and a different epic-sized undertaking, not a silent carry-forward of the original disclosure.
- **Quarantine treats both mismatch directions the same today** — an observed-but-undeclared registration and a declared-but-never-registered capability both currently trigger `'quarantined'`; the registry's "declaration/actual-registration inconsistency" text reads direction-agnostic, but a legitimate lazy/conditional registration could look identical to the latter case. This asymmetry risk is worth a deliberate ruling before a later stage locks in real enforcement policy on top of this decision.
- **`detectWildcardPermissions` only recognizes exact `'*'`, `'**'`, and `'/'` patterns** — a pattern that is broad in effect but not literally one of these three strings (for example a needlessly wide but non-maximal glob) is not flagged. Finer-grained overprivilege heuristics are a later stage's job, if ever added.
- **`sideEffectClass` is a single declared tag, not a set** — a capability with several kinds of effect (for example both `'write'` and `'network'`) declares the single highest-impact class that applies; this schema does not decompose composite effects further.
- **`assertJsonSerializable` inspects values at check-time only, never proves immutability** — a manifest whose fields are backed by getters can pass validation on one read and return different content on a later read of the same `result.manifest` reference (which is not cloned). The documented calling convention (`JSON.parse` output, which structurally cannot produce getters) avoids this in practice, but is not type-enforced anywhere the public API accepts `unknown`.
- **The JSON Schema does not close every object to unknown properties the same way `validate.ts` does** — an object carrying an extra, undeclared property currently fails `ajv` validation against `spec/capability-manifest.schema.json` but passes `validatePluginManifestV2`; the "mirrors the TS types field-for-field" claim above holds for declared fields, not yet for rejecting undeclared ones consistently across both validators.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
