---
description: "Unified Principal/Tenant/Run identity for Epic P2-01: one delegation chain type, and a runtime tenant policy that refuses a cross-tenant request rather than widening it."
kind: "package-reference"
---

# @deepseek-ai/dsh-principal

English | [中文](README.zh.md)

## Summary

One identity type shared by every layer that has to answer *who is acting, for whom, and under what delegation*. `IdentityContext` carries the principal, its tenant, and the chain back to root; `assertRuntimeTenantPolicy` enforces the one rule that cannot be left to callers.

## A cross-tenant request is refused, never widened

`assertRuntimeTenantPolicy` throws when a request names a tenant the identity does not hold. It does not fall back to the identity's own tenant, because that turns a caller's mistake into a silently different — and successful — operation against the wrong customer's data.

## The chain is the identity

Delegation is part of `IdentityContext` rather than beside it. A principal that arrived through three delegations is not the same actor as the same principal acting directly, and a consumer that only sees the leaf cannot tell them apart.

## Model Experience

None, as this package exports identity types and a tenant-policy assertion only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **The chain is recorded, not verified.** Nothing here checks that a delegation was actually granted; that is the capability-token seam's (`dsh-capability-token`), and this package trusts the chain it is handed.
- **Tenant policy is the only enforced rule.** Purpose, scope and budget travel in the context but are enforced by their own consumers, so an identity alone does not bound what a caller may do.
