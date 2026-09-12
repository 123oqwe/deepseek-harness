# Agent Note: A run that will not wait for its background jobs says so

Status: implemented

English | [中文](2026-09-12-abandoned-background-jobs-recorded.zh.md)

## Problem

A one-shot run ends when its agent goes idle, and `whenIdle()` does not follow a background job: the job is a `jobs` record with a producer promise, owned by the agent but not driving it. Two production surfaces end that way, and both then tear down.

`packages/bundle/headless/src/index.ts` awaits `whenIdle()`, flushes, writes the result line, and calls `io.exit`. `packages/subagent/subagent-in-process-driver/src/index.ts` awaits the child's `whenIdle()`, reads the result, and the parent disposes the handle. Long-lived surfaces are different: ACP ends a turn at `whenIdle()` while the process stays up, so a late completion still reaches a later turn.

What happens next is worse than dropping the work. `cancelForTeardown` (`packages/jobs/jobs-local/src/index.ts`) sets `job.reported = true` **before** cancelling, deliberately — a disposing owner must not be woken, and a waking reporter would spend a model request per teardown layer. So the abandoned set is enumerated, marked delivered, and discarded at exactly the moment nobody can read it. A reader of the session log afterwards sees a job that was started, accepted, and reported, and no record that its output went nowhere.

The product also promises otherwise. `tool-jobs`'s system-prompt section tells the model *"You are notified in-session when a job finishes"*. In a profile whose whole purpose is to answer and exit, finishing before a background job is the normal case.

## Decision

**Record the abandoned set before the run's output is written, on both surfaces.** `recordAbandonedJobs` in the headless runner lists the agent's own jobs before `sessions.flush`, and `recordAbandonedChildJobs` in the subagent driver lists the child's before `readResult`. Each logs a `warn` naming every job that has not reached a terminal status. This is the smallest change that stops the loss being silent; it is not a fix for the loss itself, which is the drain direction the program's queue entry holds open.

**Nothing enters a model request.** An abandoned job is an operator fact about a run that has already produced its answer. The child's result in particular is the parent's model-facing output and is left alone, so no corpus moves: all five recorded scenarios that start a background job replay unchanged.

**One classification of `JobStatus`, exported from the Service Definition.** `isTerminalJobStatus` lives in `@deepseek-ai/dsh-jobs` beside the union it partitions. Before this change the same three values were listed twice inside the package group — a private function in `jobs-local` and a `Set` in the invariant companion — and the two new call sites would have made four. Both existing copies now call the export.

## Testing

Three cases in `packages/bundle/headless/tests/headless.spec.ts` and three in `packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts`. The headless cases use a stub `jobs` service, because what that file owns is whether the runner reads the set and when; the driver cases mount the real `dsh-jobs-local` and give the child a job that settles only when cancelled, which is the live-at-teardown state itself.

The ordering claim is observed rather than asserted about the source: the headless case records the warning and the `session/flush` event through one channel and asserts the warning comes first. Moving the call after the flush reddens exactly that case.

Each mutation reddens one case and leaves the rest green. Removing the driver's call reddens the case that names the job. Dropping the terminal-status filter reddens the settled-job control on each surface — which is why the driver has a settled-job case at all: its no-job control cannot detect that mutation, and a control that cannot fail is not one.

The settled-job control asserts the job actually reached `completed` before asserting no warning was recorded, so a job that had not settled in time would fail loudly instead of making the empty-warnings check vacuous.

## Alternatives considered

**A session event plus a stderr projection.** The route that would reach the caller, and it is not free: the snapshot harness defines stderr as a projection of the session log (`expect(result.stderr).toBe(stderrFromSession(log))`), so any caller-visible half of this change moves a session-derived expectation. That makes it a `SessionEventMap` member with the generated catalogs, both SDKs' expected outputs, and three scenario refreshes attached. Recorded in the queue entry for the owner to rule on rather than folded in here.

**Reporting the abandoned set in the child's `SubagentResult`.** Rejected because that value is the parent model's input: it would make a teardown fact model-visible, and change every recorded subagent scenario.

**Waiting for the jobs.** The direction that actually delivers the output, and a lifetime change to two surfaces needing a deployment-chosen bound. It is the queue entry's separate ruling, not this note's.

**Changing `cancelForTeardown`'s `reported = true`.** Left alone. That line is correct where it sits — a disposing owner must not be woken — and the record belongs earlier, in the surfaces that decide when to dispose.

## Consequences

The record reaches a logger exporter only when the exporter's threshold admits level 2; an exporter with no `levels` falls back to `INFO`, and a `warn` is filtered out. So a composition whose exporters stay at the default keeps the fact and shows it to nobody. Both package READMEs say this rather than implying the caller now sees the loss.

`@deepseek-ai/dsh-headless` and `@deepseek-ai/dsh-subagent-in-process-driver` gain `@deepseek-ai/dsh-jobs` as a peer dependency. Neither requires the service: both read it through `ctx.get('jobs')` and record nothing when a composition mounts no registry, which is a case each spec covers.
