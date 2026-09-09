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

## `Retry-After` already has a parser — I missed it, §12.64 caught it

My first draft assigned `Retry-After` parsing to the P stage "at the wire boundary", which would have been a SECOND implementation. Measured after §12.64 named it:

`providerRetryAfterMs` (`packages/llm/llm-deepseek/src/adapter.ts:311`) already handles both wire forms — a delta-seconds integer and an HTTP-date — and returns `undefined` for a non-positive or unparseable value. It is **module-private**, and its result is carried on `LlmError.providerRetryAfterMs`, a field the LLM service already validates (`llm/tests/service.spec.ts:1231` pins that it rejects `NaN`).

So the P stage **lifts** that function to where both providers can reach it and consumes the existing `LlmError` field. It does not write a parser, and `backoffDelayMs` takes the already-parsed milliseconds rather than a header string.

The reason I missed it is worth recording, because it is the same shape as the withdrawn `circuit.ts`: I searched `jitter|backoff|delay` and retry keywords and never searched `retryAfter`, then declared the tree needed new code. **Before claiming the tree lacks something, search by the problem domain and not only by the name I would have given it.**

## 4.4a — the layers must[1] names, counted before signing

"所有层消费同一 RunRetryBudget" is a statement about callers, so the layers are enumerated here rather than assumed. Measured across `packages/*/*/src`:

| layer | file | what it counts today |
| --- | --- | --- |
| LLM retry | `packages/llm/llm-retry/src/index.ts` | `retryable` + its own backoff/attempt loop |
| MCP client | `packages/mcp/mcp-client/src/connection.ts` | `reconnect.maxAttempts`, its own backoff |
| Message bus outbox | `packages/run/message-bus/src/outbox.ts:173` | `record.attempts >= maxAttempts` — its own dead-letter budget |

**Three independent budgets that can multiply**, which is the registry's problem statement ("多个有限 budget 可叠加"). must[1] closes only when the layers in scope account against one run total; a `RunRetryBudget` type with no consumer would satisfy the noun and not the clause, which is why must[1] is assigned to **U** and not to C.

**A fourth row said `Subagent` and was wrong; the correction is the useful part.** `packages/subagent`'s only `maxAttempts` is `settlement-outbox.ts:153`, and it counts nothing itself — `:158` calls `decideDelivery`, the outbox policy ruled out below — while the taskboard's `attempt` is an activation epoch, not a retry counter. So there is no subagent retry budget to unify.

**Ruling: a subagent is an ATTRIBUTION RULE, not a layer.** A child session's own `llm-retry` attempts are charged to the run that spawned it. Parent retries multiplied by child-session retries is precisely what must[1] exists to stop, and that multiplication happens inside `llm-retry` — at the moment each session counts its own — not in any subagent module. So the in-scope list reads: `llm-retry` for the parent AND every child session, all charged to one run budget; `mcp-client` for reconnects and calls made FOR a run action. The outbox stays out: replaying a settlement is DELIVERY, not redoing work, and it spends a message budget rather than a run's. There is no tension with the scope ruling below — the outbox is out under both readings.

**U-stage frozen intent, recorded before the code:** a child session's nth LLM retry decrements the PARENT run's `RunRetryBudget`. The mutation that must redden it is "the child counts against its own session", because that is the shape the bug takes.

**Scope ruling (§12.64), recorded as a clause-scope decision rather than a deviation.** The message-bus outbox is **NOT** one of the layers must[1] names. `decideDelivery` is a per-MESSAGE dead-letter policy belonging to the accepted P4-06, and it answers "when do we stop trying to deliver this message", not "how much may this run spend redoing failed work". Folding it in would let a chatty outbox exhaust a run's model retries, and would change an accepted epic's semantics from outside it. The layers in scope are: LLM retry, MCP retries taken FOR a run action, subagent attempts made on behalf of a parent run, and any tool/web retry the tree holds. A background reconnect with no run attached spends no run budget and keeps its own `cockatiel` policy.

**hedge exclusion is split under §12.46-B.** The tree has no hedging producer; hedging belongs to P5-04 (with P5-02). P4-11 owns the RULE half — the decision layer defines and freezes that a hedged attempt does not stack retries and is counted once against the budget — and P5-04 owns the producer half. A readiness BLOCKED entry is recorded for P5-04 now, in the BLOCKED-159 form, so that the requirement "a hedged attempt must be tagged such that P4-11's rule fires" is on record before P5-04 starts rather than discovered by it.

