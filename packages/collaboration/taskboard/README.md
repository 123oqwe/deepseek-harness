---
description: "Task coordination for Epic P5-11: atomic single-winner claims with a monotonic attempt count, and graph validation that refuses a cycle before any work is scheduled."
kind: "package-reference"
---

# @deepseek-ai/dsh-taskboard

English | [中文](README.zh.md)

## Summary

A taskboard answers one question repeatedly under contention: *who owns this task right now?* `src/types.ts` decides a claim from caller-supplied state; `src/store.ts` performs it atomically so two workers asking at once cannot both be told yes.

## Table of Contents

- [One winner, and a count that survives losing](#one-winner-and-a-count-that-survives-losing)
- [A cycle is refused before scheduling, not during](#a-cycle-is-refused-before-scheduling-not-during)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## One winner, and a count that survives losing

`decideClaim` increments the attempt count on every claim, won or lost. A count that only advanced on success would report a task as cheap while a dozen workers fought over it, and the retry budget that reads the count would never fire.

The claim is atomic at the store, not at the decision: deciding is pure and repeatable, so two callers can decide identically and only the store can settle which one actually holds the task.

## A cycle is refused before scheduling, not during

`validateTaskGraph` rejects a dependency cycle when the graph is submitted. Detecting it later — when a worker waits forever on a task waiting on it — produces a hang rather than an error, and a hang has no message to act on.

## Model Experience

None, as this package exports claim and graph decisions, an atomic store, and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **Nothing schedules from a board yet.** These are the claim decision, the atomic store and the graph check; the worker pool that consumes them is a later epic's.
- **Nothing sweeps a lapsed claim.** A holder that gives its claim back with `release` frees the task immediately; a holder that vanishes leaves it owned until its lease elapses, and only the next claim attempt notices.
- **Reclaim is time-based and clock-trusting.** A stale claim is reclaimed on a deadline the caller supplies; the board does not itself detect a worker that is alive but wedged.
- No runtime invariant companion is published: this package decides, and the relation a claim maintains is owned by whichever store applies the decision — `@deepseek-ai/dsh-taskboard-sqlite` enforces it inside one transaction, where a checker would compare a value against itself.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

The attempt count is monotonic per task, not per worker, so it answers "how contended is this?" and not "how many times did THIS worker try?". A retry policy that wants the latter needs a per-worker counter the board does not currently keep, and adding one would make the claim decision stateful per caller.

</details>
