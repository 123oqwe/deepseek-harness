# Agent Note: A claim its turn never recorded goes back to the inbox

Status: implemented

English | [中文](2026-09-28-a-claim-its-turn-never-recorded-goes-back-to-the-inbox.zh.md)

## Problem

A step claims its messages out of the agent inbox before the `agent/pre-step` waterfall and appends them as `user/message` events only on its first attempt. A turn that ended in between, because a pre-step refused the step, the turn was aborted, or it failed, consumed the claim at `turn/end`: the message was neither pending nor recorded, and a redelivery of its `(source, id, epoch)` was refused as a duplicate (BLOCKED-088, Epic P4-06 lock (a); red first A-567).

## Decision

- The `inboxArrivals` projection consumes an arrival key when the conversation records its message as a `user/message`, and `turn/end` releases every claim still held (`packages/core/agent-loop/src/inbox.ts`).
- A turn that a pre-step refusal or an abort ends before recording its claim puts the claimed messages back at the front of `next-step` after `turn/end` and wakes nothing (`packages/core/agent-loop/src/agent.ts`). A later wake records them once.
- A refusal that removes messages on purpose lists them in `PreStepDecision.dropped`, one `{ messageIds, by, reason }` record per listener. The turn's `blocked` end records the list, and those messages are not put back. The hooks' `UserPromptSubmit` deny drops the claimed batch, the goal round driver drops its own stale or refused round, and the Run plugin drops what an ended Run claimed.
- A cancel that clears the inbox, or that passes `cancelClaim` with `keepInbox`, cancels a claim still out: the claim is put back and removed by a `canceled` splice, and the turn's `aborted` end records the cause. A subagent interrupt and a user Stop pass `cancelClaim`: they stop the work that was starting on purpose. A turn that failed before recording its claim cancels it the same way, so a turn that keeps failing, such as one with no model route, leaves no input pending.
- The goal round driver cancels a round that the loop puts back after an abort, because it never runs a claimed round again.

## Alternatives considered

- **Put back only messages that carry an arrival key.** A user prompt refused by a pre-step would still disappear without a record.
- **Wake the driver after a put-back.** A refusal that repeats would loop without bound.
- **Put back after a failure too.** A turn that keeps failing, such as one with no model route, would keep its input pending, and a subagent child in that state would never settle.

## Consequences

- A pre-step listener that rejects without `dropped` now keeps the claimed messages pending. A listener that refuses the same message every time keeps it pending, and every later batch that claims it is refused with it; there is no retry limit.
- A continuable subagent child whose turn ends before recording its claim, because a listener refused without `dropped`, keeps the message pending. Its Activation settles only when the inbox is empty, so it stays resident and the parent receives no settlement.
