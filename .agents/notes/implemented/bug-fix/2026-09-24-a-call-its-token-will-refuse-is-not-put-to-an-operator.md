# Agent Note: A call its capability token will refuse is not put to an operator

Status: implemented

English | [中文](2026-09-24-a-call-its-token-will-refuse-is-not-put-to-an-operator.zh.md)

## Problem

BLOCKED-330. Both dispatch paths run the risk gate before `ToolRuntime` prepares the call, and the capability-token check ran only in that preparation. A call its token would refuse therefore reached the risk gate first. When the gate asked, a person was asked to approve an action that could not run, and after the approval the call was refused anyway. On the shipped build this happens to a session whose token has expired (`sessionTokenTtlMs`, 24 hours by default, with no re-issue on expiry, BLOCKED-331), to a failed issuance, and to a child agent whose token scope lacks the tool. Lane A observed it on the shipped headless profile on both paths: a call presenting an expired token was put to the operator and then refused as expired.

## Decision

- **The token gate is one function, asked in three places.** `ToolRuntime`'s private `capabilityRefusal(input)` holds the check preparation already made: presence, expiry, revocation, verb and resource scope, with revocation read from the token provider. Preparation asks it where it always did, and the internal `ToolRuntimeScheduler` exposes it as `capabilityRefusal`.
- **Both dispatch paths ask it before their risk gate.** The native path (`agent-loop` `tool-calls.ts`) and the code-mode sub-dispatch (`ptc.ts`) ask it after the dispatch refusal and the policy decision, before the approval binding. A refusal settles the call with the result preparation would give: no approval is asked, no reservation is taken, and the tool body does not run.

## Alternatives considered

- **Move preparation, or all of it that refuses, ahead of the risk gate.** Not chosen: preparation also runs the `tools/pre-execute` waterfall and the guards, which run after the risk gate and the reservation today.
- **Pass the token to `gateActionRisk` and check it there.** Not chosen: the gate would hold a second copy of the rule for whether a scope requires a token, which lives in the registry's layers.
- **Refuse when the batch's token is minted.** Not chosen: a token is minted once per batch, and expiry and scope are decided per call.

## Consequences

- Preparation still checks the token. A token that expires while the operator decides is refused there, after the approval.
- A call collapsed by the code-mode presentation and also refused by its token is now reported as the token refusal, since the dispatch paths ask the token gate before preparation reaches the collapse.
- `ToolRuntimeScheduler` gained a member, so the tool-cordis API catalog changes, and P9-07.P is re-observed in the batch that carries this change.
- Config agents created at mount can race the token provider and present no token. No shipped profile uses `agents: [...]`, so this is recorded as an agent-loop Known Limitation.
