# Agent Note: A settlement acked but never recorded is redelivered when its parent starts

Status: implemented

English | [中文](2026-09-28-a-settlement-acked-but-never-recorded-is-redelivered-when-its-parent-starts.zh.md)

## Problem

A child's settlement reaches its parent through the durable bus. The drain splices the notice into the parent and acks the outbox row in one synchronous pass, and the splice reaches the parent's log only when the live-write batch flushes, up to 200 ms later. A host killed between the ack and the flush left the row acked, which no drain delivers again, and the parent's log without the notice: the settlement took effect zero times (BLOCKED-350, Epic P4-06 acceptance[0]; red first A-566).

## Decision

- When a parent's session starts, before its owed rows are drained, every settlement it acknowledged whose arrival key its inbox arrivals projection does not hold, as pending, claimed or consumed, is delivered again through the drain's insertion rules (`packages/subagent/subagent/src/continuation-activation.ts`). The row stays acked.
- The key is the inbox's own `(source, id, epoch)`, and the projection is folded from the parent's log, so a notice the parent recorded before the crash is not delivered twice, and the inbox admits the redelivery of a notice it never recorded.
- It runs only when the session starts, before anything in this process delivered to the parent, so the projection is the whole account of what reached it.

## Alternatives considered

- **Ack only after the parent's log flushed.** The drain would become asynchronous across its three triggers, a row still pending during the flush could be delivered twice by another trigger, and a crash between the flush and the ack would still need a comparison with the log.
- **Scan the parent's session history for the splice.** Synchronous reads of session history are deprecated ([decision](../architecture/2026-09-09-deprecate-synchronous-session-event-reads.md)); the projection already holds the keys.

## Consequences

- A notice cancelled from the parent's queue before it ran leaves the projection, so if its row was acked it is delivered again after the next restart.
