---
description: "The type surface and pure decision functions for Epic P2-03's first-class ActionManifest: manifest construction, argument canonicalization and hashing, side-effect classification, and the durable-append-precedes-execution gate."
kind: "package-library"
---

# @deepseek-ai/dsh-action-manifest

## Summary

`dsh-action-manifest` fixes the type surface and function signatures for Epic P2-03's first-class ActionManifest: every external write operation's manifest carries `actionId`/`runId`/`actor`/`capability`/`target`/`argumentsHash`/`sideEffectClass`/`idempotencyKey`/`preconditions`/`expectedDiff`/`compensation`/evidence requirements (must[0]); manifest generation and durable append must precede any policy/approval decision (must[1]); code-mode embedded tools and plugin RPC calls are held to the exact same manifest-generation gate as a native tool call, with no bypass (must[2]).

The package ships the type surface in `src/types.ts` and five working pure decision functions in `src/canonicalize.ts`: `canonicalizeArguments`, `computeArgumentsHash`, `classifySideEffect`, `createActionManifest`, and `assertManifestPrecedesExecution`. `tests/manifest.spec.ts` covers them in 13 cases, one per registry-declared must[] clause and acceptance[] item. No invariant companion is published because this slice constructs no registry, log, or `Context` value to check an owned relation over — `assertManifestPrecedesExecution` decides over a plain `readonly AppendedManifest[]` a caller supplies, not a value this package owns or mutates.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The manifest surface is called with plain data — no file, process, or Cordis `Context` access:

```ts
import { createActionManifest, assertManifestPrecedesExecution, computeArgumentsHash } from '@deepseek-ai/dsh-action-manifest'
import type { AppendedManifest, CreateActionManifestRequest } from '@deepseek-ai/dsh-action-manifest/types'

declare const request: CreateActionManifestRequest // actionId/runId/actor/capability/target/args/idempotencyKey/preconditions/expectedDiff/compensation/evidenceRequirements
declare const appendedLog: readonly AppendedManifest[] // every manifest the durable event log already carries, in append order

const manifest = createActionManifest(request)
// manifest.argumentsHash === computeArgumentsHash(request.args)
// manifest.sideEffectClass defaults to 'destructive' with requiresApproval: true
// when request.declaredSideEffectClass is absent (acceptance[2])

const gate = assertManifestPrecedesExecution(manifest.actionId, manifest.argumentsHash, appendedLog)
// gate.admitted is false with reason 'no-manifest-appended' | 'manifest-argument-mismatch'
// when no matching manifest precedes this execution attempt (must[1], acceptance[0]) --
// applies identically regardless of manifest.origin (must[2])
```

