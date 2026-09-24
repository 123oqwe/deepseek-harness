# Agent Note: Overflow resends and session MCP reconnects charge the run's retry budget

Status: implemented

English | [中文](2026-09-24-overflow-resends-and-session-mcp-reconnects-charge-the-run-budget.zh.md)

## Problem

Epic P4-11 must[1] requires every layer that redoes work for a run to draw on one run budget. `ctx.runRetryUsage` (`@deepseek-ai/dsh-retry`) holds that budget, but only `llm-retry` charged it. `compaction-basic` resent a request after a provider-confirmed context overflow under its own `maxOverflowRetries`, and `mcp-client` reconnected a lost server under its own `reconnect` attempt budget. Neither asked the run budget, so a run could spend past its ceiling through either path (BLOCKED-317).

## Decision

- **`compaction-basic` charges each overflow resend.** Its `agent/request-error` listener asks `ctx.runRetryUsage` to admit the resend before it compacts, charged to the delegation root's run. A refusal logs a warning naming the budget's reason and passes the error downstream, so a run with nothing left does not pay for a summary it cannot use. Admission charges at once, so an overflow that the reduction then cannot shrink still spends one retry.
- **`mcp-client` charges each reconnect of a server mounted for one session.** A server config carries an optional, runtime-only `chargeSession`, and `dsh-acp` sets it to the ACP session for every server it mounts. Before each reconnect the supervisor asks the run budget to admit it, charged to that session's delegation root's run. A refusal unregisters the tools and stops reconnection the way an exhausted attempt budget does.
- **A reconnect charges nothing before the session holds a run.** `chargedRunFor` keeps its first answer for a session, so resolving the run before the agent holds one would exempt every later retry of that session, `llm-retry`'s included. The supervisor therefore charges only once the session's agent has a `runId`.
- **Each charging layer supplies its own delegation lookup.** `dsh-retry` stays free of the agent package, so the lookup `llm-retry` passes to `chargedRun` is repeated in the two new layers, marked for the duplication gate.

## Alternatives considered

- **Charge the reconnects of a host-level MCP server.** Not chosen: a server mounted for the whole host serves every run that uses it and belongs to none, so there is no run to charge.
- **Charge the overflow resend only after compaction succeeds.** Not chosen: a run with nothing left would still pay for a summary request it cannot use.
- **Move the delegation lookup into `dsh-retry`.** Not chosen: `dsh-retry` stays free of the agent and session packages by design (`root.ts`), so the lookup that reads the agent registry belongs to the layers that hold an agent.

## Consequences

- Plugin caps still add, and the run budget bounds their sum: with `ctx.runRetryUsage` mounted, `llm-retry`'s retries, compaction's overflow resends and a session server's reconnects stop together at the run's ceiling.
- A session-mounted MCP server whose run has spent its budget loses its tools until the plugin reloads, like a server that exhausted its own attempts.
- An overflow resend whose compaction then fails to shrink the context has still spent one retry.
- A host-level MCP server keeps only its own `reconnect` budget.
- A run's budget lasts as long as its session. A Run opens with its session and no production code forgets its usage, so what one turn spends stays spent for the session's later turns while the process lives: `llm-retry` stops retrying, an overflow resend is refused and the turn ends with the overflow error, and a session server that drops again gives up. One outage of a crash-looping server can spend the whole budget, because its default ten reconnect attempts equal the shipped `maxRetries` of ten. This fix does not manage the budget's lifetime.
