# Agent Note: A workflow tree meters its children while they run

Status: implemented

English | [中文](2026-10-04-a-workflow-tree-meters-its-children-while-they-run.zh.md)

## Problem

A workflow tree's token limit (`maxNestedTokens`) was checked only when an `agent()` child started, and a child's tokens came off the tree only when the child settled. A child running when the tree was spent kept running, so one child could spend several times the limit (B-714; P4-09 acceptance[3], must[3]).

## Decision

- The workflow host subscribes to `session/event` once a child starts under a tree token limit. Each event recorded by a running in-process child's session debits what token-meter's `tokenUsage` projection says that child spent since its previous debit.
- When a debit leaves the tree at zero or below, the run aborts its running children with `token-budget-exhausted`, and later `agent()` calls are refused as before. The settlement debit takes only what is left.
- The subscription stops when the run settles. Only `packages/workflow/workflow-worker-thread/src/host.ts` changes.

## Alternatives considered

- **Pass the remaining budget to each child as a hard limit.** Every subagent provider would have to enforce it, a change to all three roles of the subagent capability. Children running at once would each receive the whole remainder and could still overshoot it together.
- **Split the remaining budget evenly between the children allowed to run at once.** The overshoot would shrink to one response, but a tree could no longer use its full budget, and the limit would be harder to configure.

## Consequences

- A tree overshoots its limit by at most one model response per child running at that moment, because usage reaches the session only when a response ends.
- A nested run's children stop at their own next recorded usage, not at the moment another run in the tree spends the last token.
- Not covered: not overrunning a budget under concurrency is P4-10 acceptance[0].
