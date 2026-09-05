---
description: "Durable inbox/outbox record states, idempotent delivery receipts, dead-lettering, dispatch ordering, backpressure, and consumer-side deduplication with cross-tenant refusal for Epic P4-06's effective-once effect handoff."
kind: "package-reference"
---

# @deepseek-ai/dsh-message-bus

## Summary

`dsh-message-bus` owns Epic P4-06's two halves of effective-once effect handoff. The **outbox** keeps a record of every message a transaction committed, so a message is never lost: `src/outbox.ts` holds the `pending`/`sent`/`acked`/`dead-letter` state set and its legal-transition table, idempotent delivery receipts (must[1]), deadline and attempt-budget dead-lettering, a total dispatch order, and enqueue backpressure (must[3]). The **inbox** decides whether an arriving message produces a business effect: `src/inbox.ts` deduplicates on `(message id, epoch)` (must[2]) and refuses cross-tenant messages (acceptance[2]).

Neither half is sufficient alone. The outbox guarantees a message survives a crash; the inbox guarantees a *lost acknowledgement* does not cost a second effect.

This package is at its Contract stage: the decisions and types are real and covered, and nothing here performs I/O or mounts a plugin.

## Table of Contents

- [Effective-once, not exactly-once](#effective-once-not-exactly-once)
- [Ordering rules that are load-bearing](#ordering-rules-that-are-load-bearing)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Effective-once, not exactly-once

The transport may deliver a message any number of times. No protocol closes the window between sending a message and durably recording its acknowledgement, so a crash inside that window necessarily produces a redelivery. What this package guarantees is that the *business effect* happens once, which is what `classifyIntake` exists for.

That window is also the only place deduplication is the sole protection: at every other crash point the outbox record's own state already prevents a second delivery. [`tests/crash.e2e.spec.ts`](tests/crash.e2e.spec.ts) names it `after-effect` and covers it directly.

## Ordering rules that are load-bearing

Two decisions depend on the order of their checks, not only on the checks themselves:

- **Tenant before deduplication.** A foreign-tenant message is refused without its key being looked up, so it leaves no trace in this consumer's seen-set. Checking duplication first would both reveal whether that id was already processed here and let a foreign message suppress a later legitimate one sharing its key.
- **Deadline before attempt budget.** A record that is both expired and out of attempts reports `deadline-expired`. The two call for different operator responses — the message stopped being worth sending, versus delivery kept failing — so the reported reason must not depend on check order.

## Model Experience

No model-visible surface. The package exports pure decision functions and types; it renders no prompt text, defines no tool, and contributes no session event, so it consumes no tokens and cannot affect KV-cache reuse.

## Known Limitations and Deferred Work

- **Contract stage only.** No Cordis plugin, service registration, or durable storage adapter is wired yet. The Provider stage owns binding these decisions to `dsh-session-persistence`'s write-behind coordinator.
- **The dispatcher loop lives in the test harness.** `tests/crash.e2e.spec.ts` drives the crash points through a local durable-state simulation rather than a real process kill. It proves the decision sequence survives each crash point; it does not prove a real process does, which the Fault stage owns.
- **No clock, no I/O.** Every decision takes `nowMs` as a parameter. A caller that passes an inconsistent clock gets inconsistent dead-lettering, and nothing here detects that.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`MessageEpoch` is currently a bare branded number with no owner assigning it. Which component advances a producer's epoch, and whether it is durable across a restart or derived from something already durable, is a Provider-stage question — the Contract stage only requires that `(id, epoch)` be unique.

</details>