## must[3] — the subject is P4-12's ledger, already ACCEPTED

"有副作用动作只有在 idempotency/reconciliation 保证下可重试" has a live subject: `@deepseek-ai/dsh-action-ledger`, accepted this session. The classifier must READ that ledger's reconciliation state rather than re-deciding idempotency, so the retry decision for a side-effecting action is a function of the ledger's verdict.

Frozen intent: an **unreconciled** side-effecting action is refused a retry even when its transport status is retryable. A `503` that may have charged a card is not a free retry.

## Stage split (registry requires 1–5 files per subtask)

| subtask | files | contents |
| --- | --- | --- |
| **C** | `classify.ts`, `budget.ts`, tests | The failure taxonomy and retryability, and the budget's accounting. **No `circuit.ts`** — the circuit is `cockatiel`'s, and the Definition side declares only the decision interface the Provider implements. Both remain C candidates subject to the clause-subject audit below. |
| **P** | provider module, `llm/llm/src/adapter-failure.ts`, `llm/llm/src/retry-policy.ts` | Adopts `cockatiel` behind the C-stage interface, and translates real adapter failures into the taxonomy. **Lifts** the existing `providerRetryAfterMs` rather than writing a parser. |
| **U** | `llm-retry/src/index.ts`, `mcp-client/src/connection.ts`, `subagent/src` | The in-scope layers consuming ONE budget. `message-bus/src/outbox.ts` is NOT here — §12.64 ruled the outbox out of must[1]'s scope. This is where must[1] and acceptance[1] close. |

## Rulings received (§12.64)

Every question this document opened has been answered, and the answers are folded in above rather than left as a list: `cockatiel` ADOPT with no `circuit.ts`; `llm-retry`'s symmetric jitter kept as-is, because symmetric jitter is legitimate jitter and the epic's job is to make it consume the shared classifier and budget; `providerRetryAfterMs` lifted rather than rewritten; the outbox ruled OUT of must[1]'s scope; hedge split under §12.46-B with P5-04 carrying the producer half.

## Status

**No code written yet.** The C subtask is `classify.ts` + `budget.ts` + tests, with no `circuit.ts`, and may begin once the `detached` preFlight is with the delegate (§12.64 ordering).

## P stage: what is written, and what is NOT (recorded before the code)

**Measured落点, so the stage does not invent a home:** `packages/reliability/retry/src/` today holds `classify.ts`, `budget.ts` and `index.ts` (the C stage), exporting `classifyFailure` / `spendsRetryBudget` / `admitRetry` / `NO_RETRIES_USED` and their types. `providerRetryAfterMs` already exists at `packages/llm/llm/src/adapter-failure.ts:70` and is parsed there — the P stage LIFTS that value into the taxonomy rather than writing a second parser, which was the §12.64 ruling.

**The provider module adopts `cockatiel` behind the C-stage interface.** It owns exactly three things:

1. The circuit itself — `circuitBreaker` with a consecutive or sampling strategy, `halfOpen`, and the bulkhead/timeout policies `cockatiel` ships. **No `circuit.ts`.** The withdrawn one reimplemented consecutive-failure counting, cooldown and half-open probing, all four of which `cockatiel` has; two breakers in one harness is the duplication the adopt decision exists to prevent, and `clause-subject-audit.json` now records the adoption with `landsIn: P4-11.P`.
2. Translation of real adapter failures into `FailureFacts`, so `classifyFailure` decides on facts the provider observed rather than on strings it re-parsed.
3. Nothing about backoff. `llm-retry`'s existing exponential backoff with symmetric jitter is the one spelling; changing it is a change to `llm-retry`, never a new module beside it.

**The dependency is added in this stage, not earlier.** `cockatiel` is verified absent today (`require.resolve` fails), so the P stage's diff includes the `package.json` entry and the lockfile. A C stage that had added it would have declared a dependency nothing imported.

**Case to freeze for P (mutation run→pasted, never predicted):** an adapter failure the taxonomy calls retryable, repeated past the breaker's threshold, must open the circuit and stop spending the run's budget — and the mutation that removes the breaker's `halfOpen` transition must redden the case that proves a recovered provider is retried again. A case that only asserts `cockatiel` was imported would pass against a breaker wired to nothing, which is the shape this epic was withdrawn-adjacent to twice.

## Status of the P stage

**No code written.** The C stage is GREEN; the adopt disposition is recorded in `clause-subject-audit.json` with `landsIn: P4-11.P`, so the gate that checks pending adoptions will bite if P is accepted without the dependency actually landing.
