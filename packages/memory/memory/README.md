---
description: "The provider-neutral durable Memory service (ctx.memory): propose/query/get/revise/forget/export over interchangeable providers, with principal/purpose/scope/context-budget read scoping and one selection policy."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

## Summary

`dsh-memory` (`ctx.memory`) is the provider-neutral durable Memory capability seam (first100 registry P6-01): propose a candidate write, query or get existing records, revise or forget one, and export everything visible to a caller — all without naming a vector database, graph database, or any other retrieval mechanism. A concrete provider (local-reference, embedding-backed, graph-backed, ...) plugs in as a backend, and the service resolves one usable provider per call, so consumers never bind to a specific vendor. Every read carries a complete access context (`principal`, `purpose`, `scope`, `contextBudget`); the seam enforces the size bound itself. `propose()` is the only mutation entry point — there is no `write`/`set`/`put` verb — so a durable record can never originate outside it.

Contract stage only (first100 registry P6-01, C): the provider registry and selection logic are real, mirroring `dsh-web`'s `WebRuntime`, but no shipped provider exists yet. `createLocalReferenceMemoryProvider()`/`createFakeMemoryProvider()` are intentionally unimplemented stubs for the Contract-stage conformance suite; a later Provider stage replaces their bodies.

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

A composition that needs durable memory loads `dsh-memory` and mounts at least one provider; a plugin or tool author then calls `ctx.memory.propose()`/`query()`/`get()`/`revise()`/`forget()`/`export()` directly. The service resolves the provider for each call, so callers never see provider ids unless they configured one.

### When to choose it

