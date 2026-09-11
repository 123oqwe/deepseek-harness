# P6-02.U preFlight — the record vocabulary that nothing writes

**Status: measurement only. No code written.** Measured at `9922c153fa`. §12.19-1 / BLOCKED-146 withdrew this epic's sign-off because `validateRecord` / `recordConflict` and their siblings have no production caller. This document re-measures that, by the same method used for P6-07.U, and finds one thing the withdrawal did not know: the memory slice landed three commits ago gave P6-02's **vocabulary** its first production consumer while leaving every one of its **decisions** uncalled.

## Question 3 — each clause's subject, and whether the shipped write path can reach it

| clause | subject | where | reached on a launched profile |
| --- | --- | --- | --- |
| must[0] the record carries content / kind / subject / source events / created+valid time / confidence / scope / purpose / TTL / sensitivity / status | `MemoryRecord`, 15 fields | `record.ts:82-102` | **partially — 2 of the 11 record-specific fields.** See the field census below |
| must[1] a conflict creates a supersedes/disputes relation instead of overwriting | `recordConflict(winner, loser, kind)` returns BOTH records | `record.ts:171` | **no.** Zero callers |
| must[2] sensitive fields stay out of the index unless policy permits | `admitToIndex(record, policy)` | `provenance.ts:69` | **no.** Zero callers, and `sensitivity` is not stored |
| acceptance[0] every record traces to a source or is marked user-asserted | `validateRecord`'s `derived-without-source` branch | `record.ts:137-141`; `isTraceable` at `provenance.ts:86` | **no.** Zero callers — see the false comment below |
| acceptance[1] expired or revoked records stay out of default retrieval | `isDefaultRetrievable(record, nowIso)` | `record.ts:193` | **no.** Zero callers, and neither `status` nor `validUntil` is stored |
| acceptance[2] a cross-scope merge must be explicit | `decideCrossScopeMerge` | `record.ts:226` | **no.** Zero callers |
| validation[2] a query result carries provenance | `withProvenance(record)` → `ProvenancedRecord` | `provenance.ts:40` | **no.** Zero callers; `query()` returns `MemoryRecordView`, which has no provenance field |

**Census method**, identical to BLOCKED-193's: `git ls-files` over the whole post-rebase tree, symbol by symbol, excluding the package's own directory and the `spec/` and `.dsh/` bookkeeping. Result for all seven functions and for `ProvenancedRecord` / `IndexingPolicy`: **no hit anywhere.** `MemoryRecord` itself has hits, and every one is a document, the registry, or `P6-01.fault.spec.ts` — no production module.

## The finding the withdrawal did not have: the vocabulary is consumed, the decisions are not

The memory slice (`840b6c2687`, `cb59dd2f5f`, `fc77fc382d`) made P6-01's write path store where a claim came from, and it did so by **deriving P6-01's request type from P6-02's**:

```
MemoryClaimOrigin =
  | (Extract<MemoryProvenance, { kind: 'derived' }> & { confidence: number })
  | Extract<MemoryProvenance, { kind: 'user-asserted' }>
```

(`types.ts:141-146`, importing `MemoryProvenance` from `record.ts` at `:25`.) The durable provider then stores `provenance` and `confidence` on every record (`index.ts:694,704`). So P6-02's `MemoryProvenance` union **is** reached by a shipped write path today, and it is the only part of this epic that is.

That makes the U question sharper than "find a caller". Two of must[0]'s fields already flow; the other nine do not, and **the fields each remaining decision needs are exactly the ones not stored**:

