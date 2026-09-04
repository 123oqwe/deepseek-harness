---
description: "The type surface and whole-graph solver for Epic P1-08's plugin ABI, capability, and schema compatibility negotiation: one deterministic solve per boot, a minimal unsat core on contradiction, and fail-closed blocking for a missing required capability."
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-compat

## Summary

`dsh-plugin-compat` fixes the type surface and solver signature for Epic P1-08's plugin ABI, capability, and schema compatibility negotiation: every plugin manifest declares a runtime API range, schema ranges, required/optional capability dependencies, and provider constraints against those dependencies (must[0]); `solvePluginGraph` solves every manifest in a boot's plugin graph together, in one call, before any plugin loads (must[1]); a genuine graph-level contradiction reports a minimal unsat core naming only the constraints that actually conflict (must[2]); and a missing required or security-critical capability can only ever resolve to a `'blocked'` activation, never a silently degraded `'active'` one (must[3]).

`src/index.ts` ships the type surface and the working whole-graph solver `solvePluginGraph`, which indexes provided capabilities, reports a minimal unsat core for a provider-constraint contradiction, and otherwise returns one activation per manifest sorted by `PluginId` with a content-derived `planId`. `src/solver.ts` adds the two things a real boot needs on top: `resolveHostCompatContext` builds a `HostCompatContext` from the live `@deepseek-ai/dsh-schema-registry`, and `resolveActivatedGraph` runs the graph to a fixpoint so a plugin blocked on its own constraints stops satisfying its consumers' capability requirements. `tests/solver.spec.ts` and `tests/provider-resolution.spec.ts` cover both in 25 cases. No invariant companion is published because this package constructs no registry, `Context`, or other mutable relation to check — every export is a plain type or a pure function over caller-supplied data.

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

The whole-graph solve is called with plain data — no file, process, or Cordis `Context` access:

```ts
import { solvePluginGraph } from '@deepseek-ai/dsh-plugin-compat'
import type { HostCompatContext, PluginCompatManifest } from '@deepseek-ai/dsh-plugin-compat'

declare const manifests: readonly PluginCompatManifest[] // every plugin's declared manifest for this boot
declare const host: HostCompatContext // this build's runtime API version + currently registered schema versions

const solution = solvePluginGraph(manifests, host)
// solution.solvable === false: solution.unsatCore names the minimal set of
//   conflicting manifest constraints, never a bare "failed"
// solution.solvable === true: solution.loadPlan.activations has one row per
//   manifest — 'active' (with any disabled optional capabilities listed) or
//   'blocked' (with the missing required capabilities listed); a caller
//   never executes a 'blocked' plugin's code
```

