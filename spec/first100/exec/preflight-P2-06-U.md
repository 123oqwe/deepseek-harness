# preFlight — P2-06 U (审批绑定完整规范化参数、资源与前置状态,Usage 阶段)

Written 2026-09-12 by lane B at `33bb29af3f`, branch `lane-b-p2-06`. Table first. Continues `preflight-P2-06.md`, `-C.md` and `-P.md`; none is restated.

## What U owns, stated against what C and P left

C decided what a binding IS; P made one at the ask and put what it covers in the durable log. **Neither supplies a caller.** U owns exactly two things:

1. **A dispatch path that SUPPLIES a binding when it asks**, so the approvals that gate real tool calls are bound rather than bare.
2. **A dispatch path that RE-VERIFIES that binding before execution** — must[1] — so a decision that no longer covers what is about to run refuses it.

Everything else in this epic is already decided, and a U case asserting anything else would be re-proving an earlier stage.

## The two askers, and which one is U's subject

| asker | file:line | what it asks about | binding? |
|---|---|---|---|
| the tool registry's approval gate | `packages/core/tools/src/index.ts:2246` | the tool call being dispatched — it has `exec.name`, `exec.callId` and the arguments | **yes: this is U's subject** |
| the risk gate | `packages/core/tools/src/external-effect.ts:418` | the same action, one layer out, when the risk class demands approval | **yes, and it is the one with the manifest in hand** |
| workspace trust | `packages/workspace/command-workspace-trust/src/index.ts:67` | a directory | no — nothing canonical to bind |
| agent instructions | `packages/context/agent-instructions/src/index.ts:88` | a project's instruction file | no |
| sandbox escalation | `packages/sandbox/sandbox/src/escalation.ts:173` | a command's escalation | deferred — see the open question |

**The registry's U files are `agent-loop/src/tool-calls.ts` and `user-approval/src/index.ts`.** The measurement above says the asking happens in `core/tools`, not in the agent loop: `tool-calls.ts` is where the manifest and the policy decision are made, and the approval ask is one layer in. So U will cite files outside the declared list, and the overlay reason is written with the freeze — the same shape P3-01 U needed.

## Per clause: what C/P decided, what U must build, how it fails if built wrong

| clause | already decided | U must build | how it fails if built wrong |
|---|---|---|---|
| **must[1]** re-verify digest, preconditions, token and policy version before execution | `verifyApprovalBinding` names the field that moved; `approval/bound` carries every field it compares | the dispatch path reads the recorded binding back and calls the verifier **before running the tool**, and refuses on anything but `valid` | **The failure is verifying what it just built.** A path that reconstructs the "recorded" tuple from the values it is about to run with, rather than from the log, compares a value against itself and admits every substitution. The U case must take the recorded fields from the SESSION and the present fields from the dispatch |
| **acceptance[0]** no substitution survives | the verifier refuses per field | the refusal must reach the caller as a REFUSED dispatch, not a warning | **The failure is a verified-and-ignored result.** Calling the verifier and proceeding regardless passes any test that asserts the verifier was called; the case must assert the tool did NOT run |
| **acceptance[1]** the six fields reach the decider | the binding covers them; `approval/bound` carries the non-secret ones | the `ApprovalRequestEvent` carries the six for display, and the ACP answerer projects them into `RequestPermissionRequest` | **The failure is widening the ACP guard.** `acp/src/index.ts:157` delegates when `callId === undefined`; making it answer non-tool-call asks to "reach more deciders" would put a tool-call-shaped permission request in front of a decision that is not a tool call |

## The non-tool-call path is a declared limitation, not a gap to fill

Measured: the ACP answerer returns `next()` when `request.callId === undefined` (`packages/acp/acp/src/index.ts:157`). Every ask that is not a tool call — workspace trust is the live one — therefore reaches **no ACP decider at all** today, and fails closed at `dsh-user-approval`'s own `'unavailable'`.

**So acceptance[1] is proved for the tool-call path and declared open for the other.** Widening the guard is refused for a stated reason: the ACP payload is `RequestPermissionRequest { sessionId, toolCall: { toolCallId }, options }` — it is SHAPED as a tool call, and a trust question has no `toolCallId` to put in it. Making one up would tell the decider they are approving a tool call that does not exist.

## Open, and named

1. **Whether the risk gate or the registry gate supplies the binding, or both.** They ask about the same action from two layers; two bindings for one action would break acceptance[2]'s one-to-one. The manifest is in hand at the risk gate (`external-effect.ts` has `classification` and the manifest's own append is next to it), which argues for one binding there and none at the registry gate — but the registry gate is the one with the arguments. **This is the first thing the U implementation must settle, and a case must pin whichever answer is chosen**, because "both ask, one binds" is invisible until someone counts `approval/bound` records per action.
2. **Sandbox escalation.** It asks through its own structural port with its own outcome vocabulary; whether an escalation is an action with a bindable tuple is not established here.
3. **Where the dispatch path reads the recorded binding from.** The session log is the record; whether U walks it or the service exposes a read is a U decision, and adding a service method before the dispatch path needs one would be the wired-code-with-no-caller shape this epic has already avoided twice.
