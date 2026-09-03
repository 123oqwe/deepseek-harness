---
description: "The Contract-stage type surface and whole-graph solver signature for Epic P1-08's plugin ABI, capability, and schema compatibility negotiation, for maintainers picking up the RED-scaffold fix-round."
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-compat

## Summary

`dsh-plugin-compat` fixes the type surface and solver signature for Epic P1-08's plugin ABI, capability, and schema compatibility negotiation: every plugin manifest declares a runtime API range, schema ranges, required/optional capability dependencies, and provider constraints against those dependencies (must[0]); `solvePluginGraph` solves every manifest in a boot's plugin graph together, in one call, before any plugin loads (must[1]); a genuine graph-level contradiction reports a minimal unsat core naming only the constraints that actually conflict (must[2]); and a missing required or security-critical capability can only ever resolve to a `'blocked'` activation, never a silently degraded `'active'` one (must[3]).

This package currently ships this epic's Contract-stage RED scaffold only: `src/index.ts`'s types are real and epic-accurate, and its one exported function, `solvePluginGraph`, has a real, epic-accurate signature but throws `'not implemented: ...'` unconditionally — the real whole-graph constraint solver is a later fix-round's deliverable (`src/solver.ts`, this epic's Provider-stage file), proven by `tests/solver.spec.ts`'s real assertions against that (currently failing) behavior. No invariant companion is published because this Contract-stage slice constructs no registry, `Context`, or other mutable relation yet to check — every export is a plain type or a pure function stub over caller-supplied data.

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

The whole-graph solve, once implemented, is called with plain data — no file, process, or Cordis `Context` access:

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

Every export is a pure function over already-computed data: `solvePluginGraph` reads no file, spawns no process, and constructs no Cordis `Context` — a later Usage-stage caller (`packages/boot/app-boot/src/profile.ts`) supplies `manifests`/`host` from real plugin package manifests and the real schema registry.

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
| [`src/index.ts`](src/index.ts) | The manifest/context/solution type surface (`PluginCompatManifest`, `HostCompatContext`, `PluginGraphSolution`, `LoadPlan`, `UnsatCore`, …) and `solvePluginGraph` (Contract-stage RED scaffold — real signature, `'not implemented'` body) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/solver.spec.ts`](tests/solver.spec.ts) — the Contract-stage RED scaffold: one case per registry-declared must[] clause (must[0] split into its declared-shape and provider-constraint cases) and one per acceptance[] clause (acceptance[1] split into its two named fail-closed scenarios).
- [`@deepseek-ai/dsh-schema-registry`](../../schema/schema-registry/README.md) — owns the `SchemaId`/`SchemaVersion` identity this package's `SchemaRangeRequirement` reuses rather than redeclaring.
- [`@deepseek-ai/dsh-plugin-manifest`](../plugin-manifest/README.md) — this repo's other plugin-capability Contract-stage package (Epic P1-01), declaring capability *access* rather than this package's compatibility *ranges*; followed here for package layout and pure-function conventions.
- [`packages/host/plugin-inventory/src/types.ts`](../../host/plugin-inventory/src/types.ts) — additively extended in this same Contract-stage slice with `compatActivation?: PluginActivationStatus`, the field a solved `LoadPlan` surfaces through (registry's own validation guidance: "将结果写入 `--dump-config` 和 plugin inventory"); wiring a real solved value into it is a later Usage-stage caller's job, not this package's.
- [`docs/glossary.md#capability-seam`](../../../docs/glossary.md#capability-seam) — the Service Definition/Service Provider/Consumer vocabulary `ProviderConstraint` narrows against.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and a pure solver-function signature only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`solvePluginGraph` throws `'not implemented'` unconditionally.** Its signature and JSDoc-documented behavior are real and epic-accurate; `tests/solver.spec.ts` fails every case against this today, by design — a later fix-round implements the whole-graph constraint solver these signatures and tests already commit to, in this epic's Provider-stage `src/solver.ts`.
- **No wiring into real plugin boot exists yet.** `packages/boot/app-boot/src/profile.ts` (registry's own `stages.U.files`) does not call `solvePluginGraph`, and no real `PluginCompatManifest` is ever built from a package's own `package.json` — this package alone cannot block a real plugin from loading or reject a real boot.
- **`packages/host/plugin-inventory/src/types.ts`'s `compatActivation` field is additive-only.** `PluginInventoryEntry.compatActivation` is declared but never populated by `packages/host/plugin-inventory/src/index.ts`'s snapshot builder — a later Usage-stage caller that has run a real `solvePluginGraph` fills it in.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
