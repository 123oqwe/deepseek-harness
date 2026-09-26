# Agent Note: Crash repair decides an interrupted turn's unanswered approvals as cancelled

Status: implemented

English | [中文](2026-09-26-an-unanswered-approval-is-cancelled-by-crash-repair.zh.md)

## Problem

P2-07 acceptance[0] at its first crash point: a host killed while an approval request waits for its answer. The log keeps the `approval/asked`, and crash repair closed the interrupted turn and the tool call, but nothing decided the ask. After the restart the approval was neither decided on the record nor asked again. Lane A's A-474 part 2 measured it on the shipped headless profile (run 36215977489).

## Decision

- **Resume repair decides the unanswered ask.** The agent layer's semantic crash repair closes each approval the interrupted final turn asked and never answered with `approval/decided { outcome: 'cancelled' }`, the outcome an aborted request settles as. The answerer, the waiting call and its signal died with the host, so no later lifecycle can answer it.
- **Inside the turn.** The decision goes after the tool-result closers and before the synthesized step and turn ends, because the user-approval invariant accepts an approval pair only inside an open turn. The later closers' seqs move up to stay contiguous.
- **Where.** `closeUnansweredApprovals` in `@deepseek-ai/dsh-agent-loop` is applied to what `interruptedTurnClosers` returns, in the resume path that already reads the stored log.

## Alternatives considered

- **In `interruptedTurnClosers` (core session).** Read-only cold reads would be balanced the same way, but the approval events belong to `@deepseek-ai/dsh-user-approval`, which core session does not depend on.
- **User-approval closing its own dead asks when a session starts**, keyed on the `session/end-seed` boundary. Finding the unanswered asks without a synchronous Session history read, which new code may not add, takes a projection and two new dependencies, and the decision would land outside any turn, which the invariant refuses.
- **Asking again.** The ask's call ended with its turn, and asking again means running an interrupted turn again, which no resume does.

## Consequences

- After a crash while an approval waits, the resumed log records the approval as `cancelled`, and the call it gated as not started or of unknown outcome.
- Read-only observers (session-query) balance a cold interrupted log without these decisions; they appear once the session is resumed.
- This is P2-07's first slice. The approval store with its states, persisted digest and deadline, compare-and-swap consumption and scheduler wake-up (must[0] to must[4]), and the crashes after an approval and before its consumption, are later slices.
- Verification: A-474 part 2 (`tests/first100/fixtures/P2-07.approval-crash.composition.spec.ts`) and `packages/core/agent-loop/tests/approval-repair.spec.ts`.
