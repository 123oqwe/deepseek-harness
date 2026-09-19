---
description: "Durable lease store for Epic P4-07: SQLite-backed acquisition serialized by BEGIN IMMEDIATE, so two processes racing for one work item cannot both hold it."
kind: "package-reference"
---

# @deepseek-ai/dsh-lease-sqlite

## Summary

`dsh-lease-sqlite` is Epic P4-07's durable Service Provider. It implements `LeaseStoreContract` from `@deepseek-ai/dsh-lease-contract` over one SQLite database and publishes it as `ctx.leaseStore`, so leases outlive the process that took them and two hosts pointed at the same directory contend over the same rows.

## Table of Contents

- [A lease that dies with its holder is not a lease](#a-lease-that-dies-with-its-holder-is-not-a-lease)
- [What the transaction covers](#what-the-transaction-covers)
- [Epochs outlive leases](#epochs-outlive-leases)
- [The emergency stop is read at every acquisition](#the-emergency-stop-is-read-at-every-acquisition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## A lease that dies with its holder is not a lease

The in-memory store this joins keeps its leases in a `Map`, one per mount, so "another host cannot take this item" holds only between two callers inside a single process — two real processes each hold their own map and both win. Every clause of P4-07 depends on the store outliving the holder: must[2]'s reclaim needs an expired lease still to be there after the worker is gone, acceptance[2]'s stop-work needs a store that can actually fail, and acceptance[0]'s recovered worker needs someone to have taken its item while it was away.

## What the transaction covers

`acquire` runs its read, its epoch bump and its write inside one `BEGIN IMMEDIATE` transaction. That is the property the rule turns on: two processes reaching it together are serialized by SQLite, so the loser reads the winner's row instead of an empty table. `busy_timeout` is 5000ms, because two hosts acquiring *different* items at the same moment is ordinary and the loser of the write lock should proceed a millisecond later rather than fail.

The comparisons themselves are not re-decided here. Expiry is `isReclaimable` from the contract, in `acquire`, in `renew` and in `reclaimable` alike — an inline `expires_at_ms <= nowMs` in the last of those reclaimed at the exact deadline the rule still holds the lease at, which is the one-millisecond two-masters window the epic exists to close.

## Epochs outlive leases

`lease_epochs` is a separate table from `leases`, keyed by work item, holding the next epoch to issue. A lease row is replaced whenever the item changes hands; the high-water epoch is not, so a reacquired item never reissues an epoch a stale worker still holds and could still present.

## The emergency stop is read at every acquisition

While a stop is in force this provider refuses `acquire` with `'stopped'`, before its storage is consulted (P2-12 must[2]). The control plane is read through `ctx.get('controlPlane')` at call time rather than injected or cached, because the answer changes while the mount lives and a copy taken at mount would report the deployment's state at startup.

A composition that mounts no control plane is admitted: capability absence is not a stop, which is the answer `stopGateFor` already gives on the dispatch path. A plane that is mounted but not yet active is a different case and is NOT admitted — reading its state throws, and this provider does not catch it, because a stop that cannot be read is not a stop that is absent. Custom compositions that mount a lease store without a control plane therefore have no stop gate at this seam; the shipped `dsh-base` bundle mounts both, and this is the provider it mounts.

`renew` and `release` stay open under a stop, for the reasons the contract's own documentation gives.

## Model Experience

None, as this package stores leases and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **One database, one machine.** SQLite serializes writers through a file lock, so hosts contend correctly only where they share a filesystem. Two machines need a store this package does not provide.
- **`setAvailable` is a switch, not a health check.** A caller must tell the store it is unreachable; a database that has genuinely gone away throws from the underlying driver instead.
- **No schema migration path.** `schema_version` is written and never read. The first change to these tables has to add the read as well as the migration.
- No runtime invariant companion is published: the store's own relation — one holder per unexpired item — is enforced inside a single `BEGIN IMMEDIATE` transaction and observable only by reading the same rows the store just wrote, so a checker would compare a value against itself rather than reconcile two independent observations.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

The lease directory is a plain path, so nothing stops two deployments that should be isolated from being pointed at one file, or two that should contend from being pointed at two. Deriving it from a storage root the harness already owns would remove the choice, and whether that root exists in every launch path has not been checked.

</details>
