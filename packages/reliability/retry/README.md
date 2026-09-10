---
description: "The retry decision vocabulary for Epic P4-11: the failure taxonomy and its retryability read against the action ledger's reconciliation state, one run-wide budget every in-scope layer accounts against, and the hedge-exclusion rule — with backoff and Retry-After parsing left to the implementations the tree already has."
kind: "package-reference"
---

# @deepseek-ai/dsh-retry

English | [中文](README.zh.md)

## Summary

`dsh-retry` ships the decisions Epic P4-11 unifies: whether a failure may be retried at all, and whether an attempt spends from the run's budget. `src/classify.ts` carries the taxonomy and the hedge rule; `src/budget.ts` carries the run-wide accounting; `tests/retry.spec.ts` covers them in 13 cases. `src/index.ts` re-exports both and declares no runtime value, so importing this package executes nothing.

The registry's problem statement is that several layers each decided retryability for themselves and their limits multiplied. The fix is that there is **one** of each decision — not that this package does more.

## Table of Contents

- [What this package deliberately does NOT do](#what-this-package-deliberately-does-not-do)
- [must[3]: the ledger decides whether an effect may be sent again](#must3-the-ledger-decides-whether-an-effect-may-be-sent-again)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## What this package deliberately does NOT do

Two mechanics live elsewhere in the tree already, and a second spelling of either is the duplication this epic exists to end (§12.64):

- **Backoff and jitter** belong to [`@deepseek-ai/dsh-llm-retry`](../../llm/llm-retry/README.md), whose jitter is *symmetric* — it may raise a delay as well as lower it before clamping. Symmetric jitter is legitimate jitter, so P4-11 makes that implementation consume this package's classifier and budget rather than replacing it. `admitRetry` takes an already-computed `delayMs`.
- **`Retry-After` parsing** is done at the provider boundary by `providerRetryAfterMs`, and its result rides on `LlmError.providerRetryAfterMs`, a field the LLM service already validates. Nothing here sees a header.

There is also **no breaker implementation here**, and no breaker library in this package's dependencies. What `src/provider.ts` declares is the `circuitBreaker` Service Definition — `BreakerDestination`, `BreakerOpenError` and `CircuitBreakerContract` — for the same reason `@deepseek-ai/dsh-lease-contract` declares `leaseStore`: the service name must mean the contract, so two providers cannot disagree about what it is. The consecutive-failure counting, the open period and the half-open probe are `cockatiel`'s, adopted in [`@deepseek-ai/dsh-retry-cockatiel`](../retry-cockatiel/README.md) per the make-vs-use ledger's `adapt`. A hand-written breaker beside an adopted one would leave the harness with two.

## must[3]: the ledger decides whether an effect may be sent again

A side-effecting attempt is retryable only under an idempotency guarantee, and [`@deepseek-ai/dsh-action-ledger`](../../action/action-ledger/README.md) is the only thing that can give one. `classifyFailure` READS its state rather than re-deciding idempotency:

| `LedgerState` | retryable | why |
| --- | --- | --- |
| `prepared` | yes | The request never left, so nothing can be duplicated. |
| `compensated` | yes | The effect happened and was undone, so the key is settled rather than free. |
| `sent` | **no** | The request left and no receipt came back — the case must[3] exists for. |
| `confirmed` | **no** | It already committed; another attempt is a duplicate. |
| `ambiguous` | **no** | Retrying is exactly what cannot resolve it; it goes to reconciliation. |
| *absent* | **no** | No ledger was consulted, which is not the same as safe. |

The last row is the one worth stating: reading absence as safety would make must[3] hold where the ledger is mounted and silently not hold everywhere else.

## Model Experience

No model-visible surface. This package registers no tool, contributes no prompt text, and emits no session event; it is consumed by the retry layers, and what a model sees is their behaviour. Token and KV-cache effects: none.

## Known Limitations and Deferred Work

- **`spendsRetryBudget` has no producer for its `hedged` input yet.** The tree has no hedging producer — hedging belongs to P5-04 — so this is the RULE half of the §12.46-B split. BLOCKED-166 records the closing condition: P5-04 must tag a hedged attempt so the rule can fire, and until then the rule is proven only against constructed input. A live caller with no reachable input is a subtler form of the zero-caller shape, and it is recorded rather than presented as coverage.
- **The budget has no consumer at this stage.** must[1]'s "all layers consume the same budget" is a statement about callers and closes at the Usage stage, where `llm-retry`, the MCP client's run-attached retries and subagent attempts thread one usage value. A budget type nothing consumes satisfies the noun and not the clause.
- **The message-bus outbox is out of scope by ruling, not by omission.** Its `decideDelivery` is a per-message dead-letter policy inside the accepted P4-06 and answers when to stop delivering a message, not how much a run may spend redoing failed work (§12.64).

No invariant companion is published: this package owns no relationship two observers could see differently — every export is a pure function over its arguments.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether `RunRetryBudget` should carry a wall-clock deadline as well as a delay ceiling is undecided. `maxDelayBudgetMs` bounds time spent WAITING, which is not the same as bounding how long a run may keep trying; a run that retries quickly forever stays inside both limits. The Usage stage will show whether the layers want the second bound, and inventing it here without a caller would be the zero-consumer shape this epic's own clause map argues against.

The classifier takes `hedged` as a fact rather than deriving it, because the tree has no hedging producer to derive it from. If P5-04 ends up tagging hedges with something richer than a boolean — a group id for the racing attempts, say — this field should follow that shape rather than keep a boolean the producer has to flatten into.

</details>
