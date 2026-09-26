# Agent Note: A Run that has ended starts no further tool call, and a refused step says why

Status: implemented

English | [中文](2026-09-26-a-run-that-has-ended-starts-no-further-call-and-says-why.zh.md)

## Problem

BLOCKED-332, under P4-05 acceptance[0]. A tool call already produced in a step still ran after an earlier call of the same step advanced the Run to `failed`: the batch's dispatch guard runs once, before the calls, and `refuseNewAction` did not read the lifecycle. The next step was refused by the Run plugin's step gate, but the turn recorded a bare `blocked`, with neither the terminal state nor the reason given for the transition, and no client learned either. Lane A measured it on the shipped headless profile (A-379, run 36045150093) and wrote the red-first cases (A-380).

## Decision

- **An ended Run refuses each further call.** `refuseNewAction` in `@deepseek-ai/dsh-tools`, which is asked before every call on the native, code-mode and direct paths, also answers `run-ended` when the agent's lifecycle is terminal. It is asked after the stop and the lease, so a takeover still reads as a takeover. A refused call gets its ordered synthetic result, in words apart from a stop, a takeover and a refused lease.
- **A refused step names the ended Run.** When the Run plugin's step gate refuses a step because the lifecycle is terminal, its `reject` carries `runEnded: { state, reason? }`, and the agent loop copies it onto the turn's `blocked` end. The reason is the one given to `runs.advance` for the terminal transition, which the Run plugin keeps per agent; a terminal state admits no further transition, so the reason stays true.
- **A client reads it from the session event stream.** The SDK server forwards every session event as it is recorded (`session.event`), so the `turn/end` that carries `runEnded` reaches a client with no new channel. `session.status` carries only `idle` or `running`, and would need a new value for this one reason.
- **The format version stays 3.** Reading a generation 3 log validates the `turn/end` envelope and its turn relationships, not the members of its reason, and every reader of the reason outside the agent loop, such as the SDK clients, ACP, the Web views, the headless exit status and the subagent drivers, reads its `kind`. `runEnded` never reaches a model request.

## Alternatives considered

- **Keeping the reason on the lifecycle object.** `advanceAgentLifecycle` would return it in `next`, but the frozen P4-05.U cases compare that object exactly (`packages/core/agent/tests/lifecycle-dispatch.spec.ts`).
- **A new turn-end kind.** The session format admits new kinds without a change, but the shipped SDK client already reads a refused step as `blocked` (A-380's control), and every consumer that switches on the kind would need the new one.
- **A lifecycle event for hosts.** No host reads the lifecycle today (A-380's reading), and a channel for one host is what the corrected condition 3 rules out.
- **Raising the format version.** A bump would make a build without this change refuse a log that it reads correctly today.

## Consequences

- After a call advances its Run to `failed` or `completed`, the calls of the same batch that start later are refused as `run-ended`. A call that started in parallel before the transition is not recalled.
- A turn stopped because the Run has ended records `runEnded` with the terminal state, and with the reason when the transition was made through `runs.advance`. A terminal state reached another way, such as the plugin ending a disposed session, is named without a reason.
- A build without this change reads a log that carries `runEnded`, ignores the member, and still reads the turn as `blocked`.
- Verification: A-380 (`tests/first100/fixtures/P4-05.terminal-dispatch.composition.spec.ts` and `P4-05.terminal-sdk-client.spec.ts`), `packages/run/run/tests/ended-run.spec.ts` and `packages/core/tools/tests/dispatch-recheck.spec.ts`.
