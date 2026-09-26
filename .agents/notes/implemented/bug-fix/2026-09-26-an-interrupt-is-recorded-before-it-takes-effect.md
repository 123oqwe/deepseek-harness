# Agent Note: A browser interrupt is committed to the durable bus before it takes effect, and a restarted host replays it

Status: implemented

English | [中文](2026-09-26-an-interrupt-is-recorded-before-it-takes-effect.zh.md)

## Problem

BLOCKED-343, P5-10 must[2] and acceptance[0] across a host restart. `interruptByParent` held the interrupt only in the runtime's per-child control router, in memory. After a graceful shutdown or a crash, a new router started in `running`, so a browser prompt addressed to the interrupted child was admitted and woke it. Lane A's A-463 measured both restarts on the shipped headless profile (run 36213135083): the child ran a full turn on the prompt. The package README stated the same as a known limitation.

## Decision

- **The interrupt is committed to the durable message bus, synchronously, before the cancel signal.** The activation registry commits it right after it verifies the parent address, as a domain event keyed like a settlement: source `subagent-interrupted`, id the child session, epoch the lease epoch of the residency being interrupted, subject the parent session. The commit is one `BEGIN IMMEDIATE` on the bus's `DatabaseSync`, so the record is on disk when `interruptByParent` returns, and a commit that throws fails the interrupt with nothing cancelled.
- **The lease epoch is the interrupt's identity.** `interruptByParent` carries no request id. What makes two interrupts the same is that they stop the same residency, and the lease store issues that epoch. A repeat in the same residency finds its record consumed and commits nothing.
- **A router built after a restart replays the record.** `controlFor` asks the bus whether any residency of the child was interrupted and, if so, makes the two observations the live interrupt made: the cancel was admitted, and the child stopped. The router is then `terminal`, which admits no prompt or steer and absorbs a second replay. `interruptByParent` builds its router before the registry records, so its own interrupt goes through the convergence barrier (must[3]) instead of being replayed as already stopped.

## Alternatives considered

- **An event in the child's session log.** Live session events are buffered and written asynchronously, so a record appended during the interrupt is lost when the host is killed before its next turn, which is A-463's crash case.
- **Reading the stop from the child's log.** A user cancel ends the turn in the log after a graceful shutdown, but after a crash only session repair's `interrupted` remains, which it writes for every turn a crash cut short, including children nobody stopped.
- **A file of its own.** The bus already is the durable, epoch-keyed intake record that the settlement outbox uses, and the runtime already requires it.

## Consequences

- After a graceful shutdown or a crash, a browser prompt or steer to a child interrupted while resident is refused with `subagent/not-resumable`.
- Nothing is recorded for a child with no resident Activation (the interrupt there is an accepted no-op that verifies no parent address), for a residency without a lease epoch (no Run Service, or its lease refused), or on an in-memory bus. The README's known limitation states these.
- The record lives in `bus.sqlite`, not in the child's session log. A-463's two "readable" cases, which scan the session logs, are re-pinned by lane A to this record.
- Verification: A-463 (`tests/first100/fixtures/P5-10.interrupt-across-restart.composition.spec.ts`) and `packages/subagent/subagent/tests/interrupt-record.spec.ts`.
