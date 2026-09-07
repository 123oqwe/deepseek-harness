---
description: "External-effect idempotency ledger for Epic P4-12: the reservation decision that authorizes one external send, epoch fencing, and the same-key-different-parameters refusal."
kind: "package-reference"
---

# @deepseek-ai/dsh-action-ledger

English | [中文](README.zh.md)

## Summary

`decideReservation` answers one question: may this caller send this external effect now? It is a pure function of the request and the ledger's current entry, so the crash campaign can drive it directly. The store that holds entries is the Provider stage; this package decides.

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

## Check order

Arguments are compared before state, and the epoch is compared before either outcome check. Both orders are load-bearing rather than stylistic. Answering `duplicate` to a request whose parameters differ would tell a caller that its new, different request had already been carried out; and reporting an outcome to a fenced-out generation would hand it information about work another generation now owns.

## Model Experience

None, as this package exports a reservation decision and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **No store and no transport.** The Contract stage decides; persisting entries and passing `Idempotency-Key` to a real provider are the Provider and Usage stages, and nothing here proves an external system agreed.
- No runtime invariant companion is published: this package holds no state and observes nothing, so there is no owned relation two observers could disagree about.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

`ambiguous` has no producer yet: nothing in this stage decides that an outcome is unknowable rather than merely unobserved, and that judgement probably belongs with whatever queries target state. Until it has one, the state is reachable only by a caller writing it directly.

</details>
