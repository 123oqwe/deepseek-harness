# Agent Note: A retry under a new call id is the same action

Status: implemented

English | [中文](2026-10-03-a-retry-under-a-new-call-id-is-the-same-action.zh.md)

## Problem

The idempotency key is derived from the session, the call id and the arguments hash. After a crash, the resume closes an interrupted call with `TOOL_OUTCOME_UNKNOWN`, and the call's ledger entry stays `sent` under the dead process's generation. A model that retries the action under a new call id presents a new key: the ledger reserved it and the tool ran a second time, and the stranded `sent` entry never reached the reconciliation list (B-726; P4-12 acceptance[1]).

## Decision

- On resume, before the closers are appended, `settleInterruptedEffects` moves the `sent` entries of every call closed with `TOOL_OUTCOME_UNKNOWN` to `ambiguous` in one transaction (`markInterrupted`). A `run_code` call's entries include those of its code-mode sub-calls, whose action ids are `<callId>:ptc:<n>`. No generation is compared. The resume holds the session's write ownership before it repairs the log, so the holder that recorded the call no longer writes this session. If that holder is still running, its later `confirm` is refused because the entry is `ambiguous`, and nothing is sent twice. Unfenced entries move too.
- A reservation names its capability and the run whose lease issued its generation. `reserve` refuses it as `ambiguous-needs-reconciliation` when another key's entry in the same scope records the same capability and arguments and is either `ambiguous` because a crash left its outcome unknown, from any run, or `sent` and held by an older generation of the same run (`sameActionBlockers`). Each such `sent` entry moves to `ambiguous` in the same transaction. A settled entry does not stop the reservation, and neither does an entry with other arguments or another tool, nor a `sent` entry of this generation or of another run.
- Lease epochs are counted per run, so two generations compare only when they share a run. The ledger stores that run beside the epoch.
- Each `ambiguous` entry records its cause: `interrupted` (moved by the resume), `fenced` (moved by `reserve` from a holder whose lease lapsed) or `errored` (the tool reported an error). Only the first two stop another key. An `errored` entry stops its own key, as before: its outcome is a known failure, recorded as ambiguous because a failure may still have committed. Every native call is reserved and every error is recorded as `ambiguous`, so stopping other keys on `errored` would refuse an ordinary retry, such as reading a file that has since been created, until the host user resolves it (gate3 2026-10-04T02:45:37Z).
- The ledger file's schema version is 3, with `capability`, `lease_run` and `cause` columns and an index on scope, capability and arguments hash. A version 2 file is refused at open, as the pre-release stance has it.
- The reconciliation reply adds that the host user settles the effect with `/resolve-effect` and that the action must not be performed again under a new call.

## Alternatives considered

- **Derive the key from the content and drop the call id.** An identical repeat made on purpose would then always be a duplicate, which changes the key semantics an accepted epic rests on.
- **Rely on the reply text alone.** It already told the model not to retry blindly, and a model that retried anyway sent the effect twice.
- **Compare the stranded entry's generation with the resumed run's at resume.** The Run Service attaches the new generation in its own `agent/session-start` listener, and nothing orders that listener before another plugin's. The session's write ownership is the proof available where the log is repaired.
- **Compare generations across runs.** Each run counts its epochs from zero, so a live `sent` entry of another run could read as older and be moved to `ambiguous` under its holder.

## Consequences

- After a crash, the interrupted call's effect is in the reconciliation list as soon as the session resumes. In the resumed session, a retry of the same tool and arguments under any call id is refused until the host user settles the effect.
- An identical action repeated on purpose while an earlier one is unsettled is refused too, and the reply names `/resolve-effect`.
- Not covered: after a tool error, the same action under a new call id goes ahead, so a failed attempt that committed anyway can be performed twice. That is the existing limit of recording every error as `ambiguous`, and this change does not widen it.
- Not covered: a session that is never resumed keeps its `sent` entries until it is. Until then, a retry from another session meets them only when it is in the same run under a newer generation. An entry reserved without a capability is matched by its key alone; both shipped dispatch paths name the capability.
