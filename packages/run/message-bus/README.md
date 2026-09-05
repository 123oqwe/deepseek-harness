# @deepseek-ai/dsh-message-bus

Durable inbox/outbox logic for effective-once effect handoff (Epic P4-06).

The package owns the two halves that make a redelivered message harmless: the **outbox**, which keeps a record of every message a transaction committed, and the **inbox**, which decides whether an arriving message produces a business effect. Neither half is sufficient alone — the outbox guarantees a message is never lost, and the inbox guarantees a lost acknowledgement does not cost a second effect.

## Effective-once, not exactly-once

The transport may deliver a message any number of times. No protocol closes the window between sending a message and durably recording its acknowledgement, so a crash inside that window necessarily produces a redelivery. What this package guarantees is that the *business effect* happens once, which is what [`classifyIntake`](src/inbox.ts) exists for.

## Ordering rules that are load-bearing

Two decisions here depend on the order of their checks, not only on the checks themselves:

- **Tenant before deduplication.** A foreign-tenant message is refused without its key being looked up, so it leaves no trace in this consumer's seen-set. Checking duplication first would both reveal whether that id was already processed here and let a foreign message suppress a later legitimate one sharing its key.
- **Deadline before attempt budget.** A record that is both expired and out of attempts reports `deadline-expired`. The two produce different operator responses — the message stopped being worth sending, versus delivery kept failing — so the reported reason must not depend on check order.

## Model Experience

No model-visible surface. The package exports pure decision functions and types; it renders no prompt text, defines no tool, and contributes no session event, so it consumes no tokens and cannot affect KV-cache reuse.

## Known Limitations and Deferred Work

- **Contract stage only.** This package currently holds the record states, decisions, and deduplication rules. No Cordis plugin, service registration, or durable storage adapter is wired yet; the Provider stage owns binding these decisions to `dsh-session-persistence`'s write-behind coordinator.
- **The dispatcher loop lives in the test harness.** [`tests/crash.e2e.spec.ts`](tests/crash.e2e.spec.ts) drives the crash points through a local durable-state simulation rather than a real process kill. It proves the decision sequence survives each crash point; it does not yet prove a real process does, which the Fault stage owns.
- **No clock, no I/O.** Every decision takes `nowMs` as a parameter. A caller that passes an inconsistent clock gets inconsistent dead-lettering, and nothing here detects that.