`solvePluginGraph` and `resolveActivatedGraph` are pure functions over already-computed data: they read no file, spawn no process, and construct no Cordis `Context`. `resolveHostCompatContext` (`src/solver.ts`) is the one export that reads live state, calling the schema registry's `listSchemas()` to build a `HostCompatContext` from this build's real registrations. `parseCompatDeclaration` validates one plugin package's `package.json` `dsh.compat` field into a `PluginCompatManifest`, and `DSH_RUNTIME_API_VERSION` is the integer a boot solves against. `packages/boot/app-boot/src/profile.ts`'s `negotiateProfileLayerCompatibility` calls both to supply `manifests` from real plugin package manifests, and `composeProfile` (`apps/cli/src/profile-boot.ts`) runs that solve at every real `dsh --profile` launch before any bundle patch reaches `boot()`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **A separate negotiation axis from Plugin Manifest v2.** `@deepseek-ai/dsh-plugin-manifest`'s `PluginManifestV2` (Epic P1-01, a predecessor) declares capability *access* for permission auditing — side-effect class, auth audience, destinations. This package declares capability *compatibility* for graph solving — ranges, necessity, and provider constraints. Neither type extends the other; `src/index.ts`'s own module doc records why they stay separate.
- **Structured integer ranges, not semver strings.** `RuntimeApiRange`/`SchemaRangeRequirement` compare with plain integer ordering, mirroring this repo's monotonic `SCHEMA_VERSION`/`SESSION_FORMAT_VERSION` convention rather than parsing a semver range string — a deterministic solver (acceptance[0]) never depends on a range-string parser's own behavior.
- **Whole graph, one call, no lazy alternative.** `solvePluginGraph` is this package's only exported operation. There is no per-plugin `resolveOne` a caller could reach for instead — must[1]'s "boot 前求解整个插件图" is structural, not a discipline callers must remember to follow.
- **No representable partial activation.** `PluginActivationStatus`'s `'active'` variant has no `missingCapabilities` field and its `'blocked'` variant has no `disabledOptionalCapabilities` field. must[3]'s "禁止靠 try/catch 静默降级安全能力" has no type-level slot to fall into by catching an internal error — the return type itself has no partial-activation shape to construct.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The manifest/context/solution type surface (`PluginCompatManifest`, `HostCompatContext`, `PluginGraphSolution`, `LoadPlan`, `UnsatCore`, …) and `solvePluginGraph`, the one-call whole-graph solve |
| [`src/solver.ts`](src/solver.ts) | `resolveHostCompatContext` (host facts from the live schema registry) and `resolveActivatedGraph` (blocking cascaded to a fixpoint along provider edges, plus the surviving `ProviderBinding`s) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/solver.spec.ts`](tests/solver.spec.ts) — `solvePluginGraph`'s clause coverage: one case per registry-declared must[] clause (must[0] split into its declared-shape and provider-constraint cases) and one per acceptance[] clause (acceptance[1] split into its two named fail-closed scenarios).
- [`tests/provider-resolution.spec.ts`](tests/provider-resolution.spec.ts) — `src/solver.ts`'s cases: host-context resolution against the real schema registry, provider binding, and cascade to a fixpoint.
- [`@deepseek-ai/dsh-schema-registry`](../../schema/schema-registry/README.md) — owns the `SchemaId`/`SchemaVersion` identity this package's `SchemaRangeRequirement` reuses rather than redeclaring.
- [`@deepseek-ai/dsh-plugin-manifest`](../plugin-manifest/README.md) — this repo's other plugin-capability Contract-stage package (Epic P1-01), declaring capability *access* rather than this package's compatibility *ranges*; followed here for package layout and pure-function conventions.
- [`packages/host/plugin-inventory/src/types.ts`](../../host/plugin-inventory/src/types.ts) — additively extended in this same Contract-stage slice with `compatActivation?: PluginActivationStatus`, the field a solved `LoadPlan` surfaces through (registry's own validation guidance: "将结果写入 `--dump-config` 和 plugin inventory"); wiring a real solved value into it belongs to the follow-on stage that covers the registry's `--dump-config`/inventory validation item, not to this package and not to the boot-path negotiation that consumes the solve.
- [`docs/glossary.md#capability-seam`](../../../docs/glossary.md#capability-seam) — the Service Definition/Service Provider/Consumer vocabulary `ProviderConstraint` narrows against.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and a pure solver-function signature only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`solvePluginGraph` compares major versions only.** `checkSchemaRanges` tests a registered schema's `major` against a `SchemaRangeRequirement`'s `minVersion.major`/`maxVersion.major` and ignores every lower version component, so a manifest cannot express a minor-level requirement.
- **The unsat core covers one contradiction shape.** `solvePluginGraph` returns `solvable: false` only when a `requires-provider` and an `excludes-provider` constraint name the same required capability's *sole* provider. Every other failure — a runtime-API-range or schema-range mismatch, a missing required capability, a provider constraint that leaves no admissible provider among several — is reported per manifest as a `blocked` activation instead of a graph-level core.
- **No wiring into real plugin boot exists yet.** `packages/boot/app-boot/src/profile.ts` (registry's own `stages.U.files`) does not call `solvePluginGraph`, and no real `PluginCompatManifest` is ever built from a package's own `package.json` — this package alone cannot block a real plugin from loading or reject a real boot.
- **`packages/host/plugin-inventory/src/types.ts`'s `compatActivation` field is additive-only.** `PluginInventoryEntry.compatActivation` is declared but never populated by `packages/host/plugin-inventory/src/index.ts`'s snapshot builder. The real boot-path solve now runs in `composeProfile` (`apps/cli/src/profile-boot.ts`), which reports its outcome on stderr and drops a blocked layer's patches, but does not write the activation into the inventory snapshot; carrying it there is the registry's separate `--dump-config`/inventory validation item.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
