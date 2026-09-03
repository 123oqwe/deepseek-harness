# Memory

Provider-neutral durable Memory capability seam (first100 registry P6-01). The [Service Definition package](../../packages/memory/memory) owns propose/query/get/revise/forget/export vocabulary, provider selection, and the `memory/access` durable session event; a concrete provider (embedding-backed, graph-backed, plain-text, or otherwise) is a separate, swappable package this page's vocabulary never names.

Source: [`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

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

## Status

Contract stage only (first100 registry P6-01, C). `MemoryRuntime`'s provider registry and selection logic are real; `createLocalReferenceMemoryProvider()`/`createFakeMemoryProvider()` (`packages/memory/memory/src/index.ts`) are intentionally unimplemented stubs pending the Provider stage. Wiring a live `ctx.memory` call into the durable session log — so the `memory/access` event this page's read-scoping section describes has a real emitter, and so `packages/memory/memory/src/invariant.ts` has real events to validate — is the Usage stage's job.
