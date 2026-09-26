# Agent Note: The host user resolves an ambiguous external effect

Status: implemented

English | [中文](2026-09-26-the-host-user-resolves-an-ambiguous-external-effect.zh.md)

## Problem

BLOCKED-311, under P4-12 acceptance[1]: an ambiguous state is not blindly retried; it enters reconciliation. The ledger refused every later attempt at an `ambiguous` key, but nothing on the shipped product could clear the entry, so a tool that threw left its key blocked for good. Lane A's A-529 red first (`tests/first100/fixtures/P4-12.reconciliation.composition.spec.ts`) observed on the shipped headless profile that no command resolved an entry.

## Decision

- **An operator command, owned by the ledger's plugin.** `@deepseek-ai/dsh-action-ledger` registers `/resolve-effect <idempotencyKey> <confirmed|compensated>` where a command registry is composed; given no arguments, it lists the caller's `ambiguous` entries.
- **Only the host user, and only their own entries.** The invoking agent must act as a `user` principal, the predicate `@deepseek-ai/dsh-workspace-trust` calls `isHostUserPrincipal`, and the key is looked up in that principal's scope. The host user is asked through the approval surface, and anything but `allowed-once` changes nothing.
- **Never back to `prepared`.** An approved resolve moves the entry to `confirmed` or `compensated`. Doing the work again is a new action with a new key.
- **The resolution is the audit record.** It holds who resolved the entry, to what, and when. The store writes it in the transaction that moves the entry, and moves only an entry that is still `ambiguous`; `entry()` returns it. A `confirmed` resolve has no provider receipt, so the entry's receipt digest is the digest of the resolution.
- **The store.** `markCompensated` joins `markAmbiguous`, `confirm` takes an optional resolution, and `listAmbiguous` reads what is waiting. Resolutions live in a table of their own, so a version 2 ledger file gains it on open without a migration.

These are the delegate's defaults of 2026-09-24 (A-312) and the contract of 2026-09-26 (first100-delegate-1a, gate3).

## Alternatives considered

- **A ledger-level `resolve` method.** The contract kept the shipped path an operator command rather than a new seam method, so the red first and the implementation follow one design.
- **Importing the command registry's and the approval service's types.** `@deepseek-ai/dsh-commands` and `@deepseek-ai/dsh-user-approval` reach this package through the agent, LLM and retry packages, so the import would be a dependency cycle. The plugin declares structural views of the two services and of the invoking agent, as `@deepseek-ai/dsh-memory` does for its proposal policy.
- **Resolution columns on the ledger table.** Existing files would need a migration or a new schema version; a separate table does not.
- **Querying the target's state.** No provider supports it (must[3]'s other half), so reconciliation is the host user's today.

## Consequences

- An `ambiguous` key leaves that state only through the host user's approved resolve; a composition without a command registry or an approval surface cannot resolve one.
- After a resolve, a reserve on the same key answers `duplicate` with the resolved state instead of the ambiguous refusal.
- A build that predates the resolution table reads the ledger as before and does not see resolutions.
- Verification: A-529 on the shipped headless profile, and `packages/action/action-ledger/tests/resolve-effect.spec.ts` for the store and every branch of the command.
