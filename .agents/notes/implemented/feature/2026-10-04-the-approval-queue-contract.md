# Agent Note: The approval queue's contract

Status: implemented

English | [中文](2026-10-04-the-approval-queue-contract.zh.md)

## Problem

Epic P2-07 asks for an approval queue that survives turns and processes: six states, a persisted request digest, policy version, actor and deadline, consumption by compare-and-swap, and no execution of an expired or revoked approval. Today `@deepseek-ai/dsh-user-approval` awaits each decision inline, nothing persists an approval outside the session log, and a crash only closes the interrupted turn's unanswered asks as `cancelled`.

## Decision

- **A contract package, `@deepseek-ai/dsh-approval-store`, first.** It declares `ctx.approvalStore` against `ApprovalStoreContract`, so every provider means the same service, as `@deepseek-ai/dsh-lease-contract` does for leases.
- **Six states and a table.** `requested` → `approved` | `denied` | `expired` | `revoked`; `approved` → `consumed` | `expired` | `revoked`; the other four are terminal. From its deadline on, a pending approval reads as `expired` and can only be marked so.
- **One revision per move.** Every write names the revision it read; the pure `applyApprovalTransition` checks tenant, revision, deadline, then the table, so racing clients leave one terminal state and a consumption happens at most once. Providers apply this function rather than re-deciding.
- **Two scopes.** A `turn` approval belongs to one tool call and is revoked when a crash ends its turn; a `run` approval belongs to a durable Run that waits for it across processes (the delegate's ruling on the build plan, 2026-10-04).
- **A SQLite provider beside it.** `./sqlite` keeps every approval in one file; each move is one `BEGIN IMMEDIATE` transaction around the read, the pure decision and the write, so two processes deciding one approval are serialized, and a file at another schema version is refused. A test-only fault hook inside each write lets a case kill the process before COMMIT and reopen.
- **Ids are the owners' brands, redeclared.** `ApprovalRequestId`, `SessionId`, `RunId`, `TenantId` and `PrincipalId` are the same brands their packages declare, so the contract depends on none of them.

## Alternatives considered

- **Put the store inside `@deepseek-ai/dsh-user-approval`.** The Run that waits, the SDK's list and decide requests and the approval service all consume it; a separate contract keeps them from depending on the asking path.
- **A version counter only in the SQLite provider.** The race and at-most-once rules would then live in one provider's SQL, and a second provider could decide them differently.

## Consequences

- The contract, its decisions and the SQLite provider are in place; no profile mounts the provider and nothing writes through yet. The mount, the Run's `waiting_for_approval` with its wake path, the write-through from user-approval and the SDK requests follow in the Use slice.
