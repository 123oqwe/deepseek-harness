# Agent Note: An approval asked during a tool dispatch is a human wait

Status: implemented

English | [中文](2026-09-24-an-approval-asked-during-a-tool-dispatch-is-a-human-wait.zh.md)

## Problem

P4-05 must[0] asks that an approval wait be told apart from a tool wait, so that a supervisor deciding whether to reclaim a run can see that a person is being waited on. On the native dispatch path, `executeToolCalls` moves the agent to `waiting_tool` before any call of the batch runs (`packages/core/agent-loop/src/tool-calls.ts`). When a call then reached the risk gate and an operator was asked, the gate proposed `waiting_human`, which the state machine did not admit from `waiting_tool`, and discarded the refusal. An approval wait on the default path therefore read as a tool wait, and nothing reported that the transition had been refused (BLOCKED-329, found by lane A's W3 case on the shipped headless profile).

## Decision

- **The state machine admits `waiting_tool → waiting_human`.** While an operator is asked the run waits on a person, whichever wait it was in before. The gate returns the run to `running` afterwards, as it did, so the tool body runs in `running`.
- **The gate logs a refused advance.** `gateActionRisk` passes each answer of `advanceLeasedAgent` to `warnRefusedAdvance`, which warns with the tool, the state proposed and the refusal. `no-run`, the answer for a composition without a Run Service, is not logged. The action is still not refused for a lifecycle it could not record.
- **The run returns to `running` however the ask ends.** The ask sits in a `try` whose `finally` advances the run, so the run is back in `running` also when the approval service throws, and the error still reaches the caller (blind review F1, B-587). Before, a throw left the run in `waiting_human`, which holds no dispatch slot, and `agent/pre-step` refused every later step of the session.

## Alternatives considered

- **Order the native path's advances so the edge is not needed.** Not chosen: the gate runs per call inside the tool runtime, after the batch's single advance to `waiting_tool`, so this would move the dispatch advance into every call.
- **Return to `waiting_tool` after the operator answers.** Not chosen: lane A's acceptance[1] case observes the approved tool body running in `running`, which is what the gate has always done.

## Consequences

- On the native path an approved call moves the run `waiting_tool → waiting_human → running`, and the calls of the batch that run after it run in `running` rather than `waiting_tool`, as before this change.
- A refused advance at the gate, for example one refused because another host holds the run's lease, now appears in the log.
