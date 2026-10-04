# Agent Note: Approvals go through the durable queue

Status: implemented

English | [中文](2026-10-04-approvals-go-through-the-durable-queue.zh.md)

## Problem

Epic P2-07 acceptance[1] and acceptance[2] require that an approval runs its action at most once and never after it expired or was revoked, decided by compare-and-swap. After the contract slice, `@deepseek-ai/dsh-user-approval` still decided inline and wrote nothing to `ctx.approvalStore`, and no dispatch path read it, so a grant another client revoked still ran.

## Decision

- **The approval service records every ask.** With `ctx.approvalStore` mounted, `request()` records a turn-scoped approval before `approval/asked` and records the outcome as its move: `allowed-once` approves it, `rejected` denies it, `cancelled` and `unavailable` revoke it. A move the store refuses is left as the store has it; the consumption decides whether the action runs.
- **Tenant and actor come from the session's manifest attribution.** `approvalViewerOf(session)` is `manifestAttribution(attachedIdentity(session), session.id).actor`, so an approval and the manifest of the action it covers name one tenant and principal (the delegate's ruling, 2026-10-04).
- **The dispatch consumes.** The agent loop's native call, the code-mode sub-dispatch and the public seam's direct call consume the approval their `approval/bound` record names, after `verifyRecordedApproval` and before `reserveExternalEffect` (the direct call reserves nothing). The verifier and the consumption select that record through one function. A failed consumption refuses the call with `ApprovalConsumedError`, code `ABORTED_BEFORE_DISPATCH`.
- **A missing approval fails closed.** With a store mounted, a dispatch whose approval the store does not hold for the session's tenant is refused as `not-found`.
- **An unbound ask is consumed at its decision.** An ask without a binding, such as workspace trust, has no dispatch that reads it back, so `request()` consumes its grant, and a grant that cannot be consumed then settles `cancelled` before `approval/decided` is appended.
- **A crashed turn's approvals are revoked when an agent is published.** An `agent/created` listener in the approval service revokes the turn approvals the session left requested or approved, so `agent-loop` is unchanged.

## Alternatives considered

- **Let a dispatch run when the store holds no approval.** An approval asked before the store was mounted would keep working, and so would one a tenant mismatch hides; failing closed costs one re-ask.
- **Revoke in the agent loop's resume repair.** That changes `agent-loop`; the listener reaches every agent publication from the service that owns the asks.

## Consequences

- No shipped profile mounts the store yet. The mount and snapshot refresh, then the SDK's list and decide requests, then the Run's `waiting_for_approval`, follow in later Use-slice commits.
- The revocation runs for every agent created for a session, including a new session, where it finds nothing to revoke.
