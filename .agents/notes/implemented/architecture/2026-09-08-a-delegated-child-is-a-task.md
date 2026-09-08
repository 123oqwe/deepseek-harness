# Agent Note: A delegated subagent child is a task on the board

Status: implemented

## Problem

`@deepseek-ai/dsh-taskboard` shipped a task record, an atomic claim, a receipt rule and a graph validator; `@deepseek-ai/dsh-taskboard-sqlite` shipped a durable store that serializes claims across processes. Nothing in the harness created a task. Measured across `git ls-files`, excluding the owning packages and every test path, `decideClaim`, `validateTaskGraph` and `openTaskStore` each had zero production callers, so every statement about what a claim or a receipt does was true of a library and of nothing this harness runs.

The gap was not a missing wire. Comparable capabilities each had a moment to attach a rule to — a message arriving, a run starting, a workflow step settling, a tool call dispatching an external effect — and their consumers were written by connecting an existing event to an existing decision. The taskboard had no such moment, because nothing here submits a task graph or claims a task, so there was no producer to connect and its declared consumer had nothing to consume.

## Decision

**A task is a delegated subagent child.** `SubagentRuntime` already publishes `subagent/start` and `subagent/end` around every child of both shapes — one-shot runs and continuable activations, cold resumes included — and each edge carries the child's session id and the delegating parent. Every field the task record requires is already present at those two points, so the board gets real work without a new product concept: the task id is the child's session id, the owner is the parent session that delegated it, the attempt is the claim the activation was granted, and the receipt is the child's own terminal stop reason.

**The owner is the parent, not the child.** A claim answers who is responsible for the work, and a child does not choose to be delegated. Two hosts that both resume one continuable child are two workers contending for one task; the child is the same either way.

**A completed child submits; it does not verify.** Nothing checks a delegated result, so the receipt advances to `submitted`, and `verified` stays unreachable through this producer. Writing `verified` would record a check that never ran.

**A claim can be given back, and the producer gives it back at settlement.** The contract gained `release`, fenced by the attempt exactly as a receipt is: a holder whose claim lapsed and was reclaimed can still finish and try to release, and accepting that would strip the new holder's claim on the say-so of a worker that no longer has one. Without a release, expiry alone cannot separate "the holder is gone" from "the holder finished and is starting again", so a host delegating the same child twice would have been refused by its own finished attempt until the lease elapsed. A release returns a task to `open` only from `claimed`; work already submitted keeps that status and merely loses its owner, because a holder letting go does not un-submit its work.

**The board records; it does not gate.** A refused claim is logged and the child still starts. That is now a decision about behaviour rather than a missing mechanism — refusing to start a child is a real failure a caller sees, and nobody has ruled that a contended board should stop a delegation.

**The producer is its own package.** `@deepseek-ai/dsh-subagent-taskboard` rather than an edit to `SubagentRuntime`, because the claim lease is a deployment-varying setting — a profile whose children are one-shot tool calls and one whose children run for an hour need different answers — and `SubagentRuntime` carries no configuration to hold one.

**The board is published as a service.** `@deepseek-ai/dsh-taskboard-sqlite` gained the Cordis plugin that mounts it as `ctx.taskStore`, mirroring the durable lease store including opening the database in `Service.init`. Without it every consumer would call `openTaskStore` and decide for its callers where tasks live — and that directory is the whole of the multi-process property, since two hosts contend only when a profile pointed them at one board.

**The listing reads the board.** `list-children` attaches each child's task status, through `ctx.get('taskStore')` rather than a declared injection so enumeration keeps working on a profile that coordinates nothing. The two answers can disagree, and that is the value: the session record says whether a child is resident, and only the board says whether the runtime recorded its work as submitted or failed.

## Consequences

The base bundle mounts the board under the session storage root and the producer above it, so a shipped profile now creates tasks. Every claim rule, receipt rule and transition table in the taskboard is exercised by real delegations rather than only by its own tests.

A task outlives the child's activation and is never removed, so the board grows with one row per child ever delegated under that root; nothing prunes it. A host that dies mid-child leaves a claimed task until the lease lapses, which is deliberate — the claimed attempt is held in memory precisely so a restarted host cannot report work it never observed finish, and the release is lost with it.

Nothing renews a claim while its child runs, so a child outliving `claimLeaseMs` has a task that looks reclaimable while it is still being driven. Setting the lease well above the longest expected child is the whole of the current answer.

`SubagentListEntry` gained an optional `taskStatus`, which the remote catalog projects. It is absent both when no board is mounted and for any child delegated before one was, because an unrecorded child is not the same as one recorded as open.

## Alternatives considered

- **A task per workflow step.** The workflow journal already records step starts, settlements and receipts; a task per `agent()` call would have reused an existing producer, but it would also be a second durable record of one thing.
- **Gating activation on the claim.** It was unavailable before `release` existed, because without one it refuses the legitimate second delegation as readily as the contended one. It is available now and still not taken: that is a decision about what a contended board should do to a caller, which is not a wiring question.
- **Renewing the claim while the child runs** instead of sizing the lease to outlast it. The lease capability already does exactly this and the taskboard would be reimplementing it; the two would then be two generations for one piece of work.
- **Leaving the primitives unadopted.** Honest, and it says plainly that the capability ships three libraries the harness does not use. Delegation was already the work the board describes; not recording it was the defect.