| stored on a shipped write | absent |
| --- | --- |
| `id`, `principal`, `content`, `updatedAt` (P6-01's `MemoryRecordView`), plus `scope`, `provenance`, `confidence` | `kind`, `subject`, `createdAt`, `validFrom`, `validUntil`, `purpose`, `sensitivity`, `status`, `relations` |

- `isDefaultRetrievable` needs `status` and `validUntil` — neither stored.
- `admitToIndex` needs `sensitivity` — not stored.
- `recordConflict` needs `relations` and `status` — neither stored.

So no consumer can be wired to these functions without the store first holding the fields they read. **The U stage's real subject is the on-disk record, not a call site.** That was already flagged as item 5 of `preflight-memory-slice.md`, which asked the two questions this preFlight inherits rather than re-answers: is bumping `DURABLE_FILE_MEMORY_FORMAT_VERSION` and refusing older documents acceptable (the pre-release stance in `AGENTS.md` says yes), and where do the added fields come from on `propose()` — since inventing a `kind` or a `confidence` the writer never stated would put a fabricated fact in durable data.

## A comment that asserts a guarantee nothing provides

`index.ts:688-692` says of the stored provenance:

> *"`validateRecord` already refuses a `derived` record whose source list is empty, so a stored origin is one that traces somewhere."*

`validateRecord` has zero callers, `propose()` delegates straight to the provider (`index.ts:162-164`), and no `sourceEvents` check exists anywhere in `index.ts` or `types.ts`. `MemoryClaimOrigin`'s derived branch accepts `sourceEvents: []` — an empty array satisfies `readonly SourceEventId[]`. **So `propose({ origin: { kind: 'derived', sourceEvents: [], confidence: 0.5 }, … })` is accepted and stored today, and acceptance[0] does not hold on the shipped write path.**

This is a comment describing a guarantee held by a function that is never reached from the path the comment is on. It is the clearest single statement of what §12.19-1 withdrew the sign-off for, and it is also the smallest candidate first consumer: `propose()` calling the check that already exists.

Whether that is P6-02.U's work or P6-01's defect is **not decided here** — the check belongs to P6-02 and the path belongs to P6-01, and which epic owes the wiring is an ownership question. Recorded as OQ16.

## What the existing U freeze proves, and what it does not

The frozen U entry runs `scope.spec.ts`, 8 cases, all about `decideCrossScopeMerge` — a function with zero production callers. The cases are real and the rule they pin is right; they construct their own inputs, so they prove the decision is correct and prove nothing about anything reaching it. **This is the same shape as P6-07.U's `projectLifecycleRecords`**, and re-running the freeze green does not close what §12.19-1 withdrew.

The C and F entries are in a different position and this preFlight does not disturb them: a Contract stage is allowed to be about the vocabulary, and the 19-boundary fault matrix is about `validateRecord`'s own refusals. It is only the **Usage** stage that claims a subject it does not have.

## Question 4 — the execution card, re-read

Row `P6-02`, heading `#### P6-02`, `sheetCommit: null`, `recordedBeforeFirstLine: false` (backfilled 2026-09-07 under gate (e), so it is a reconstruction — evidence about the epic, not a decision taken before it). Verdict **`PROVIDER_WRITE`**, no secondary, `adopted: []`, `standardsImported: []`, `rejectedAbsent: []`, `gapCheck: []`, `expectedDeletedPct: "0"`, `residual: "The memory record, its scope, and its temporal fields."`

- **`standardsOwned`: the Graphiti-style bitemporal field set** (`created_at` / `valid_at` / `invalid_at` / `expired_at`), owned **by assignment and not yet by evidence** — the card says so in those words. The record shape does carry `createdAt` / `validFrom` / `validUntil`, so the vocabulary exists; what it lacks is a live frozen case naming it, which is `verify-make-vs-use`'s fourth check. The card records that the owed vocabulary case is due **with** the U rework rather than backfilled after it.
- **Two families are owned elsewhere and correctly absent here**: W3C PROV-DM (owner P6-09) and W3C DPV (owner P6-10), both marked `notAdoptedHere` in `standards-ownership.json`. No case of this epic names either, which is consistent with the assignment rather than evidence against it. The measurement above does not disturb this.
- **`fast-check` is recorded as a `real-gap`, not a settled deviation**, with a stated closing condition: at least one property case over `recordConflict` or `decideCrossScopeMerge`, or a ruling that the example set suffices. That closing condition **collides with this preFlight's finding**: a property case over `decideCrossScopeMerge` would deepen coverage of a function that still has no production caller, which is more of what §12.19-1 withdrew the epic for. Ordering matters and it is not this document's to fix — recorded as OQ17.
- **`expectedDeletedPct: "0"`** is consistent here, unlike P6-07's: nothing measured above is a duplicate of something production already built. P6-02's problem is absence, not duplication.

## Relation to the memory slice and to the open queue

- **The slice is P6-02's first production consumer and does not close it.** `MemoryProvenance` flows; no decision does. Stating it the other way round — "the slice gave P6-02 a caller" — would be the kind of claim §12.19-1 exists to catch.
- **The format-version question is shared.** `preflight-memory-slice.md` item 5 asks it for that slice; this epic's U stage cannot be done without answering it, because nine of the eleven fields have to reach disk first.
- **BLOCKED-193's pattern does not apply here.** P6-07's clauses each had a rival implementation production reached. P6-02's have none: no other module in the tree validates a memory record, records a memory conflict, or decides a cross-scope merge. Absence, not duplication.

## Open questions (OQ16–OQ19) — none taken here

1. **OQ16** — is wiring `validateRecord` into `propose()` P6-02.U's work or P6-01's defect? The check belongs to P6-02, the path to P6-01. Until it is answered, the comment at `index.ts:688-692` states a guarantee nothing provides, and acceptance[0] does not hold on a shipped write.
2. **OQ17** — the card's `fast-check` closing condition names `decideCrossScopeMerge`, which has no production caller. Does the property coverage wait until the function has a consumer, or is example coverage ruled sufficient?
3. **OQ18** — the on-disk format. Nine of must[0]'s fields are unstored; storing them bumps `DURABLE_FILE_MEMORY_FORMAT_VERSION` and refuses every document written by the current build. `AGENTS.md`'s pre-release stance points at "bump and refuse", and this is the same question as `preflight-memory-slice.md` item 5 — it wants one answer, not two.
4. **OQ19** — where the added fields come from on `propose()`. `kind`, `subject`, `purpose` and `sensitivity` have no source in the current request, and defaulting a `confidence` or a `kind` the writer never stated would put a fabricated fact in durable data — the rule `originOf` already follows for confidence (`index.ts:671-675`).

## Status

**No code written.** The census is the deliverable: seven functions, zero production callers; one vocabulary union now consumed; one comment asserting an unenforced guarantee; nine of eleven record fields absent from disk, and they are precisely the fields the uncalled decisions read.
