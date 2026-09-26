# Agent Note: A DeepSeek settings section that has not resolved refuses calls

Status: implemented

English | [中文](2026-09-26-an-unresolved-deepseek-settings-section-refuses-calls.zh.md)

## Problem

B-646, from the P4-11 blind review. `llm-deepseek` resolved its composition entry at load and kept the result as its last good connection facts. When the `llm-deepseek` settings section attached and its snapshot failed the resolve step, the provider fell back to that value: calls went to the composition entry's endpoint with its key reference, while the section named another endpoint. The only record was a `ctx.logger` error, which a headless run does not show (BLOCKED-336). A settings document written before [the retry code list was removed](2026-09-26-one-retryability-verdict-for-the-breaker-and-llm-retry.md) takes this path: Schemastery keeps the unknown `retryPolicy.retryableCodes` key, and `resolveRetryPolicy` refuses it.

## Decision

- A last good value belongs to the configuration source that produced it. `setSource` clears it, so a section that has not resolved since it attached has none.
- With no last good value, every call fails with an `LlmError` whose code is `INVALID_SETTINGS` and whose message names the section and carries the resolve error. Nothing is sent. The refusal happens in `prepareCall`, before the circuit breaker's first-chunk guard, and the code is `unclassified`, so neither llm-retry nor the breaker retries or counts it.
- The registration keeps its captured retry policy, which no refused call reaches. The refusal is logged once per settings change.
- The namespace stays registered, so the Models page or an edit of the document can repair the section; the next snapshot that resolves restores service.
- A section that resolved once and later fails still keeps its own last good facts.

## Alternatives considered

- **Ignoring `retryableCodes` with a warning.** Before the first release, backends reject old on-disk formats, and the retry policy already refuses the key at load; ignoring it here would be a compatibility shim.
- **Refusing the registration with a `validate` hook, as `llm-pi-ai` does.** The section registers from an optional `ctx.inject` callback, and whether a throw there stops the boot is not established; a refused registration would also leave the Models page no section to repair.

## Consequences

- A headless run with such a document prints `dsh: INVALID_SETTINGS: …` and exits non-zero instead of calling another endpoint.
- `llm-pi-ai` refuses the same key through its `validate` hook, so its whole section fails to register. The base bundle mounts it without composition routes, so nothing is re-routed; the missing diagnostic is recorded under B-648.
- Verification: lane A's A-499, and the `dynamic-config.spec.ts` case that stores the removed key before start.
