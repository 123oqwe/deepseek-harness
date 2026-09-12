# Agent Note: A run that will not wait for its background jobs says so

Status: implemented

English | [中文](2026-09-12-abandoned-background-jobs-recorded.zh.md)

## Problem

A one-shot run ends when its agent goes idle, and `whenIdle()` does not follow a background job: the job is a `jobs` record with a producer promise, owned by the agent but not driving it. Two production surfaces end that way, and both then tear down.

`packages/bundle/headless/src/index.ts` awaits `whenIdle()`, flushes, writes the result line, and calls `io.exit`. `packages/subagent/subagent-in-process-driver/src/index.ts` awaits the child's `whenIdle()`, reads the result, and the parent disposes the handle. Long-lived surfaces are different: ACP ends a turn at `whenIdle()` while the process stays up, so a late completion still reaches a later turn.

What happens next is worse than dropping the work. `cancelForTeardown` (`packages/jobs/jobs-local/src/index.ts`) sets `job.reported = true` **before** cancelling, deliberately — a disposing owner must not be woken, and a waking reporter would spend a model request per teardown layer. So the abandoned set is enumerated, marked delivered, and discarded at exactly the moment nobody can read it. A reader of the session log afterwards sees a job that was started, accepted, and reported, and no record that its output went nowhere.

The product also promises otherwise. `tool-jobs`'s system-prompt section tells the model *"You are notified in-session when a job finishes"*. In a profile whose whole purpose is to answer and exit, finishing before a background job is the normal case.

## Decision

**Record the abandoned set before the run's output is written, on both surfaces.** `recordAbandonedJobs` in the headless runner lists the agent's own jobs before `sessions.flush`, and `recordAbandonedChildJobs` in the subagent driver lists the child's before `readResult`. Each appends one `job/abandoned` session event per job that has not reached a terminal status, and logs a `warn` naming the set. This is not a fix for the loss itself, which is the drain direction the program's queue entry holds open; it is what stops the loss being silent.

**The caller learns of it, which took the session event rather than a log line.** A `warn` is level 2 and an exporter with no `levels` falls back to `INFO`, so a logger-only record keeps the fact and shows nobody. stderr is the caller's channel, and the recorded-session harness defines stderr as a projection of the session log — so a line the log cannot explain fails every scenario. The event is therefore the mechanism and the line is derived from it: `abandonedJobLine` is exported from the headless bundle and the harness calls it, so the two spellings cannot drift.

**Nothing enters a model request.** The event is appended after the turn has ended and carries no surface metadata. The child's result in particular is the parent's model-facing output and is left alone.

**The registry does not append the event; the surfaces do.** Only a surface knows a run is ending, and `cancelForTeardown` runs at fiber disposal — after the headless runner has already written its result.

**One classification of `JobStatus`, exported from the Service Definition.** `isTerminalJobStatus` lives in `@deepseek-ai/dsh-jobs` beside the union it partitions. Before this change the same three values were listed twice inside the package group — a private function in `jobs-local` and a `Set` in the invariant companion — and the two new call sites would have made four. Both existing copies now call the export.

## Testing

One new recorded scenario, `snapshots/session/background-job-abandoned`, plus three cases in `packages/bundle/headless/tests/headless.spec.ts` and three in `packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts`.

**The scenario exists because the corpus could not show this defect at all.** Measured across every `replay.override.json`: three scenarios start a background job, two bound it with `job_output(wait: true)`, and the third kills its job — and `kill()` marks the record reported before changing status. No recorded run ended with a live background job, so neither the defect nor its fix was observable. The new scenario starts two real background Bash processes in one run: one that finishes and is collected, and one that never finishes. Its fixture carries exactly one `job/abandoned` event, naming the second — the collected job's absence is the control that makes the event about liveness rather than about having started a job at all.

Two mutations on the scenario, each red for its own reason: dropping the runner's stderr write reddens the stderr projection, and dropping the append reddens the log comparison. The headless cases use a stub `jobs` service, because what that file owns is whether the runner reads the set and when; the driver cases mount the real `dsh-jobs-local` and give the child a job that settles only when cancelled, which is the live-at-teardown state itself.

The ordering claim is observed rather than asserted about the source: the headless case records the warning and the `session/flush` event through one channel and asserts the warning comes first. Moving the call after the flush reddens exactly that case.

Each mutation reddens one case and leaves the rest green. Removing the driver's call reddens the case that names the job. Dropping the terminal-status filter reddens the settled-job control on each surface — which is why the driver has a settled-job case at all: its no-job control cannot detect that mutation, and a control that cannot fail is not one.

The settled-job control asserts the job actually reached `completed` before asserting no warning was recorded, so a job that had not settled in time would fail loudly instead of making the empty-warnings check vacuous.

## Alternatives considered

**A logger record alone.** The first shape of this change, and it does not reach the caller: `warn` is filtered out by a default exporter, and in a one-shot run nothing drains the buffer before the process leaves. It is kept beside the event because an in-process observer — a host embedding the bundle — reads it without parsing a log.

**Reporting the abandoned set in the child's `SubagentResult`.** Rejected because that value is the parent model's input: it would make a teardown fact model-visible, and change every recorded subagent scenario.

**Waiting for the jobs.** The direction that actually delivers the output, and a lifetime change to two surfaces needing a deployment-chosen bound. It is the queue entry's separate ruling, not this note's.

**Changing `cancelForTeardown`'s `reported = true`.** Left alone. That line is correct where it sits — a disposing owner must not be woken — and the record belongs earlier, in the surfaces that decide when to dispose.

## Consequences

`SessionEventMap` gains a member, so `docs/persistence-catalog.md` and `packages/core/session/src/known-event-types.ts` are regenerated. No SDK expected output changes: measured, no scenario under `snapshots/sdk/` or `snapshots/acp/` ends with a live background job, and no SDK surface enumerates the event vocabulary.

The `warn` still goes out beside the event and is still filtered by a default exporter. It is a convenience for an in-process observer, not the record — the record is the event and the stderr line derived from it.

`@deepseek-ai/dsh-headless` and `@deepseek-ai/dsh-subagent-in-process-driver` gain `@deepseek-ai/dsh-jobs` as a peer dependency. Neither requires the service: both read it through `ctx.get('jobs')` and record nothing when a composition mounts no registry, which is a case each spec covers.
