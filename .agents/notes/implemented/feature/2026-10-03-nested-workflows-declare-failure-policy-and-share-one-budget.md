# Agent Note: A nested workflow's failure policy is declared by its parent, and one count bounds each tree of runs

Status: implemented

English | [中文](2026-10-03-nested-workflows-declare-failure-policy-and-share-one-budget.zh.md)

## Problem

BLOCKED-312 conditions [2] and [3], P4-09 acceptance[2] and [3]. Every nested start returned the literal `fail-parent`, and no request field could carry a policy, so a parent could not ask to continue past a failed child. A nested run's budget was derived from its parent's and never written back, so siblings each received the same allowance; an `agent()` start was checked only against its own worker's per-run cap; and nothing read token usage, so `maxNestedTokens` was configuration and nothing more.

## Decision

- The parent declares the policy on its call: `workflow({ name, digest, onFailure }, args)`, with `onFailure` one of `fail-parent` and `continue-parent`. The worker refuses any other value before asking the host, the host checks the value again where it crosses the thread boundary, and the engine resolves an undeclared policy to `fail-parent` in one function.
- A root run starts a tree count from its `maxTotalAgents` and the deployment's `maxNestedTokens`, and every run it nests holds the same object. The engine charges a nested run to the tree and bounds the parent's own budget by what the tree has left before the admission rules, which are unchanged. The host charges each `agent()` child to the tree and refuses one, with `agent-budget-exhausted` or `token-budget-exhausted`, when the tree is spent.
- When an in-process child settles, the host takes the tokens it spent off the tree, read from token-meter's `tokenUsage` projection: uncached input, output, cache reads and cache writes. A composition without token-meter cannot be metered; the first child to settle in a tree logs that the tree's token limit is not in effect.
- `maxNestedTokens: 0` sets no token limit. A child whose provider runs it in another process reports no usage the host can read, so a tree with a token limit refuses it once the provider has started it, and disposes it before its result reaches the script.

## Alternatives considered

- **Declare the policy in the child's definition.** The policy decides how the parent treats the failure, so it belongs to the parent's call; a definition that set it would decide for every parent that nests it.
- **Count only nested runs, or only `agent()` children.** The delegate ruled one count per tree for both, against the root run's `maxTotalAgents`.
- **Treat a composition without token-meter like a remote child and refuse every start.** Every engine test composition would need token-meter mounted; the delegate ruled to debit nothing and warn, and the shipped base mounts token-meter.
- **Refuse a remote child in every tree.** Every tree had a token limit, so remote providers could not run workflow children at all; `maxNestedTokens: 0` gives a deployment that uses one a way to run them with the token limit off.
- **Mark remote providers on the subagent seam, so the refusal comes before the start.** Every provider would change; the refusal after the start is the smaller change, and its cost is in the README.

## Consequences

- A tree's tokens are debited when a child settles, so children running at once can together spend past the limit; not overrunning a budget under concurrency is P4-10 acceptance[0].
- A tree's count lives in memory; a resumed run starts its tree again from the budget its journal recorded.
- The engine specs whose stub providers return children with no local agent set `maxNestedTokens: 0`.
- `@deepseek-ai/dsh-workflow-worker-thread` depends on `@deepseek-ai/dsh-token-meter` and `@deepseek-ai/dsh-session-projection` as peers.
