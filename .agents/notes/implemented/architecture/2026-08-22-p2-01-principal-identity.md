# P2-01: Unified Principal/Tenant/Run/Actor Identity Context

## Problem
Session/Agent IDs identify a session but cannot express user, organization, service account, sub-agent delegation chains, or cross-process identity.

## Contract
- Principal kinds: user, service, agent, anonymous-dev
- Delegation chain traces root -> current actor
- Tenant boundary enforced: cross-tenant delegation rejected
- Forged agent ID detection: agent must appear in chain
- Token replay detection: used tokens throw on reuse
- anonymous-dev is restricted, not equivalent to admin

## Failure Semantics
- Cross-tenant delegation: TenantBoundaryError
- Forged agent ID: ForgedAgentIdError
- Replayed token: ReplayedTokenError

## Compatibility
- New package: @deepseek-ai/dsh-principal under packages/identity/
- No existing packages modified
