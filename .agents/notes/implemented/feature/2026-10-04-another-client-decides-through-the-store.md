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
- **The SDK lists and decides as the host user.** `approval/list` and `approval/decide` use the viewer `manifestAttribution` gives the host-user identity the server's sessions act as, the same source a dispatch consumes with, so a client reconnecting as that user lists its pending approvals; `sessionId` narrows the list and is not an access boundary. Another tenant's approval is answered `not-found`, never `other-tenant`.
- **`approval.changed` is opt-in.** A client declaring the existing `approval` capability receives each recorded or moved approval of its connection's tenant, with `sessionId` at the top level so session subscriptions deliver it. The two methods and the notification join the request and notification maps and the fingerprinted surface; the approval types stay out of the schema registry, as `ShutdownRequest` does (the delegate's ruling, 2026-10-04).

## Alternatives considered

- **Poll the row while an ask waits.** A timer on every ask for a case the in-process event covers.
- **Log the answerers' outcome even when another client won.** The session log would then disagree with the store, and only consumption would hold the line.

## Consequences

- An SDK client's decision settles an inline ask, since the SDK server decides through the same store.
- The protocol fingerprint moves, and P8-01's golden fixture pins the new value.
- dsh-base's Manifest v2 declares the event its approval service listens to.
