---
description: "External-effect idempotency ledger for Epic P4-12: the reservation decision that authorizes one external send, epoch fencing, and the same-key-different-parameters refusal."
kind: "package-reference"
---

# @deepseek-ai/dsh-action-ledger

English | [中文](README.zh.md)

## Summary

`decideReservation` answers one question: may this caller send this external effect now? It is a pure function of the request and the ledger's current entry, so the crash campaign can drive it directly. `openLedgerStore` makes that answer durable: one SQLite row per `(scope, key)`, written before the request leaves.

## Table of Contents

- [Why a tool result is not evidence](#why-a-tool-result-is-not-evidence)
- [The five states are permissions, not labels](#the-five-states-are-permissions-not-labels)
- [Check order](#check-order)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Why a tool result is not evidence

A tool result records what the harness observed. It cannot record what the outside world committed, because the window between sending a request and persisting its outcome is real: crash inside it and the log cannot say whether the email went out. The ledger is the durable record that makes a retry decidable rather than a guess.

## The five states are permissions, not labels

`prepared` means nothing left the harness, so a retry may send. `sent` means a request left and no receipt came back, so a retry must NOT. `confirmed` and `compensated` are settled — the second is settled by the compensation having run, which frees nothing. `ambiguous` is the state a retry cannot resolve, and it goes to reconciliation rather than to another attempt.

## Keys are per client

An idempotency key is unique per client, not globally. `draft-ietf-httpapi-idempotency-key-header-07` says so, and its security considerations give the reason: a server that does not scope keys by client identity lets one client discover another's key state. So the ledger's identity is `(scope, key)`, where the scope is the manifest's `actor` principal, and it is half the table's primary key rather than a column beside it. Two agents deriving a key from an arguments hash collide easily; they get two reservations, and neither learns the other exists.

## Check order

Arguments are compared before state, and the epoch is compared before either outcome check. Both orders are load-bearing rather than stylistic. Answering `duplicate` to a request whose parameters differ would tell a caller that its new, different request had already been carried out; and reporting an outcome to a fenced-out generation would hand it information about work another generation now owns.

## Model Experience

None, as this package exports a reservation decision and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **No transport.** Passing `Idempotency-Key` to a real provider is still unbuilt: `idempotencyHeader` names the header and no adapter sends it, so must[2]'s native pass-through is a decision with no caller. must[3]'s other half — querying target state to resolve an ambiguity — is likewise absent, which is why `ambiguous` refuses rather than reconciles.
- **The production caller reserves; it does not yet resolve.** `packages/core/agent-loop/src/tool-calls.ts` reserves before every native tool call, marks it `sent` before the tool runs, and records a receipt digest or `ambiguous` from the result. A tool that throws leaves an `ambiguous` entry that refuses every later attempt at that key, and nothing clears it — deliberate, since clearing it would let a retry perform an effect that may already have committed, but it means a failed action is permanently blocked until a reconciler exists.
- **The receipt digest is over the tool's own content**, which is what the harness observed rather than what the provider returned. Until a transport carries a real receipt, the digest proves the same outcome was recorded twice, not that the outside world committed once.
- **`ambiguous` cannot tell unknowable from merely failed.** The dispatch path writes it for every errored tool result, which is the fail-closed reading: a tool that threw may or may not have committed. Distinguishing a request that never left from one whose outcome is genuinely unknown needs target-state queries this package does not have.
- No runtime invariant companion is published: this package holds no state and observes nothing, so there is no owned relation two observers could disagree about.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether the ledger should own the reconciliation loop, or only record that one is owed, is undecided. The crash campaign drives `ambiguous` by writing it directly, which is enough to prove the refusal but says nothing about who resolves it.

</details>
