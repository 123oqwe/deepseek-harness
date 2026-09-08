---
description: "The control-message kinds and their relative urgency for Epic P5-10: one priority table shared by the subagent control router and the agent inbox's dequeue point, so a cancel outranks a steer wherever the two arrive together."
kind: "package-reference"
---

# @deepseek-ai/dsh-control-priority

## Summary

`dsh-control-priority` holds P5-10's `ControlKind` and the one table that says which kind wins when several arrive together, plus `orderByControlPriority` over any item that carries a kind.

## Table of Contents

- [Why the table lives alone](#why-the-table-lives-alone)
- [What the table actually decides](#what-the-table-actually-decides)
- [What an item without a kind means](#what-an-item-without-a-kind-means)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Why the table lives alone

The ordering has two consumers on opposite sides of a dependency. `@deepseek-ai/dsh-subagent`'s control router decides for one child; `@deepseek-ai/dsh-agent`'s inbox decides at its claim boundary, which is where messages from every source converge — a router only ever sees what was routed through it, while `steer`, `inject` and `followup` reach an inbox directly from a user, a team, or a goal driver. `dsh-subagent` depends on `dsh-agent`, so the table cannot live in either and stay reachable from the other.

A second table would be one rule with two implementations, and the two would decide the same race differently the first time either changed.

## What the table actually decides

**Only `cancel` is promoted.** must[1]'s "each kind defines a priority" governs conflicts between control DECISIONS — two instructions that cannot both be obeyed — and a cancel is the only kind that must win one regardless of when it arrived. A stop that waited its turn behind the work it stops has not stopped anything. That is acceptance[0]: a `steer` or `continue` arriving at the same moment as a `cancel` must not depend on which the transport delivered first.

**Everything else keeps arrival order, and `inject` is the reason.** Injected content is not a decision, it is context, and moving a later-arriving instruction ahead of context that arrived before it changes what that instruction means. An earlier version of this package ranked all five kinds; measured, that reordered a `continue` ahead of an already-arrived `inject` and reversed two cases in `@deepseek-ai/dsh-experimental-agent-team`, whose expectation — the quiet context first, then the follow-up that wakes on it — is the correct reading of both messages.

Arrival order is itself the defined winner between two non-cancel kinds, supplied by the comparator's explicit index tiebreak rather than by sort stability.

## What an item without a kind means

Ordinary input is not a control message, and it is not demoted either: a prompt that arrived before a `steer` is still the earlier message. Only a cancel is promoted past it, so a stop is never queued behind a prompt.

`human-answer` carries a kind but is not promoted: it is positioned by the wait point it answers, and sorting it against unrelated traffic would move an answer away from its question.

## Model Experience

Indirectly, through the inbox batch `@deepseek-ai/dsh-agent` claims with it.

#### KV Cache effect

Reordering a batch changes the message order inside a single request's suffix. It does not rewrite an earlier prefix, so a cached prefix stays valid; the reordered tail is new content either way.

## Known Limitations and Deferred Work

- **The kind is recorded per operation, not carried on the message.** `Inbox` holds it beside the queue, keyed by message id, so nothing durable changes and a message replayed from a log arrives with no kind. A resumed session therefore claims its restored queue in arrival order.
- **No producer marks a `cancel` into an inbox.** `Agent.cancel` clears the queue rather than queueing anything, so the `cancel` promotion is exercised by the subagent router and by tests, not by an inbox in production.
- No runtime invariant companion is published: this package holds no state and observes nothing — it is one table and one pure comparator over caller-supplied values.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether a second kind should ever be promoted is open. `steer` has the strongest case — steering an in-flight turn is arguably more urgent than starting the next one — and it was promoted until §12.37, when doing so was measured to reorder a follow-up ahead of context that preceded it. Any future promotion has to answer that: which pairs it reorders, and whether the later message's meaning survives being read first.

</details>
