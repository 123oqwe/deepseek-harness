# Agent Note: A memory proposal held for review is listed, then approved or rejected by a person

Status: implemented

English | [中文](2026-09-26-memory-review-lifecycle.zh.md)

## Problem

P6-03's first slice let the proposal policy send a write to review — stored `pending`, withheld from recall — but nothing could act on a held proposal. A `pending` record had no way to become `active` (approved) or to be refused (rejected), and no way to be listed, so a memory the policy held would wait forever. `must[0]` also requires a proposal to state its intended use and its TTL, and the first slice checked neither: a proposal that omitted `purpose` or `validUntil` was auto-accepted as if complete. And `must[2]` — high-sensitivity defaults to a person — needs a person, specifically, to be the one who decides; nothing distinguished a user from an agent or service principal at the decision.

## Decision

`ctx.memory` gains three review verbs, on the seam and all three providers:

- **`listPending({ accessContext })`** — the `pending` proposals the access context may see, scoped and capped like `export`; a reporting channel, not retrieval.
- **`approve({ principal, scope, id })`** — `pending` → `active`.
- **`reject({ principal, scope, id })`** — `pending` → `rejected` (never active).

`must[0]` completeness is decided first in `decideProposal`: a proposal that omits `purpose`, or omits `validUntil`, is held for review. To tell an omitted TTL from a stated "no expiry", `MemoryProposeRequest.validUntil` becomes `string | null` — an explicit `null` is stated and complete; an absent key is unstated and held.

Two fail-closed rules guard the transition. Only a **user principal** decides: `MemoryRuntime.approve`/`reject` refuse an agent or service principal with `MEMORY_REVIEW_FORBIDDEN` at the seam, before the provider is reached, so a refused decision leaves the proposal `pending`. And a transition of an id the scope may not see, or that names no `pending` record, is refused — `MEMORY_RECORD_NOT_FOUND` for an unknown or out-of-scope id (indistinguishable, as `revise`/`forget` already treat them), `MEMORY_NOT_PENDING` for one already decided. `pendingViews` and `reviewTransition` are the shared bodies all three providers use.

The shipped operator entry is a `dsh memory` CLI run as the host user (a separate commit, its shape fixed by lane B's B-658), because a person must be able to approve a held proposal or `pending` never clears.

## Alternatives considered

- **Route the review through the P2-12 human-channel as a mid-run question.** Rejected: review is after-the-fact — an operator looks over the held list and decides — not a run stopping to ask. The shipped entry is a CLI the host user runs, not a `human-channel` question, per the delegate's ruling.
- **Collapse an omitted `validUntil` with an explicit `null` (treat both as open-ended).** Rejected: `must[0]` requires a *stated* TTL, and "never expires" is a decision a writer makes (`validUntil: null`), distinct from saying nothing. Collapsing them would auto-accept a proposal that stated no TTL.
- **Put the user-principal check in each provider.** Rejected: it is a seam-level authorization that holds for every provider, so it lives once in `MemoryRuntime` before the provider is reached — where `requireCompleteAccessContext` already sits — rather than being re-implemented, and possibly diverging, across three backends.

## Consequences

- A held proposal now has a complete lifecycle: list, then approve (recallable) or reject (never). `forget` with a tombstone, `export` carrying provenance and conflict status, and merge/supersede propagation to the index are the third slice.
- No package.json or lockfile change: memory already peer-depends on `dsh-principal`, whose `Principal.kind` the seam reads. The CLI operator entry, a new command package, is a separate commit.
- The policy unit fixtures now state a purpose and a TTL, because the `must[0]` rule would otherwise hold them for review; their `must[0]` coverage is explicit.
