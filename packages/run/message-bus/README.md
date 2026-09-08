---
description: "Durable inbox/outbox record states, idempotent delivery receipts, dead-lettering, dispatch ordering, backpressure, and consumer-side deduplication with cross-tenant refusal for Epic P4-06's effective-once effect handoff."
kind: "package-reference"
---

# @deepseek-ai/dsh-message-bus

## Summary

`dsh-message-bus` owns Epic P4-06's two halves of effective-once effect handoff. The **outbox** keeps a record of every message a transaction committed, so a message is never lost: `src/outbox.ts` holds the `pending`/`sent`/`acked`/`dead-letter` state set and its legal-transition table, idempotent delivery receipts (must[1]), deadline and attempt-budget dead-lettering, a total dispatch order, and enqueue backpressure (must[3]). The **inbox** decides whether an arriving message produces a business effect: `src/inbox.ts` deduplicates on `(source, message id, epoch)` (must[2]) and refuses cross-tenant messages (acceptance[2]).

Neither half is sufficient alone. The outbox guarantees a message survives a crash; the inbox guarantees a *lost acknowledgement* does not cost a second effect.

It also carries the **mailbox**: a directed message arriving for one recipient, in `src/mailbox-delivery.ts`. That was `@deepseek-ai/dsh-mailbox` until this package absorbed it — see below.

The decisions themselves perform no I/O and own no clock. `commitIntake` in `src/bus-store.ts` is the one place they meet durable storage, and it is a real transaction: the domain event, the outbox rows and the inbox transition to `consumed` all commit inside one `BEGIN IMMEDIATE`.

## Table of Contents

- [Effective-once, not exactly-once](#effective-once-not-exactly-once)
- [Committing an event with its outbox records](#committing-an-event-with-its-outbox-records)
- [Ordering rules that are load-bearing](#ordering-rules-that-are-load-bearing)
- [The dispatch loop](#the-dispatch-loop)
- [Why the mailbox is here and not its own package](#why-the-mailbox-is-here-and-not-its-own-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Effective-once, not exactly-once

The transport may deliver a message any number of times. No protocol closes the window between sending a message and durably recording its acknowledgement, so a crash inside that window necessarily produces a redelivery. What this package guarantees is that the *business effect* happens once, which is what `classifyIntake` exists for.

That window is also the only place deduplication is the sole protection: at every other crash point the outbox record's own state already prevents a second delivery. [`tests/crash.e2e.spec.ts`](tests/crash.e2e.spec.ts) names it `after-effect` and covers it directly.

## Committing an event with its outbox records

`commitIntake` writes the domain event, every outbox row it owes, and the inbox row's transition to `consumed` inside one `BEGIN IMMEDIATE` transaction. A crash anywhere inside it rolls the whole group back, so there is no state in which an event is durable and the outgoing message no record explains.

`BEGIN IMMEDIATE` rather than a deferred `BEGIN`: the write lock is taken up front, so two consumers racing for one message fail fast on the lock instead of at `COMMIT` after both believed they held it.

A second entry point, `commitWithOutbox`, used to offer the same promise over an `AtomicBatchSink` — an interface nothing in the repository implemented. It could only ever guarantee one *batch*, which a torn write can still split, and its own documentation said so. It was deleted rather than kept beside the transaction: two commit paths for one clause is the arrangement where the weaker one gets used by accident.
## Ordering rules that are load-bearing

Two decisions depend on the order of their checks, not only on the checks themselves:

- **Tenant before deduplication.** A foreign-tenant message is refused without its key being looked up, so it leaves no trace in this consumer's seen-set. Checking duplication first would both reveal whether that id was already processed here and let a foreign message suppress a later legitimate one sharing its key.
- **Deadline before attempt budget.** A record that is both expired and out of attempts reports `deadline-expired`. The two call for different operator responses — the message stopped being worth sending, versus delivery kept failing — so the reported reason must not depend on check order.

## The dispatch loop

`dispatchOnce` runs the decisions over a set of records and applies their outcomes. Three properties belong to the loop rather than to any single decision:

- **The attempt is spent and `sent` is persisted before the record reaches the transport.** Persisting afterwards would lose the spent attempt whenever the process died mid-send, leaving a record that looks untried — so the budget would bound nothing.
- **A failed send returns the record to `pending`, not to dead-letter.** The spent attempt is the entire record of that failure, and the budget is what separates a transient failure from a permanent one.
- **The clock is read once per pass.** Re-reading it per record would let a slow transport expire a later record, making a record's fate depend on its position in the batch.

## Why the mailbox is here and not its own package

A mailbox carries directed messages between agents that do not share a call stack, and its one guarantee is that a message delivered twice produces one effect. That is this bus's own guarantee, and `@deepseek-ai/dsh-intake-dedup` is the rule both applied. What the separate package held beyond it was a recipient-address check and a set of type names — a package for a seam that does not exist, and the split had already produced one rule with two implementations, the copy P4-06's clause was about being the one nothing called (BLOCKED-136).

The address check is now `decideMailboxArrival`, and it still runs BEFORE the duplicate check, for the same reason the tenant check does: consulting the seen-set for a message addressed elsewhere would let a misdirected message suppress a later legitimate one sharing its key.

The mailbox names carry a `Mailbox` prefix. This package also exports the outbox's `decideDelivery` and `DeliveryDecision`, which decide something else about a different record; two functions of that name one import apart is the confusion that made a separate package look necessary.

## Model Experience

None, as this package exports outbox and inbox decisions, a dispatch loop, and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **The dispatcher is a loop, not a service.** `dispatchOnce` runs one pass and returns what it did; scheduling passes and retry backoff belong to a caller that does not exist yet. It reports a dead-letter through `onDeadLetter`, but nothing is wired to that channel — the alert has a producer and no consumer.
- **No Cordis plugin or service registration yet.** The decisions are bound to a durable sink through a structural interface, not mounted as a capability seam.
- **The crash points are simulated, not real process kills.** `tests/crash.e2e.spec.ts` drives them through a local durable-state harness. It proves the decision sequence survives each crash point; it does not prove a real process does, which the Fault stage owns.
- No runtime invariant companion is published: every export here is a decision over caller-supplied state, and the one durable relation — a consumed key and the row that wrote it — is read back from the same store that wrote it, so a checker would compare a value against itself rather than reconcile two independent observations.
- **No clock, no I/O.** Every decision takes `nowMs` as a parameter. A caller that passes an inconsistent clock gets inconsistent dead-lettering, and nothing here detects that.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`MessageEpoch` is currently a bare branded number with no owner assigning it. Which component advances a producer's epoch, and whether it is durable across a restart or derived from something already durable, remains undecided — the decisions here only require that `(source, id, epoch)` be unique — and `source` is what makes that requirement satisfiable at all, since a message id is unique only within its sender (BLOCKED-140).

</details>
