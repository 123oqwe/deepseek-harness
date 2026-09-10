---
description: "The circuit-breaker provider for Epic P4-11: one cockatiel policy per destination behind dsh-retry's Service Definition, opening on the consecutive failures the retry classifier counts as endpoint ill-health, and refusing the next attempt before it reaches the adapter."
kind: "package-reference"
---

# @deepseek-ai/dsh-retry-cockatiel

English | [中文](README.zh.md)

## Summary

`dsh-retry-cockatiel` mounts `ctx.circuitBreaker`, the service [`@deepseek-ai/dsh-retry`](../retry/README.md) declares. `cockatiel` owns the mechanics — consecutive-failure counting, the open period, half-open probing — under the `adapt` verdict the make-vs-use ledger recorded for it. This package owns only the two decisions that are the harness's: **which destinations are separate**, and **which failures count against an endpoint's health**.

## Table of Contents

- [What a refusal is](#what-a-refusal-is)
- [Keyed per destination](#keyed-per-destination)
- [The classifier decides what counts](#the-classifier-decides-what-counts)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## What a refusal is

`execute` runs the operation, or throws `BreakerOpenError` **without running it**. There is no "ask whether it is open, then decide": a contract that reported state separately would leave the consultation to every caller, and a caller that forgot would still compile and still pass its own tests. The tests assert the refusal as *the stub was not called*, not as a returned flag.

A caller's own error is rethrown unchanged. A counted failure travels internally as a private `CountedFailure` so `cockatiel`'s predicate can recognize it without inspecting the caller's error type, and the original is unwrapped on the way out — a caller awaiting an `LlmError` must not receive a breaker-internal type instead.

## Keyed per destination

Breaker state is kept per `{ provider, baseUrl, model }`, not per provider name. One provider can front more than one endpoint (`llm-deepseek` resolves a base URL per call config), two models at one base URL fail independently, and one deployment's outage must not open the breaker for a healthy sibling. A frozen case drives one destination past the threshold and asserts a second destination **under the same provider** still executes.

Narrowing this later to a provider key would leave the contract unchanged; widening it would not, which is why it starts here.

## The classifier decides what counts

`execute` takes a `classify` callback and this package never inspects a raw error. Whether a failure means the ENDPOINT is unhealthy is [`classifyFailure`](../retry/README.md)'s decision applied to facts only the caller can read: a policy denial and a malformed request are permanent, and counting them would open a breaker on a working destination. A permanent failure passes straight through `cockatiel`'s predicate, which records neither a success nor a failure, so the breaker does not move.

## Composition

`dsh-base` mounts this package as the `circuit-breaker` row, so every base-backed profile — including the `dsh` a user starts — has a breaker. The consumer resolves it with `ctx.get`, so a profile that drops the row keeps the pre-P4-11 behaviour rather than failing; mounting it in the shared base is what makes the epic reach the product.

Both shipped values are `Config` fields, changeable per profile:

| field | shipped value | why that value |
|---|---|---|
| `consecutiveFailures` | 5 | `cockatiel`'s own `ConsecutiveBreaker` default, and nothing in this deployment argues for another: below it a transient blip opens a destination that is fine, above it a dead one keeps being called. Measured against `llm-retry`'s per-request cap, five consecutive COUNTED failures means at least two failed requests. |
| `openMs` | 30000 | `cockatiel`'s own default open period: long enough that a restarting endpoint is not hammered, short enough that a recovered one is not written off for a turn. |

## Dev Note

The provider stores its policies in a `private readonly` map rather than a `#private` field. Cordis hands callers a Service proxy, so `this` inside a method is not the instance and a `#private` access throws `Receiver must be an instance of class …`. `@deepseek-ai/dsh-lease`'s store is written the same way for the same reason.

## Model Experience

None, as this package refuses or admits an attempt before the adapter is reached and registers no tool, prompt text or session event.

#### KV Cache effect

Nothing here enters a model request. A refusal reaches the model only as whatever its caller does with the thrown error.

## Known Limitations and Deferred Work

- **The breaker guards the FIRST chunk, not the whole stream.** `@deepseek-ai/dsh-llm` consults it where the first chunk is pulled, because that is where an endpoint's health shows: a stream that produced a chunk answered. A failure arriving mid-stream is the transport's or the model's, and does not move the breaker — so a destination that reliably starts and then fails will not open. Widening this would mean deciding, inside the breaker, which mid-stream failures are the endpoint's fault, which is the classifier's job and is not observable at a chunk boundary.
- **Breaker state is per process and not persisted.** A restart re-closes every destination, so a run that restarts against a dead endpoint pays the threshold again. Persisting it would make an endpoint's health durable state with an owner and an eviction policy, which nothing has asked for; `cockatiel` exposes `toJSON`/`state` if it is ever wanted.
- **`openMs` is a fixed period, not a backoff.** `cockatiel` supports a growing open period; this provider passes a single duration because no deployment has asked to tune a curve, and one number is the thing an operator can reason about.
