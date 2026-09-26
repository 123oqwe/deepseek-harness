# Agent Note: After a wait, the stop and the lease are checked again before a tool runs

Status: implemented

English | [中文](2026-09-26-a-wait-is-followed-by-a-second-stop-and-lease-check.zh.md)

## Problem

BLOCKED-334; P4-07 acceptance[0], and P2-12 acceptance[0] and must[2]. The native and code-mode dispatch paths asked `refuseNewAction` once, before the risk gate. When the gate asks an operator, the wait can last minutes, and an emergency stop or another host taking the run over during it was only logged when the lifecycle could not return to `running`; the approved call then ran. Lane A's A-387 measured it: on both paths, the fence and the stop variants ran the approved tool (8 red, 2 green). Two more places ask and then act: the tool runtime's pre-execute ask, latent today, and a sandbox escalation approved inside a tool body, where lane A's A-489 showed an approved write outside the workspace running after a stop.

## Decision

- **One re-check before every tool body.** `ToolRuntime` asks `refuseNewAction` again after the pre-execute waterfall and any ask, just before it dispatches, and settles a refused call with the result `refusedDispatchResult` gives before the gate. The native loop, code mode and the public seam all pass that point, so it covers the risk gate's ask on both paths (sites 1 and 2) and the pre-execute ask (site 3). The check is synchronous and adds no wait of its own.
- **A sandbox escalation asks again after the grant.** `approveEscalation` takes a required `refusalAfterApproval(agent)` and, after an `allowed-once`, throws the text it returns before the wider sandbox runs (site 4). The bash, pwsh and fs tools answer with `refusalToAct` from `@deepseek-ai/dsh-tools`, which reports `refuseNewAction`'s refusal in the words `refusedDispatchResult` uses. `@deepseek-ai/dsh-sandbox` still imports no agent package; the tool layer supplies the answer.

## Alternatives considered

- **Refuse the call when the risk gate's return to `running` is refused.** That covers the two dispatch paths only, and ties the refusal to a lifecycle write that exists only where a lease is held; a stop without a lease would still pass.
- **Check in each tool body.** Every tool would need the check, and one that forgot it would run.
- **An optional escalation hook.** A tool that left it out would escalate after a stop; the field is required so every caller answers.

## Consequences

- An approved call whose run was stopped or taken over while the operator decided does not run, and its result names the stop or the takeover.
- Each dispatch reads the clock once more, just before the body.
- Verification: lane A's A-387 (native and code mode, fence and stop) and A-489 (site 4, an fs write), `packages/core/tools/tests/dispatch-recheck.spec.ts`, and the escalation spec of `@deepseek-ai/dsh-sandbox`. The order mutations move the re-check after the body (sites 1 to 3) and the escalation's check before the human's answer (site 4).