Every export is a pure function over already-computed data: no export in this package reads a file, spawns a process, appends to a real durable log, or constructs a Cordis `Context` — a later Usage-stage caller supplies `appendedLog` from a real event log and wires this gate into the real tool-dispatch path.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Actor and run identity are reused, not re-branded.** `ActionManifest.actor`/`runId` are `@deepseek-ai/dsh-principal`'s `Principal`/`RunId` directly — Epic P2-01 is this epic's declared predecessor precisely so a manifest's actor is the same traceable principal every other durable record carries, never a second, parallel identity vocabulary.
- **Origin is a manifest field, not a side channel.** `ActionOrigin` (`'native-tool-call'` | `'code-mode-embedded'` | `'plugin-rpc'`) is part of `ActionManifest` itself, and `assertManifestPrecedesExecution` never branches on it — must[2]'s "cannot bypass" requirement is structural (the gate has no origin-conditional code path to bypass through), not a rule a future caller could forget to re-add for a new invocation surface.
- **Generation is fixed; durable append and policy are not.** `createActionManifest` never appends anything and never reads or returns a policy/approval decision — must[1]'s ordering ("先生成并 durable append manifest，再做 policy/approval") is enforced by `assertManifestPrecedesExecution` reading an already-appended log the caller supplies, keeping this package ignorant of how appends or approvals are actually implemented (a later Usage-stage Consumer's job).
- **Unclassifiable is a fail-closed default, not an error.** `classifySideEffect(undefined)` returns a normal `SideEffectClassification` value (`sideEffectClass: 'destructive'`, `requiresApproval: true`) rather than throwing — an action the classifier cannot reason about is not a bug to crash on, it is the highest-risk case a caller must handle (acceptance[2]).
- **"Not reversible" is stated, never merely absent.** `Compensation` is a discriminated union on `reversible`, not an optional field — an action the issuer knows cannot be undone declares `{ reversible: false, reason }` explicitly, closing the gap a missing/undefined `compensation` field would otherwise leave ambiguous between "forgot to fill this in" and "genuinely irreversible".

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The manifest/request/gate type surface: `ActionManifest`, `CreateActionManifestRequest`, `AppendedManifest`, `ExecutionGateDecision`, `SideEffectClassification`, plus the branded ids and value types they compose |
| [`src/canonicalize.ts`](src/canonicalize.ts) | `canonicalizeArguments`/`computeArgumentsHash` (acceptance[1]), `classifySideEffect` (acceptance[2]), `createActionManifest` (must[0]/must[1]), `assertManifestPrecedesExecution` (must[1]/acceptance[0]/must[2]) |
| [`src/index.ts`](src/index.ts) | Package entry point barrel; re-exports `./canonicalize.ts` in full. Not itself part of this epic's Contract-stage deliverable — see its own module doc |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/manifest.spec.ts`](tests/manifest.spec.ts) — 13 cases, one per registry-declared must[] clause and acceptance[] item, with acceptance[0] and must[2] each split into paired admit/refuse cases.
- [`../../../spec/action-manifest.schema.json`](../../../spec/action-manifest.schema.json) — the JSON Schema mirror of `ActionManifest`, since this epic's `stages.C.files` is schema-first.
- [`packages/core/tools/src/index.ts`](../../core/tools/src/index.ts), [`packages/core/tools/src/ptc.ts`](../../core/tools/src/ptc.ts), [`packages/core/agent-loop/src/tool-calls.ts`](../../core/agent-loop/src/tool-calls.ts) — the real tool-dispatch, code-mode `run_code` bridge, and agent-loop paths must[1]/must[2] require this epic's gate to sit in front of (Usage-stage wiring, not this package's job; this epic's `stages.P` is `N/A`).
- [`@deepseek-ai/dsh-principal`](../../identity/principal/README.md) — this epic's predecessor (P2-01), the source of `Principal`/`RunId`.
- [`@deepseek-ai/dsh-plugin-ownership`](../../plugin/plugin-ownership/README.md) — this repo's other Contract-stage capability package, followed here for package layout and pure-function conventions.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure decision-function signatures only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No wiring into real tool dispatch exists yet.** `packages/core/tools/src/index.ts`, `packages/core/tools/src/ptc.ts`, `packages/core/tools/src/code-mode.ts`, `packages/core/agent-loop/src/tool-calls.ts`, and `packages/core/session/src/known-event-types.ts` do not call into this package (registry's own `stages.U.files`) — this package alone cannot generate a real manifest for an actual tool call, durably append one to a session log, or block a real execution attempt.
- **`CapabilityRef`'s exact string grammar is unfixed**, and it deliberately does not import `@deepseek-ai/dsh-plugin-ownership`'s `StableCapabilityId` — Epic P1-09 is not a declared predecessor of P2-03. A later integration stage decides whether and how to unify the two capability-identity vocabularies.
- **`classifySideEffect` trusts a declared class verbatim and requires approval only for `'destructive'`.** `'write'`, `'network'`, and `'process'` return `requiresApproval: false`, and no export re-derives a class from `target` or `args` to catch a capability that under-declares its own side effect. A richer approval policy is a deployment concern this package does not own (registry `nonGoals`: "不引入与本项无关的垂直业务逻辑").

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
