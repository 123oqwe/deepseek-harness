# P6-07.U preFlight — giving the session lifecycle a subject

**Status: measurement only. No code written, nothing submitted for approval yet.**

P6-07's sign-off was withdrawn (§12.75) because `@deepseek-ai/dsh-session-lifecycle` is mounted in none of the six bundles, has zero importers outside its own package, and `listSessions` / `applyRetention` / `softDelete` / `hardErase` / `legalHold` / `archiveSession` each have zero production callers. Only the repair half is reached, through `core/session`. Same shape as P2-02: the mechanism is complete and nothing is its subject.

## The finding that decides the rebuild: there are TWO `listSessions`, and the reached one is not this epic's

Measured on this tree:

| symbol | package | production callers |
| --- | --- | --- |
| `listSessions(records, request)` | `@deepseek-ai/dsh-session-lifecycle` | **0** |
| `listSessions(signal?)` | `@deepseek-ai/dsh-session-query` | reached — `packages/api/session-controller/src/list.ts:139` calls `ctx.sessionQuery.listSessions(signal)` |

They are not the same function wearing one name. The lifecycle's takes a complete candidate set plus `{filters, cursor, pageSize}` and returns one page with a continuation cursor — filtering, deterministic sort and keyset pagination that tolerates concurrent insert/delete. The query service's takes only a signal and returns every `SessionRecord`; the API controller then does its own cursor walk against `provider.searchSessions` with its own halving retry (`list.ts:246-289`).

So the harness ALREADY paginates sessions in production, with a hand-rolled cursor, beside an unused package that exists to decide exactly that. One rule, two implementations, and the one nothing reaches is the one this epic shipped.

## What that makes the rebuild, and the question it raises

The U stage is not "find somewhere to call `applyRetention`". It is: **`ApiSessionList` is the real consumer, and it should be deciding pagination with `session-lifecycle` instead of its own walk.** That gives `listSessions`, its cursor and its filters a production caller on a launched profile — `api/session-controller` is mounted in the bundles the web and SDK profiles boot — and it removes a duplicate rather than adding a second one.

**The question that has to be answered before any code:** the two work on different record types (`SessionLifecycleRecord` vs `SessionRecord`), and the lifecycle's signature is pure — it pages over a set the caller has already loaded, while the controller's path is incremental and never holds the whole corpus. Reconciling them is either

1. a projection from `SessionRecord` to `SessionLifecycleRecord` at the controller, paging over a loaded page rather than the corpus — which changes what the lifecycle's cursor means; or
2. the lifecycle's decision moving behind the query service's incremental surface, which is a change to `session-query`'s contract and therefore not P6-07's alone.

Neither is picked here. (1) keeps the change inside P6-07's own files but weakens what its pagination claims; (2) is the honest shape and crosses into another epic's package.

**The retention, erasure, legal-hold and archive halves are a separate question** and are not answered by the same consumer: nothing in the harness expires, erases, holds or archives a session today. Whether those get a subject in P6-07.U or are split under §12.46-B with producers scheduled elsewhere is the delegate's, and this document does not assume it.
