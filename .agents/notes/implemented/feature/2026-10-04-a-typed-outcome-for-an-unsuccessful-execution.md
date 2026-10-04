# Agent Note: A typed outcome for an unsuccessful execution

Status: implemented

English | [中文](2026-10-04-a-typed-outcome-for-an-unsuccessful-execution.zh.md)

## Problem

Epic P3-03 asks for a typed outcome, `policy_denied`, `resource_exhausted`, `timeout`, `cancelled`, `tool_failed` and `world_lost`, decided from the control channel and never from output a program writes, so that retry decides by type and every surface keeps it. Today a tool result carries a structured error name and code at best, each consumer reads them its own way, and nothing names the six kinds.

## Decision

- **The vocabulary lives in `@deepseek-ai/dsh-execution-world`.** `ExecutionOutcome` is a closed union by `kind` with typed detail, and `retryClassOf` names each kind `permanent`, `transient` or `by-tool`.
- **Two closed mappings read structured facts only.** `outcomeOfToolError` reads a tool error's name and code, and `outcomeOfModelFailure` a model failure's code. A refusal name counts only with the pre-dispatch code `ABORTED_BEFORE_DISPATCH`; a name or code the tables do not know is `tool_failed`; names are looked up in a `Map`, so a prototype key is never a refusal.
- **Fence and lease are not policy.** `FencedError` is `cancelled` by `fenced` (the run held its work item and another holder took it over; permanent), and `LeaseRefusedError` is `world_lost` with `lease-refused` (another holder owns the item; a later attempt may get it). Neither is a refusal a policy made (the delegate's rulings, 2026-10-04).
- **The model mapping is here, read structurally.** `@deepseek-ai/dsh-llm` cannot import this package: this package already reaches the model layer through the sandbox and the session. `outcomeOfModelFailure` takes `{ code }`, which `LlmFailure` satisfies.

## Alternatives considered

- **A seventh kind for contention.** It names a refused lease exactly, but widens the six kinds the clause lists; `world_lost` with a reason carries it.
- **Put the vocabulary in `@deepseek-ai/dsh-llm`.** The model layer would then define a tool-execution vocabulary.

## Consequences

- Nothing records an outcome yet: a dispatch writing `outcome` on `tool/result`, structured names for guard and pre-execute denials, and the SDK and UI showing the kind follow in the Use stage.
