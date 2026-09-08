# Evidence package — P4-12 外部副作用 Idempotency Ledger

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured at `53864d10ad`.

## Summary

Seven of nine clauses close. must[2] does not — the native pass-through has no caller and no provider to call it. must[3] closes only in its local-fencing half, for the same reason.

| clause | verdict |
| --- | --- |
| must[0] the manifest mandates an idempotency key | closes |
| must[1] the five ledger states | closes |
| must[2] a provider with native key support gets it passed through | **does not close** |
| must[3] otherwise, target-state query or local fencing | closes in its local-fencing half only |
| must[4] CAS reserve before execution, receipt digest after | closes |
| must[5] the ledger refuses a stale epoch | closes |
| acceptance[0] zero duplicate effects across a 10,000-run crash campaign | closes |
| acceptance[1] `ambiguous` goes to reconciliation, never a blind retry | closes |
| acceptance[2] same key with different arguments is refused | closes |

## The consumer, stated once

`reserveExternalEffect` / `confirmExternalEffect` (`core/tools/src/external-effect.ts`) are called from BOTH production dispatch points — `agent-loop/src/tool-calls.ts:219,198` for native tool calls and `core/tools/src/ptc.ts:634` for code-mode. They live in `dsh-tools` precisely so code-mode reaches the same pair rather than a second copy (§12.35-2), which is what stops the two paths from drifting.

That answers question (3) for the clauses below.

## must[0] — the manifest mandates an idempotency key

| question | answer |
| --- | --- |
| exists | `manifestIdempotencyKey(sessionId, actionId, argumentsHash)` |
| production callers | **2** — `agent-loop/src/tool-calls.ts`, `core/tools/src/ptc.ts` |
| reached | yes — every native call and every code-mode dispatch builds one |

The key is derived from the session, the action and the arguments hash together, so two runs of one session cannot collide and one action with different arguments cannot reuse a key.

## must[1] — the five ledger states

`prepared`, `sent`, `confirmed`, `ambiguous`, `compensated` are the `LedgerState` union, and each is documented by what a recovering process may do next rather than as a status label. Persisted in the `ledger` table's `state` column, so the set survives a restart.

## must[2] — a provider with native key support gets the key passed through

| question | answer |
| --- | --- |
| exists | `idempotencyHeader(provider, key)` returns `{ name: 'Idempotency-Key', value }` for a `native` provider |
| production callers | **0** — the only occurrences of `idempotencyHeader` and of the string `Idempotency-Key` anywhere outside tests are its own declaration in `action-ledger/src/index.ts` and the type in `types.ts` |
| reached | **no** |

**This does not close.** No provider in the harness declares `ProviderIdempotency`, and nothing calls the function that would build the header. The clause is true of a function and of nothing the harness sends.

It is also smaller than it looks and worth stating precisely: the function is three lines and correct, and what is missing is a provider that both performs an external effect and supports the header. The harness's external-effect surface today is tool calls, and no shipped tool speaks to an API with native idempotency support. So this is not wiring that was forgotten — it is a clause written for providers this build does not have.

## must[3] — otherwise, target-state query or local fencing

The `local-fencing` half closes: `ProviderIdempotency`'s second arm says the ledger's reservation IS the deduplication, and that is what `reserveExternalEffect` performs on every dispatch. The `native` half is must[2]'s and does not.

The target-state query the clause also names is the caller's, and the code says so — for `local-fencing` "the caller must query target state to resolve an ambiguity". No shipped caller does, because no shipped caller reaches an ambiguity (see acceptance[1]).

## must[4] — CAS reserve before execution, receipt digest after

| question | answer |
| --- | --- |
| exists | `decideReservation` inside `BEGIN IMMEDIATE` (`store.ts:153`); `confirm(scope, key, epoch, receiptDigest)` records the digest |
| production callers | `reserveExternalEffect` and `confirmExternalEffect`, from both dispatch points |
| reached | yes, before `prepare` on the native path — the reservation is taken before the tool runs, not alongside it |

The ordering is the clause: a crash between the reserve and the tool's own commit leaves a durable record that the effect was already claimed.

## must[5] — the ledger refuses a stale epoch

`decideReservation` returns `{ action: 'refused', reason: 'stale-epoch', currentEpoch }` when `request.epoch < existing.epoch`. The check order is load-bearing and documented as such: arguments are compared BEFORE state, so a second different request is never told its work was already done; the epoch is compared before the outcome checks, so a fenced-out generation does not learn the outcome of work it no longer owns and is not told to reconcile it.

## acceptance[0] — zero duplicate external effects across a 10,000-run crash campaign

The campaign drives the decisions directly and counts at a fake external service rather than at the harness's own log — counting at the log would prove only that the log recorded one attempt. Refusal is a settled outcome rather than an error: `refusedReservationResult` renders it as a tool result, so a refused duplicate does not surface as a failure the model retries.

## acceptance[1] — `ambiguous` does not retry blindly

`decideReservation` returns `refused / ambiguous-needs-reconciliation` for an `ambiguous` entry, and `markAmbiguous` is called from `external-effect.ts` — so the state is both produced and honoured on the dispatch path. P4-08's resume consumes the same distinction: a step whose receipts are `ambiguous` ends the resume with `ambiguous-reconciliation-required` rather than re-running.

## acceptance[2] — the same key with different arguments is refused

`{ action: 'refused', reason: 'arguments-differ', firstArgumentsHash }`, checked first for the reason given above.

## Signing position

Seven clauses close on consumers reached from both dispatch points. must[2] does not close and cannot be closed by wiring: it needs a provider with native idempotency support, which this build does not have. must[3] closes in the half that has an implementation.

Recommend signing the seven and recording must[2] as a directed deferral in the §12.46-B shape — landing when a provider that speaks native idempotency exists, rather than against a named epic, since no scheduled epic introduces one. If the delegate prefers it bound to an epic, the honest owner is whichever slice first adds an external-API provider.
