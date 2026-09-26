# Agent Note: A provider failure reported in the stream moves the circuit breaker

Status: implemented

English | [中文](2026-09-26-in-band-provider-failures-move-the-circuit-breaker.zh.md)

## Problem

BLOCKED-347; P4-11 acceptance[2] asks that the circuit opens when a provider fails, and recovers. The runtime in `dsh-llm` passed the first `iterator.next()` of each stream through the circuit breaker, and the breaker counts only a throw. pi-ai never throws once its stream has started: a provider failure arrives as a `usage` chunk and then an `error` finish chunk. The first pull therefore resolved, the breaker recorded a success for every failed call, and on a pi-ai route it never opened. Lane A's A-498 measured it (run 36223805295): past the threshold, the next call still reached a backend that failed every request.

## Decision

- **The breaker judges where the stream first answers.** The runtime pulls the leading chunks inside the breaker's operation, up to the first chunk other than `usage`, because a `usage` chunk says nothing about whether the endpoint answered.
- **An in-band failure is judged like a throw.** When that chunk is an `error` or `aborted` finish, the operation throws an internal marker carrying the finish's failure, and the breaker classifies it with `llmFailureFacts(failure)`, the function it applies to a thrown failure after `normalizeLlmFailure`. The shared classifier decides whether it counts: a transient code counts; a malformed request, a caller-side condition such as the caller's own abort, and an unclassified code do not.
- **The stream passes through unchanged.** The runtime catches its marker and yields the chunks the adapter produced, the `usage` chunk and the finish included, so consumers and llm-retry receive what they received before.
- **Only where the stream first answers.** A failure after a text, reasoning or tool-call chunk is the model's or the transport's and does not move the breaker, as before.

## Alternatives considered

- **Make pi-ai throw a failure it reports before any content.** That drops the `usage` chunk pi-ai sends with the failure, and it leaves the breaker unable to judge any other adapter that reports failures in-band, which the stream protocol allows.
- **Count every error finish, wherever it arrives.** A failure mid-stream is not evidence that the destination is down, which is why the breaker judges only where the stream first answers.

## Consequences

- On a pi-ai route, a provider that fails every call opens the breaker after the configured number of consecutive failures, and the next call is refused without reaching the backend.
- With or without a breaker mounted, a stream that starts with `usage` chunks yields them once its first other chunk arrives, rather than one by one.
- Verification: lane A's A-498, and `packages/llm/llm/tests/circuit-breaker-in-band.spec.ts`, which also pins the uncounted outcomes, a failure after the stream answered, and a stream without a breaker.
