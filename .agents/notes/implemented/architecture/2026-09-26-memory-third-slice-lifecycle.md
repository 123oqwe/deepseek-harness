# Agent Note: forget leaves a tombstone and clears the recall projection; supersede, merge and erase reach the index

Status: implemented

English | [中文](2026-09-26-memory-third-slice-lifecycle.zh.md)

## Problem

P6-03's third slice owes `must[3]` (support merge, supersede, forget, export and right-to-erasure, and propagate to the index), `acceptance[1]` (after `forget` the store, index, cache and projection clear within an SLA and a compliant tombstone is left) and `acceptance[2]` (export carries a record's source and conflict status). Before this slice `forget` physically deleted a record and left nothing, `export` returned neither provenance nor status, and the seam had no `supersede`, `merge` or `erase`. The `decideCrossScopeMerge` and `recordConflict` decisions existed but nothing called them.

The projection clause is the subtle one. `@deepseek-ai/dsh-memory-context` recalls records into a step's request as a durable `snapshot`-form user message. Once a record a step recalled is forgotten, the store, the default search and a second reader stop returning it — but the earlier recall snapshot stays in the session's history and rides into every later request, so the forgotten content keeps reaching the model. Clearing the store is not clearing the projection.

## Decision

`ctx.memory` gains the verbs on the seam and all three providers:

- **`supersede({ principal, scope, id, supersedes })`** — the newer record gains a `supersedes` relation to the older, the older is marked `superseded`; the default search returns only the newer, `export` keeps both (must[1] — a conflict never overwrites).
- **`merge({ principal, from, into, authorization? })`** — `into` gains a relation to `from`, which is marked so only the survivor is searched. A cross-scope merge with no `authorization` naming both scopes is refused with `MEMORY_MERGE_NOT_AUTHORIZED` before either record changes, through the existing `decideCrossScopeMerge`.
- **`forget`** now removes the record's content and leaves a `{ id, forgottenAt, forgottenBy }` tombstone that carries none of it; `export` lists the tombstones the access context may see.
- **`erase({ principal, tenantId, subject })`** — right-to-erasure — forgets every record about the subject in the tenant, in any session or workspace; other subjects and other tenants are untouched.
- **`export`** records now carry `provenance`, `status` and `relations`; `query`/`get` keep the bare view.

The **projection clears in `@deepseek-ai/dsh-memory-context`**, not in the loop. A recall is that consumer's own `snapshot`-form message, and `@deepseek-ai/dsh-llm`'s `ContextForm` 'snapshot' already promises that a later snapshot from the same producer supersedes the earlier — the mechanism `time-context` and `tmux-context` rely on, applied at request assembly. The bug was that a step which recalled nothing emitted no snapshot, so the earlier recall stayed the latest. Now a step that recalls nothing supersedes an earlier recall this consumer left on the same session with a cleared marker carrying none of the recalled content.

The durable document gains an additive top-level `tombstones` list **without a version bump**: it is not a per-record field, so a version-3 document that predates it is complete — it forgot nothing — and reads back with no tombstones rather than a fabricated value.

## Alternatives considered

- **Route the memory recall through the loop's runtime-context snapshot (a section on `RuntimeContextProjection`, which surface-replaces).** Rejected: the recall is memory-context's own durable snapshot and already rides the producer-snapshot supersede contract, so the fix is local to how it manages its snapshot's lifetime; making a query-driven recall a runtime-context section would move the read out of the pre-step where its `memory/access` event and open-turn query live.
- **Bump the durable format version for `tombstones`.** Rejected: the version bumps guarded per-record fields an old record lacks and cannot be read without inventing; a new top-level list is absent-means-none, and `durable-provider.spec` asserts the written version is 3.
- **Reuse `record.ts`'s `recordConflict` for supersede/merge.** Not possible directly: it is typed for P6-02's canonical `MemoryRecord`, and the providers store the provisional `ScopedMemoryRecord`; a local `supersedeInto` encodes the same no-overwrite rule for the stored shape.

## Consequences

- A-512's measured state, carried here rather than filed separately: this build has no persistent memory index, cache or session projection as separate objects. `acceptance[1]`'s "index" is the `query` scan over the store, its "cache" is a second provider instance over the same directory, and its "projection" is memory-context's recall snapshot — so clearing the store clears the first two, and the memory-context change clears the third. No new persistent index was introduced.
- This first projection increment clears on the common path (a recall, then a later step that recalls nothing), but two gaps leak toward keeping forgotten content, so they are being closed rather than accepted: the "did this session leave a recall snapshot" fact is judged from a per-plugin-instance set, which is empty after a resume, and a step with no query does not re-project. The follow-up judges that fact from the durable session log and, every step, re-checks the records in the latest recall snapshot against current retrievability — replacing the snapshot (cleared, or re-projected to only still-retrievable records) whether or not the step has a query — while a never-recalled session still emits nothing. Lane B writes its red-first (B-657's third commit: a resumed session and a no-query step).
- No package.json or lockfile change: memory already peer-depends on `dsh-principal`. The generated `tool-cordis` api-catalog projection goes stale on the new export shape and provider verbs and is left for the pipeline to regenerate.
