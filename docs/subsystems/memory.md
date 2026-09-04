# Memory

English | [中文](memory.zh.md)

Provider-neutral durable Memory capability seam (first100 registry P6-01). The [Service Definition package](../../packages/memory/memory) owns propose/query/get/revise/forget/export vocabulary, provider selection, and the `memory/access` durable session event; a concrete provider (embedding-backed, graph-backed, plain-text, or otherwise) is a separate, swappable package this page's vocabulary never names.

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

<a id="memory-vs-session-query"></a>

## Memory vs. Session Query

Memory is not [Session Query](session-query.md), and the two are never interchangeable:

| | Memory | Session Query |
|---|---|---|
| Reads | Records a caller explicitly `propose()`d into durable storage | The existing conversation/session corpus itself (messages, tool calls, events) |
| Scope | Cross-session, keyed by tenant/principal | One session (or a bounded cross-session corpus read), keyed by session identity |
| Population | Explicit `propose()` only — never derived automatically from a transcript | Populated by the ordinary act of conducting a session; nothing is "proposed" into it |
| Mutation | `revise()`/`forget()` change or remove a durable record | Read-only: a session's own log is append-only and is never edited through this seam |
| Retrieval mechanism | Provider-defined and unspecified here (`must[0]`) — embedding, graph, or keyword | Structured filters, source precedence, and full-text search over logged events |

A consumer that wants "what did we discuss earlier in this conversation" reaches for Session Query; a consumer that wants "what has this user told us, durably, across every conversation" reaches for Memory. Neither seam is a backend for the other: Memory never queries the session log to answer `query()`/`get()`, and Session Query never reads a `MemoryRecordView`.

## The provider-neutral vocabulary

`must[0]` requires the seam to define propose/query/get/revise/forget/export without naming a vector database or graph database. Every request/result pair below is deliberately silent on retrieval mechanism; `MemoryQueryRequest.query` is free text, and how a provider turns that into matching records is entirely its own concern.

```ts type-equiv
/** A candidate write. `propose` is the ONLY mutation entry point a model-facing caller has. */
interface MemoryProposeRequest {
  readonly principal: Principal
  readonly scope: MemoryScope
  readonly content: unknown
}
```

```ts type-equiv
/** Result of a successful `propose()`: the newly minted record's identity. */
interface MemoryProposeResult {
  readonly id: MemoryRecordId
}
```

```ts type-equiv
/** A free-text read request; the seam names no retrieval mechanism (`must[0]`). */
interface MemoryQueryRequest {
  readonly accessContext: MemoryAccessContext
  readonly query: string
}
```

```ts type-equiv
/** Result of `query()`. `truncated` is set when the seam cut `records[]` down to `contextBudget.maxRecords`. */
interface MemoryQueryResult {
  readonly records: readonly MemoryRecordView[]
  readonly truncated: boolean
}
```

The `MemoryRecordView` returned by `query()`/`get()`/`export()` is a **provisional, minimal** projection sufficient for Contract-stage conformance only. The canonical `MemoryRecord` — content artifact/ref, kind, subject, source events, confidence, TTL, sensitivity, status, and supersedes/disputes relations — is first100 registry P6-02's job in a later wave and supersedes this shape.

## Read scoping (`must[3]`)

Every read (`query`, `get`, `export`) carries a complete `MemoryAccessContext`:

```ts type-equiv
/**
 * The four dimensions `must[3]` requires on every memory read: who is
 * reading (`principal`), why (`purpose`), within what boundary (`scope`),
 * and under what size bound (`contextBudget`). Carried by `query`, `get`, and
 * `export` — the seam rejects a read whose access context is incomplete.
 */
interface MemoryAccessContext {
  readonly principal: Principal
  readonly purpose: string
  readonly scope: MemoryScope
  readonly contextBudget: MemoryContextBudget
}
```

`principal` and `scope.tenantId` reuse [`Principal`/`TenantId`](../../packages/identity/principal/src/types.ts) from the first100 registry P2-01 identity seam rather than inventing a parallel identity vocabulary. `purpose` is an open string at Contract stage — no fixed taxonomy is imposed. `contextBudget` (`maxRecords`/`maxTokens`) is enforced by the seam itself after the provider returns, mirroring `WebRuntime`'s `maxResults` enforcement (`@deepseek-ai/dsh-web`): an over-returning provider can never leak more records than the caller's budget allows.

## No durable-write bypass (`acceptance[1]`)

`propose()` is the package's only mutation entry point — there is no `write`/`set`/`put` verb on `MemoryProvider`. A durable record's identity is always minted by a provider inside `propose()`; `revise()`/`forget()` operate only on an id a prior `propose()` actually returned, so a caller cannot fabricate a durable memory by inventing an id and calling `revise()` directly.

## Provider replaceability (`must[1]`)

`MemoryRuntime` (`ctx.memory`) mirrors `WebRuntime`'s selection semantics: a configured provider id wins when registered and usable; without one, the single registered usable provider runs; zero or multiple usable providers fail clearly (`MEMORY_PROVIDER_UNAVAILABLE` / `MEMORY_PROVIDER_AMBIGUOUS`). Selection never depends on registration order, so swapping which provider backs `ctx.memory` never requires a consumer code change.

