# Agent Note：断路器与 llm-retry 给出同一个可否重试的判决

Status: implemented

[English](2026-09-26-one-retryability-verdict-for-the-breaker-and-llm-retry.md) | 中文

## 问题

BLOCKED-339；P4-11 must[0] 要求所有层共用一套错误分类、给出同一个可否重试的答案。原先有两层各自按自己的规则决定一次失败的模型请求能否重试。`dsh-llm` 里的断路器在 `classifyFailure(llmFailureFacts(failure))` 判为可重试时，把首块失败计入断开。`dsh-llm-retry` 则在失败码属于提供方策略的 `retryableCodes` 时重试失败的步骤，默认是 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT` 与 `TRANSPORT`。lane A 的 A-419 矩阵量出两者在八种失败上判决相反，方向全都一样：断路器判可重试，llm-retry 判永久。这八种是 HTTP 408、报告余额耗尽的 429，以及六个不带状态码的码：`ABORTED`、`UNSUPPORTED_CONTENT`、`REQUEST_EXTENSION`、`MISSING_CREDENTIAL`、`UNSUPPORTED_REASONING_EFFORT` 与 `UNKNOWN`。always 模式根本不读这张表，每种失败都无上限地重试，无效请求也不例外。

## 决定

- **只有一个判定。** llm-retry 用 `isRetryableLlmFailure(failure)` 判定。它由 `@deepseek-ai/dsh-llm-retry` 导出，定义为 `classifyFailure(llmFailureFacts(failure)).retryable`，也就是断路器在同一组事实上用的函数。两种模式都先调它，always 模式只取消次数上限。`retryableCodes` 从重试策略里删除；配置里还写这个键的，加载时报错，报错点名这个键和分类器。
- **码只在一处转成事实。** `llmFailureFacts` 给每个适配器码至多一个事实；`classifyFailure` 新增两个事实，并在读状态码之前检查：
  - `malformed`（`invalid-input`）：`INVALID_REQUEST`、`INVALID_ARGS`、`UNSUPPORTED_CONTENT`、`UNSUPPORTED_REASONING_EFFORT`、`REQUEST_EXTENSION` 与 `CONTEXT_WINDOW_EXCEEDED`。请求要先改，重发才可能成功。
  - `callerSide`（`client-error`）：`AUTH`、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`QUOTA` 与 `ABORTED`。凭据、余额和自己的取消只有调用方能改变，所以余额耗尽即使以 429 到达也被拒绝。
  - `unclassified`（新理由 `unclassified`）：不带状态码、码既不属于上面两类、也不是五个暂时性码之一的失败。没有任何东西表明它会过去，重试可能重复一个确定性的故障，把它计入断路器又可能让一个健康的目的地断开。`UNKNOWN` 在这里判定。
  - 带状态码、又没有上述事实的失败按状态码判：408、429 与 5xx 可重试，其余 4xx 为 `client-error`。408 现在会被重试，因为它表示服务器不再等待。
- **一次失败，一份输入。** 断路器把首块抛出的错误读作 `llmFailureFacts(normalizeLlmFailure(error))`，而 `normalizeLlmFailure(error)` 正是 finish 块带给 llm-retry 的那份失败，所以两层从同一个值算出同一个判决。首块之后的失败，或者适配器在 finish 块里报告的失败，只会到达 llm-retry，因为断路器只在首块判断端点是否健康。

## 不带状态码的码

改动之前，llm-retry 恰好重试这五个暂时性码，所以 normal 模式下它对每个不带状态码的码的判决都没有变。断路器原先把除 `INVALID_REQUEST` 与 `INVALID_ARGS` 以外的每个不带状态码的首块失败都计入，现在只计这五个。

| 事实 | 出厂适配器与运行时发出的、不带状态码的码 |
|---|---|
| 无（可重试） | `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT` |
| `malformed` | `INVALID_REQUEST`、`UNSUPPORTED_CONTENT`、`UNSUPPORTED_REASONING_EFFORT`、`REQUEST_EXTENSION`、`CONTEXT_WINDOW_EXCEEDED` |
| `callerSide` | `AUTH`、`QUOTA`、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`ABORTED` |
| `unclassified` | `UNKNOWN`、`STREAM_CLOSED`、`MALFORMED_RESPONSE`、`INVALID_RESPONSE`、`PI_AI_ERROR`、`INVALID_REPLAY_STATE`、`UNSUPPORTED_OPTION`、`UNKNOWN_MODEL`、`NO_ADAPTER`、`INVALID_PREPARED_CALL`、运行时的 `INVALID_MODEL_*` 各码，以及 DeepSeek 未映射的 finish reason，如 `INSUFFICIENT_SYSTEM_RESOURCE` |

## 考虑过的替代方案

- **保留 `retryableCodes`，默认值由分类器推出。** 部署一旦覆盖，第二张表就回来了。
- **只给量出的八个码加事实。** pi-ai 报告 `AUTH`、`CONTEXT_WINDOW_EXCEEDED` 与 `PI_AI_ERROR` 时不带状态码，分类器会把它们判为可重试；llm-retry 就会在压缩恢复运行之前自己重试上下文溢出。

## 后果

- normal 模式会重试 408。always 模式不再重试分类器拒绝的失败。
- 断路器不再计入调用方一侧或无法分类的首块失败，例如调用方自己的 `ABORTED`、`PI_AI_ERROR` 或 `STREAM_CLOSED`。
- DeepSeek 适配器报告为 `STREAM_CLOSED` 的流仍不会被重试；pi-ai 把截断报告为 `TRANSPORT`，会被重试。
- 重试状态的键不再带码表，所以 `llm/retry` 事件的 `policyKey` 变短了；录制的快照与 headless 预期已随之更新。
- 验证：lane A 的 A-419 矩阵（lane A 把其中 llm-retry 一侧改为读 `isRetryableLlmFailure`），以及针对 always 模式的 A-457；`dsh-retry`、`dsh-llm` 与 `dsh-llm-retry` 里的单元用例。
