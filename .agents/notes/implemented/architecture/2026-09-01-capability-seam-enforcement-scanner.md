# Agent Note: A mechanical capability-seam boundary enforcer (`architecture.layers.json` / `pnpm run architecture:seams`)

Status: implemented

English | [中文](2026-09-01-capability-seam-enforcement-scanner.zh.md)

## Problem

The [capability-seam glossary entry](2026-06-13-capability-seams.md) states the Service Definition / Service Provider / Consumer split as a naming and packaging convention, but nothing mechanically checked it: a consumer package could deep-import a provider's `src/*` internals, or a provider package could take on a reverse dependency toward app/UI code, and no CI signal would catch it. Enforcement depended entirely on review discipline across 256 workspace packages and 29 declared capability families, which does not scale and leaves the boundary silently erodible as new packages are added.

## Decision

Two layers now enforce the boundary, split along the repository's own Contract/Consumer convention:

- **`architecture.layers.json`** declares each capability family's `id`, `definition` package, `providers[]`, `consumers[]`, and allowed cross-family dependency edges, plus a dated, owned `allowlist[]` for pre-existing exceptions.
- **`scripts/architecture/capability-seams.ts`** is the pure detector: schema validation for the JSON above and the violation-detection functions (deep-import into a provider's `src/*`, provider-to-app/UI reverse dependency, non-reversible registration for a family with no consumer composition or unload test), given already-resolved facts. It performs zero filesystem I/O.
- **`scripts/architecture/check-capability-seams.mjs`** is the real scanner: a live workspace `package.json` and TypeScript static-import walk across every package, producing the resolved facts (4175 cross-package import edges as of this writing) that it feeds into the `.ts` detector's pure functions. `pnpm run architecture:seams` runs it as the real CLI entry point, printing the violating dependency edge, source file, and remediation, and exiting non-zero on any unsuppressed violation.

Both files independently define an `isPlainObject(value)` guard (they do not share a runtime — one is a `.ts` module under the workspace's TypeScript build, the other a plain `.mjs` script) applied before reading any field off a `families[]` or `allowlist[]` array element parsed from `architecture.layers.json`. This closed a real crash class: an initial fault-testing round validated only that these fields were arrays, not that each element was itself a well-formed object, so `families: [null]`, an `allowlist` entry missing its `owner` field, or a family missing `providers`/`consumers` each threw an uncaught `TypeError` reading a property off `null`/`undefined` instead of reporting a clear schema error. `check-capability-seams.mjs`'s `hasScannableShape()` gates the entire real scan behind the same well-formedness check, so a malformed `architecture.layers.json` fails closed (a reported schema error, zero violations) rather than attempting to scan against an unsafe shape.

`architecture.layers.json`'s allowlist carries two pre-existing gaps surfaced by the first live scan (the `authorization` and `userQuestions` families, both registration-based providers with no dedicated package) as dated, owned entries rather than code changes, matching the acceptance criterion that every allowlist row names a removal date and a responsible owner.

## Alternatives considered

**Detect violations with a generic dependency-graph linter (e.g. an off-the-shelf import-boundary ESLint rule) instead of a bespoke scanner.** Rejected: generic tools reason about static import graphs, not this repository's specific family/definition/provider/consumer vocabulary or its allowed-edge and allowlist semantics (a dated, owned exception is a first-class concept here, not a suppression comment). A bespoke scanner keeps the enforcement vocabulary identical to the glossary term it enforces.

**Fold the array-element well-formedness guard into a single shared module imported by both the `.ts` detector and the `.mjs` scanner.** Rejected for this round: the two files do not currently share a build or module-resolution path (`.mjs` runs as a plain Node script outside the workspace TypeScript project), so a shared module would need its own packaging decision. Duplicating the four-line guard was judged cheaper than that decision for now; a future slice that gives the `.mjs` scanner a real build step could revisit consolidating it.

## Consequences

Bought: capability-seam boundary violations are now a CI-visible failure with a named edge, file, and remediation, rather than a review-time judgment call. Malformed or adversarial `architecture.layers.json` content — missing fields, null array elements, non-object elements, non-string `owner` — fails with a clear schema error and a non-zero exit instead of crashing the process, verified against both the pure detector directly and the real CLI subprocess path.

Cost: the well-formedness guard is hand-duplicated in two files that must be kept in sync by convention, not by the compiler, until a shared build path exists for the `.mjs` scanner. A known, narrower gap remains out of this round's scope: a family whose `id` field is present but non-string (e.g. an object) currently fails an `=== ''` comparison silently rather than raising a distinct type error — no crash results, but the message would be less specific than the guards this round added for the array-element case.
