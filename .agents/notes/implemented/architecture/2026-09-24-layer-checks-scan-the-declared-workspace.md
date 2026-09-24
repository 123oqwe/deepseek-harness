# Agent Note: The layer and seam checks scan the declared workspace, and their exceptions name exact edges and uses

Status: implemented

English | [中文](2026-09-24-layer-checks-scan-the-declared-workspace.zh.md)

## Problem

`pnpm run architecture:layers` (Epic P0-04) and `pnpm run architecture:seams` (Epic P0-03) each chose their packages with hard-coded globs. The layer checker read `packages/*/*` and `apps/*`, and the seam checker read `packages/*/*` only; `vendor/*`, `native/system`, `native/system/packages/*`, `benchmarks`, `website` and `python/sdk-runtime`, all declared in `pnpm-workspace.yaml`, went unread. Because `vendor/*` was among them, the vendored Cordis peer-dependency cycles were never in the graph the layer checker searched. That checker had four more gaps in what it could report:

- it asked only whether the globally shortest cycle was exempted, so an exempted short cycle hid every longer unexempted one;
- a cycle exemption matched by package set, was tied to no edge of the graph, and could not go stale;
- the kernel rule saw only top-level import and export declarations that named a binding, so `export *`, a side-effect import, a dynamic `import()`, `require()`, a module augmentation, a triple-slash reference and a manifest declaration were invisible, and an external model SDK was invisible in every form;
- an unexpired `kernelEdgeAllowlist` entry suppressed any kernel violation, including the ones acceptance[1] makes unconditional.

`main()` printed its elapsed time but chose its exit code by violations alone, although `docs/architecture/layering.md` names the 10-second budget as a failure condition.

## Decision

**Both checkers enumerate `pnpm-workspace.yaml`.** Each reads the `packages:` patterns with `js-yaml` and globs `<pattern>/package.json`; a file that declares no pattern, or whose patterns match no package, throws, so neither gate can pass by scanning nothing. The layer checker takes the packages under `vendor/` out of the six-layer classification into a separate `vendored` map, and [`tests/first100/layer-package-map.json`](../../../../tests/first100/layer-package-map.json) assigns a layer to the nine newly scanned packages that no directory rule reaches: the `@deepseek-ai/node-addon-system` native addon with its workspace and platform binaries, `benchmarks`, `website` and `python/sdk-runtime`.

**The cycle graph includes the vendored packages.** It is the production package graph plus every `dependencies`/`peerDependencies` edge from or into a vendored package. The vendored strongly connected component {`@deepseek-ai/cordis`, `@deepseek-ai/cordis-plugin-include`, `@deepseek-ai/cordis-plugin-loader`} holds exactly three simple cycles, and [`tests/first100/layer-cycle-exemptions.json`](../../../../tests/first100/layer-cycle-exemptions.json) records each one with this note as its `adrNote`.

**A record exempts exactly the cycle its edges name.** A record lists its packages in edge order, so it names its edges, and a found cycle matches a record only up to rotation. `findUnexemptedCycles` in [`scripts/architecture/check-layer-deps.mjs`](../../../../scripts/architecture/check-layer-deps.mjs) reports every unexempted cycle through two searches: for each edge no record names, the shortest cycle through that edge, found by a breadth-first search back from the edge's target; and, on the subgraph of recorded edges, every simple cycle no record names. Each cycle is reported rotated to its smallest package, shortest first. A record naming an edge the graph lacks is a `stale-exempted-cycle` violation; a record whose `adrNote` names no file, or that repeats an earlier record's cycle, is a malformed store.

