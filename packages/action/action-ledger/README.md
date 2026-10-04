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
- [A reservation is exclusive only when both sides are fenced](#a-reservation-is-exclusive-only-when-both-sides-are-fenced)
- [A retry under a new call id is the same action](#a-retry-under-a-new-call-id-is-the-same-action)
- [The host user resolves an ambiguous effect](#the-host-user-resolves-an-ambiguous-effect)
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

## A reservation is exclusive only when both sides are fenced

A generation comes from a run's lease, and a run without one presents `'unfenced'` — a state, not the number zero. The distinction decides which guarantee the reservation carries.

With generations on both sides, a `prepared` entry may be taken over by a HIGHER generation and is refused to the SAME one as `held-at-same-epoch`: the higher generation's fence proves the previous holder is out, while a caller at the holder's own generation is a live peer, and two holders of one reservation is what must[2] forbids. That refusal is distinct from `duplicate`, which asserts the effect already happened, and from `stale-epoch`, which asserts a successor fenced this caller out — one says wait, the other says stop.

A `sent` entry that a HIGHER generation finds is refused as `ambiguous-needs-reconciliation`, and `reserve` moves it to `ambiguous` in the same transaction, under the holder's generation: the fence proves the sending holder's lease lapsed, so nobody can say whether the effect landed (question 33 (a)). That holder may still be running; it cannot confirm afterwards because the entry is `ambiguous`. At the same generation, or with either side unfenced, it is still a `duplicate`.

With either side unfenced the ledger cannot tell a live peer from the same worker restarting, so it re-takes the `prepared` entry and keeps at-least-once instead of stranding a key nobody can prove abandoned. The decision then carries `fenced: false`, including when a well-fenced caller takes over an entry whose own holder had no generation: the old holder can still send. `sent`, `confirmed` and `ambiguous` entries are unaffected — the degraded rule re-takes what was never sent and nothing else.

## A retry under a new call id is the same action

A key is derived from the call id, so a model that retries an action whose outcome is unknown under a new call id presents a new key. A reservation therefore also names its capability and the run whose lease issued its generation. `reserve` refuses it as `ambiguous-needs-reconciliation` when another key's entry in the same scope records the same capability and arguments and is either `ambiguous` because a crash left its outcome unknown (cause `interrupted` or `fenced`), from any run, or `sent` and held by an older generation of the same run (`sameActionBlockers`, B-726). Each such `sent` entry moves to `ambiguous` in the same transaction. Lease epochs are counted per run, so a `sent` entry of another run, or of this generation, may be live and does not stop the reservation. A settled entry does not stop it either, and neither does an entry with other arguments or another tool. A reservation that names no capability is matched by its key alone. An entry the dispatch path marked `ambiguous` because its tool reported an error (cause `errored`) refuses only its own key: its outcome is a known failure, recorded as ambiguous because a failure may still have committed.

`markInterrupted` moves the `sent` entries of the calls a resumed session closes as interrupted (`TOOL_OUTCOME_UNKNOWN`) to `ambiguous` with the cause `interrupted`, in one transaction, so they are listed for reconciliation before any retry. A `sent` entry `reserve` moves (question 33 (a), or another key's same-run older generation) gets the cause `fenced`. It compares no generation: the resume holds the session's write ownership before it repairs the log, so the holder that recorded the call no longer writes that session, and if it is still running its later `confirm` is refused. The file's schema version is 3, and an older file is refused at open.

## The host user resolves an ambiguous effect

`ambiguous` refuses every later attempt at its key, because a retry could perform an effect that may already have committed. `/resolve-effect <idempotencyKey> <confirmed|compensated>` is how such an entry leaves that state (P4-12 acceptance[1], BLOCKED-311). The plugin registers the command where a command registry is composed; given no arguments, it lists the entries that are waiting, whatever their scope.

Only the host user resolves, and they resolve an entry of any scope: a child agent, a workflow run and a webhook session act for the host user, so the host user is the one who reconciles their entries. The invoking agent must act as a `user` principal, and the key is looked up among the `ambiguous` entries of every scope; a key waiting under more than one scope is refused rather than guessed. The host user is asked through the approval surface, and anything but an approval changes nothing. An approved resolve moves the entry to `confirmed` or `compensated` under the entry's own scope, in the transaction that records the resolution, which `entry()` returns: who resolved it, to what, and when. A transition that carries no resolution — `markSent`, a plain `confirm`, `markAmbiguous` — moves only a `prepared` or `sent` entry, so nothing but a resolve takes an entry out of `ambiguous` or back out of a settled state. The entry never returns to `prepared`; doing the work again is a new action with a new key. A `confirmed` resolve has no provider receipt, so the entry's receipt digest is the digest of the resolution.

## Model Experience

None, as this package exports a reservation decision and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **No transport.** Passing `Idempotency-Key` to a real provider is still unbuilt: `idempotencyHeader` names the header and no adapter sends it, so must[2]'s native pass-through is a decision with no caller. must[3]'s other half — querying target state to resolve an ambiguity — is likewise absent, so an `ambiguous` entry is reconciled by the host user, not automatically.
- **The production caller reserves; the host user resolves.** `packages/core/agent-loop/src/tool-calls.ts` reserves before every native tool call, marks it `sent` before the tool runs, and records a receipt digest or `ambiguous` from the result. A tool that throws leaves an `ambiguous` entry that refuses every later attempt at that key until the host user resolves it with `/resolve-effect`. A composition without a command registry or an approval surface cannot resolve one.
- **The receipt digest is over the tool's own content**, which is what the harness observed rather than what the provider returned. Until a transport carries a real receipt, the digest proves the same outcome was recorded twice, not that the outside world committed once.
- **`ambiguous` cannot tell unknowable from merely failed.** The dispatch path writes it for every errored tool result, which is the fail-closed reading: a tool that threw may or may not have committed. Distinguishing a request that never left from one whose outcome is genuinely unknown needs target-state queries this package does not have.
- **Without a lease, must[2] does not hold.** Only the Run Service assigns a lease generation, so a profile that does not mount it — `sdk-minimal` ships without it — reserves unfenced, and two concurrent workers there can both hold one reservation and both send. The ledger reports that as `fenced: false` on the decision rather than silently promising exclusivity, and the session log records it as an `action/manifest-appended` event with no `leaseEpoch`; making the guarantee hold for those profiles needs a generation source they do not have.
- **A retry under a new call id after a tool error goes ahead.** An `errored` entry stops only its own key, so if the failed attempt committed anyway, the same action under a new call id can perform it a second time. This is the existing limit of reading every error as ambiguous; B-726 does not widen it.
- **A session nobody resumes keeps its stranded `sent` entries.** They move to `ambiguous` when that session is resumed. Until then, a retry from another session meets them only within the same run under a newer generation.
- No runtime invariant companion is published: this package holds no state and observes nothing, so there is no owned relation two observers could disagree about.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether the ledger should also reconcile automatically, by querying target state where a provider supports it, is undecided; today the host user resolves each `ambiguous` entry through `/resolve-effect`.

</details>
