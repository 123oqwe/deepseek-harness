# Agent Note: A sessionless restored Run fails once the refusing lease lapses

Status: implemented

English | [中文](2026-09-28-a-sessionless-restored-run-fails-once-the-refusing-lease-lapses.zh.md)

## Problem

After a restart, the Run plugin fails every restored non-terminal Run whose sessions are all gone (P4-05 acceptance[2]). It checked once, when session persistence became available, and skipped a Run whose lease the store refused. A restart that came before the dead predecessor's lease lapsed therefore left the Run non-terminal until some later restart (blind review 2-1; red first A-568). The same check stopped at the first Run whose check threw and kept the lease it had taken (2-3). Separately, the Run's end decision read only the plugin's failure table, so a lifecycle ended `failed` through `runs.advance` was recorded `succeeded` (2-4).

## Decision

- A Run whose lease is refused is checked again at the refusing lease's expiry plus one millisecond, because a lease is still held at its expiry instant, or one lease term later when the store names no expiry (`packages/run/run/src/index.ts`). Each check reads the Run's state and its sessions again, and teardown clears the pending checks.
- Each Run is checked on its own: a failure is logged and the sweep goes on, and a lease taken for the write is released in `finally`.
- The end decision is `failed` when an unrecovered error was the Run's last reported activity or the agent's lifecycle already ended `failed`.

## Alternatives considered

- **Check every restored Run on a fixed interval.** It adds a tunable, and the refusing lease's own expiry already says when the answer can change.
- **Fail the Run without taking the lease.** A live holder whose lease is still valid would lose its Run.

## Consequences

- A live holder that keeps renewing keeps its Run; the check is scheduled again at each expiry it observes.
- A Run whose opener's session is gone while an owned child's session remains is not failed, although only the opener's session can continue it (`adoptable`).
