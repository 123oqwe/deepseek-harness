# Agent Note: A send a fenced-out holder left goes to reconciliation

Status: implemented

English | [中文](2026-10-03-a-send-a-fenced-out-holder-left-goes-to-reconciliation.zh.md)

## Problem

The native dispatch marks an external effect `sent` before the tool runs. When the host is killed after that mark and before the result is recorded, the entry stays `sent` under the dead process's lease generation. A resumed session that replays the same call reaches the same idempotency key under a newer generation, and the ledger answered it as a plain `duplicate`: the model was told the action "was already sent", which asserts an outcome nobody knows, and the entry never reached reconciliation (question 33; A-600 observes it on the shipped headless launch).

## Decision

- `decideReservation` refuses a `sent` entry that an older generation holds as `ambiguous-needs-reconciliation`. The fence proves only that the holder's lease lapsed; the holder may still be running. It cannot confirm or record a failure afterwards because the entry is then `ambiguous`, which only a host resolution leaves.
- The ledger store's `reserve` moves such an entry to `ambiguous` in the same transaction as the decision, under the holder's own generation, which is the transition `markAmbiguous` makes. `listAmbiguous` then lists it, and `/resolve-effect` settles it.
- The model gets the existing reconciliation reply: the outcome is unknown, cannot be settled by retrying, and awaits reconciliation. The tool is not run again.
- At the same generation, or with either side unfenced, a `sent` entry is still a `duplicate`: there a live holder may still be sending, and no lapsed lease is proven.

## Alternatives considered

- **Call `markAmbiguous` from the dispatch after `reserve` answers `duplicate`.** Between the two calls the old holder, if it were still alive, could confirm the entry, and the move would then fail on a settled entry; one transaction has no such window.
- **A new decision kind for a stranded send.** The existing refusal already says what the caller must do, and the dispatch and its reply need no new case.

## Consequences

- A replay of the same call after a crash reports the outcome as unknown and lists the effect for the host user to resolve; under that idempotency key it is never performed twice. A retry under a new call id presents a new key, which this decision does not see; [the same-action check](2026-10-03-a-retry-under-a-new-call-id-is-the-same-action.md) covers it.
- Not covered: an unfenced profile (no Run lease) cannot tell a dead holder from a live one, so there a stranded `sent` entry is still answered as a duplicate.
