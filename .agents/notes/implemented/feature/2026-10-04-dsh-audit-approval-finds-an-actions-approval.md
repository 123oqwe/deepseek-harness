# Agent Note: `dsh audit approval` finds the approval an action was decided by

Status: implemented

English | [中文](2026-10-04-dsh-audit-approval-finds-an-actions-approval.zh.md)

## Problem

P2-06 validation[2] asks that an audit query find the unique approval of an action. The session log carries what the query needs: each bound ask's `approval/bound` names the dispatch it decided about as `actionId`, and its `id` pairs it with `approval/asked` and `approval/decided`. No operator-facing command ran the query (BLOCKED-280).

## Decision

- `dsh audit approval --profile <name> <session-id> <action-id>` is a launcher verb beside `dsh memory`, run as the host user. It boots the profile, reads the stored session's log through `ctx.sessionQuery.readSession`, and prints one JSON line: `{ sessionId, actionId, approvals }`.
- `approvals` holds every approval whose `approval/bound` names the action id, in log order. Each entry carries the bound fields (`approvalId`, `action`, `digest`, `principal`, `preconditions`, `capabilityToken` and `policyVersion` when present, `expiresAtMs`), the bound event's `boundSeq`, and the joined `asked` (`seq`, `toolName`) and `decided` (`seq`, `outcome`), each `null` when the log lacks it.
- Exit codes: 0 when exactly one approval matches, 3 when none does, 4 when more than one does, 2 for a malformed lookup, 1 when the log cannot be read.
- The lookup reports what the log records. It does not apply the dispatch path's choice among several records, so it leaves `verifyRecordedApproval` untouched.
- `@deepseek-ai/dsh-session` moves from the CLI's devDependencies to its dependencies for the `SessionId` brand.

## Alternatives considered

- **An SDK or RPC method.** A protocol change, with both SDKs' expected outputs moving, for a lookup an operator runs locally.
- **An exported function only.** Not a tool an operator can run.
- **Sharing the dispatch path's record selection.** It would change accepted dispatch code to serve a report, and it would hide a log that binds one action twice, which is itself an audit finding.

## Consequences

- The verb reads only a session the chosen profile's persistence can see. `readSession` replay-validates the log, so a log a newer build wrote fails with exit 1 rather than being read partially.
- A dispatch with no binding (an ask with no tuple, or no ask) has no record to find, and the verb exits 3.
