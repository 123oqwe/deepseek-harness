# Agent Note: Every memory provider enforces the scope its caller read or wrote under

Status: implemented

English | [中文](2026-09-04-memory-seam-scope-enforcement.zh.md)

## Problem

`@deepseek-ai/dsh-memory` ships three `MemoryProvider` implementations behind the `ctx.memory` seam registry epic P6-01 defines. `createDurableFileMemoryProvider` stored the `MemoryScope` each `propose()` carried and filtered every operation through it. `createLocalReferenceMemoryProvider` and `createFakeMemoryProvider` stored no scope and filtered by none. Both are exported production factories — `createFakeMemoryProvider`'s name describes its retrieval mechanism, not its reachability — and both are what a composition gets when it registers a provider without a durable directory.

The worst consequence is a cross-tenant **write**, and it is the category P6-01's own clause did not anticipate. `must[3]` says every *read* is bounded by principal, purpose, scope and context budget, so the clause names reads; `revise()` is a write and was bounded by nothing. A caller holding a record id could call `revise()` under a different `tenantId` and silently overwrite another tenant's stored content, and the call resolved rather than rejecting — the caller was told it succeeded. One tenant modifying another tenant's durable data is a different category from disclosing it, not a facet of it.

Below that, `forget()` under a foreign tenant deleted the victim's record outright, and `export()`, `query()` and `get()` returned the victim's content verbatim. Three categories: write, destruction, disclosure.

The `sessionId` dimension leaked identically, and that is the fact that reframes the defect. A read scoped to `session-2` saw `session-1`'s record within the same tenant. So this was not a forgotten tenant filter but an absent filter: no dimension of `MemoryScope` bounded any operation, which is why `must[3]` names four dimensions rather than one.

Why the earlier stages did not catch it, which is the part that generalizes. Contract stage proved the seam **rejects an incomplete access context**; nothing anywhere proved that a **complete** one bounds the result. The seam's two guards are `requireCompleteAccessContext`, which checks that the four fields are present, and `capRecords`, which checks a count. A whole clause was guarded by a check on the *shape of its input* rather than on its *effect*, which is exactly why `must[3]` read as covered and was not. Provider stage did prove scope filtering — but only for the one provider that had it.

Two smaller defects surfaced under the same fault stage. `capRecords` compared `records.length <= maxRecords` and then called `slice(0, maxRecords)`, so a negative budget made the comparison false and the slice count back from the array's end: `maxRecords: -1` over three records returned **two** of them while reporting `truncated: true`. A partial result whose size depends on the budget's magnitude and whose flag asserts the bound was applied is worse than a uniform failure, because the flag is the thing a caller trusts. Separately, a damaged `memory.json` threw a bare `SyntaxError` out of `JSON.parse`, while the adjacent unknown-version branch raised a `MemoryError` naming the file — one failure class reported two ways from neighbouring lines.

## Decision

Scope enforcement lives in the provider, and all three providers now do it. `createLocalReferenceMemoryProvider` and `createFakeMemoryProvider` store the `MemoryScope` their `propose()` carried and filter every read **and every write** through `inScope`, the same predicate `createDurableFileMemoryProvider` already used. `revise()` and `forget()` treat an out-of-scope id as one that was never proposed: `revise()` raises `MEMORY_RECORD_NOT_FOUND` and `forget()` is a no-op, so a foreign id is indistinguishable from a nonexistent one and neither leaks the victim record's existence.

The two providers share the `inScope` predicate and nothing else. Their data structures, id schemes and query-matching algorithms stay distinct, because `acceptance[0]` requires two genuinely independent implementations passing one conformance suite and a shared store would collapse them into one implementation aliased twice. The predicate is the exception on its own merits: it is the contract both must enforce *identically*, and two hand-written copies of a security filter is how they drift.

`toRecordView` strips the stored scope on every read, so `MemoryRecordView` remains exactly `{id, principal, content, updatedAt}` and no reader sees a new field.

`capRecords` clamps a negative `maxRecords` to zero, bounding such a read to nothing rather than to a count taken from the end.

A damaged durable document raises `MemoryError` `MEMORY_CORRUPT_STORE` naming the file, with the parser's error as `cause`. The parser's own message is not surfaced as the failure: its text varies with the V8 version and names nothing a caller can route on.

### What the seam still cannot enforce, and who owns it

The seam does not enforce scoping and cannot. `MemoryRuntime.query/get/export` receive `MemoryRecordView` values that carry no tenant, so there is nothing to compare a read's `scope` against — a provider that returns out-of-scope records is believed. This fix makes the three shipped providers correct; it does not make the guarantee independent of the provider.

Closing it requires a scope or tenant field on `MemoryRecordView` in `packages/memory/memory/src/types.ts`. That is a Contract surface, so the owner is a C-stage supersession of P6-01, or registry epic P6-02, which owns the canonical `MemoryRecord` that supersedes this provisional view — `types.ts` states in-file that this module must not anticipate it. A fault stage rewriting a Contract surface is the overreach the stage rules exclude.

The unlock signal is mechanical: the residual is pinned by a passing case in `tests/first100/fixtures/P6-01.fault.spec.ts` titled `CHARACTERIZATION: a hostile provider still returns out-of-scope records, because the seam has no tenant on the record to check`. When the owning stage lands the field, that case starts failing. **That failure is the fix arriving, not a regression to patch back to green** — the case is then deleted along with the residual it recorded.

