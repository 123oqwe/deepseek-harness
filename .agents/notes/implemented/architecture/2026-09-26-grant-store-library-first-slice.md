# Agent Note: A reusable grant is a library before it is a mount

Status: implemented

English | [中文](2026-09-26-grant-store-library-first-slice.zh.md)

## Problem

Epic P2-08 asks for a reusable grant: scoped to an actor, a capability and a resource, carrying amount, use-count and time-window limits, naming an environment, expiring, and revocable, matched by policy predicates rather than by any model-authored text, with its uses counted and a revocation that reaches every worker and fails closed.

Its Use stage consumes an approval seam: an action outside every grant's limits goes back to approval or refusal (acceptance[1]), and that seam is P2-07's persistent approval queue, which is not built yet. Mounting a grant store into the shipped permission stack now would either couple to an absent seam or put an opt-in into a shipped default, which the package rules forbid. The first slice needs the grant vocabulary and its decisions to exist and be exercised without any of that.

## Decision

The first slice is a pure library, `@deepseek-ai/dsh-grant-store`, and nothing else. `src/types.ts` holds the vocabulary; `src/match.ts` validates a draft and matches an action; `src/store.ts` is an in-process store and a worker view. The package registers no Cordis service, tool, prompt or session event, and no profile mounts it, so it is not in the SDK runtime closure yet — it joins that closure only when the Use stage mounts it with P2-07.

Matching reads a grant's predicates and limits alone and never the action's `justification`, so a model-authored claim that an action was approved, or an instruction not to allow it, changes no decision (must[1]). Where two grants cover the same action the stricter one decides, so an action inside the wider grant but outside the narrower one is allowed by neither (acceptance[1]); at the library layer this is a boolean allow/deny that reports, never an approval that enforces, matching the rest of `packages/policy`.

`validateGrantDraft` refuses two shapes so the store cannot hold them, checking scope before expiry: a draft missing an actor, capability or resource predicate, or whose resource prefix is empty and so covers every resource, is `GRANT_UNSCOPED`; a draft whose expiry is absent, non-numeric or non-finite is `GRANT_NO_EXPIRY`, so no grant is permanent. `issue` runs the same check and throws a `GrantError` carrying the code, leaving the store empty. A grant is immutable once stored: a counted use or a revocation replaces its record rather than mutating it, so a list taken earlier stays a stable snapshot. A revocation advances the store's epoch; a `GrantView` re-reads the source's grants when the epoch moves, and a source it cannot read allows nothing, so an unreachable worker fails closed.

## Alternatives considered

- **Mount the store now behind a stub approval fallback.** Rejected: it couples to the absent P2-07 seam and puts an opt-in into a shipped default with no real enforcement behind it. The Use-stage mount waits for the seam it consumes.
- **Fold grant matching into `policy-enforcement`.** Rejected: grant matching is a distinct vocabulary, as `risk-taxonomy` is distinct from `policy-engine`. The policy group already keeps authority, grading and decision as separate seams that meet only at the enforcement point, and a grant store is a fourth such seam, not a change to an existing one.
- **Brand the grant id.** Deferred: the slice-1 contract uses a plain string id and there is no wire or process boundary an opaque id crosses yet. Branding belongs with the persisted cross-worker source in the third slice.
- **Make the worker view cache-free, re-reading on every authorization.** Rejected in favour of an epoch-gated re-read: it models the bounded propagation acceptance[2] describes, and because every authorization still rechecks the epoch, a revocation is seen at the next authorization regardless.

## Consequences

- B-660's twelve red-first cases pass against the library alone, with no composition boot.
- The second slice (Provider/Use) adds the provider and mounts a grant store into the permission stack once P2-07 lands; its default must be fail-closed — an empty or unreadable store returns to approval or denial, never auto-allow — and only then does the package enter the SDK runtime closure, under the runtime-closure guard.
- The third slice (Fault) replaces the in-process source with a persisted, cross-worker one and covers the revocation race and offline-worker faults of acceptance[2], and the strictest-overlap and boundary property tests of the validation clauses.
