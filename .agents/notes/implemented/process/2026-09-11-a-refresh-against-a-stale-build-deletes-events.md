# Agent Note: A refresh against a stale build deletes events, and nothing fails

Status: implemented

English | [中文](2026-09-11-a-refresh-against-a-stale-build-deletes-events.zh.md)

## Problem

`f4cb4beee8` refreshed the recorded corpus for the attached host identity. It also removed every `run/task-profile` line from `snapshots/sdk/` — 34 of them, across all 16 scenarios. The refresh run exited 0. No gate was red. The corpus was committed and the damage sat in the tree until a later full-corpus replay reported all 16 SDK scenarios failing at once.

A refresh writes back whatever the run emitted. An event the run does not emit is therefore not preserved — it is deleted. The SDK lane spawns `dsh --profile sdk`, which executes built `lib/`, and at the time of that refresh `packages/run/run/lib/index.js` still predated P4-02 U's `session.append('run/task-profile', …)`; it was not rebuilt until nearly two hours later. The subprocess genuinely emitted nothing, and the write-back recorded that absence as the truth.

The lane split is what makes this checkable rather than a story. The same run **added** 90 `run/task-profile` lines to `snapshots/session/` and left `snapshots/acp/` a wash. The session lane launches from source through tsx, so it saw the new event. Only the lane running built artifacts lost it.

Two properties made it invisible:

- **A stale build is silent on the write path.** Nothing distinguishes "the product stopped emitting this event" from "the build predates the event" at write-back time; both look like a run that emitted less.
- **The lane that was damaged was never replayed back.** Refresh rewrites and passes by construction. Only a subsequent replay compares, and the lane just rewritten is exactly the one nobody re-checks.

## Decision

`assertBuiltArtifactsCurrent(packagesRoot, mode)` refuses a write-back run when any workspace package's `lib/` is older than its `src/`. Wired into the three lanes that spawn a shipped profile — `snapshots/sdk`, `snapshots/acp`, `snapshots/session` — at the site where each resolves its mode.

Three choices worth recording, because each was the difference between a guard that catches this and one that does not:

**The check is workspace-wide, not lane-local.** The artifact that deleted the events belonged to `packages/run/run`, which no SDK scenario names. A spawned profile loads the plugin graph, so any stale package in it can change what the run emits. A guard scoped to the lane's own packages would have passed.

**Per package, not tree-wide.** A partial build is the common case: one package rebuilt, its dependency not. Comparing a single newest-`src` against a single newest-`lib` across the tree hides exactly that.

**Replay stays unguarded.** Replay compares and never writes, so a stale build there produces a loud diff — which is the signal that surfaced this defect. Refusing would convert a useful failure into a setup error.

## Consequences

A refresh now fails fast with the stale packages named, instead of committing a smaller corpus. The cost is one directory walk of `packages/*/*/{src,lib}` per write-back run: 293 packages, ~5300 files, ~0.13s.

The general rule this belongs to: **a mode that writes back is only as trustworthy as the artifact it observed.** Where a test harness both produces and accepts the expected output, the thing to pin is not the comparison but the provenance of what it compared against. Stated as a working practice — after refreshing a lane, replay it; the run that rewrote the fixtures is the one run that cannot tell you they are right.
