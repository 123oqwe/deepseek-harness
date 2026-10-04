# Agent Note: A tool result records its outcome

Status: implemented

English | [中文](2026-10-04-a-tool-result-records-its-outcome.zh.md)

## Problem

Epic P3-03 acceptance[1] requires every class of failure to keep its type in the session log, the SDK and the UI, and must[1] requires that a program's output never decides it. The C slice gave the vocabulary (`ExecutionOutcome`) and the mapping from an error's name and code, but no `tool/result` carried an outcome. Several failures also had no structured facts to map: a pre-execute deny, a guard, an approval that was not granted, a post-execute block, a thrown error that is not a HarnessError, and a shell command that exited non-zero, which is a successful result whose facts sit in the tool's value.

## Decision

- **One field, one writer.** `tool/result` gains an optional `outcome`, a record the session package declares field for field (`ToolResultOutcome`) so the log owns its format; the session refuses an outcome of any other kind. The agent loop's single append writes `toolResultOutcome(result)`, so the fence, lease and skipped-call results get one too.
- **The producer that knows records it, beside the result.** The outcome is not a field of the in-memory result, so every existing comparison of a result's fields still holds; the registry keeps it in a weak map that each copy of a result carries, and `toolResultOutcome` reads it. The registry records `policy_denied` for its own refusals (from `policy` for a pre-execute deny, a guard and a post-execute block; from `approval` for an approval that was not granted). A thrown error maps through `outcomeOfToolError` from its own name and string `code`, HarnessError or not, so a provider's ceiling refusal and a lost sandbox are typed. Any other error result maps from its structured error info.
- **A tool reports a successful run that did not succeed.** `output.outcome` is a pure projection from the tool's validated value, beside `render` and `presentationMeta`. bash and pwsh report through `shellRunOutcome`: an abort, the executor's deadline, a signal or a non-zero exit, never the output or the sandbox's output-matched `denied`.
- **Crash repair** records a call whose outcome is unknown as `tool_failed` with `TOOL_OUTCOME_UNKNOWN`, which nothing retries on its own (the delegate's ruling Q-U1), and one that never started as `cancelled` by `interrupt`.
- **New rows**: `TOOL_TOKEN_DENIED` is `policy_denied` from `policy`; `WORLD_LOST` is `world_lost` with `lost-contact`. E2B's lost sandbox becomes `SandboxLostError` with that code.
- **Not model-visible.** The outcome is not rendered into the result content; the model reads the same text as before.

## Alternatives considered

- **Derive the outcome in the agent loop from error names alone.** The refusals without error info and every shell exit would read as an untyped `tool_failed`.
- **Give each unnamed refusal an error name and code.** It would change the recorded `error` of results that have none today, for a fact the producer already holds.
- **Import `ExecutionOutcome` into the session package.** A new edge from the session layer to the execution-world package for one type.

## Consequences

- Recorded sessions with a failed tool result gain an `outcome` field, and so do the SDK notifications that carry them; a clean result is unchanged.
- Shell denial is still parsed from output for the advisory hint, and bwrap/seatbelt runner failure still is; U2 moves both to out-of-band facts.
