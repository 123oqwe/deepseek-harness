---
description: "Secret-lease vocabulary and state machine for Epic P3-06: what a CredentialRef resolves to, which principal, action and world a grant is bound to, and the four states a lease can be in."
kind: "package-reference"
---

# @deepseek-ai/dsh-secrets-broker

English | [中文](README.zh.md)

## Summary

A `CredentialRef` names a stored credential. A `SecretLease` is what that ref resolves to for one use: a grant bound to a `Principal`, an `ActionId`, a `WorldId`, a recorded purpose and an expiry instant. `decideRedemption` answers whether a lease may be redeemed now, returning the credential or one closed reason it refused.

## Table of Contents

- [What a lease binds](#what-a-lease-binds)
- [Expiry is a fact about the clock](#expiry-is-a-fact-about-the-clock)
- [Use revokes, and a stopped world revokes](#use-revokes-and-a-stopped-world-revokes)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## What a lease binds

All five bindings are must[0]'s literal list, and each names an existing subject: `Principal` from `dsh-principal`, `ActionId` from `dsh-action-manifest`, `WorldId` from `dsh-execution-world`. A second vocabulary for the same facts would let two parts of the system disagree about which action a lease is for.

Expiry is tested before the bindings. An expired lease refuses for being expired whoever presents it, so a refusal cannot tell a caller that some other principal would have matched — a fact about a grant they no longer hold.

## Expiry is a fact about the clock

`effectiveState` reads a stored `issued` record as `expired` once `expiresAt` has passed, with no sweeper having run. That is what makes an expired lease unusable on the replay path, where by definition nothing swept. The comparison is `>=`, so the recorded instant is the first unusable one rather than the last usable one.

## Use revokes, and a stopped world revokes

`afterRedemption` returns the record in `redeemed`, so the same lease presented again refuses (must[2]). A stopped world ends every grant inside it whatever each lease's own expiry says — `revokeWorldLeases` is that cascade, as a pure function of the records and the world id.

A terminal state is never rewritten. The first reason a lease stopped being usable is the one an audit keeps.

## Model Experience

No model-visible surface. This package decides; it renders nothing and adds no tool, prompt or session event. No tokens are spent on its behalf and it does not participate in the KV cache.

## Known Limitations and Deferred Work

- **must[1], brokered injection, is not modelled.** A secret reaching a world without the ambient environment requires `WorldSecretsSpec.posture: 'broker-only'`, which `execution-world/src/local-provider.ts` refuses: only a separate address space can keep that promise. The transport waits on that shape; this package is the grant.
- **acceptance[1]'s leak surfaces are not covered here.** Whether a secret stays out of stdout/stderr, crash dumps and the session log is a property of the writers, not of the lease. The session-log limb in particular has no redaction seam on this tree — `session-telemetry`'s waterfall covers records sent to a backend and ships no rules.
- **No lease store.** Records are values; nothing here persists or indexes them. Which component owns lease durability is undecided, and a store written before the transport is chosen would likely be rebuilt with it.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether `purpose` should stay free text is undecided. It is recorded for audit and never matched on, which is what keeps the broker from having to enumerate every legitimate reason a deployment reads a credential; a closed list would either grow without bound or push callers to misuse its nearest member. If a later stage wants to *decide* on purpose rather than record it, that choice has to be made deliberately.

The delegation model overlaps P2-02's capability token, which already narrows a child's resources to a subset of its parent's. Whether a lease should delegate through that mechanism or grow its own is open; building a second one without deciding would be the duplicate vocabulary this package was careful to avoid elsewhere.

</details>
