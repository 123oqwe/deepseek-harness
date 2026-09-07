---
description: "The lease capability definition for Epic P4-07: work-item and epoch identities, the fencing token every state write carries, the staleness and expiry rules, and the store operations a provider must implement."
kind: "package-reference"
---

# @deepseek-ai/dsh-lease-contract

## Summary

`dsh-lease-contract` is Epic P4-07's Service Definition. It declares what a lease is — a per-work-item `LeaseEpoch`, a `FencingToken` carried by every state write, a `Lease` with a deadline — and the two rules every holder and every store decide by: `checkFencing`, which refuses any write whose epoch is not the item's current one, and `isReclaimable`, which says when a lease has lapsed. It declares `LeaseStoreContract`, the operations a provider implements, and augments `Context` with `leaseStore` so a consumer injects the rule rather than a storage choice.

It contains no store. The providers are `@deepseek-ai/dsh-lease` (in-memory, single-process) and `@deepseek-ai/dsh-lease-sqlite` (durable, shared).

## Table of Contents

- [Why the definition is separate](#why-the-definition-is-separate)
- [Authority is an epoch, not a timestamp](#authority-is-an-epoch-not-a-timestamp)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Why the definition is separate

A consumer of a lease — a workflow host, an agent dispatcher — needs the rule, not the storage. While the rule lived beside the in-memory store, every consumer depended on orchestration runtime to read a fencing decision, and the nearest store was the one it constructed: the workflow engine held every lease in a `Map` of its own, so "another host cannot take this item" was true only between two runs inside one process.

Splitting the definition out makes the dependency direction match the decision. `Context.leaseStore` is declared here, once, as `LeaseStoreContract` rather than as either provider's class, so the two providers cannot disagree about what the service is and a consumer injecting it cannot reach past the contract into whichever one a deployment mounted.

## Authority is an epoch, not a timestamp

The staleness test consults no clock. Two workers whose clocks disagree still agree on which epoch is larger, so acceptance[1] — "clock skew within tolerance does not produce two masters" — holds by construction rather than by tuning a tolerance. Time enters only where it must: a heartbeat advances a caller-supplied deadline, and `isReclaimable` compares that deadline to a caller-supplied instant. A lease is still held at the exact instant it expires (`nowMs > expiresAtMs`), because reclaiming and renewing at the same instant would otherwise both be legal.

`checkFencing` requires the token's epoch to **equal** the lease's, so an epoch *above* the current one is refused as `stale-epoch` too. Epochs are issued only by a store, so an epoch higher than any it issued did not come from it; refusing the unknown is the fail-closed direction. Its check order — item, existence, epoch, holder — is part of the contract, because the reason is evidence: a worker learning `stale-epoch` knows it was fenced out and must stop, while one learning `wrong-work-item` has a routing bug of its own.

## Model Experience

None, as this package exports declarations and two pure decisions and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **The contract has no reclaim notification.** A fenced-out holder learns it lost the item only when its next write is refused. That is deliberate — it is the one notification that cannot be lost — but it means a holder doing no writes never finds out.
- **`setAvailable` is a switch, not a health check.** The contract lets a caller declare a store unreachable; nothing in it detects an outage.
- No runtime invariant companion is published: this package declares types and two pure decisions and holds no state, so there is no owned relation two observers could disagree about. `checkFencing` and `isReclaimable` are functions of their arguments, covered by unit cases in the packages that apply them.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`packages/core/agent/src/state-machine.ts` declares its own `LeaseEpoch` as a bare `number` for the agent lifecycle, while this package's is branded and scoped to a work item. Whether those are the same concept, and which module should own it, is unresolved — merging them touches P4-05's Contract surface and was deliberately not done from here.

</details>
