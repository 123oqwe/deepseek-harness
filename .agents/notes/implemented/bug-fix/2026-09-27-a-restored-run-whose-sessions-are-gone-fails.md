# Agent Note: A restored Run whose sessions are gone fails instead of dangling

Status: implemented

English | [中文](2026-09-27-a-restored-run-whose-sessions-are-gone-fails.zh.md)

## Problem

P4-05 acceptance[2] asks that an orphaned Run is reclaimed after a restart or fails safely. A crash that lands after the Run is durable but before its session is leaves a Run no host can continue: adoption happens when a session starts, and that session never starts again. The Run stayed non-terminal for good (A-560). The state machine also had no way to fail a Run from `accepted` or `paused`.

## Decision

- `LEGAL_RUN_TRANSITIONS` lets `accepted` and `paused` go to `failed`. P4-01 lists the states and requires illegal transitions to be refused; which transitions are legal is a design choice, and the state set does not change.
- At mount, once session persistence is available, the run plugin checks every Run it restored non-terminal. When none of the Run's sessions exists (`SessionPersistence.stat` answers `undefined`), it acquires the Run's lease, as a reclaim does, and advances the Run to `failed` under that lease, then releases it. A live holder keeps the lease, so its Run is left alone.
- The reason is written to the logger line. A Run's log has no field for one; adding it would change the `runs.json` format.

## Alternatives considered

- **Cancel a Run in `accepted` or `paused`.** Legal without a table change, but `cancelled` says someone cancelled it.
- **Walk `accepted` through `planning` to `failed`.** It records a planning step that never happened.

## Consequences

- A Run that lost every session in a crash reaches `failed` on the next boot instead of staying in `listNonTerminal` forever.
- The failure reason is not durable; recording it in the Run's log is registered as later work.
- Verification: A-560 (`tests/first100/fixtures/P4-05.reclaim-after-restart.composition.spec.ts`), with lane A's A-562 replacing the two P4-01 table cases whose titles change.
