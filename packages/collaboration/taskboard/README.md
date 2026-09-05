---
description: "Task coordination for Epic P5-11: atomic single-winner claims with a monotonic attempt count, and graph validation that refuses a cycle before any work is scheduled."
kind: "package-reference"
---

# @deepseek-ai/dsh-taskboard

English | [中文](README.zh.md)

## Summary

A taskboard answers one question repeatedly under contention: *who owns this task right now?* `src/types.ts` decides a claim from caller-supplied state; `src/store.ts` performs it atomically so two workers asking at once cannot both be told yes.

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
- **Reclaim is time-based and clock-trusting.** A stale claim is reclaimed on a deadline the caller supplies; the board does not itself detect a worker that is alive but wedged.
