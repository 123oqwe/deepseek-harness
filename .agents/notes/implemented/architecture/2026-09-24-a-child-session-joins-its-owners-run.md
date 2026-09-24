# Agent Note: An in-process child session joins the Run of the agent that owns it

Status: implemented

English | [中文](2026-09-24-a-child-session-joins-its-owners-run.zh.md)

## Problem

P4-01 acceptance[2] says one Run can span several sessions, and the user decided on 2026-09-24 that it is implemented as written, not narrowed. `RunService.attachSession` existed, was durable and was tested, but no production path called it: `RunPlugin` opened one Run per session and passed that one session to `openForSession`, so every Run's `sessionIds` held a single id (BLOCKED-309). The deferral was deliberate (BLOCKED-196). The lease's work item is the session, not the Run (§12.35-2), and `attachSession` presents no lease. A Run that two sessions wrote to could therefore have two authorities: two hosts, each validly holding one of the two sessions' leases.

## Decision

- **A child joins as a member.** When `RunPlugin` opens a session, it looks for the live agent the registry records as the session's owner (`AgentRegistry.isOwnedBy`). If the owner has a Run, `attachSession` adds the child to that Run's `sessionIds`. The child keeps its own Run, lease, lifecycle, heartbeat and terminal write; nothing about them changes.
- **The owner's lease is the one authority over the owner's Run.** Only two paths give an agent `runId === R`: minting R, and adopting it on a restart. `adoptable` now offers a session only the Runs it opened (`sessionIds[0]`), never one it joined, so every writer of R holds the lease of the session that opened R. The join itself is written only while the owner's lease still admits writes (`mayWrite`), so a host that lost the owner's lease cannot add members.
- **The two closing conditions are rewritten, not met by a Run-level work item.** BLOCKED-196 asked for "the shape of a Run-level work item", and BLOCKED-309 route 1 for "one authority (a Run-level work item)". Both now read "one authority: the lease of the session that opened the Run; joiners are members". The delegate ruled this in `approved/P4-01.md` ("裁法甲"). Both conditions are the delegate's own rulings, so rewriting them is not a narrowing of a registry clause.

## Alternatives considered

- **A child shares its owner's Run (`child.runId = owner.runId`).** Not chosen: the heartbeat, `awaitingFirstStep` and the failure ledger are keyed by Run and would have to move to per agent, `finish` would have to stop ending a shared Run, and the child would write R under its own lease, which is the two-authority case itself.
- **Decide membership by durable lineage (`header.parentSession`).** Not chosen: a gateway fork and a detached workflow session also carry a parent session, and both are by design a new run. The runtime owner excludes them.
- **A Run-level work item, replacing or composed with the session item.** Not chosen: Replace reverses §12.35-2 and is a user decision, and Compose needs a holder of two leases, which does not exist.

## Consequences

- An owned child's session is in two Runs: its own, and its owner's, as a member. The owner's Run log gains no event for the join or for anything the child does; membership is read from `sessionIds`.
- A grandchild joins its direct owner's Run, not the root's, so nested delegation forms a chain of Runs.
- Detached workflow sessions, gateway forks, every root session, and out-of-process subagents join no Run.
- The join is checked against the owner's lease when the child opens, not in the Run's serialized turn as `advance` checks its fence. A lease lost between that check and the write can still admit one join.
- A join write that fails is announced through `run/store-write-failed`, like every other tracked write, and is not retried. Nothing in production consumes that event yet (BLOCKED-295).
- The two frozen absence cases (`restart.spec.ts` and `plugin.spec.ts`) still pass, because they create only root sessions, but their titles no longer describe the product.
