# Reliability

[English](reliability.md) | 中文

harness 如何判定一次失败的远程调用是否值得重试、一个 run 可以为重试花多少,以及一个端点在什么时候干脆不再被调用。类型与决策位于 [`packages/reliability`](../../packages/reliability/README.zh.md);消费者是 LLM 服务及其重试层,模型真正观察到的东西由它们拥有。

Source: [`packages/reliability/retry/src`](../../packages/reliability/retry/src)

<a id="failure-facts-and-classification"></a>

## 失败事实与分类

一次失败以**事实**而非异常类型抵达本子系统。`FailureFacts` 携带 adapter 能够观察到的东西——HTTP 状态码、传输错误种类、`Retry-After` 值、是否被策略拒绝——而 `classifyFailure` 把这些事实转成判决:可否重试,以及为什么。这样切分是因为每个可能重试的层看到的错误类都不一样,而以错误类型为键的分类法需要为每个 provider SDK 各写一个分支。

判决刻意收得很窄。除 408 与 429 之外的 4xx 是永久失败,策略拒绝是永久失败,格式错误的请求是永久失败——重试它们中的任何一个,只会把一次失败变成好几次同样结局的失败。其余都可重试,这是对一次调用方无法解释其失败的远程调用最诚实的默认。

<a id="the-run-retry-budget"></a>

## Run 重试预算

一次重试要花时间与金钱,两者都属于 **run**,而不属于恰好注意到这次失败的那一层。`RunRetryUsageContract.admit(run, delayMs)` 在一次调用里同时决定并记账:调用方无法在不扣账的情况下查询预算——这正是两个各自独立挂载的重试层共享同一个总额、而不是各留一份的原因。

归属沿委派链走到**根**。子会话的重试记在它可见的最远祖先所持有的 run 上,因为 Run 与 session 是 1:1——记在重试者自己的 run 上,会让父与每个子各拿一份独立额度,而这正是本子系统要终结的"叠加"。这次遍历有环检测,并停在本进程能看到的最远祖先处。

解析不出 run 属于能力缺失而非权限拒绝:该层保留它自己的按 session 策略,而不是把这种情况当成无限预算。

<a id="the-circuit-breaker"></a>

## 断路器

`CircuitBreakerContract.execute(destination, operation, classify)` 在目的地尚未打开时执行操作;已打开时抛出 `BreakerOpenError` 且**根本不执行**它。这里是一个操作而不是"先查后记"的一对,理由与 `admit` 是一个调用相同。

`BreakerDestination` 是 `(provider, baseUrl, model)`,三个字段都参与:同一 base URL 下的两个模型独立失败——一个下线的模型会从健康的端点返回错误——而 provider 名区分共用同一 URL、凭据不同的两套部署。只有被分类器判为可重试的失败才推动断路器,因此策略拒绝或格式错误的请求不会影响端点的健康度。

随附的 provider 是 [`retry-cockatiel`](../../packages/reliability/retry-cockatiel/README.zh.md):它按目的地各持一个 `cockatiel` policy,并拥有连续失败计数、打开时长与半开探测。哪些失败算数、哪些目的地彼此独立仍留在这里,因为那是 harness 的决策而不是库的。

<a id="what-a-model-sees"></a>

## 模型看到什么

直接看到的:没有。本子系统不注册工具、不贡献提示词文本、不发出会话事件。模型能观察到的是它的请求究竟有没有发出:`@deepseek-ai/dsh-llm` 在拉取**第一个 chunk** 的位置咨询断路器,因为端点的健康正是在那里显形——已经产出过一个 chunk 的流说明端点应答了——而拒绝以该服务自身的失败形式浮现。既不挂载预算也不挂载断路器的组合,其行为与这两者出现之前完全一致;两个消费者都用 `ctx.get` 解析服务,因此"缺席"是能力缺失,而不是权限拒绝。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
