# preFlight — P4-11 Usage stage (the layers consume ONE budget)

Per lifecycle §1: written before any code. Everything below is measured at `2c6940be62`, not recalled. must[1] and acceptance[1] close here, and the epic preFlight assigned them to U precisely because "all layers consume the same budget" is a statement about callers.

## The carrier, corrected — my first measurement was wrong in half

**Recorded because the error is the useful part.** I grepped for `ctx.runs` consumers OUTSIDE `run/run` and read the zero as "nothing creates a Run". The plugin is its own consumer: `RunPlugin` opens a Run from agent events — `run/run/src/index.ts:853` on `agent/session-start`, `:901` adopting every already-live agent at startup, with `:856`/`:859`/`:862` on `agent/disposed` / `agent/error` / `agent/pre-step` — and it is mounted in `bundle/base` (`cordis.patch.yml:563`), so it reaches every shipping profile. **Runs are created in production, one per agent session.** Searching for external consumers of a service that drives itself from events finds nothing and means nothing.

What IS zero is narrower and still true: `RunService.attachSession` — the multi-session edge, one Run spanning several sessions — has no production caller. So a Run today is 1:1 with a session, which is exactly why the budget cannot simply be "this agent's run".

| fact | state at `2c6940be62` |
| --- | --- |
| a Run per agent session | **created in production** by `RunPlugin` from `agent/session-start`, mounted in `bundle/base` |
| `Agent.runId` | already on the agent; `RunPlugin` is its sole writer, set when it opens the Run |
| `RunService.attachSession` (one Run, many sessions) | **zero production callers** |

**Carrier, ruled:** the budget is keyed by the run of the DELEGATION ROOT — follow `parentSession` to the session with none, and take that session's `RunId`. Parent and child each have their own Run (the plugin opens one per session), and the retry budget is charged to the root's. That is a real `RunId` from the first line of code rather than a stand-in, and the stacking must[1] names is blocked without inventing any producer. When `attachSession` acquires a real consumer and one Run spans a delegation tree, the key's MEANING does not change — it is still the root's run id.

## What `llm-retry` counts today, and the exact line the mutation must break

`packages/llm/llm-retry/src/index.ts:220`:

```
const retryState = ctx.sessionProjections.stateOf(agent.session, 'llmRetry') as LlmRetryState
```

Retries are counted **per session**, and `policy.maxRetries` is compared against that per-session count. This IS the defect must[1] names: a parent that spawns five children gets six independent retry allowances, and the registry's "multiple finite budgets can stack" is exactly this.

**The frozen case the delegate asked for:** a child session's nth LLM retry decrements the PARENT's budget. **The mutation that must redden it:** the child counts against its own session — which is not a hypothetical mutation but a byte-for-byte restoration of line 220, so the case is a regression test for the defect that exists now.

## Layers in scope, counted before signing

| layer | file | what it counts today | U's change |
| --- | --- | --- | --- |
| LLM retry | `llm-retry/src/index.ts:220` | its own per-session count | consult `classifyFailure` and charge `admitRetry` against the root's usage |
| MCP client | `mcp-client/src/connection.ts` | `reconnect.maxAttempts`, its own backoff, one budget per outage | charge only reconnects made FOR a run action; a background reconnect with no run attached keeps its own policy |
| message-bus outbox | `run/message-bus/src/outbox.ts` | its own dead-letter budget | **out of scope by ruling (§12.64)**, not by omission |

The outbox stays out under both readings: replaying a settlement is DELIVERY, not redoing work.

## must[3]'s Usage half: the ledger decides, and the decision must reach a caller

`classifyFailure` already refuses a side-effecting attempt whose ledger state is not `prepared` or `compensated`. At C it was proven against constructed facts. U's job is that a REAL failing tool call carrying a reserved idempotency key reaches that refusal — the frozen intent is that a `503` on an action the ledger has as `sent` is refused a retry, and the positive control beside it is that the same `503` on an action the ledger has as `prepared` IS retried, so the refusal is about the ledger state rather than about the status.

## The family, all three together

P4-11.P deferred the `circuitBreaker` family registration because P0-03 must[2] wants a consumer composition test and the capability had no consumer. U registers all three at once: the consumer (`llm-retry`, once it routes through the breaker), its composition test, and the family entry in `architecture.layers.json`. The provider README records this in both languages; the deferral is not carried in a thread.

## 4.4a, before signing

Counted at `2c6940be62`: `classifyFailure`, `admitRetry` and `spendsRetryBudget` have **0** production callers, and `ctx.circuitBreaker` has none either. Every one of those numbers must be non-zero when U is signed, and the report must name the call sites rather than assert the count.

## Status

**No code written.** Freeze entries will be recorded run-and-pasted per §12.68 once the cases exist.
