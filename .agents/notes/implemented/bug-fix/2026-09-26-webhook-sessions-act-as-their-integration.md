# Agent Note: A webhook-created session acts as its integration's service principal

Status: implemented

English | [中文](2026-09-26-webhook-sessions-act-as-their-integration.zh.md)

## Problem

BLOCKED-340; P2-01 acceptance[0] requires every action to trace to a root user or tenant through the full delegation chain. `dsh-webhook` created its Agent without an identity, so an action's manifest named an anonymous actor (`anonymous:webhook-<uuid>`) and no `identity/attached` was logged. Lane A's A-421 measured it through the documented GitHub review patch on the `web` profile (run 36198814967).

## Decision

- **The integration is the principal.** The Agent acts as a `ServicePrincipal` whose id is `webhook:<kind>:<source>`. The runtime dispatches only verified deliveries, and an adapter verifies each one with the secret configured for its source, so kind and source name the integration the HMAC key stands for; `kind` keeps equal source names of two providers apart.
- **Not the provider account.** Payload fields such as the account that triggered the event are not used: the signature authenticates the integration, not that account.
- **The host user's tenant.** The principal is minted in the tenant `resolveTenantId` in `dsh-host-user-id` returns (`$DSH_TENANT`, otherwise `local`), which that package now exports. A host user who resumes a webhook-created session therefore names the tenant the session recorded, as `resolveSessionIdentity` in `dsh-agent-loop` requires.
- **One run per Agent.** Each created Agent gets a new run id and a one-hop delegation chain rooted at the principal. The session logs `identity/attached` of kind `service` once, and every action manifest names the principal as its actor.

## Alternatives considered

- **Attach the host user.** The request comes from a remote sender authenticated by HMAC, not from the machine's user (BLOCKED-291 (c)).
- **A principal per provider account, read from the payload.** Unauthenticated data would choose the actor.
- **A principal per rule.** A rule is trusted code the operator installs, not a credential; the secret that authenticated the request belongs to the source.

## Consequences

- The manifests and audit records of a webhook-created session name `webhook:<kind>:<source>` instead of an anonymous actor.
- A deployment that runs in a tenant sets `$DSH_TENANT` once, for the host user and for its webhook integrations alike.
- Verification: lane A's A-421 (`apps/cli/tests/profiles/web/tests/webhook-actor.e2e.ts`), the `dsh-webhook` session spec, and the `dsh-host-user-id` spec. The mutation M-606-1, which drops the attachment, turns A-421's case red again.
