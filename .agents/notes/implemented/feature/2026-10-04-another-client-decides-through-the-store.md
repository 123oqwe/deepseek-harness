# Agent Note: Another client decides through the store

Status: implemented

English | [中文](2026-10-04-another-client-decides-through-the-store.zh.md)

## Problem

Epic P2-07 validation[1] requires that two clients deciding one approval leave one terminal state. After U1a, an ask kept waiting when another client decided its approval through the store. Its own later move named the revision read just before moving, so a late `cancelled` could revoke an approval the other client had already approved.

## Decision

- **The store announces.** Every provider emits `approval-store/changed` after each recorded approval and each accepted move, never after a refused one; the contract states it as a provider obligation.
- **The ask's own move names the revision it recorded.** A move made since then refuses it as `stale-revision`, and the ask settles on the state the store holds: approved is `allowed-once`, denied is `rejected`, anything else is `cancelled`. The race between deciders and the at-most-once consumption are two separate compare-and-swaps (the delegate's ruling, 2026-10-04).
- **A waiting ask is withdrawn.** `ApprovalService` keeps one listener and the waiting asks by approval id; a move of a waiting approval aborts the signal its answerers see, so a prompt still on screen is taken down.
- **In-process only.** A move another process makes in a shared store is seen on the next read; nothing polls.

## Alternatives considered

- **Poll the row while an ask waits.** A timer on every ask for a case the in-process event covers.
- **Log the answerers' outcome even when another client won.** The session log would then disagree with the store, and only consumption would hold the line.

## Consequences

- The SDK server's list and decide requests decide through the same store, so an SDK client's decision settles an inline ask.
- dsh-base's Manifest v2 declares the event its approval service listens to.