## Testing

`tests/first100/fixtures/P6-01.fault.spec.ts` carries 27 cases. Sixteen failed against the code as landed and pin the three defects above, across both providers and all four operations. Nine are prefixed `CHARACTERIZATION:` and passed already, pinning fault handling that was correct — `MEMORY_UNSUPPORTED_FORMAT_VERSION` for an unknown version and for a non-object document, an empty document reading as a first boot rather than damage, `MEMORY_DUPLICATE_PROVIDER` and a registry left usable after it, a provider's own mid-query rejection surfacing unwrapped, and `maxRecords: 0` — plus the residual above and the inertness of `MemoryContextBudget.maxTokens`, which is declared and read by no code.

Two cases are prefixed `control:` and also passed at RED: they assert a **same-tenant** read still sees its own record. They are neither proof nor pinning, and the mutation proof is what shows they are not decoration. Making `inScope` refuse everything — the plausible wrong fix — left **ten of the sixteen** cross-tenant cases green while reddening both controls. A security suite alone cannot tell a correct scope filter from a seam that returns nothing; only the controls separate them.

The same mutation also reddened the cross-tenant `revise()` and `forget()` cases, because each asserts the victim's record is **still readable afterwards**. Those assertions are load-bearing against an over-broad filter, not incidental setup, and simplifying them to a bare rejection check would remove redundancy the case names do not advertise.

All three fixes are proven in both directions. Reverting the scope filter reddens twelve defect cases and leaves controls and characterizations green. Reverting the budget clamp reddens exactly the two negative-budget cases; they are kept separate because one records that `truncated: true` lied and the other that the result was magnitude-dependent, and a merged case would prove only whichever fired first. Reverting the corrupt-store wrap reddens exactly the two damaged-document cases. Clamping every budget to zero, and widening `MEMORY_CORRUPT_STORE` over the unknown-version branch, each redden the cases that pin the distinction they erase.

No case asserts on a `JSON.parse` message or on temp-path equality, so none can pass on macOS and fail on Linux; every `mkdtemp` directory is removed in `afterEach`, since specs run in forked workers.

## Alternatives considered

**Enforcing scope at the seam, so the guarantee does not depend on providers behaving.** This is the better guarantee and it is what a reader meeting the per-provider filter will reach for. It is not available here: `MemoryRecordView` carries no tenant, so `MemoryRuntime` has nothing to filter against, and supplying one is a Contract change to `types.ts` owned by a C supersession or P6-02. Taking it inside a fault stage would have rewritten a frozen Contract surface to satisfy a stronger reading of the clause than the clause's own stage had shipped. Recorded here and pinned by a test so the residual does not evaporate at the next refactor.

**Giving the two in-memory providers one shared scoped store, deleting the duplicated filtering.** Rejected: `acceptance[0]` requires two independently written providers passing one conformance suite, and a shared store makes them one implementation registered under two ids, which would leave the swap test proving nothing. Sharing the `inScope` predicate alone keeps the independence that acceptance clause is about while removing the duplication that actually matters.

**Rejecting a negative `maxRecords` with a `MemoryError` instead of clamping it.** A negative budget is a caller bug and failing loud is this repository's default. Clamping won because the four read-scoping dimensions already have exactly one rejection path — `MEMORY_ACCESS_CONTEXT_REQUIRED`, for an *absent* dimension — and adding a second, value-based rejection to a budget whose whole purpose is to bound a result is surface a caller must now handle in order to ask for nothing. Bounding the read to nothing is what a budget of "less than zero records" means. The rejection remains available if a caller is ever found that would rather be told.

**Wrapping every provider rejection in a `MemoryError` while fixing the corrupt-store one.** Rejected as a catch-all, which this epic's gate names explicitly. `MEMORY_CORRUPT_STORE` is a failure this package's own reader detects and can describe; a provider's backend failure is not, and re-wrapping it would bury a `cause` chain the seam adds nothing to. The provider's own rejection surfacing unwrapped is pinned as a characterization rather than left unstated.

**Implementing `maxTokens` while fixing `maxRecords`.** Rejected as behaviour extension beyond what the fault cases prove. Enforcing it requires choosing a token-estimation policy, which is a decision with its own owner. Its inertness is pinned instead, so the next reader meets a recorded gap rather than an assumed feature.

## Consequences

A record proposed under one scope is no longer visible under another through any of the three providers, in either direction. Callers that relied on the in-memory providers ignoring scope — none exist in this repository; the seam's only consumer, `packages/context/memory-context`, reads under the tenant it proposes under — would now read nothing.

`MEMORY_CORRUPT_STORE` joins the seam's open-string code set. Consumers already tolerate provider-specific codes, so it is additive.

The two in-memory providers now allocate one `MemoryScope` reference per record. They are not durable and hold their records for the process lifetime, so the cost is a pointer per record and is not worth a measurement.

`MemoryContextBudget.maxTokens` remains declared and inert. It is the sixth field this program has found declared with no producer or consumer, which is a finding about how these vocabularies get written — a type authored ahead of its enforcement reads as a guarantee to everyone who meets it afterwards — rather than a fact about this field.

The residual above is the one thing this fix does not buy: a hostile or merely careless provider still returns whatever it likes, and the seam believes it. It is recorded in the program's lock register with its owner and unlock signal, because a residual that lives only in a test comment does not survive the next refactor.
