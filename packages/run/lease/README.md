---
description: "Worker leases, fencing tokens, and the epoch staleness test for Epic P4-07: per-work-item lease generations, a token carried by every state write, expiry and scheduler reclaim, and fail-closed refusal of any write whose epoch is not the item's current one."
kind: "package-reference"
---

# @deepseek-ai/dsh-lease

## Summary

`dsh-lease` owns Epic P4-07's authority model. A scheduler cannot stop an old worker from waking up; it can only ensure that when one does, nothing it says is believed. `src/types.ts` holds the pieces that make that true: a per-work-item `LeaseEpoch` that increases with every acquisition (must[0]), a `FencingToken` carried by every state write and action execution (must[1]), `isReclaimable` for expiry and scheduler reclaim (must[2]), and `checkFencing`, which refuses any write whose epoch is not the item's current one (must[3]).

## Table of Contents

- [Authority is an epoch, not a timestamp](#authority-is-an-epoch-not-a-timestamp)
- [Why a forged-high epoch is also refused](#why-a-forged-high-epoch-is-also-refused)
- [The expiry boundary](#the-expiry-boundary)
- [The store is the sole issuer of epochs](#the-store-is-the-sole-issuer-of-epochs)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Authority is an epoch, not a timestamp

The staleness test consults no clock. Two workers whose clocks disagree still agree on which epoch is larger, so acceptance[1] — "clock skew within tolerance does not produce two masters" — holds by construction rather than by tuning a tolerance. Time enters only where it must: a heartbeat advances a caller-supplied deadline, and `isReclaimable` compares that deadline to a caller-supplied instant.

A token names its work item as well as its epoch. An epoch alone is meaningless across items — epoch 7 of item A says nothing about item B — and a token without the item would let a worker holding any current lease write to work it does not own.

## Why a forged-high epoch is also refused

`checkFencing` requires the token's epoch to **equal** the lease's, so an epoch *above* the current one is refused as `stale-epoch` too. Epochs are issued only by the store, so an epoch higher than any it has issued did not come from it. Admitting it would invert the mechanism, making a forged-high epoch the strongest authority in the system; refusing the unknown is the fail-closed direction.

## The expiry boundary

A lease is still held at the exact instant it expires: reclaim requires `nowMs > expiresAtMs`. Stated explicitly because the alternative is the two-masters window — with `>=`, a renewal and a reclaim arriving at the same instant would both be legal.

## The store is the sole issuer of epochs

That is what makes `checkFencing` meaningful: a token can only carry an epoch `LeaseStore` handed out, so refusing anything that is not the item's current epoch refuses every forgery too. Epoch counters are **per work item** — a shared counter would let activity on one item advance another's, and epoch 7 of item A says nothing about item B.

A heartbeat moves the deadline and does **not** issue a new epoch: the holder's authority is unchanged, and bumping it would fence the holder out of its own work. Renewal of an already-expired lease is refused rather than granted, because the scheduler may already have handed that item to someone else — reviving a lapsed holder is precisely the two-masters state.

**Availability is part of the contract, not an error path.** While the store is unavailable, `acquire` refuses with `store-unavailable` and `reclaimable` returns nothing. "Nobody holds this" and "I cannot tell you who holds this" must not look alike to a scheduler: reporting an item free during an outage is how the same work reaches a second worker (acceptance[2]).

## Model Experience

No model-visible surface. The package exports decision functions, an in-memory lease store, and types; it renders no prompt text, defines no tool, and contributes no session event, so it consumes no tokens and cannot affect KV-cache reuse.

## Known Limitations and Deferred Work

- **The store is in-memory and single-process.** `LeaseStore` holds leases in a `Map`, so it proves the epoch and availability rules but not the contention they exist to survive. A shared, durable store is not in this package.
- **Nothing carries the token yet.** `FencingToken` is defined and checked, but no state write in this repository presents one. The Usage stage owns threading it through the agent dispatch path and the workflow worker host.
- **Contention is proved sequentially.** `tests/fencing.e2e.spec.ts` runs a hundred acquisitions in order and asserts exactly one token survives. Genuinely concurrent acquisition needs a shared store, which does not exist here.
- **`setAvailable` is a switch, not a health check.** Nothing detects an outage; a caller must tell the store it is unreachable.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`packages/core/agent/src/state-machine.ts` already declares its own `LeaseEpoch` as a bare `number` for the agent lifecycle. This package's `LeaseEpoch` is branded and scoped to a work item. Whether those are the same concept, and which module should own it, is unresolved — merging them touches P4-05's Contract surface and was deliberately not done from here.

</details>
