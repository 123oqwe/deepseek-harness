---
description: "The control-message kinds and their relative urgency for Epic P5-10: one priority table shared by the subagent control router and the agent inbox's dequeue point, so a cancel outranks a steer wherever the two arrive together."
kind: "package-reference"
---

# @deepseek-ai/dsh-control-priority

## Summary

`dsh-control-priority` holds P5-10's `ControlKind` and the one table that says which kind wins when several arrive together, plus `orderByControlPriority` over any item that carries a kind.

## Table of Contents

- [Why the table lives alone](#why-the-table-lives-alone)
- [What an item without a kind means](#what-an-item-without-a-kind-means)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Why the table lives alone

The ordering has two consumers on opposite sides of a dependency. `@deepseek-ai/dsh-subagent`'s control router decides for one child; `@deepseek-ai/dsh-agent`'s inbox decides at its claim boundary, which is where messages from every source converge — a router only ever sees what was routed through it, while `steer`, `inject` and `followup` reach an inbox directly from a user, a team, or a goal driver. `dsh-subagent` depends on `dsh-agent`, so the table cannot live in either and stay reachable from the other.

A second table would be one rule with two implementations, and the two would decide the same race differently the first time either changed. Measured: inverting this table reddens a case in each consumer.

`cancel` outranks everything, which is acceptance[0] — a `steer` or `continue` arriving at the same moment as a `cancel` must not depend on which the transport delivered first. The order is total across all five rather than a cancel-first special case, because two non-cancel kinds also need a defined winner, and a comparator that only knew about `cancel` would leave the rest to sort stability, which is the same scheduling dependence one level down.

## What an item without a kind means

Ordinary input is not a control message. An item whose kind is `undefined` sorts after every control message and keeps its arrival position among the others: giving it a rank would mean deciding that some user text outranks a cancel, which is a decision nobody asked for and one a priority table must not make silently.

## Model Experience

Indirectly, through the inbox batch `@deepseek-ai/dsh-agent` claims with it.

#### KV Cache effect

Reordering a batch changes the message order inside a single request's suffix. It does not rewrite an earlier prefix, so a cached prefix stays valid; the reordered tail is new content either way.

## Known Limitations and Deferred Work

- **The kind is recorded per operation, not carried on the message.** `Inbox` holds it beside the queue, keyed by message id, so nothing durable changes and a message replayed from a log arrives with no kind. A resumed session therefore claims its restored queue in arrival order.
- **No producer marks a `cancel` into an inbox.** `Agent.cancel` clears the queue rather than queueing anything, so the `cancel` rank is exercised by the subagent router and by tests, not by an inbox in production.
- No runtime invariant companion is published: this package holds no state and observes nothing — it is one table and one pure comparator over caller-supplied values.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether `continue` should outrank `steer` is unsettled. The table follows P5-10's own ordering, where steering an in-flight turn is more urgent than starting the next one; a deployment that treats a queued follow-up as the more important signal would want the opposite, and nothing here is configurable.

</details>