## Consumers go through the Service Definition (`must[2]`)

`ctx.memory` is the only intended entry point. A `MemoryProvider` object is inert on its own — constructing one has no effect until `ctx.memory.registerProvider()` makes it reachable; there is no free-standing `proposeMemory()`/`queryMemory()` export a consumer could call while skipping the seam.

The shipped consumer is [`@deepseek-ai/dsh-memory-context`](../../packages/context/memory-context/README.md), which recalls records on each step and appends them to the request. It injects the `memory` service and calls it; it imports no provider and no `MemoryRuntime` class, so swapping the mounted provider changes what it recalls with no change to the consumer.

### Recall is logged wherever it is model-visible (`validation[3]`)

A memory record that reaches a model request must be reconstructable from the session log alone. The consumer satisfies this by construction rather than by audit: the injected `user/message` and its `memory/access` event are produced from the same read result on the same code path, so neither can occur without the other. `memory/access` is a registered `SessionEventMap` member, so a log carrying it survives replay through the persistence read path instead of being refused as an unknown type.

The seam itself emits nothing. A caller of `ctx.memory` other than this consumer records no event unless it appends one, so the log is complete for reads made through a consumer that writes one, not for every conceivable caller.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryruntime"></a>

### `ctx.memory` — `MemoryRuntime`

The memory access service. Registered as `ctx.memory` (one instance per context).

Selection semantics (resolved at execution time, never order-dependent):

- A configured id that is registered and `available()` → that provider.
- A configured id not registered → `MEMORY_PROVIDER_CONFIGURED_MISSING`.
- A configured id registered but unavailable → `MEMORY_PROVIDER_CONFIGURED_UNAVAILABLE`.
- No id configured, exactly one registered usable provider → that provider.
- No id configured, multiple usable providers → `MEMORY_PROVIDER_AMBIGUOUS`.
- No id configured, no usable provider → `MEMORY_PROVIDER_UNAVAILABLE`.

```ts cordis-catalog
/**
 * Register a memory provider. Throws {@link MemoryError}
 * `MEMORY_DUPLICATE_PROVIDER` if its id is already registered. Returns a
 * disposer; disposed with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: MemoryProvider): () => void

/**
 * Submit a candidate write. The only mutation entry point this seam
 * exposes (`acceptance[1]`).
 * @param request - the candidate content, its principal, and its scope.
 * @returns the newly minted record's identity.
 */
async propose(request: MemoryProposeRequest): Promise<MemoryProposeResult>

/**
 * Run a free-text read through the selected provider, capped to
 * `request.accessContext.contextBudget.maxRecords`.
 * @param request - the query and its complete access context.
 * @returns matching records, capped to the caller's budget.
 */
async query(request: MemoryQueryRequest): Promise<MemoryQueryResult>

/**
 * Fetch one record by id.
 * @param request - the record id and its complete access context.
 * @returns the record, or `undefined` when no such record is visible to the access context.
 */
async get(request: MemoryGetRequest): Promise<MemoryRecordView | undefined>

/**
 * Update an existing record's content. Rejected when `request.id` was
 * never returned by a prior `propose()` (`acceptance[1]`).
 * @param request - the target id, its new content, its principal, and its scope.
 * @returns Nothing.
 */
async revise(request: MemoryReviseRequest): Promise<void>

/**
 * Remove a record. Idempotent.
 * @param request - the target id, its principal, and its scope.
 * @returns Nothing.
 */
async forget(request: MemoryForgetRequest): Promise<void>

/**
 * Bulk-read every record visible to `request.accessContext`, capped to
 * `contextBudget.maxRecords`.
 * @param request - the complete access context.
 * @returns every visible record, capped to the caller's budget.
 */
async export(request: MemoryExportRequest): Promise<MemoryExportResult>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Status

Contract, Provider, and Usage stages (first100 registry P6-01, C+P+U). `MemoryRuntime`'s provider registry/selection logic, all three providers (`createLocalReferenceMemoryProvider()`/`createFakeMemoryProvider()`/`createDurableFileMemoryProvider()`), and `must[3]` read-scoping enforcement in `query()`/`get()`/`export()` are real (`packages/memory/memory/src/index.ts`), covered by [`conformance.spec.ts`](../../packages/memory/memory/tests/conformance.spec.ts) and [`durable-provider.spec.ts`](../../packages/memory/memory/tests/durable-provider.spec.ts).

The Usage stage adds the live call site: [`@deepseek-ai/dsh-memory-context`](../../packages/context/memory-context/README.md) recalls memory into real requests and emits `memory/access`, and the `dsh-base` bundle carries both it and `dsh-memory` as `disabled: true` rows a profile opts into. [`memory-context.spec.ts`](../../packages/context/memory-context/tests/memory-context.spec.ts) boots the shipped headless profile through the Loader and asserts the recall and its event over the durable JSONL log the run wrote, then reloads that log through the persistence read path to prove it replays.

The package publishes no `./invariant` companion (see the [package README](../../packages/memory/memory/README.md#understand-the-implementation)).
