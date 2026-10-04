# Agent Note: Clients and retry read the typed outcome

Status: implemented

English | [中文](2026-10-04-clients-and-retry-read-the-typed-outcome.zh.md)

## Problem

U1 records `outcome` on `tool/result`. Epic P3-03 acceptance[1] also requires the SDK and the UI to keep the type, and acceptance[2] requires the retry policy to decide on it. The TypeScript SDK already passes events through typed by `SessionEvent`. The Python SDK read events as plain dictionaries with no accessor. The web row's state came from `isError`, an `interrupted` code and, on a shell row, the exit status its terminal card parses; it never named the kind. `retryClassOf` had no caller outside tests.

## Decision

- **Retry (delegate ruling Q-U4b).** For a model failure that carries no status, `isRetryableLlmFailure` takes the retry class of `outcomeOfModelFailure` first: `permanent` is not retried, `transient` is. `by-tool`, and every failure with a status, keep the shared `classifyFailure`, because a request that reached the provider may have had effects.
- **Python.** `ExecutionOutcome` (the six kinds as a closed literal, the detail fields, extra fields kept) and `tool_result_outcome(event)`; `RunResult.tool_outcomes()` lists the call id and outcome of each call in the run that did not succeed. A malformed outcome raises `SdkProtocolError`, as `finish_reason` does.
- **Web (delegate ruling Q-U4a).** `ToolResultNode.outcome` carries the event's field through the chat and trajectory projections. The row state reads it first: `cancelled` is stopped, every other kind is error; a result without one keeps the `isError`/`interrupted` rule. The row shows the kind as locale-owned copy (six `outcome.*` keys) in its suffix slot, and the bash row after its summary. A row that only its outcome marks failed keeps its collapsed summary, because its result text is the command's own output, not a failure line. The question row keeps its own verdict copy for `ASK_CANCELLED` and `ASK_ABORTED`.

## Alternatives considered

- **Keep `isError` for the state and show the kind only as a label.** A command that exited non-zero without a terminal card, such as a persistent-shell result, would still read as a successful row.
- **Apply the outcome's class to every model failure.** A timeout that carries a non-retryable status would be retried.
- **Return the raw dictionary from the Python accessor.** Nothing would check the kind.

## Consequences

- A shell row whose terminal card already showed a failing exit stays red and gains the kind label; a cancelled shell run, which its terminal card showed as failed by its signal, is now stopped.
- Rows of recorded sessions change only once their logs carry `outcome`, which U1's snapshot refresh adds.
- The TypeScript SDK is unchanged.
