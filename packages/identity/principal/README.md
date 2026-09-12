---
description: "Unified Principal/Tenant/Run identity for Epic P2-01: one delegation chain type, and a runtime tenant policy that refuses a cross-tenant request rather than widening it."
kind: "package-reference"
---

# @deepseek-ai/dsh-principal

English | [中文](README.zh.md)

## Summary

One identity type shared by every layer that has to answer *who is acting, for whom, and under what delegation*. `IdentityContext` carries the principal, its tenant, and the chain back to root; `assertRuntimeTenantPolicy` enforces the one rule that cannot be left to callers.

## Table of Contents

- [A cross-tenant request is refused, never widened](#a-cross-tenant-request-is-refused-never-widened)
- [The chain is the identity](#the-chain-is-the-identity)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## A cross-tenant request is refused, never widened

`assertRuntimeTenantPolicy` throws when a request names a tenant the identity does not hold. It does not fall back to the identity's own tenant, because that turns a caller's mistake into a silently different — and successful — operation against the wrong customer's data.

## The chain is the identity

Delegation is part of `IdentityContext` rather than beside it. A principal that arrived through three delegations is not the same actor as the same principal acting directly, and a consumer that only sees the leaf cannot tell them apart.

**Runtime invariant:** No runtime invariant companion is published: this package is a pure type contract plus pure delegation-chain functions, with no event stream or mutable module state to compare. The `adminGrantOwners` registry in `src/chain.ts` is a private unforgeability check, not a public relation.

## Model Experience

None, as this package exports identity types and a tenant-policy assertion only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **The chain is recorded, not verified.** Nothing here checks that a delegation was actually granted; that is the capability-token seam's (`dsh-capability-token`), and this package trusts the chain it is handed.
- **Tenant policy is the only enforced rule.** Purpose, scope and budget travel in the context but are enforced by their own consumers, so an identity alone does not bound what a caller may do.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Delegation depth is carried but not bounded here. A chain that grows without limit is a resource question rather than an identity one, so the ceiling belongs with whatever creates delegated agents; this package would only be able to refuse a chain after it had already been built.

</details>
