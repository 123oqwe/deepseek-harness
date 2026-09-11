# P6-07.U preFlight — giving the session lifecycle a subject

**Status: measurement only. No code written, nothing submitted for approval yet.** Re-measured at `ed5bbe16d3`; the earlier revision of this document is superseded, and one of its claims is corrected below.

P6-07's sign-off was withdrawn (§12.75) because `@deepseek-ai/dsh-session-lifecycle` is mounted in none of the six bundles and nothing outside its own package calls it. Same shape as P2-02: the mechanism is complete and nothing is its subject.

## Question 3 — each clause's subject, and who actually holds it today

The measurement that matters for a U stage is not "does the subject exist" but "which implementation is the one production reaches". For four of this epic's clauses the answer is **a different implementation in a different package, under the same name**.

| clause | this epic's subject | what production actually reaches |
| --- | --- | --- |
| must[0] list filtered by tenant/workspace/status/time | `listSessions(records, request)` — filters, deterministic sort, keyset cursor — `session-lifecycle/src/index.ts:145`; filters at `session-query/src/filters.ts` | `SessionQuery.listSessions(signal)` returns the whole corpus (`session-query/src/index.ts:161`) and `api/session-controller/src/list.ts:139` walks its own cursor with a halving retry (`list.ts:246-289`) |
| must[1] soft delete | `softDeleteSession` — `retention.ts:148` | **nothing.** No production caller anywhere |
| must[1] legal hold | `placeLegalHold` / `assertNoLegalHold` — `retention.ts:163,181` | **nothing** |
| must[1] hard erase | `hardErase` — `delete.ts:204` | **nothing** |
| must[1] archive | `archiveSession(record, archivedBy, occurredAt)` returns a record with a disposition — `retention.ts:134` | `WorkspaceRegistry.archiveSession(sessionId)` — `workspace/src/index.ts:290` — durable, serialized on the registry write chain, exposed as `@Remote('archiveSession')` (`api/workspace-controller/src/index.ts:107`) and driven by the Web UI |
| must[2] deletion propagates to query/attachments/memory/artifacts by policy | `propagateDeletion` + `SOFT_DELETE_POLICY` / `HARD_ERASE_POLICY` — `delete.ts:149,115,125` | **nothing** |
| acceptance[2] corrupted-log read returns the minimal recoverable range plus evidence | `readSessionLogWithRepair` — `index.ts:290` | the JSONL scanner's own `corruption` field — `session-persistence-jsonl/src/format.ts:355,535` — which **mirrors this epic's `CorruptedLogEvidence` by structure and deliberately not by import** (`format.ts:358-368`, BLOCKED-075). `core/session/src/repair.ts` holds the separate interrupted-turn repair |

**Correction to the earlier revision of this document.** It said "nothing in the harness expires, erases, holds or archives a session today." Erase, hold and expiry are still true. **Archive is not** — `dsh-workspace` archives sessions durably today, over the Remote API, from the Web UI. The earlier sentence was written from this package's call census alone and never looked for the verb elsewhere, which is the same mistake that let the two `listSessions` sit side by side unnoticed.

## The finding that decides the rebuild: three parallel implementations, and the reached one is never this epic's

| verb | this epic | the reached one | relation |
| --- | --- | --- | --- |
| `listSessions` | page over a loaded candidate set, keyset cursor | whole-corpus read + a hand-rolled cursor in the controller | same rule, two implementations |
| `archiveSession` | pure: record → record with disposition | durable: append to `archivedSessionIds` | same verb, two mechanisms, two storage locations |
| `CorruptedLogEvidence` | `index.ts:246`, no bound on `raw` | `format.ts:369`, bounded by `CORRUPTION_RAW_LIMIT` | structural mirror, independence deliberate, divergence invisible to the compiler |

This is one pattern, not three coincidences: **every clause of P6-07 that production actually needed, production built somewhere else.** The clauses with no second implementation — soft delete, legal hold, hard erase, propagation — are exactly the ones production has never needed.

So the U stage's question is not "find somewhere to call `applyRetention`". It is: for each clause, either this epic's implementation becomes the one production reaches and the duplicate goes, or this epic's is the wrong shape and the clause's subject is the other one. Adding a second caller to the unreached side would make the duplication permanent.

## What the existing U freeze proves, and what it does not

The frozen U entry runs `session-query/tests/lifecycle-projection.spec.ts` + `session-lifecycle/tests/projection.spec.ts`, 23 cases, all about `projectLifecycleRecords` and the tenant/workspace filter branches. Several are genuinely end-to-end against the real corpus ("feeds listSessions, so a tenant-filtered page walk over the real corpus omits and duplicates nothing").

