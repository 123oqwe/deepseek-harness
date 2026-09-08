# preFlight — P4-11 统一 Retry Classifier、Circuit Breaker 与 Retry Budget

Per lifecycle §1: written before any code, for delegate confirmation. Supersedes the withdrawn C attempt (§12.62), which was written without this document and hand-rolled a circuit breaker the ledger had already judged `adapt`.

Everything below is measured at `224d2ac867`, not recalled.

## make-vs-use

| package | verdict | form | note |
| --- | --- | --- | --- |
| `cockatiel` (connor4312, MIT, 4.0.0) | **ADOPT** | runtime, lands in **P** | The ledger's own row: `circuitBreaker` consecutive/sampling + halfOpen, bulkhead, timeout, fallback, `wrap()`, events. **Not currently installed** (`require.resolve('cockatiel')` → not installed), so adopting it is a real dependency addition, not a re-declaration. |
| `p-retry` | reject | — | The ledger rejects it as "redundant with llm-retry", which is the same reasoning that makes a third backoff here wrong. |
| `opossum` | optional | — | Breaker only; `cockatiel` covers it and more. |

**No hand-written circuit breaker.** The withdrawn `circuit.ts` reimplemented consecutive-failure counting, cooldown and half-open probing — all four of which `cockatiel` ships. Two breakers in one harness is the shape the user's directive forbids, and adopting later would leave both.

## The existing implementation this epic UNIFIES

`packages/llm/llm-retry/src/index.ts` already computes exponential backoff with jitter:

```
const jitter = 1 - config.jitterRatio + 2 * config.jitterRatio * random()
return Math.min(exponential * jitter, config.maxDelayMs)
```

Its jitter is **symmetric** — it may raise as well as lower, then clamps. The withdrawn `classify.ts` used subtract-only jitter, which would have been a **third** spelling of the same decision. P4-11 must reuse this one, and any change to it is a change to `llm-retry`, not a new module beside it.

## 4.4a — the layers must[1] names, counted before signing

"所有层消费同一 RunRetryBudget" is a statement about callers, so the layers are enumerated here rather than assumed. Measured across `packages/*/*/src`:

| layer | file | what it counts today |
| --- | --- | --- |
| LLM retry | `packages/llm/llm-retry/src/index.ts` | `retryable` + its own backoff/attempt loop |
| MCP client | `packages/mcp/mcp-client/src/connection.ts` | `reconnect.maxAttempts`, its own backoff |
| Message bus outbox | `packages/run/message-bus/src/outbox.ts:169` | `decideDelivery(record, nowMs, maxAttempts)` — its own dead-letter budget |
| Subagent | `packages/subagent/subagent/src` | `maxAttempts`, `retryable` |

**Four independent budgets that can multiply**, which is exactly the registry's problem statement ("多个有限 budget 可叠加"). must[1] closes only when these four account against one run total; a `RunRetryBudget` type with no consumer would satisfy the noun and not the clause, which is why must[1] is assigned to **U** and not to C.

## must[3] — the subject is P4-12's ledger, already ACCEPTED

"有副作用动作只有在 idempotency/reconciliation 保证下可重试" has a live subject: `@deepseek-ai/dsh-action-ledger`, accepted this session. The classifier must READ that ledger's reconciliation state rather than re-deciding idempotency, so the retry decision for a side-effecting action is a function of the ledger's verdict.

Frozen intent: an **unreconciled** side-effecting action is refused a retry even when its transport status is retryable. A `503` that may have charged a card is not a free retry.

## Stage split (registry requires 1–5 files per subtask)

| subtask | files | contents |
| --- | --- | --- |
| **C** | `classify.ts`, `budget.ts`, tests | The failure taxonomy and retryability, and the budget's accounting. **No `circuit.ts`** — the circuit is `cockatiel`'s, and the Definition side declares only the decision interface the Provider implements. Both remain C candidates subject to the clause-subject audit below. |
| **P** | provider module, `llm/llm/src/adapter-failure.ts`, `llm/llm/src/retry-policy.ts` | Adopts `cockatiel` behind the C-stage interface, and translates real adapter failures into the taxonomy. `Retry-After` parsing lives here, at the wire boundary. |
| **U** | `llm-retry/src/index.ts`, `mcp-client/src/connection.ts`, `message-bus/src/outbox.ts`, `subagent/src` | The four layers above consuming ONE budget. This is where must[1] and acceptance[1] close. |

## Open question for the delegate

`message-bus`'s `decideDelivery` budget is a **dead-letter** policy for durable delivery, not an LLM retry. Folding it into `RunRetryBudget` may be wrong: a run's model-retry budget and an outbox's redelivery budget answer different questions, and merging them could let a chatty outbox exhaust a run's model retries. I have not assumed either way — must[1]'s "所有层" needs a ruling on whether the outbox is one of the layers it names.

## Status

**No code written.** Awaiting confirmation of the adopt/reuse decisions and the outbox question before the C subtask begins.
