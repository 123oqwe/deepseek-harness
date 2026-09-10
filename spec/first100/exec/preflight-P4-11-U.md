# preFlight — P4-11 Usage stage (the layers consume ONE budget)

Per lifecycle §1: written before any code. Everything below is measured at `2c6940be62`, not recalled. must[1] and acceptance[1] close here, and the epic preFlight assigned them to U precisely because "all layers consume the same budget" is a statement about callers.

## The measurement that decides the whole stage: there is no run to charge

The delegate's framing — "a parent and each child session account against the SAME run budget" — assumes a run identity the tree can name. Measured, it cannot:

| carrier | state at `2c6940be62` |
| --- | --- |
| `ctx.runs` (the Run service) | **zero production consumers outside its own package.** `ctx.runs`, `runs.create` and `runs.advance` appear nowhere in `packages/*/*/src` beyond `run/run`. Nothing in the harness creates a Run. |
| `RunService.attachSession` | **zero production callers.** The session→run edge exists and is never written, so `runsForSession` returns `[]` for every session in a shipped profile. |
| `session.header.parentSession` | **real and read in production** — `experimental/agent-team/src/roster.ts:94` and `:223` walk it today. |

So charging "the run" would require P4-11.U to also make something CREATE runs and attach sessions to them — a product decision about what a Run is for, which belongs to whoever owns the Run service, not to the retry epic. Building it here would be this program's recurring shape: an epic inventing a producer so that its own clause has a subject.

**Proposed carrier, for the delegate to confirm before code:** the budget is keyed by the ROOT of the delegation chain — the session reached by following `parentSession` until it is absent. That is the run in everything but name, it exists today, and every layer in scope can compute it from what it already holds. When Runs acquire a real producer, the key becomes the `RunId` and nothing else about this stage changes; the note will say so, so a later reader does not mistake the root session for the permanent answer.

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

## Open question for the delegate — one, and it blocks the code

The carrier above. If the answer is "wait for a real Run producer", U cannot close must[1] and the honest move is a readiness entry against whoever owns it; if it is "key by the delegation root", the stage proceeds as written. I am not choosing this one alone: it decides whether must[1] closes in this epic or is directed out of it, which is a scope ruling rather than an implementation detail.

## Status

**No code written.** Freeze entries will be recorded run-and-pasted per §12.68 once the cases exist.
