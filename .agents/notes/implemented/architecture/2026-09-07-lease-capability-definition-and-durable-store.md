# Agent Note: The lease capability split into a definition, two providers, and an injected consumer

Status: implemented

## Problem

Epic P4-07's lease rule existed only beside its in-memory store, and the one consumer that needed it constructed that store itself.

Two consequences, both measured:

- **The `Map` could not carry the rule.** `LeaseStore` keeps leases in a `Map` owned by the mount, so "another host cannot take this work item" held only between two callers inside one process. `WorkerThreadWorkflowEngine` did `new LeaseStore()` per engine, and the case asserting a second host is refused ran two engines in one process — it passed because both engines shared a heap, not because the rule holds. Two real processes each held their own map and both won.
- **The consumer depended on orchestration runtime to read a decision.** `check-layer-deps` reported `@deepseek-ai/dsh-workflow-worker-thread -> @deepseek-ai/dsh-lease: providers -> orchestration-runtime`. Adding a durable store beside the in-memory one made that two findings rather than one: replacing a `new` with a different `new` moves the mistake without removing it.

## Decision

- **The definition moved to `@deepseek-ai/dsh-lease-contract` (capability-definitions).** It declares `WorkItemId`, `WorkerId`, `LeaseEpoch`, `FencingToken`, `Lease`, the acquire/renew outcomes, `LeaseStoreContract`, and the two decisions `checkFencing` and `isReclaimable`. `@deepseek-ai/dsh-lease/types` re-exports them; nothing is redeclared, because a second copy of `checkFencing` would be the one-rule-two-implementations shape BLOCKED-136 records, and this is the copy that decides whether a stale worker may write.
- **`Context.leaseStore` is declared in the definition, as `LeaseStoreContract`.** Not as either provider's class. Two providers cannot then disagree about what the service is, and a consumer injecting it cannot reach past the contract into whichever one a deployment mounted.
- **Two providers.** `@deepseek-ai/dsh-lease-sqlite` is the durable one: one `BEGIN IMMEDIATE` transaction around `acquire`'s read, epoch bump and write, `busy_timeout = 5000`, and a `lease_epochs` table separate from `leases` so a reclaimed item never reissues an epoch a stale worker still holds. `@deepseek-ai/dsh-lease`'s `InMemoryLeaseStorePlugin` publishes the `Map` store for a caller that is genuinely alone, and for suites whose subject is the consumer rather than contention.
- **The consumer injects.** `WorkerThreadWorkflowEngine` gained `leaseStore` in `inject` and lost its `leaseDirectory` config — where leases live is the provider's question, and a profile answers it. `packages/bundle/base/cordis.patch.yml` mounts `@deepseek-ai/dsh-lease-sqlite` before the engine; without a provider the engine does not activate, which is the loud failure the alternative (a silent private store) does not have.

`check-layer-deps` findings: 121 → 120. Not recorded in a note as an accepted violation — removed.

## Defect found while writing this

`openLeaseStore`'s `reclaimable` filtered rows with `expires_at_ms <= nowMs` while the contract's `isReclaimable` is `nowMs > expiresAtMs`. The two disagree at exactly the deadline: the inline comparison reclaims an item the rule still holds, which is the one-millisecond two-masters window P4-07 exists to close. It is now filtered through `isReclaimable`, like `acquire` and `renew` already were. This is the second implementation of a stated rule going wrong in the direction the rule was written to prevent — the reason the definition is one package and no store re-decides.

## Alternatives considered

- **Keep the contract in `packages/run/lease` and only add the provider.** Measured: the finding count went 121 → 122, because a consumer importing the type still crosses the same layer. The layer edge follows the package graph, so the type has to live below the consumer for the edge to disappear.
- **Let the engine open its own SQLite store from a config path.** Rejected: the engine would still choose storage for its deployment, two hosts meant to contend could still be pointed at different files, and its unit suites could not run against a store with no file.
- **Publish the in-memory provider from the definition package.** Rejected: an implementation in a definitions package is the seam collapsing back into one role.

## Consequences

- Six suites that mount `WorkerThreadWorkflowEngine` now mount `InMemoryLeaseStorePlugin` first. That is the intended cost of the injection: a consumer that cannot start without a provider is one whose dependency is real.
- `@deepseek-ai/dsh-lease-contract` and `@deepseek-ai/dsh-lease-sqlite` have no Chinese README pair yet, which `verify-translation-pairing` reports; translation is user-authorized work and is recorded in BLOCKED-124 rather than done here.
- P4-07's remaining §12.16 item is untouched: agent dispatch still carries no fencing token, so `advanceAgentLifecycleFenced` still has no production caller.
