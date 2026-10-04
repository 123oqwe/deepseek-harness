# Agent Note: A nested workflow does not outlive its cancelled parent

Status: implemented

English | [中文](2026-10-04-a-nested-workflow-does-not-outlive-its-cancelled-parent.zh.md)

## Problem

A cancelled workflow run cancels its nested `workflow()` runs by walking the set of nested runs it holds. A nested run joins that set only after it has started, and the host started one without checking whether the parent was already cancelled. A worker that sent a nested start after its run was cancelled, before it read the Cancel message, therefore got a nested run that nothing cancelled and that kept spending the parent's budget. The comment beside the registration said the run was registered before the start was awaited; it was registered after (B-709; P4-09 acceptance[1], blind review 1-1).

## Decision

- The host refuses a nested start when its run is cancelled, has lost its worker or has settled, with the same admission check `agent()` children already use. The refusal names the reason, and nothing is started.
- After a nested run starts and before it is registered, the host checks again. When the parent was cancelled while it was starting, the host disposes the nested run and refuses the call, so the run is neither registered nor awaited.
- The comment now states the order the code follows. Only `packages/workflow/workflow-worker-thread/src/host.ts` changes.

## Alternatives considered

- **Register the nested run before it starts.** The run exists only once the engine has started it, so there is nothing to register earlier.
- **Have the engine check the parent while it starts the nested run.** The engine's nesting port would then read the host run's cancellation state, which belongs to the host; the host check covers the same window without widening that port.

## Consequences

- A script's `workflow()` call made after its run was cancelled rejects with `nested workflow "<name>" was not started: workflow run cancelled: <reason>`.
- Not covered: a nested run in another process; nested runs start in-process today.
