# Reliability

English | [中文](reliability.zh.md)

How the harness decides whether a failed remote call is worth trying again, what a run may spend trying, and when an endpoint stops being called at all. The types and decisions live in [`packages/reliability`](../../packages/reliability/README.md); the consumers are the LLM service and its retry layer, which own what a model actually observes.

Source: [`packages/reliability/retry/src`](../../packages/reliability/retry/src)

<a id="failure-facts-and-classification"></a>

## Failure facts and classification

A failure reaches this subsystem as **facts**, never as an exception type. `FailureFacts` carries what an adapter could observe — an HTTP status, a transport error kind, a `Retry-After` value, whether a policy denied the call — and `classifyFailure` turns those facts into a verdict: retryable or not, and why. The split exists because every layer that might retry sees a different error class, and a taxonomy keyed on error types would need one branch per provider SDK.

The verdict is deliberately narrow. A 4xx that is not 408 or 429 is permanent, a policy denial is permanent, and a malformed request is permanent — retrying any of them turns one failure into several with the same outcome. Everything else is retryable, which is the honest default for a remote call whose failure the caller cannot explain.

<a id="the-run-retry-budget"></a>

## The run retry budget

A retry costs time and money, and both belong to the **run**, not to the layer that happened to notice the failure. `RunRetryUsageContract.admit(run, delayMs)` decides and records in one call: a caller cannot consult the budget without charging it, which is what makes two independently mounted retry layers share one total instead of each keeping its own.

Attribution walks to the delegation ROOT. A child session's retries are charged to the run its furthest visible ancestor holds, because a Run is 1:1 with a session — charging the retrying session's own run would give a parent and each of its children an independent allowance, which is the stacking this subsystem exists to end. The walk is cycle-guarded and stops at the furthest ancestor the process can see.

A run that cannot be resolved is capability absence, not permission: the layer keeps its own per-session policy rather than treating the failure as an unlimited budget.

<a id="the-circuit-breaker"></a>

## The circuit breaker

`CircuitBreakerContract.execute(destination, operation, classify)` runs an operation unless its destination is already open, and throws `BreakerOpenError` **without running it** when it is. One operation rather than a consult-then-record pair, for the same reason `admit` is one call.

A `BreakerDestination` is `(provider, baseUrl, model)`, and all three participate: two models at one base URL fail independently — a decommissioned model returns errors from a healthy endpoint — and the provider name distinguishes two deployments that share a URL through different credentials. Only failures the classifier calls retryable move the breaker, so a policy denial or a malformed request leaves an endpoint's health untouched.

The shipped provider is [`retry-cockatiel`](../../packages/reliability/retry-cockatiel/README.md), which keeps one `cockatiel` policy per destination and owns the consecutive-failure counting, the open period and half-open probing. Which failures count and which destinations are separate stay here, because those are the harness's decisions rather than the library's.

<a id="what-a-model-sees"></a>

## What a model sees

Nothing directly. This subsystem registers no tool, contributes no prompt text and emits no session event. What a model observes is whether its request was made at all: `@deepseek-ai/dsh-llm` consults the breaker where the FIRST chunk is pulled, because that is where an endpoint's health shows — a stream that produced a chunk answered — and a refusal surfaces as that service's own failure. A composition mounting neither the budget nor the breaker behaves exactly as it did before they existed; both consumers resolve their service with `ctx.get`, so absence is a capability that is missing rather than a permission that was denied.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcircuitbreaker--circuitbreakercontract"></a>

### `ctx.circuitBreaker` — `CircuitBreakerContract`

The mounted circuit breaker, published by whichever provider a profile mounts.

One operation, not a consult-then-record pair: a contract that reported state separately would leave the consultation to every caller, and a caller that forgot would still compile and still pass its own tests.

```ts cordis-catalog
/**
 * Run `operation` unless its destination's breaker is open, counting the
 * outcome toward that destination's health.
 *
 * `classify` is required rather than inferred because what counts as
 * endpoint ill-health is {@link classifyFailure}'s decision applied to facts
 * only the caller can read: a policy denial is permanent but says nothing
 * about the endpoint, and counting it would open a breaker on a working
 * destination. The breaker never inspects a raw error itself.
 * @param destination - the endpoint the operation addresses.
 * @param operation - the work to attempt.
 * @param classify - reads the thrown value into facts this package decides on.
 * @returns the operation's own result.
 * @throws {BreakerOpenError} when the destination is open, WITHOUT running
 *   `operation`.
 */
execute<T>( destination: BreakerDestination, operation: () => Promise<T>, classify: (error: unknown) => FailureFacts, ): Promise<T>
```

Source: [`packages/reliability/retry/src/provider.ts`](../../packages/reliability/retry/src/provider.ts)

<a id="ctxrunretryusage--runretryusagecontract"></a>

### `ctx.runRetryUsage` — `RunRetryUsageContract`

The mounted run-retry accounting, published by whichever provider a profile mounts.

`admit` decides AND stores in one call rather than exposing a read and a write: two layers retrying concurrently would each read the same usage, decide against it and store their own successor, and one retry would vanish. The decision is the only thing a caller needs, and the arithmetic behind it is not a caller's to redo.

```ts cordis-catalog
/**
 * Charge one retry to `run` if the budget allows it.
 *
 * The budget is the STORE's, not a parameter: two layers passing their own
 * allowances would share a total and disagree about the ceiling, which is
 * half of the stacking this epic ends. One store, one total, one allowance.
 * @param run - the run the retry is charged to — the DELEGATION ROOT's run,
 *   not the session that happens to be retrying.
 * @param delayMs - the wait this retry would take, already computed.
 * @returns the admission, or the refusal and why.
 */
admit(run: RunId, delayMs: number): BudgetDecision

/**
 * The run a session's retries are charged to, resolved once and remembered.
 *
 * Remembering is not a cache of something that might change: a session's
 * delegation root is fixed when the session is created, so the first
 * resolution is the only one there is. What it survives is the PARENT going
 * away — a continuable child outliving its parent's turn is ordinary, and
 * re-walking a chain whose parent is gone would hand that child a fresh
 * allowance, which is the stacking must[1] exists to stop.
 * @param session - the session retrying.
 * @param resolve - computes the charged run, called only on the first ask.
 * @returns the charged run, or `undefined` when none could be resolved.
 */
chargedRunFor(session: string, resolve: () => RunId | undefined): RunId | undefined

/**
 * What `run` has spent so far, for reporting.
 * @param run - the run to report on.
 * @returns its usage, or {@link NO_RETRIES_USED} when it has spent nothing.
 */
usageOf(run: RunId): RetryUsage
```

Source: [`packages/reliability/retry/src/usage.ts`](../../packages/reliability/retry/src/usage.ts)
<!-- END GENERATED cordis-surface -->
