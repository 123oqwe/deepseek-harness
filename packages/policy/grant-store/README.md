---
description: "Reusable scoped, expiring capability grants for Epic P2-08's first slice: the grant vocabulary, pure validation that refuses unscoped or permanent drafts, predicate-only matching where the stricter of two covering grants decides, and an in-process store plus a fail-closed worker view."
kind: "package-library"
---

# @deepseek-ai/dsh-grant-store

## Summary

`dsh-grant-store` is the first slice of Epic P2-08: a reusable grant is scoped to an actor, a capability and a resource prefix, carries amount, use-count and time-window limits, names an environment, and expires. `src/types.ts` holds the vocabulary; `src/match.ts` validates a draft and matches an action against grants by their predicates and limits alone; `src/store.ts` is an in-process store that issues, lists, revokes and counts uses, and a worker view that re-reads on epoch change and fails closed. This slice mounts nothing — the permission-stack wiring waits for P2-07.

## Table of Contents

- [What a grant decides, and what it does not](#what-a-grant-decides)
- [Scoped and expiring, by construction](#scoped-and-expiring)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## What a grant decides, and what it does not {#what-a-grant-decides}

`matchGrants` reads a grant's predicates — actor tenant and principal, capability action, resource prefix, environment — and its limits — largest amount, use count, time window and expiry. It never reads the action's `justification`: a model-authored claim that "this was approved" changes no decision, and a model-authored "do not allow this" changes none either. An action covered by no grant, or outside any one covering grant's limits, is allowed by none, so the enforcement point sends it back to approval or refusal.

Where two grants cover the same action, the stricter one decides: an amount inside the wider grant but over the narrower one is refused. This is a boolean allow/deny at the library layer, not an approval; nothing here refuses an action on its own authority, exactly as the rest of `packages/policy` reports rather than enforces.

## Scoped and expiring, by construction {#scoped-and-expiring}

`validateGrantDraft` refuses two shapes so the store cannot hold them. A draft missing its actor, capability or resource predicate — or whose resource prefix is empty, which would cover every resource — is `GRANT_UNSCOPED`. A draft whose expiry is absent, non-numeric or non-finite is `GRANT_NO_EXPIRY`, so no grant is permanent. Scope is checked first, so a draft that is both unscoped and permanent reads as unscoped. `createMemoryGrantStore().issue` runs the same check and throws a `GrantError` carrying the code, leaving the store empty, so a refused draft is never stored.

A revocation advances the store's epoch. A `GrantView` opened over the store re-reads its grants whenever the epoch moves, so a revocation reaches the worker at its next authorization; a source whose epoch or grants cannot be read allows nothing, so an unreachable worker fails closed rather than open.

## Model Experience

None, as this package registers no tool, prompt text, or session event, so nothing it owns reaches a model request.

#### KV Cache effect

Nothing here enters a request, so provider cache reuse is unaffected. What a model eventually reads about a grant decision is whatever the consuming enforcement point chooses to say, and that choice belongs to the consumer.

## Known Limitations and Deferred Work

- This slice is the library only. No Cordis service, provider or mount exists yet: the grant store is not in any profile, and nothing reads it during a permission decision. The Provider and Use stages that wire it into the approval/denial path arrive with P2-07's persistent approval queue, and only then does the package join the SDK runtime closure.
- `GrantView` models bounded revocation propagation over an in-process source. Real cross-worker distribution — a persisted source, a serialization boundary and the revocation race and offline-worker faults of acceptance[2] — is the third slice's work.
- The store mints grant ids as an in-process counter and holds grants in memory; durability and cross-process identity come with the persisted source.
