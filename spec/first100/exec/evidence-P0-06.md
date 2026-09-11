# Evidence — P0-06 (统一 Schema Registry 与兼容性规则)

Written 2026-09-11 by lane B, after a per-clause read of an already-ACCEPTED epic. The epic was signed without an evidence page — one of twelve in that state — and this page exists because one of its three clauses is **vacuously true on this tree** and had nowhere to say so. Nothing here re-judges the sign-off; it records what the cells do and do not establish.

## 4.4 per clause

### acceptance[0] — 至少能够读取审计基线产生的旧 session fixture

**Covered, by real fixtures rather than constructed ones.** Three F citations each replay a genuine pre-schema-registry session log — `snapshots/web/fresh-round-trip/session.jsonl`, `snapshots/sdk/text-turn/session.jsonl`, `snapshots/session/skill-load/session.jsonl` — one per corpus lane. The clause says "at least", and three real logs across three lanes satisfy it without interpretation.

**Service / production:** the registry reads a file the product wrote; the fixtures are the product's own output rather than a test's. No gap.

### acceptance[1] — 不兼容客户端收到机器可读错误，不出现静默字段丢失

**Covered on both halves, and the negative half has its own cases rather than being inferred.** The clause has a positive obligation (a machine-readable error reaches the client) and a negative one (no silent field loss). Five U citations cover four distinct entry points — the SDK `initialize` handshake, a session-event log line, settings section registration, and a settings hot reload — and two of them are about the negative half specifically:

- `does not swallow a schema-incompatible line into the tolerant corrupt-suffix heuristic` — the failure mode where a strict rejection is quietly absorbed by a lenient recovery path that exists for a different reason.
- `keeps the last good value (no silent field loss) when a hot-reloaded section declares an incompatible major` — loss is refused, and what survives is named.

That is the distinction worth recording: "it rejected" does not imply "nothing was silently dropped", and this epic does not rely on the implication.

**Service / production:** the U cases live in the packages that own each entry point (`sdk/server`, `session-persistence-jsonl`, `settings`) rather than in a Loader composition. Accepted here because the clause's subject is what a CLIENT receives at a boundary, which those suites observe directly.

### acceptance[2] — 所有 registry migration 具有双向或明确不可逆测试

**Vacuously true on this tree, and that is the reason this page exists.** Measured 2026-09-11:

| what | reading |
|---|---|
| production `registerSchema` call sites | 3, and **all three pass `identityMigration`** — `schema-registry/src/index.ts:242` (per session-event type), `:266` (per sdk-protocol message name), `settings/src/index.ts:455` |
| production callers of `evolveSchema` (the non-identity entry point) | **0** — README examples only |
| non-identity `migrate` functions registered anywhere in production | **0** |

So "all registry migrations" ranges over an empty set. The four P citations demonstrate that the registry **can express** both classes — a rename round-tripped in each direction, a `fullName` merge declared irreversible, plus a case proving a naive reverse does not recover the original data — but they do not establish that every migration in the repository has been tested, because none exists.

**This is the correct state for a Contract stage.** It is recorded because an unstated vacuous truth reads exactly like a discharged obligation, and a later reader comparing the clause to the citations has no way to tell the difference. P1-10's acceptance[2] is the positive precedent: its harness comment blocks the same shape explicitly, observing that "nothing changed" is trivially true of an empty tree and seeding real content before asserting it.

**The obligation transfers rather than discharges.** The first epic to land a real non-identity migration owes the bidirectional-or-explicitly-irreversible test for that migration; it inherits this clause rather than being covered by it.

## What this page does not do

It does not re-judge the sign-off. All four cells are GREEN, `checkCoverageClosure('P0-06')` is valid with no unverified citations, and the delegate ruled that the vacuous truth is recorded rather than treated as a withdrawal. What changed is that the limitation is now written where a signer reads, instead of being recoverable only by re-measuring the tree.
