---
description: "The type surface, pure validation logic, and declared-vs-observed comparison for Plugin Manifest v2, for users and maintainers who need to know exactly what a plugin must declare, how the schema/wildcard checks work, and how a quarantine decision is derived."
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-manifest

English | [中文](README.zh.md)

## Summary

`dsh-plugin-manifest` fixes the type surface and pure validation logic of Epic P1-01's Plugin Manifest v2: the `dsh.manifestVersion=2` shape a plugin package carries under `package.json`'s `dsh` field (must[0]) — services, tools, skills, MCP servers/resources/prompts, events, filesystem, network, process, secrets, UI surfaces, data stores, migrations, execution mode, and compatibility. Every Tool/MCP capability and every remote Skill/MCP Provider declares a side-effect class, an auth audience, allowed destinations, and a data classification (must[1]/acceptance[3]). The package also reads the pre-existing `dsh.bundle` format for compatibility, always tagged `legacy-untrusted` (must[3]), and detects wildcard-permission requests (acceptance[0]).

`src/index.ts` re-exports every Contract-stage runtime function alongside the types, and adds this package's Provider-stage logic: `compareDeclaredToObserved` diffs a validated manifest's declared capabilities against what a plugin actually registered into a live Cordis `Context`, and `decidePluginTrust` turns that comparison into acceptance[0]'s quarantine decision. Both are pure functions over already-computed data — this package still has no reader wired into `dsh plugin`/profile boot: no CLI, no code that walks a live `Context` to build the `observed` value these functions compare against, no installer decision. See [Known Limitations and Deferred Work](#known-limitations-and-deferred-work).

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
| [`src/index.ts`](src/index.ts) | The package's real runtime entry: re-exports every `./types.ts` type and `./validate.ts` function, and adds `ObservedPluginCapabilities`, `compareDeclaredToObserved`, and `decidePluginTrust` — the declared-vs-observed comparison and quarantine decision |
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

- **No real reader or CLI yet** — this package still ships only pure functions over already-computed data; a later Usage-stage slice wires `apps/cli/src/plugin.ts` (`pnpm plugin:verify <fixture>`), `apps/cli/src/profile-boot.ts`, and `packages/host/plugin-inventory` to call `classifyPluginDeclaration`/`compareDeclaredToObserved`/`decidePluginTrust` for real installs and profile boots.
- **`compareDeclaredToObserved` never builds its own `observed` value** — acceptance[0]'s "declaration/actual-registration mismatch" needs a live `Context` walked for its real registrations, which this pure-function package never constructs. Building `ObservedPluginCapabilities` from a booted profile's actual Cordis registry is a later Usage-stage concern (typically `packages/host/plugin-inventory`'s `PluginPermissionState`).
- **`decidePluginTrust` never enforces quarantine** — it is a pure decision only (`'active' | 'quarantined'`); blocking new tool calls, isolating a plugin's `ctx` surface, or surfacing the decision in an installer UI needs a real boot sequence and is a later stage's job. It also never sees a `'missing'` or `'legacy-untrusted'` declaration — Contract-stage's `isDeniedInProductionByDefault` already answers that separate, production-default-deny axis.
- **`compareDeclaredToObserved` compares by capability identity (name), not by field content, and only at the top level** — a tool declared and observed under the same name but with a drifted `sideEffectClass`/`authAudience`/`allowedDestinations`/`dataClassification` produces no mismatch; an `McpServerDeclaration`'s nested `resources`/`prompts` are never compared, only its top-level server name. No runtime concept anywhere in this repo yet makes these fields observable from a live registration, so a true field-level comparison is out of reach system-wide today, not only in this package. A later stage's `compareDeclaredToObserved` design must account for this before assuming stronger guarantees than exist.
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
