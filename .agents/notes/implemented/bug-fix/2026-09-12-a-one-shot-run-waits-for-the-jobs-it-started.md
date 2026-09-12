# Agent Note: A one-shot run waits for the jobs it started, on a bound a deployment chooses

Status: implemented

English | [中文](2026-09-12-a-one-shot-run-waits-for-the-jobs-it-started.zh.md)

## Problem

A one-shot run ends when its agent goes idle, and a background job is not part of that condition. The previous change made the loss visible — each abandoned job gets a `job/abandoned` event and a stderr line — but visible is not delivered. The product tells the model it will be notified when a job finishes, and in a profile whose whole purpose is to answer and exit, finishing before the job is the normal case.

Two surfaces end that way: the headless runner, which then leaves the process, and the in-process subagent driver, whose parent disposes the child right after reading its result.

## Decision

**Both surfaces wait, bounded by a config field, before they read their result.** `waitForJobsMs` on the headless bundle's `Config`, and on the two in-process subagent providers' `Config` passed down through `InProcessRunOptions` — the driver is a library and defaults nothing a deployment should choose, the same request/spec split `dsh-shell` uses. The default is 30s and `0` stays expressible, because how long a caller's wall clock may be held for work it did not ask to wait for is a deployment's question, not this code's.

**The drain observes `onJobDone`, never `jobs.wait(...)`, and this is the decision the whole change turns on.** A registered waiter makes the registry mark the job reported: `jobs-local`'s `settle` sets `reported` whenever `waiters > 0`, and `wait` marks it again on return. `reported` is exactly what the delivery path consults. Draining through `wait` would therefore have produced a run that waited correctly, recorded no abandonment, and still showed the model nothing — the precise failure the drain exists to prevent, in a shape that looks like success. An observer registers no waiter, so `tool-jobs` delivers normally.

**The set is the one live at the read point, and one deadline covers everything after it.** A completion may wake a turn that starts another job; waiting until nothing is running would let that chain extend the wait without limit. The same deadline also covers the turn a completion opened, because a run that waited for its jobs and then printed before their answer arrived waited for nothing.

**Expiry stops the wait and never the job.** Cancelling on expiry would turn a slow job into a killed one, which is what teardown does anyway; what the caller needs is to learn the work was dropped, and the existing record already says so.

**The wake budget does not apply inside the drain.** The budget bounds a self-exciting chain in a conversation — a woken turn starting the job whose completion wakes it — and a run that is already finishing starts nothing. Without the exemption a spent budget would route the drained completion to `inject`, where nothing claims it, converting one silent loss into another.

## Testing

Three units, each RED before GREEN, each mutation reddening its own case.

`tool-jobs` owns the exemption and three cases: an idle owner is woken inside the window with the budget spent; the budget is still in force outside it; only the drained owner is exempt. Ignoring the window reddens all three. A mutation that CLEARS the budget instead of bypassing it reddens only the first, and only because that case ends by checking that the pre-window spend still stands — without that tail a bypass and a reset are indistinguishable, and a drain that reset the budget would leave a conversation able to wake itself again.

Each surface has the positive and negative pair: a job that settles inside the bound records no abandonment, and a bound that expires records what it left running without killing it. Not waiting reddens the first; cancelling on expiry reddens the second.

The `wait()` suppression is not given a mutation of its own. It is two code readings, and `jobs-local` already freezes the waiter half (`resolves with the terminal snapshot when the job settles, marked reported`); a synthetic mutation here would restate a property that already has an owner.

## Alternatives considered

**A `tool-jobs` service carrying the window.** The first shape, and it does not survive the composition: two scoped `tool-jobs` mounts share one registry — there is a frozen case for exactly that — and `ctx.provide` refuses the second registration. The phase moved to `@deepseek-ai/dsh-jobs`, keyed by the Agent instance, which both surfaces and the delivery plugin already depend on. The RULE stays in `tool-jobs`: this package declares only that a run is ending, not what that means for a notice.

**Configuring `maxConsecutiveWakes` higher on one-shot profiles.** Rejected: it works around the rule instead of stating it, and a budget that ran out still routes to `inject`, so the loss returns in a different shape.

**Draining until nothing is running.** No termination argument: a completion that wakes a turn that starts a job would extend the wait indefinitely.

## Consequences

A one-shot run now takes up to `waitForJobsMs` longer when it leaves a job running. That is the point, and `0` restores the old timing exactly.

`snapshots/session/background-job-abandoned` sets the bound to 100ms. Its subject is the record, its job never settles, and at the shipped default it would hold the suite for thirty seconds to reach an identical state. Writing that override surfaced a loader detail worth knowing: a patch entry's `config` REPLACES the bundle's rather than merging into it, so the required `task` had to be re-supplied — the first attempt failed the boot with `$.task missing required value`.
