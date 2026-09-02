---
description: "The Contract-stage type surface and pure validation logic for Plugin Manifest v2, for users and maintainers who need to know exactly what a plugin must declare and how the schema/wildcard checks work."
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-manifest

English | [中文](README.zh.md)

## Summary

`dsh-plugin-manifest` fixes the type surface and pure validation logic of Epic P1-01's Plugin Manifest v2: the `dsh.manifestVersion=2` shape a plugin package carries under `package.json`'s `dsh` field (must[0]) — services, tools, skills, MCP servers/resources/prompts, events, filesystem, network, process, secrets, UI surfaces, data stores, migrations, execution mode, and compatibility. Every Tool/MCP capability and every remote Skill/MCP Provider declares a side-effect class, an auth audience, allowed destinations, and a data classification (must[1]/acceptance[3]). The package also reads the pre-existing `dsh.bundle` format for compatibility, always tagged `legacy-untrusted` (must[3]), and detects wildcard-permission requests (acceptance[0]).

This package currently ships its Contract-stage slice only: `src/types.ts`'s type surface, `src/validate.ts`'s pure schema/wildcard/legacy-read functions, and `src/invariant.ts`'s explained-empty companion. It has no real reader wired into `dsh plugin`/profile boot yet — no CLI, no Cordis registry comparison, no installer decision. See [Known Limitations and Deferred Work](#known-limitations-and-deferred-work).

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

Classify a `package.json` `dsh` field and validate a manifest against the schema:

```ts
import { classifyPluginDeclaration, validatePluginManifestV2, detectWildcardPermissions } from '@deepseek-ai/dsh-plugin-manifest/validate'

declare const dshField: unknown // package.json's parsed "dsh" field

const declaration = classifyPluginDeclaration(dshField)
// declaration.kind is 'manifest-v2' | 'legacy-untrusted' | 'missing'

const result = validatePluginManifestV2(dshField)
if (result.valid) {
  const wildcards = detectWildcardPermissions(result.manifest)
  // wildcards is non-empty for a manifest requesting '*', '**', or '/' as a destination pattern
}
```

Every export is a pure function over already-parsed `unknown` JSON data — none reads a file, spawns a process, or imports the plugin package it validates. There is no exported constructor for `PluginManifestV2` itself: a plugin author writes the manifest as literal JSON in their own `package.json`, and this package only reads and checks it.

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
| [`src/index.ts`](src/index.ts) | Pure type re-export of `./types.ts` — zero runtime exports, zero Cordis registration (this Contract-stage slice's mandatory B4(f) scaffold) |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: explained-empty — no constructed manifest value or installer exists yet in this slice |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`docs/plugins/manifest-v2.md`](../../../docs/plugins/manifest-v2.md) — the manifest format's user-facing documentation.
- [`spec/capability-manifest.schema.json`](../../../spec/capability-manifest.schema.json) — the JSON Schema (draft 2020-12) mirroring this package's type surface field-for-field.
- [`tests/manifest.spec.ts`](tests/manifest.spec.ts) — the Contract-stage proof, including golden-fixture agreement between this package's TypeScript validator and the JSON Schema document (ajv).
- [`docs/architecture.md#profiles-and-bundles`](../../../docs/architecture.md#profiles-and-bundles) — the pre-existing `dsh.bundle`/`dsh.profile` vocabulary this package's manifest is additive to.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure validation functions only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No real reader or CLI yet** — this Contract-stage slice ships only the type surface and pure validation functions; a later P/U-stage slice wires `apps/cli/src/plugin.ts` (`pnpm plugin:verify <fixture>`), `apps/cli/src/profile-boot.ts`, and `packages/host/plugin-inventory` to call `classifyPluginDeclaration` for real installs and profile boots.
- **No Cordis registry comparison** — acceptance[0]'s "declaration/actual-registration mismatch" (comparing a manifest against what a booted profile's Cordis registry actually contains) needs a live `Context`, which this pure-function package never constructs. That comparison is a P/U-stage runtime concern.
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