But `projectLifecycleRecords` has **zero callers outside its own package** — the census below covers the whole post-rebase tree, not `packages/*/src`. So those 23 cases construct the projection themselves. They prove the projection is correct; they do not prove anything on a launched profile reaches it. That gap is precisely what §12.75 withdrew the sign-off for, and re-running this freeze green does not close it.

**Census method, stated so it can be checked:** `git ls-files` over the entire tree (not a `src`-only glob — the rule recorded after `P6-01.fault.spec.ts` survived a `packages/*/src`+`apps/*/src` grep), symbol by symbol, excluding the package's own directory. Result: `projectLifecycleRecords`, `readSessionLogWithRepair`, `propagateDeletion`, `hardErase`, `softDeleteSession`, `placeLegalHold`, `assertNoLegalHold`, `createFileSessionLifecycleStore` — none. `listSessions` and `archiveSession` — many hits, all of them the other implementation. The single tree-wide mention of `@deepseek-ai/dsh-session-lifecycle` outside the package is the prose comment at `format.ts:360`, and it says explicitly that it does not import.

## The question that must be answered before any code

`ApiSessionList` is the honest consumer for must[0], and wiring it gives the cursor and filters a production caller on a launched profile while deleting a duplicate. But the two work on different record types (`SessionLifecycleRecord` vs `SessionRecord`) and the lifecycle's signature is pure — it pages over a set the caller already holds, while the controller's path is incremental and never holds the corpus. Reconciling them is either

1. a projection from `SessionRecord` to `SessionLifecycleRecord` at the controller, paging over a loaded page rather than the corpus — which changes what the lifecycle's cursor means and quietly weakens acceptance[0]'s million-session claim; or
2. the lifecycle's decision moving behind the query service's incremental surface — the honest shape, and a change to `session-query`'s contract, therefore not P6-07's alone.

Neither is picked here. **The `archiveSession` collision needs its own answer** and it is not the same one: unlike `listSessions`, the reached implementation is durable and the unreached one is pure, so "replace the duplicate" would mean this epic's pure function absorbing a durable registry write. **And the retention/erasure/hold half has no candidate consumer at all** — whether it gets a subject in P6-07.U or is split under §12.46-B with producers scheduled elsewhere is the delegate's call, not an assumption this document makes.

## Question 4 — the execution card, re-read

Row `P6-07`, card heading `#### P6-07`, `sheetCommit: null`. Verdict **`PROVIDER_WRITE`**, no secondary. `adopted: []` — this epic takes on nothing, so nothing in U can lean on an external package's guarantees. `standardsOwned: []` and `standardsImported: []`. `rejectedAbsent: []`. `gapCheck: []`. `expectedDeletedPct: "0"` — **and that field is now questionable**: the rebuild above is a duplicate-removal, so a U stage that does it honestly deletes the controller's hand-rolled cursor walk. If the delegate takes option (1) or (2), this field wants re-stating rather than inheriting.

Two deviations are recorded, both re-stated on their own merits after the withdrawal made their previous "ACCEPTED-row" reasoning false:

- **`node:sqlite` keyset pagination — not adopted.** A technique, not a package; no `node:sqlite` import in anything this epic wrote. The card says explicitly that P6-07.U reopens the pagination question rather than inheriting it — which is this document's central question, so the card and this preFlight agree.
- **`fast-check` — not adopted by this epic's own cases.** Present in the repository, absent from this epic's reality set. Note validation[0] is literally "运行 pagination property tests"; the frozen cases are example-based. If U rebuilds must[0] on a real consumer, `fast-check` is the named candidate for that clause and the card already says so.

`residual`: "Session lifecycle, retention, and the corrupted-log read path." All three are still residual, and the measurement above says why: retention has no consumer, the read path has a reached rival, and the lifecycle listing has a reached rival.

The card's `probes` entry is `MIXED` with a positive control (an importer of `vitest` must be found), so the per-entry zeros are real zeros rather than a silent scan failure. `recordedBeforeFirstLine: false`, backfilled 2026-09-07 under gate (e) — so the card is a reconstruction, not a contemporaneous record, and this preFlight treats it as evidence about the epic rather than as a decision made before it.

## Open questions this preFlight does NOT settle

1. **must[0]'s rebuild shape** — option (1) vs (2) above.
2. **The `archiveSession` collision** — which of the two is P6-07's subject, given the reached one is durable and this epic's is pure.
3. **Whether the retention/erasure/hold half gets a consumer in P6-07.U or splits under §12.46-B.**
4. **`expectedDeletedPct: "0"`** — inconsistent with any honest duplicate-removal; needs re-stating with the chosen shape.
5. **validation[0]'s "property tests"** against example-based frozen cases, and whether the card's named `fast-check` becomes an adopt at U.
