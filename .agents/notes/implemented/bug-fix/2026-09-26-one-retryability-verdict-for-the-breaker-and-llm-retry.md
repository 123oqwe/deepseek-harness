# Agent Note: The circuit breaker and llm-retry give one retryability verdict

Status: implemented

English | [中文](2026-09-26-one-retryability-verdict-for-the-breaker-and-llm-retry.zh.md)

## Problem

BLOCKED-339; P4-11 must[0] asks for one error taxonomy and one retryability answer for every layer. Two layers decided whether a failed model request may be retried, each by its own rule. The circuit breaker in `dsh-llm` counted a first-chunk failure toward opening when `classifyFailure(llmFailureFacts(failure))` called it retryable. `dsh-llm-retry` retried a failed step when its code was in the provider policy's `retryableCodes`, by default `EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT` and `TRANSPORT`. Lane A's A-419 matrix measured eight kinds on which they disagreed, all in one direction: the breaker said retryable and llm-retry said permanent. They were HTTP 408, a 429 reporting an exhausted balance, and six codes with no status: `ABORTED`, `UNSUPPORTED_CONTENT`, `REQUEST_EXTENSION`, `MISSING_CREDENTIAL`, `UNSUPPORTED_REASONING_EFFORT` and `UNKNOWN`. Always mode never read the list and retried every failure, an invalid request included, without an attempt limit.

## Decision

- **One decision.** llm-retry decides with `isRetryableLlmFailure(failure)`, exported by `@deepseek-ai/dsh-llm-retry` and defined as `classifyFailure(llmFailureFacts(failure)).retryable`, which is the breaker's function over the same facts. Both modes call it first, and always mode lifts only the attempt limit. `retryableCodes` is removed from the retry policy; a configuration that still sets it fails at load with an error that names the key and the classifier.
- **Codes become facts in one place.** `llmFailureFacts` gives each adapter code at most one fact, and `classifyFailure` checks two new ones before it reads the status:
  - `malformed` (`invalid-input`): `INVALID_REQUEST`, `INVALID_ARGS`, `UNSUPPORTED_CONTENT`, `UNSUPPORTED_REASONING_EFFORT`, `REQUEST_EXTENSION` and `CONTEXT_WINDOW_EXCEEDED`. The request must change before a resend can succeed.
  - `callerSide` (`client-error`): `AUTH`, `MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`, `QUOTA` and `ABORTED`. Only the caller can change its credential, its balance or its own cancellation, so an exhausted balance is refused even when it arrives as a 429.
  - `unclassified` (the new reason `unclassified`): a failure with no status and a code that is neither of the above nor one of the five transient codes. Nothing says it will pass, a retry may repeat a deterministic fault, and counting it could open a healthy destination. `UNKNOWN` is decided here.
  - A failure with a status and none of these facts is decided by the status: 408, 429 and 5xx are retryable and every other 4xx is `client-error`. A 408 is now retried because the server stopped waiting.
- **One failure, one input.** The breaker classifies a throw before the stream answers as `llmFailureFacts(normalizeLlmFailure(error))`, and `normalizeLlmFailure(error)` is the failure the finish chunk carries to llm-retry, so both layers compute one verdict from one value; a failure an adapter reports in its finish chunk before the stream answers is classified from that chunk's failure, the value llm-retry reads ([in-band failures](2026-09-26-in-band-provider-failures-move-the-circuit-breaker.md)). A failure after the stream answers reaches only llm-retry, because the breaker judges endpoint health only where a stream first answers.

## Statusless codes

Before this change llm-retry retried exactly the five transient codes, so its verdict on every code without a status is unchanged in normal mode. The breaker counted every statusless first-chunk throw except `INVALID_REQUEST` and `INVALID_ARGS`, and now counts only the five.

| Fact | Codes the shipped adapters and the runtime emit without a status |
|---|---|
| none (retryable) | `EMPTY_RESPONSE`, `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT` |
| `malformed` | `INVALID_REQUEST`, `UNSUPPORTED_CONTENT`, `UNSUPPORTED_REASONING_EFFORT`, `REQUEST_EXTENSION`, `CONTEXT_WINDOW_EXCEEDED` |
| `callerSide` | `AUTH`, `QUOTA`, `MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`, `ABORTED` |
| `unclassified` | `UNKNOWN`, `STREAM_CLOSED`, `MALFORMED_RESPONSE`, `INVALID_RESPONSE`, `PI_AI_ERROR`, `INVALID_REPLAY_STATE`, `UNSUPPORTED_OPTION`, `UNKNOWN_MODEL`, `NO_ADAPTER`, `INVALID_PREPARED_CALL`, the runtime's `INVALID_MODEL_*` codes, and an unmapped DeepSeek finish reason such as `INSUFFICIENT_SYSTEM_RESOURCE` |

## Alternatives considered

- **Keeping `retryableCodes` with a default derived from the classifier.** A deployment override would restore the second table.
- **Mapping only the eight measured codes.** pi-ai reports `AUTH`, `CONTEXT_WINDOW_EXCEEDED` and `PI_AI_ERROR` without a status, so the classifier would have called them retryable and llm-retry would have retried a context overflow before compaction's recovery ran.

## Consequences

- Normal mode retries a 408. Always mode no longer retries a failure the classifier refuses.
- The breaker no longer counts a caller-side or unclassified first-chunk failure, such as the caller's own `ABORTED`, `PI_AI_ERROR` or `STREAM_CLOSED`.
- A stream the DeepSeek adapter reports as `STREAM_CLOSED` is still not retried; pi-ai reports its truncations as `TRANSPORT`, which is.
- The retry-state key no longer carries a code list, so an `llm/retry` event's `policyKey` is shorter; the recorded snapshot and headless expectations were updated.
- Verification: lane A's A-419 matrix, whose llm-retry side lane A points at `isRetryableLlmFailure`, and A-457 for always mode; unit cases in `dsh-retry`, `dsh-llm` and `dsh-llm-retry`.
