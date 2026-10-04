# Agent Note: Token growth keeps each delegated ancestor's filter

Status: implemented

English | [中文](2026-10-04-token-growth-keeps-each-delegated-ancestor-filter.zh.md)

## Problem

BLOCKED-331's growth path in `@deepseek-ai/dsh-capability-token-file` re-derives a delegated child whose scope shows a tool its token lacks. Before re-deriving, it issued the child's parent a root covering every tool the parent could see. When the parent was itself delegated under a filter, that root replaced the filtered token: a launcher allowed only `read` held `write` once the detached run it started saw `write`, and so did the run (D8's control case, BLOCKED-363). A resumed run was issued a root the same way when a child it delegated to grew.

## Decision

- `redelegateIfNeeded` (`packages/policy/capability-token-file/src/index.ts`) computes the names a re-derivation can add: the child's visible tools its token lacks, passed through the child's filter and through the filter of every delegated ancestor. The walk ends at the first session the mount did not delegate.
- A root at the end of the walk is widened to cover the names, as before. Each delegated ancestor is then re-derived from its parent under its own filter, top down, before the child.
- A resumed (adopted) session at the end of the walk is never re-issued, so it bounds the names by what it holds.
- When no name can be added and the token has not expired, nothing is re-derived and no signature is spent.

## Alternatives considered

- **Grow only a root parent and skip growth under a delegated one.** It is one condition, but a tool the composition puts in a child's scope, such as `structured_output`, would be refused under any delegated parent even when every filter admits it.

## Consequences

- A delegated session's authority is its filter at every depth; growth can add a name only when every filter above the child admits it.
- A composed tool under a delegated parent reaches the child only when that parent's filter admits it.
