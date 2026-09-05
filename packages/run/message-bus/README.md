---
description: "Durable inbox/outbox record states, idempotent delivery receipts, dead-lettering, dispatch ordering, backpressure, and consumer-side deduplication with cross-tenant refusal for Epic P4-06's effective-once effect handoff."
kind: "package-reference"
---

# @deepseek-ai/dsh-message-bus

## Summary

`dsh-message-bus` owns Epic P4-06's two halves of effective-once effect handoff. The **outbox** keeps a record of every message a transaction committed, so a message is never lost: `src/outbox.ts` holds the `pending`/`sent`/`acked`/`dead-letter` state set and its legal-transition table, idempotent delivery receipts (must[1]), deadline and attempt-budget dead-lettering, a total dispatch order, and enqueue backpressure (must[3]). The **inbox** decides whether an arriving message produces a business effect: `src/inbox.ts` deduplicates on `(message id, epoch)` (must[2]) and refuses cross-tenant messages (acceptance[2]).

Neither half is sufficient alone. The outbox guarantees a message survives a crash; the inbox guarantees a *lost acknowledgement* does not cost a second effect.

The decisions themselves perform no I/O and own no clock. `commitWithOutbox` is the one place they meet durable storage, through a structural sink interface rather than a mounted capability seam.

## Table of Contents

- [Effective-once, not exactly-once](#effective-once-not-exactly-once)
- [Committing an event with its outbox records](#committing-an-event-with-its-outbox-records)
- [Ordering rules that are load-bearing](#ordering-rules-that-are-load-bearing)
- [The dispatch loop](#the-dispatch-loop)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Effective-once, not exactly-once

The transport may deliver a message any number of times. No protocol closes the window between sending a message and durably recording its acknowledgement, so a crash inside that window necessarily produces a redelivery. What this package guarantees is that the *business effect* happens once, which is what `classifyIntake` exists for.

That window is also the only place deduplication is the sole protection: at every other crash point the outbox record's own state already prevents a second delivery. [`tests/crash.e2e.spec.ts`](tests/crash.e2e.spec.ts) names it `after-effect` and covers it directly.

## Committing an event with its outbox records

`commitWithOutbox` hands a domain event and the outbox records derived from it to a durable sink in **one** call. That matters because the session write controller takes its whole pending queue when a write begins: two separate `enqueue` calls with a write starting between them land in different batches, leaving an event durable whose outgoing message no record explains. The indivisibility comes from the sink's `enqueueAll` never awaiting — a write can only begin at a suspension point, and there is none inside the group.

**One batch is not one transaction, and the difference is measured rather than assumed.** The JSONL backend rolls a batch back to its pre-batch size on a write *error*, so that path is atomic. A *crash* mid-batch is not: recovery truncates to the last complete record, so the earlier entries of a batch can survive while later ones are dropped. See `Known Limitations` below and BLOCKED-089.

## Ordering rules that are load-bearing

Two decisions depend on the order of their checks, not only on the checks themselves:

- **Tenant before deduplication.** A foreign-tenant message is refused without its key being looked up, so it leaves no trace in this consumer's seen-set. Checking duplication first would both reveal whether that id was already processed here and let a foreign message suppress a later legitimate one sharing its key.
- **Deadline before attempt budget.** A record that is both expired and out of attempts reports `deadline-expired`. The two call for different operator responses — the message stopped being worth sending, versus delivery kept failing — so the reported reason must not depend on check order.

## The dispatch loop

`dispatchOnce` runs the decisions over a set of records and applies their outcomes. Three properties belong to the loop rather than to any single decision:

- **The attempt is spent and `sent` is persisted before the record reaches the transport.** Persisting afterwards would lose the spent attempt whenever the process died mid-send, leaving a record that looks untried — so the budget would bound nothing.
- **A failed send returns the record to `pending`, not to dead-letter.** The spent attempt is the entire record of that failure, and the budget is what separates a transient failure from a permanent one.
- **The clock is read once per pass.** Re-reading it per record would let a slow transport expire a later record, making a record's fate depend on its position in the batch.

## Model Experience

No model-visible surface. The package exports decision functions, a dispatch loop, and types; it renders no prompt text, defines no tool, and contributes no session event, so it consumes no tokens and cannot affect KV-cache reuse.

## Known Limitations and Deferred Work

- **`commitWithOutbox` guarantees one batch, not one transaction.** must[0] asks for a single transaction. A crash inside a batch can leave the domain event durable and drop the outbox record, because recovery truncates to the last complete record rather than to the batch boundary. Ordering the records first would make the survivor the recoverable direction, but the batch is written in `seq` order and the log requires contiguity. Closing this needs backend atomicity or a change to seq assignment; neither belongs to this package.
- **The dispatcher is a loop, not a service.** `dispatchOnce` runs one pass and returns what it did; scheduling passes, retry backoff, and dead-letter alerting belong to a caller that does not exist yet.
- **No Cordis plugin or service registration yet.** The decisions are bound to a durable sink through a structural interface, not mounted as a capability seam.
- **The crash points are simulated, not real process kills.** `tests/crash.e2e.spec.ts` drives them through a local durable-state harness. It proves the decision sequence survives each crash point; it does not prove a real process does, which the Fault stage owns.
- **No clock, no I/O.** Every decision takes `nowMs` as a parameter. A caller that passes an inconsistent clock gets inconsistent dead-lettering, and nothing here detects that.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`MessageEpoch` is currently a bare branded number with no owner assigning it. Which component advances a producer's epoch, and whether it is durable across a restart or derived from something already durable, remains undecided — the decisions here only require that `(id, epoch)` be unique.

</details>
