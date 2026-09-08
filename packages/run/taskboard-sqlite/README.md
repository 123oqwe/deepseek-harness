---
description: "Durable taskboard for Epic P5-11: SQLite-backed claims serialized by BEGIN IMMEDIATE, so two processes contending for one task cannot both hold it."
kind: "package-reference"
---

# @deepseek-ai/dsh-taskboard-sqlite

## Summary

`dsh-taskboard-sqlite` is Epic P5-11's durable Service Provider. It implements `TaskStoreContract` from `@deepseek-ai/dsh-taskboard` over one SQLite database, so a claim survives the process that took it and two processes contending for one task cannot both be told they hold it.

## Table of Contents

- [acceptance[0] is about processes, and a Map is not](#acceptance0-is-about-processes-and-a-map-is-not)
- [What the transaction covers](#what-the-transaction-covers)
- [What the plugin adds over `openTaskStore`](#what-the-plugin-adds-over-opentaskstore)
- [The decisions are not re-implemented here](#the-decisions-are-not-re-implemented-here)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## acceptance[0] is about processes, and a Map is not

`TaskStore` keeps its tasks in a `Map` owned by one mount, so "only one worker wins a contended claim" holds between two callers inside a single process. That is also all its own stress case can show: a hundred workers, run **sequentially**, against a pure function. Two real workers are two processes, they each hold their own map, and both win.

The in-memory board is still correct for what it claims — a single-process board, atomic because its read, decision and write have no `await` between them. A deployment whose workers are separate processes mounts this one.

## What the transaction covers

`claim` runs its read, its decision and its write inside one `BEGIN IMMEDIATE` transaction. Two processes reaching it together are serialized by SQLite, so the loser reads the winner's row rather than the task as it was. `submit` is inside one too, and validates against everything already stored rather than against the batch alone: a cycle can close across two separately-valid submissions, and doing the check inside the transaction stops a concurrent submission closing one underneath it.

`applyReceipt` holds the same lock across its checks AND its write. An earlier draft committed after the checks and wrote afterwards, which put the read and the write on opposite sides of the lock — exactly the interleaving the transaction exists to prevent.

`busy_timeout` is 5000ms: two workers claiming *different* tasks at the same moment is ordinary, and the loser of the write lock should proceed a millisecond later rather than fail.

## What the plugin adds over `openTaskStore`

The default export mounts the store as `ctx.taskStore`. Without it every consumer calls `openTaskStore` and thereby decides for its callers where tasks live, which is the one setting acceptance[0] turns on: two hosts contend for a task only when a profile pointed them at one directory. The database opens in `Service.init` rather than the constructor, because a constructor that throws during service construction unwinds into `cannot create effect on inactive context` — a message naming neither the path nor the database.

## The decisions are not re-implemented here

`decideClaim` decides a claim, `isClaimCurrent` decides whether a receipt's attempt is current, `validateTaskGraph` decides a cycle, and the receipt's legality table belongs to the in-memory board — this provider borrows a single-task board to apply one, and writes only its result. A second implementation of "may this worker claim" is the shape BLOCKED-136 records, and here it would be the copy that hands one task to two workers.

The task is stored as its own JSON rather than as columns. The shape is `dsh-taskboard`'s and changes with that package; mirroring it in DDL would be a second declaration of one record, and this store's queries are by id or all-rows, never by field.

## Model Experience

None, as this package stores tasks and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **One database, one machine.** SQLite serializes writers through a file lock, so workers contend correctly only where they share a filesystem. Workers on two machines need a store this package does not provide.
- **No claim expiry sweep.** A lapsed claim is only noticed when someone tries to claim that task again; nothing scans for expired claims and reports them.
- No runtime invariant companion is published: the relation this store owns — one holder per unexpired claim — is enforced inside a single `BEGIN IMMEDIATE` transaction and observable only by reading the rows it just wrote, so a checker would compare a value against itself rather than reconcile two independent observations.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether the taskboard and the lease should share one store is undecided. A claim is a lease over a task, and `dsh-lease-sqlite` already serializes exactly this shape; keeping them apart means two databases with the same locking discipline, and merging them means one package owning two vocabularies.

</details>
