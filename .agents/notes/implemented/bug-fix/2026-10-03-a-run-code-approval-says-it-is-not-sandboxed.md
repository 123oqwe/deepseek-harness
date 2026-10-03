# Agent Note: A run_code approval says the program is not sandboxed

Status: implemented

English | [中文](2026-10-03-a-run-code-approval-says-it-is-not-sandboxed.zh.md)

## Problem

`run_code` executes a model-written program in a host worker thread, which is containment and not a security boundary: the program can read and write any file the user's account can, including under `$DSH_HOME`, whatever the session's sandbox mode. Under `read-only` and `workspace-write` the call is asked about, because it declares no risk domain tags and so classifies as `security-sensitive`. The approval request showed the six P2-06 fields with the arguments redacted, and none of them said this (question 34; A-601 observes it on the shipped headless launch). On the Web card the detail line showed a `bash` command but not the program, which stayed collapsed in the transcript.

## Decision

- **A tool-declared notice.** `ToolDefinition.approvalNotice`, passed through `defineTool`, states what approving any call of the tool permits beyond the manifest's fields. It is static per tool and never model-visible. `run_code` declares: "This code does not run in the OS sandbox: it can read and write any file your account can, including $DSH_HOME."
- **The display carries it.** `approvalDisplayFor` takes the dispatched tool's notice and adds it as `ApprovalDisplay.notice`; the native, direct and code-mode dispatch paths all pass it.
- **Web.** The approval card shows the notice as the first detail row, labelled through the `approval` dictionary. The detail slot shows a call's `code` when it carries no `command`, so the program being approved is on the card with its line breaks.
- **ACP.** `session/request_permission` puts `Notice: …` first in the tool call's content. The program already reached the client as the `tool_call` update's `rawInput` before the request.

## Alternatives considered

- **Change `run_code`'s manifest `expectedDiff`.** The manifest is logged and digested, so every recorded-session fixture with a `run_code` call would change for a sentence that belongs to the approval, not to the action record.
- **Have each surface recognise `run_code` by name.** Every surface would then hold the fact and a new one would omit it; the tool that runs outside the sandbox is the one that states it.

## Consequences

- An approver on the Web or in an ACP client is told on the request itself that an approved `run_code` program can read and write any file the account can.
- The `headless` and `sdk` profiles mount no approval answerer, so there the call is still refused as `unavailable` and nobody sees the request.
- Not covered: running `run_code` in a sandboxed subprocess is P3-05's (question 34 (c)).
