---
description: "The durable approval queue for Epic P2-07: six approval states and the moves between them, the record a store keeps, compare-and-swap store operations, the pure transition decisions every provider applies, and the SQLite provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-approval-store

English | [中文](README.zh.md)

## Summary

`dsh-approval-store` is the contract of Epic P2-07's durable approval queue: an approval asked in one turn or process can be decided, consumed at most once, or expire in another. `src/types.ts` holds the vocabulary — the approval's id, its scope (a turn's tool call, or a durable Run that waits), its six states, the record a store keeps (request digest, policy version, actor, deadline, tenant) and the store operations every provider implements as `ctx.approvalStore`. `src/transitions.ts` holds the decisions every provider applies: the transition table, the deadline, tenancy and the compare-and-swap write. `src/sqlite.ts` is the SQLite provider, exported as `./sqlite` and published as `ctx.approvalStore` by its plugin; nothing mounts it yet, and its consumers follow.

## Table of Contents

- [States and moves](#states-and-moves)
- [One write, one revision](#one-write-one-revision)
- [The SQLite provider](#the-sqlite-provider)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="states-and-moves"></a>
## States and moves

An approval starts `requested`. From there it is `approved`, `denied`, `revoked`, or `expired`; an `approved` approval is `consumed`, `revoked` or `expired`; `denied`, `expired`, `revoked` and `consumed` are terminal (`APPROVAL_TRANSITIONS`). From its deadline on, a `requested` or `approved` approval reads as `expired` (`effectiveApprovalState`) and can move only to `expired`, so a lapsed approval is never approved or executed. An approval belongs to one tenant: another tenant can neither read nor decide it, and is not told that it exists.

<a id="one-write-one-revision"></a>
## One write, one revision

Every record carries a revision that starts at 0 and grows by one on every move. Every write names the revision the writer read (`applyApprovalTransition`): a write from an older read is refused as `stale-revision` and shows the current record. So two clients deciding the same approval leave exactly one terminal state, and an approval is consumed at most once — the action it approved runs only when its consumption succeeds. The checks run in a fixed order, tenant, revision, deadline, then the table, so the conflict names the first thing that was wrong. A successful decision records who decided and when, and a consumption records when.

<a id="the-sqlite-provider"></a>
## The SQLite provider

`openApprovalStore(directory, options)` keeps every approval in one file, `approvals.sqlite`, whose `schema_version` is 1; a file at another version is refused, not migrated. Each move is one `BEGIN IMMEDIATE` transaction: the row is read, `applyApprovalTransition` decides, and the moved row is written where the revision is still the one read, so the write lock spans the read and the write and two processes deciding one approval are serialized. A read filters by tenant and reports a lapsed approval as `expired` without writing. `ApprovalStoreSqlitePlugin` takes `directory` (required; the profile row names it) and `busyTimeoutMs` (default 5000), opens the file at mount and closes it at teardown. The test-only `fault` option is called inside each write after its statement and before COMMIT, where a test throws to observe the rollback or kills its process to observe what a restart finds.

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, prompt text, or session event, so nothing it owns reaches a model request.

#### KV Cache effect

Nothing here enters a request, so provider cache reuse is unaffected. What a model reads about an approval is whatever the asking consumer writes into its session, and that belongs to the consumer.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- A Run cannot yet wait in `waiting_for_approval`, and the SDK's list and decide requests are not on the wire; they arrive with the Use stage's later commits.
- No runtime invariant companion is published: the store is the only record of an approval's state until the Use stage writes the session log beside it, so no two observations can disagree yet; one is reconsidered then.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