Choose the service when a plugin or tool must read or write durable, cross-session memory without hard-coding a vendor. You do not need it for reading the current or a past conversation's own transcript — that is [Session Query](../../session-query/README.md)'s job (see the [subsystem boundary](../../../docs/subsystems/memory.md#memory-vs-session-query)). The service adds no storage of its own: without at least one usable provider, every call fails with a structured `MemoryError`.

### Minimal configuration

Load the service and let a single mounted provider auto-select, or pin a provider id with `providerId`. The environment variable `$DSH_MEMORY_PROVIDER` feeds the same field and is not a separate priority chain.

```yaml
- name: '@deepseek-ai/dsh-memory'
```

| Field | Default | Meaning |
|---|---|---|
| `providerId` | (unset) | Pinned provider id; unset auto-selects when exactly one is usable |

### Operations

```text
// Propose a candidate write — the only mutation entry point:
const { id } = await ctx.memory.propose({ principal, scope, content })

// Read, scoped by principal/purpose/scope/contextBudget:
const { records, truncated } = await ctx.memory.query({ accessContext, query: 'text' })
const record = await ctx.memory.get({ accessContext, id })

// Revise or forget an id a prior propose() actually returned:
await ctx.memory.revise({ principal, scope, id, content })
await ctx.memory.forget({ principal, scope, id })

// Bulk-read everything visible to an access context:
const { records } = await ctx.memory.export({ accessContext })
```

The [Memory subsystem](../../../docs/subsystems/memory.md) reference is the exhaustive vocabulary and the read-scoping and no-bypass rationale.

### Provider selection

Each call resolves its provider at execution time, and registration or load order never matters. A configured provider id wins when it is registered and usable; without a configured id, the service runs the single usable provider or fails clearly:

| Situation | Outcome |
|---|---|
| configured id registered and usable | runs that provider |
| configured id not registered | `MEMORY_PROVIDER_CONFIGURED_MISSING` |
| configured id registered but unavailable | `MEMORY_PROVIDER_CONFIGURED_UNAVAILABLE` |
| no id, exactly one registered usable provider | runs it |
| no id, no usable provider | `MEMORY_PROVIDER_UNAVAILABLE` |
| no id, multiple usable providers | `MEMORY_PROVIDER_AMBIGUOUS` |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the service; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Provider-neutral by construction.** `src/types.ts` names no vector/graph-specific field anywhere in the request/result vocabulary (`must[0]`); `query()` takes free text and leaves the retrieval mechanism entirely to the provider.
- **One mutation entry point.** `propose()` is the only verb that can introduce a new durable record; there is no `write`/`set`/`put` verb to bypass it (`acceptance[1]`).
- **Selection is never order-dependent**, mirroring `dsh-web`'s `WebRuntime`: a capability either pins a provider id or auto-selects when exactly one usable provider is registered.
- **The seam owns the read size bound.** `contextBudget.maxRecords` is enforced after the provider returns, so an over-returning provider can never leak more records than the caller's budget allows.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `MemoryRuntime` service, the provider registry, execution-time selection, and the Contract-stage `createLocalReferenceMemoryProvider`/`createFakeMemoryProvider` stubs |
| [`src/types.ts`](src/types.ts) | Vocabulary: request/result types, `MemoryProvider`, the `MemoryError` taxonomy, and the `memory/access` durable session event |
| — | No runtime invariant companion is published; `memory/access` is this package's own event, minted only by `MemoryRuntime`, so no independent second source exists to cross-check it against — the same situation `dsh-web` resolved by omitting a companion. `must[3]`'s read scoping belongs in `query()`/`get()`/`export()` themselves, not a post-hoc log check. |

### Data model

`MemoryRecordView` is a provisional, minimal projection sufficient for Contract-stage conformance only — the canonical `MemoryRecord` (content artifact/ref, kind, subject, source events, confidence, TTL, sensitivity, status, supersedes/disputes) is first100 registry P6-02's job. `principal`/`scope.tenantId` reuse `Principal`/`TenantId` from `@deepseek-ai/dsh-principal` (first100 registry P2-01) rather than a parallel identity vocabulary.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Memory subsystem](../../../docs/subsystems/memory.md) — the exhaustive request/result vocabulary, the read-scoping and no-bypass rationale, and the Memory vs. Session Query boundary.
- [Identity/Principal](../../identity/principal/README.md) — the `Principal`/`TenantId` vocabulary this seam reuses.

-----

<a id="model-experience"></a>
## Model Experience

None, as this Contract-stage seam ships no model-facing tool and contributes no prompt or schema of its own; a later consumer package would render its own model-facing surface over `ctx.memory`.

#### KV Cache effect

No direct invalidation; a named future consumer would own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the service is incomplete on its own. They are current package constraints for the Contract stage.

- **No shipped provider** — `createLocalReferenceMemoryProvider()`/`createFakeMemoryProvider()` are intentionally unimplemented stubs whose methods reject with a plain error; a real, durable provider is first100 registry P6-01's Provider stage.
- **The durable provider is not implemented yet** — `createDurableFileMemoryProvider({ directory })` declares the durable, file-backed backend (per-directory durability, tenant/session read scoping, `durable-file-<uuid>` ids) and its methods reject with a plain `not implemented` error; `../tests/durable-provider.spec.ts` asserts the required behavior, currently RED pending that implementation.
- **No live session-log wiring** — nothing yet emits the `memory/access` durable event this package declares; a live call site is the Usage stage's job.
- **`must[3]` read-scoping enforcement is not yet added** — `query()`/`get()`/`export()` do not yet reject an incomplete `MemoryAccessContext`; `../tests/conformance.spec.ts` asserts the required `MemoryError` `MEMORY_ACCESS_CONTEXT_REQUIRED` behavior, currently RED pending that enforcement.
- **No model-facing tool** — `ctx.memory` has no consumer yet; a `dsh-tool-memory`-shaped package is out of this epic's scope.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Follow-up registrations this Contract-stage PR left open

- `scripts/verify-package-readme-model-experience.ts` does not yet list `@deepseek-ai/dsh-memory` in its audited sentence map; `pnpm run doc-sync` needs that entry before it passes for this package.
- `packages/core/session/src/known-event-types.ts` is generated (`pnpm run gen-persistence-catalog`) and does not yet list `memory/access`; regenerate it once this package's `SessionEventMap` addition is ready to ship.
- No group README exists yet at `packages/memory/README.md` (subsystem-page ownership link); `scripts/verify-subsystem-pages.ts` needs either that page or a justified exemption entry.

</details>
