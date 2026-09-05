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

## Model Experience

No model-visible surface. The package exports pure decision functions and types; it renders no prompt text, defines no tool, and contributes no session event, so it consumes no tokens and cannot affect KV-cache reuse.

## Known Limitations and Deferred Work

- **No store yet.** `Lease` describes what a store holds, but acquisition, heartbeat renewal, and reclaim are not implemented — the Provider stage owns `src/store.ts`, including what happens when the store itself is unavailable (acceptance[2], "stop taking new work when the lease store fails").
- **Nothing carries the token yet.** `FencingToken` is defined and checked, but no state write in this repository presents one. The Usage stage owns threading it through the agent dispatch path and the workflow worker host.
- **Contention is proved sequentially.** `tests/fencing.e2e.spec.ts` runs a hundred acquisitions in order and asserts exactly one token survives. Real concurrent acquisition against a shared store is the Provider stage's to prove.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`packages/core/agent/src/state-machine.ts` already declares its own `LeaseEpoch` as a bare `number` for the agent lifecycle. This package's `LeaseEpoch` is branded and scoped to a work item. Whether those are the same concept, and which module should own it, is unresolved — merging them touches P4-05's Contract surface and was deliberately not done from here.

</details>
