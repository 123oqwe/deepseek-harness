# Agent Note: A Team send racing recovery reports the shared delivery

Status: implemented

English | [中文](2026-10-05-a-team-send-racing-recovery-reports-the-shared-delivery.zh.md)

## Problem

`@deepseek-ai/dsh-experimental-agent-team` promises that a sender sees its message either accepted by the target inbox or retained as `queued` when delivery is temporarily unavailable (package README). `sendMessage()` appends `team/message/queued` inside the Lead's journal transaction, waits for the flush, then dispatches. The append is visible to readers before the flush settles, and a Lead's recovery pass, which runs outside that transaction after a resume, dispatches every undelivered record it reads. When recovery read the new record first, it claimed the message and delivered it; the sender's own dispatch then found the id in flight and returned `false`, so its receipt said `queued` for a message the target had accepted. The S4 full gate (run 37266436298) caught it in `persistence.spec.ts`, which had passed on the same code in the S3 full gate.

## Decision

- `TeamMailbox.inFlightMessages` (`packages/experimental/agent-team/src/mailbox.ts`) maps each in-flight message id to its delivery attempt instead of only recording the id.
- `tryDispatch` stores its attempt before returning it. A caller that finds the id in flight receives that attempt instead of `false`, so a send racing a recovery pass reports the outcome of the one delivery.
- `dispatchThrough` registers the attempt for each earlier queued record it delivers on a message's behalf under the same rule.
- A record that is not in flight is dispatched as before, so a delivery that is unavailable still leaves the message `queued`.

## Alternatives considered

- **Re-read the journal after the flush and report `accepted` when recovery has delivered the record.** It adds a read on every send and still answers `queued` while recovery's delivery is pending.
- **Hold sends until a Lead's recovery pass completes.** It changes the ordering between recovery and sends for every Team, which the defect does not require.

## Consequences

- A send and a recovery pass that reach the same record share one delivery attempt, and both report its outcome.
- A recovery pass that reaches a record a send is delivering waits for that delivery instead of skipping it.