**Kernel dependencies are found by construction, and three Cordis uses pass.** For a `kernel`-layer package the checker labels every use of a package outside the ranked workspace graph, from three sources: the manifest's `dependencies`, `peerDependencies` and `optionalDependencies`; every top-level import, re-export and `declare module` declaration; and every other module reference `ts.preProcessFile` returns, such as `import()`, `require()`, `import x = require()`, an import type or a triple-slash types reference. A reference no declaration accounts for is labelled `*`, so a form the declaration walk does not name still fails. acceptance[1], as narrowed on 2026-09-24, admits exactly three uses of `@deepseek-ai/cordis`, and only by `@deepseek-ai/dsh-trust-kernel`, the package the narrowed clause names: the `Context` import binding, the `@deepseek-ai/cordis` peer declaration that binding needs, and a `declare module` augmentation of the `Context` interface. Every other use of a vendored package, and any use of `@deepseek-ai/cordis` by another `kernel`-layer package, is `kernel-forbidden-cordis-binding`, and a dependency on any package that is neither a workspace package nor a Node builtin is `kernel-external-dependency`. `devDependencies` and test files are not read. A kernel package's `optionalDependencies` on a workspace package are layer edges too, so a model provider or UI package declared there is `kernel-upward-dependency`. Rule 8's spawn-target reading does not apply to a kernel package, so declaring a UI application under `apps/` is a violation even when nothing is imported from it.

**The allowlist cannot admit what acceptance[1] forbids.** A `kernelEdgeAllowlist` entry never admits a kernel edge to a vendored package, an external package, a `surfaces-apps` package or a `providers` package. Naming such an edge still counts as a use, so the entry reports as expired rather than stale once its date passes.

**The time budget decides the exit code.** `main()` reads `performance.now()`, which counts from the checker process's start and so includes loading tsx and TypeScript, and exits non-zero with a `time-budget` line when the run takes longer than `--budget-ms`, 10 000 by default. The pnpm and tsx launcher processes are outside that measurement. The summary line reports the classified, vendored and total workspace packages.

## Alternatives considered

**One enumeration module shared by both checkers.** Rejected: the two checkers belong to different epics and share no module, and each reads the same `pnpm-workspace.yaml`, so they diverge only if one of them changes its reader.

**One exemption record for the whole Cordis component, matched by package set.** Rejected: a package-set match exempts only the three-package cycle, leaves both two-package cycles unexempted, and would exempt any later cycle over the same packages with a different edge order.

**Delete the exempted edges and search the rest.** Rejected: a cycle that shares an edge with an exempted cycle disappears with that edge. Searching from each package instead lets a short exempted cycle through that package hide a longer one, and enumerating every simple cycle grows factorially on a dense graph.

**Grant the three uses to every `kernel`-layer package.** Not chosen: the narrowed clause names `@deepseek-ai/dsh-trust-kernel`, and granting the uses per layer would extend them to any kernel package added later, beyond what the user approved.

**A deny-list of model SDK names.** Rejected: a list samples the SDKs that exist today, while refusing every external package is complete by construction.

**A wall-clock assertion in the vitest suite.** Rejected: whole-repository scans measured above 5 seconds under the suite's parallel load, so such an assertion would depend on machine load. The suite proves the budget comparison through `--budget-ms`, and the serial First-100 gate run measures the real repository against the 10-second default.

## Consequences

Bought: both gates scan every package pnpm installs, the vendored Cordis cycles pass only through three records pinned to their edges, and a record fails as soon as its cycle changes. Every unexempted cycle is reported, and the kernel rule has no channel through which an import form, a manifest declaration or an allowlist entry escapes it.

Cost: a re-vendor that changes the peer fields of `vendor/cordis`, `vendor/include` or `vendor/loader` must update the records in the same change. The kernel rule does not see a non-literal specifier, `import.meta.resolve()` or `require.resolve()`. Only `src/**` is read, so four newly scanned packages whose code sits outside `src/` (`benchmarks`, `native/system`, `website`, `python/sdk-runtime`) contribute manifest edges only; none of them has an inbound edge, so none can lie on a cycle. `optionalDependencies` stay outside the cycle graph, and a `!` pattern in `pnpm-workspace.yaml` is not read as an exclusion.
