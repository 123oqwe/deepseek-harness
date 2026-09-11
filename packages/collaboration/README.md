---
description: "The collaboration group map: the rules several workers follow so that one item has one owner, one message has one effect, and what they learn is written down where the others can read it, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/collaboration

English | [中文](README.zh.md)

## Summary

The collaboration group is the rules more than one worker follows when they share work. Four questions, one package each at the centre: **who owns this item** (a lease whose epoch every state write presents), **has this message already had its effect** (one deduplication key, applied identically at both ends), **who takes this task** (an atomic single-winner claim), and **what did we learn** (a board of structured facts, never free prose). Two more carry the ordering: which control message is urgent, and where a workflow was when it stopped. Every package here is host-side and registers no tool; what a model observes is whether its work ran, never the coordination.

Each package's own README sits one directory down and is English-only for now, which is why the names below are not links: this page would have to claim a Chinese counterpart that does not exist.

## Table of Contents

- [Packages](#packages)
- [What is not arrived yet](#what-is-not-arrived-yet)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| `lease-contract` | Epic P4-07's authority model: work-item and epoch identities, the fencing token every state write carries, the staleness test, and the refusal | — (the Service Definition; providers live in `packages/run`) |
| `intake-dedup` | Epic P4-06's one deduplication rule — `(source, message id, epoch)` — applied by both the message bus and the subagent intake | — (a library; key derivation and one decision) |
| `taskboard` | Epic P5-11's claim decision: atomic single-winner claims with a monotonic attempt count, plus the graph check that refuses a cycle before work starts | — (the decision and store contract; the SQLite provider is `packages/run/taskboard-sqlite`) |
| `blackboard` | Epic P5-11's shared fact board: a fact is a structured value or an artifact reference, never free prose, and every fact traces to its writer | — |
| `control-priority` | Epic P5-10's one priority table, shared by the subagent control router and the agent inbox so two orderings cannot disagree | — |
| `workflow-journal` | Epic P4-08's per-step record — script digest, program counter, artifact refs — and the step-level resume it makes possible | — |

The lease is the group's load-bearing idea, and the reason several of these are contracts rather than implementations. **Authority is an epoch a store ISSUED**, never a timestamp and never a number a caller chose, so "did my claim expire" and "has someone else taken this" are the same question asked of the store rather than of a clock two hosts cannot agree on.

-----

<a id="what-is-not-arrived-yet"></a>
## What is not arrived yet

Taken from each package's own Known Limitations, because this group is unusually full of contracts whose providers or callers are elsewhere — or not yet anywhere.

- **The lease contract has no reclaim notification.** A fenced-out holder learns it lost the item only when its next write is refused.
- **`setAvailable` is a switch, not a health check.** A caller can declare a store unreachable; nothing here detects it.
- **Nothing schedules from a taskboard yet**, and **nothing sweeps a lapsed claim**: `release` frees a task immediately, a holder that simply stops does not.
- **The blackboard has no retention policy and uniform trust.** Facts accumulate; a fact from any writer is admitted on the same terms.
- **`intake-dedup` holds no state** — the seen-set is the caller's, by design, so this module has no opinion on where it lives.
- **No producer marks a `cancel` into an inbox**, so `control-priority`'s most urgent kind has no writer.
- **`workflow-journal`'s `receiptsToReconcile` has no production caller**, and its compaction has a caller but no observable saving.

-----

<a id="related-documentation"></a>
## Related documentation

- [Core subsystem](../../docs/subsystems/core.md) — the authoritative contract for `ctx.leaseStore` (sourced from `lease-contract`) and `ctx.taskStore`, and for the `Agent` fields a lease authorizes.
- [Workflow subsystem](../../docs/subsystems/workflow.md) — where the journal is read: step-level resume, and what a restarted worker reconstructs from it.
- [Subagent subsystem](../../docs/subsystems/subagent.md) — the control router that shares `control-priority`'s table with the agent inbox.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in each package's README.

The open question this group has not settled is **what a work item is**. The lease's item is a session in `@deepseek-ai/dsh-run` and a workflow run in the workflow worker, and both are right for their callers — but a Run that spans sessions would need a third kind, and then a rule for which one a write presents. `BLOCKED-196` holds that question with the measurement behind it.

The second is **how a holder learns it lost**. Today the answer is "at its next refused write", which is correct and late: a host can spend a model call on work it no longer owns before finding out. A notification would need the store to push, which the contract deliberately does not require of a provider.

</details>
