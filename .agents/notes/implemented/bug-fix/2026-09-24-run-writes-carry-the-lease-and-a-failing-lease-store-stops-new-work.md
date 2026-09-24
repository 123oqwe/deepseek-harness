# Agent Note: Run writes carry the lease, and a failing lease store stops new work

Status: implemented

English | [中文](2026-09-24-run-writes-carry-the-lease-and-a-failing-lease-store-stops-new-work.zh.md)

## Problem

P4-07's acceptance was withdrawn (BLOCKED-319) over two gaps on the shipped headless profile. A host whose work item had been taken over still wrote its Run's outcome when its session ended: `finish` called `endRun` unconditionally, and `RunService.advance` took no lease, so `verifying` and `succeeded` landed over the new holder's Run. And when the lease store threw while a session started, for example because another connection held its SQLite lock past the busy timeout, the exception was swallowed by the listener dispatch: the agent had neither a Run nor a refusal, so its tool calls ran. must[1] asks that state writes carry the fencing token; the user chose to have the Run's first-step and terminal writes carry it and be checked where they are written, and to record the rest as a Known Limitation.

## Decision

- **`RunService.advance` takes the writer's lease.** With a `fence`, the write happens only while `fence.mayWrite(occurredAt)` admits it, asked in the Run's own turn right before the state machine decides. A refusal records nothing and reads `'fenced'`, a new member of `RunTransitionDenialReason`; when asking the lease throws, the write is refused as `'lease-unavailable'`, another new member, instead of the error escaping the Run's turn.
- **`RunPlugin` passes the agent's lease on five writes**: `accepted → planning`, `→ running`, and the terminal `cancelled`, `verifying`, and `succeeded` or `failed`. `pauseRun` does not.
- **A write refused for its lease is logged.** All six of `RunPlugin`'s Run writes go through one helper, which logs a `fenced` or `lease-unavailable` refusal as a warning naming the transition, the Run and the reason. An illegal transition is not logged, because after a refused `verifying` the terminal write is asked for and refused as illegal.
- **`finish` gives the item back after the terminal writes settle.** Released first, the holder's own writes would find no lease and be refused.
- **`open` treats a store that throws like a refused lease.** Reading the predecessor and taking the lease sit in one `try`; on a throw the agent is marked `leaseRefused`, no Run opens, and the log records the refusal as `lease-unavailable`.

## Alternatives considered

- **Check `mayWrite` in `finish` before calling `endRun`** (the diagnosis's first change). Not chosen: it is a check before an unfenced write, and the delegate kept one mechanism, the check where the write is made.
- **Record an epoch on the Run and have the store refuse older ones.** Not chosen by the user: it changes the Run schema and is new code.
- **Have `pauseRun` carry the lease.** Not chosen: `pauseRun` gives the lease back before it awaits anything so that a clean unload does not leave the item leased, and that order is BLOCKED-197's design.

## Consequences

- `pauseRun`'s `paused` write, `openForSession`, `attachSession` and session-log appends carry no lease. The lease lives in SQLite and the Run in its JSON store, so a write admitted just before a takeover can still land; "stale writes after a newer token = 0" is not claimed.
- A session whose lease store failed at start stays refused for its life, like one refused by a live holder or an emergency stop, and `leaseRefused` now also means "the store failed"; a new session is needed once the store recovers.
- If the lease provider is torn down before a session's terminal writes settle, those writes are refused as `'lease-unavailable'` and the release throws, reported as a failed Run store write, and the lease row stays until it lapses. A session that ends while its host is shutting down can therefore keep a non-terminal Run.
- The first-step writes are shown at the Run Service unit level; on the shipped profile the cases observe the terminal writes.
- A store that fails after the lease is taken is not covered: a heartbeat's `renew` that throws is not caught, and tools dispatch until then.
