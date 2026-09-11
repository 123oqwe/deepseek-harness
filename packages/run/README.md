---
description: "The run group map: the Run a harness session does its work inside, the lease that says who owns it, the task profile it was planned from, and the durable stores behind message handoff and task claiming, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/run

English | [中文](README.zh.md)

## Summary

The run group answers four questions about one unit of harness work: what it *is* (a Run, with a closed lifecycle and an append-only event log), who *owns* it right now (a lease whose epoch every state write presents), what it was *asked for* (a compiled task profile traceable back to the user's goal), and how work and messages survive a process that dies (durable stores for claimed tasks and for committed-but-undelivered messages). The group is optional and host-side only: it registers no tools, injects no prompts, and nothing here reaches a model request — what a model observes is whether its turn ran, never the bookkeeping. Mount it when more than one host may contend for the same work, or when a crash must not lose or double an effect; a single-process composition can omit the whole group.

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
| `run` | The Run's ten-state lifecycle, its append-only event log, the durable registry, and the mounted plugin that opens a Run per agent session | `ctx.runs` |
| `task-profile` | The generic compiled task profile: the goal reference, constraints carrying their own source and confidence, and the questions a compile asked instead of guessing | — (a library; one pure compiler function) |
| `lease` | The authority model — a per-work-item epoch, the fencing token every state write presents, and the reclaim test — plus the in-memory provider | `ctx.leaseStore` |
| `lease-sqlite` | The durable lease provider: acquisition serialized by `BEGIN IMMEDIATE`, so two processes racing for one work item cannot both hold it | `ctx.leaseStore` |
| `message-bus` | Effective-once effect handoff: an outbox so a committed message is never lost, an inbox so a lost acknowledgement costs no second effect, and directed mailbox delivery | — (record states and decision functions) |
| `taskboard-sqlite` | The durable taskboard: claims serialized by `BEGIN IMMEDIATE`, so two processes contending for one task cannot both hold it | `ctx.taskStore` |

Each package's own README sits one directory down and is English-only for now, which is why the names above are not links: this page would have to claim a Chinese counterpart that does not exist.

The lease is the group's load-bearing idea and the reason the two SQLite packages look alike. Authority is an **epoch a store issued**, never a timestamp and never a number a caller chose, so "did my lease expire?" and "has someone else taken this?" are the same question asked of the store rather than of a clock two hosts cannot agree on.

-----

<a id="what-is-not-arrived-yet"></a>
## What is not arrived yet

Recorded here because the group's READMEs describe contracts that are in places only partly reached from production, and a reader comparing the prose to a running system should know which is which.

- **A Run occupies two states in production, not ten.** `ctx.runs` opens a Run at `accepted` and the one transition a mounted plugin drives is `accepted → planning`, which names the task profile compiled for the agent's first model step. The transitions onward to a terminal state are implemented and refused-when-illegal, and are reached by no production caller yet.
- **Workflow executions are not referenced in a Run's log.** The brands such a reference needs are reconciled; no listener appends one.
- **Nothing reads a task profile back.** It is compiled, appended to the session log, and named in the Run's transition; putting it into a model request belongs to a later epic, which is why its validation exists before its reader does.

-----

<a id="related-documentation"></a>
## Related documentation

- [Core subsystem](../../docs/subsystems/core.md) — the authoritative contract for `ctx.runs` and for the `Agent` fields the Run Service is the sole writer of (`runId`, `lifecycle`, `runLease`, `leaseRefused`, `taskProfile`).
- [Persistence catalog](../../docs/persistence-catalog.md) — the durable session events this group writes, `run/task-profile` among them.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in each package's README.

The open question the group has not settled is **where a Run's event log lives**. `run` keeps it in its own store document, referenced from nothing in the session log; `task-profile` puts a profile's BODY in the session log and has the Run's log reference it by digest. Both answers are defensible and the group currently holds one of each. What makes that coherent rather than accidental is the ownership test — a profile is compiled from a message in one session's log and means nothing outside it, while a Run spans sessions — but the test is stated here and not in a decision record.

The second is **whether a Run may span sessions in practice**. The type surface says one Run can carry many sessions and the registry has the operation for it; the mounted plugin mints a fresh Run per session and never calls it, so a subagent today gets its own Run rather than joining its parent's. Whether that is the right product answer or an unfinished seam is not decided.

</details>
