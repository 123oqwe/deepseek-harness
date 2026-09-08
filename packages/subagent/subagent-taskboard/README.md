---
description: "Epic P5-11's producer: records every delegated subagent child as a task on the mounted taskboard, claiming it for the delegating parent at subagent/start and advancing it from the terminal stop reason at subagent/end."
kind: "package-reference"
---

# @deepseek-ai/dsh-subagent-taskboard

## Summary

`dsh-subagent-taskboard` is what creates tasks. It listens to the delegation lifecycle `@deepseek-ai/dsh-subagent` already publishes and keeps one task per delegated child on `ctx.taskStore`: claimed for the delegating parent when the child starts, advanced from the child's own terminal stop reason when it settles.

## Table of Contents

- [Why delegation is the moment](#why-delegation-is-the-moment)
- [What a task means here](#what-a-task-means-here)
- [The board records; the lease enforces](#the-board-records-the-lease-enforces)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Why delegation is the moment

P5-11 shipped a taskboard, a claim rule and a receipt rule that nothing created tasks for, so every clause about what a claim does was true of a library and of nothing this harness runs. What the epic lacked was an event to attach to — the thing P4-06 had in a message arriving and P4-07 had in a run starting.

Delegation is that event. `subagent/start` and `subagent/end` already bracket every child of both shapes, one-shot runs and continuable activations alike, and each edge carries the child's session id and the delegating parent. No new concept is introduced to give the board work: the work was already there and unrecorded.

## What a task means here

The task **is** the delegated child, and its id is the child's session id. Its owner is the parent session that delegated it, because the claim answers "who is responsible for this work" and a child does not choose to be delegated — two hosts that both resume one continuable child are two workers contending for one task, and the child is the same either way.

The receipt is the child's own terminal stop reason: `completed` submits the work, anything else fails it. It advances to `submitted` rather than `verified` because nothing checked the result — a runtime that wrote `verified` would be recording a check that never ran.

`dependsOn` is empty and stays empty. A delegation is ordered by whoever issued it, and inventing dependencies between children here would be this plugin deciding a shape the taskboard deliberately leaves to its caller.

## The board records; the lease enforces

A refused claim is logged, not acted on. Enforcement belongs to the lease: P4-07 refuses a second host at `acquire`, before its Run opens, and a board that also refused would be a second rule deciding one question — the two would disagree the first time either changed.

The two are kept consistent by existence rather than by a copied number. A claim is made only for a child that holds its Run lease, so a claim on the board means that host really owns the work, and a host that lost the race leaves the board showing the holder that won. A task carrying its own epoch beside the lease's would be a second generation for one piece of work.

## Model Experience

None, as nothing here registers a prompt, tool, or schema and no task state reaches a model request — the runtime advances tasks precisely so that a model does not have to.

#### KV Cache effect

None: no content this plugin writes enters a request, so no prefix changes.

## Known Limitations and Deferred Work

- **A claim is released at settlement, not renewed while the child runs.** A child that outlives `claimLeaseMs` has a task that looks reclaimable while it is still being driven; nothing extends the claim. Setting the lease well above the longest child a profile expects is the whole of the current answer.
- **Nothing verifies.** Every task stops at `submitted` or `failed`; `verified` is unreachable through this producer because the harness has no verifier for delegated work.
- **A receipt and its release are both lost when the host dies mid-child.** The claimed attempt is held in memory by design — a restarted host reporting work it never observed finish would be worse — so the task stays claimed until it lapses.
- No runtime invariant companion is published: this plugin owns no state beyond the in-flight attempt map, and the relation it maintains is between a lifecycle edge and a row it just wrote, which a checker would compare against itself.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether `list-children` should report task state is open. P5-11's registry names it a consumer, and a listing that showed which children are claimed, submitted or failed would be the natural read side; it would also put a board read on a path that today answers from session projections alone.

</details>
