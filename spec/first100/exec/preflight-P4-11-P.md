# preFlight — P4-11 Provider stage (cockatiel behind the decision interface)

Per lifecycle §1: written before any code. Everything below is measured at `715897272c`, not recalled. This supplements the epic preFlight (`preflight-P4-11.md`, approved) with the P stage's own targets, and records one thing that document assumed and the tree does not have.

## The freeze-target list, before any code

| file | why it is in P |
| --- | --- |
| `packages/reliability/retry-cockatiel/src/index.ts` | the Provider: `cockatiel`'s breaker behind the Definition's contract |
| `packages/reliability/retry/src/provider.ts` | the Provider CONTRACT, which does not exist yet — see below |
| `packages/llm/llm/src/adapter-failure.ts` | translate a real adapter failure into `FailureFacts` |
| `packages/reliability/retry-cockatiel/tests/breaker.spec.ts` | the Provider's own cases |
| `packages/llm/llm/tests/adapter-failure.spec.ts` | the translation's cases, in the package that owns the failure type |

The list earns itself again: the epic preFlight's P row named a "provider module" and two `llm/llm` files, and **named no test file**, the same gap it caught on P6-02.U and P4-08. Answered up front, and the answer is two test files rather than one because the translation is `llm/llm`'s subject and the breaker is the provider's.

`packages/llm/llm/src/retry-policy.ts` is on the epic preFlight's P list and is **dropped here**: measured, it resolves and validates `BackoffConfig` / `RetryPolicyConfig` and computes nothing about failures. Making it consume the classifier is what the U stage does when `llm-retry` threads one budget. Touching it in P would edit a file whose subject this stage does not decide.

## What C actually left, measured — the Provider contract does not exist

`packages/reliability/retry`'s public surface is three pure functions and their types: `classifyFailure`, `spendsRetryBudget`, `admitRetry` (plus `NO_RETRIES_USED`). `grep -rn "Contract\|Provider\|breaker\|circuit" packages/reliability/retry/src/` returns one hit, and it is a prose line in a module comment.

So the C stage's README sentence — "the Provider stage adopts it behind this package's decision interface" — names an interface that is not declared. A `cockatiel` policy wired to nothing but its own tests would satisfy that sentence and leave the seam a Provider without a Definition, which is the incomplete-seam shape `docs/glossary.md` forbids.

**P therefore declares the contract as its first target**, not as a side effect: a `CircuitBreakerContract` in the Definition package naming the two operations a caller needs — ask whether a destination is currently open, and record an attempt's outcome — with `retry-cockatiel` as its first provider. The Definition gains no dependency on `cockatiel`; only the provider package does.

## `cockatiel` is a real dependency addition

`require.resolve('cockatiel')` → not installed, re-measured. Adding it is the `adapt` verdict being carried out, and it lands in `packages/reliability/retry-cockatiel/package.json` alone, so no package that only decides gains a runtime dependency.

## The lift, and what it is not

`providerRetryAfterMs` is `packages/llm/llm-deepseek/src/adapter.ts:311`, module-private, called once at `:685`, and handles both wire forms. Its result already rides on `LlmError.providerRetryAfterMs`, which `adapter-failure.ts:70-82` validates today and rejects when non-finite or non-positive.

The lift is therefore **narrow**: `adapter-failure.ts` consumes the already-parsed field. This stage writes no parser and reads no header. The epic preFlight's own §12.64 correction stands and is repeated here because the temptation recurs at exactly this stage.

## 4.4a — count the callers before signing

Counted in `packages/*/*/src`, excluding tests, at `715897272c`:

- `classifyFailure`: **0 production callers.** Every reference is C's own suite.
- `admitRetry`: **0 production callers.**
- `normalizeLlmFailure`: has production callers in `llm/llm`.

So P's honest claim is bounded: it makes the classifier reachable **from a real adapter failure**, and it gives the breaker a contract and a provider. It does **not** make the shipped LLM path spend one run budget — that is must[1], assigned to U, and a P-stage report claiming otherwise would repeat P2-02's shape.

## The case that must really bite

A case that imports `cockatiel`, drives its policy directly and asserts the policy opened proves that `cockatiel` works. It is not evidence about this harness.

**Where the observation can and cannot be, measured.** `normalizeLlmFailure`'s one production caller is `adapterFailureChunk` (`llm/llm/src/index.ts:1070`), which converts an adapter throw into the stream protocol's terminal chunk. That is the failure FUNNEL, not the retry loop — the loop lives in `llm-retry`, which the U stage rewires. So P cannot honestly show the shipped LLM path refusing an attempt, and a case claiming it would be reporting U's work.

**Frozen intent, before the code:** the case drives the provider's own `execute` — the operation `cockatiel`'s policy wraps — with a stub adapter that counts calls, feeding it genuine `llm-deepseek` failure VALUES translated through `normalizeLlmFailure` rather than hand-built `FailureFacts`. After the configured consecutive failures, the next `execute` must reject and **the stub's call count must not increase**. The refusal is observed as "the adapter was not called", never as a returned flag: a flag nobody consults is the shape this program keeps finding.

**The mutation that must redden it:** have the provider record outcomes but never consult breaker state before executing. If the case still passes, it was asserting on the recording rather than on the refusal, and the case is at fault.

**A positive control sits beside it,** because a provider that refused everything unconditionally would satisfy the refusal assertion: a destination under the failure threshold must still execute, and the stub's count must increase.

**A second mutation, for the translation:** make `normalizeLlmFailure` drop `providerRetryAfterMs`. A case that does not redden is not observing the lift.

## Ruled: breaker state is keyed per DESTINATION

Asked because `cockatiel` gives one policy object per breaker either way, so this is a keying decision rather than a library one. Ruled per destination (base URL + model): must[2]'s "provider circuit breaker" names a grain that is in fact the endpoint, one provider name can front two endpoints, and a healthy endpoint must not be opened by a sick one's failures. Narrowing destination→provider later does not change the contract; widening does.

**Frozen with a negative control:** two destinations under ONE provider, one driven past the threshold and one not — the open destination refuses, and the healthy one still executes with its stub count increasing. Without it, a breaker keyed per provider would satisfy every other case here.

## Registration, following the precedents rather than inventing one

Measured: `architecture.layers.json` holds 30 families, and `capabilityToken` reads `definition: @deepseek-ai/dsh-capability-token`, `providers: [@deepseek-ai/dsh-capability-token-file]`. This epic adds `definition: @deepseek-ai/dsh-retry`, `providers: [@deepseek-ai/dsh-retry-cockatiel]`, consumers empty at P — U adds them, and an invented consumer here would be a name with nothing behind it.

The service is declared in the DEFINITION package, per `lease-contract/src/index.ts:25`, whose own reason applies unchanged: declaring it there makes the name mean the contract rather than an implementation, so two providers cannot disagree about what the service is.

## Status

**No code written.** Freeze entry will be recorded run-and-pasted per §12.68 once the cases exist; this document is the pre-commitment they must match.
