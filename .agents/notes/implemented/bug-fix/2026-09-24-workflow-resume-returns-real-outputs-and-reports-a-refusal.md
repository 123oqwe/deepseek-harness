# Agent Note: The workflow tool resumes an interrupted run with its children's real outputs

Status: implemented

English | [中文](2026-09-24-workflow-resume-returns-real-outputs-and-reports-a-refusal.zh.md)

## Problem

P4-08 acceptance[0] asks that a workflow killed at an `agent()` boundary be resumed by a restarted host without repeating finished child work, and acceptance[1] that a resume under a changed script be refused visibly. On the shipped acp profile four gaps stood in the way. The `workflow` tool had no parameter that reached `engine.resume`; its parameter root accepts unknown keys, so a call carrying `resume` started a second run under a new id. The journal recorded the placeholder `agent-result-<seq>` as every completed step's output, so a resumed step handed the script that string instead of its child's value. A resume refused as `script-digest-changed` ran the script from its first step with nothing telling the caller. And the host journalled a step completed as soon as the worker reported it, while the child's `turn/end` could still sit in the session backend's write batch: a kill in between left a journal naming a finished step whose child log did not show it, and the resume started that child again.

With real outputs recorded, three more gaps showed. The worker reused a recorded step by its step number alone, and step numbers follow the order in which `agent()` calls start: a resume with different `args`, or of a script whose later calls start as earlier calls complete, handed one call the output another call recorded, and the host marked the step verified. A resume refused for a changed script restarted the run under the same id, and the restarted run's first journal write replaced the refused journal, so the interrupted run's record was lost. And the journal, which now holds its children's outputs, was written with the modes the process umask gives, where a session log is written for its owner only.

## Decision

- **`workflow` takes `resume: "<runId>"`** and passes the call's `script`, `meta`, `args` and parent to `engine.resume` under that id. The value must match `^[\w-]+$`, and `resume` with `detached: true` is refused.
- **The worker reports each completed `agent()` value as JSON text** on its agent-end message: the structured value, or the output text. The host hands it to the journal only, never to `workflow/agent-end` listeners, and the journal records it inline; a resumed step returns the parsed value.
- **A refused resume is reported on the run, not raised.** `Reconciled.refused` carries `admitResume`'s `reason` and `detail`, `WorkflowRun.resumeRefused` exposes them, the tool's closed output schema gains the optional `resumeRefused`, and the text the model reads begins with `resume refused (<reason>): the run started over from its first step.`
- **The host flushes a finished in-process child's session before forwarding its result to the worker**, with the same `ctx.sessions.flush` call `subagent/continuation-activation.ts` makes. A failed flush is logged as a warning and the result is still forwarded.
- **A recorded step is reused only for the call that recorded it.** The worker computes each `agent()` call's identity, `callDigestOf`: SHA-256 of its prompt, `schema`, `provider` and `model`. The journal records it as the entry's `call`, the host passes each reusable step's identity to the worker, and the worker starts the step again when the identities differ.
- **A resume refused for a changed script first moves the journal** to `refused/<runId>.<first 12 hex of its script digest>.json` in the journal directory (`setJournalAside`), so the restarted run writes a new `<runId>.json` beside it.
- **The journal directory is created with mode 0700 and each journal file is written with mode 0600**, as a session log is.

## Alternatives considered

- **Derive the output on the host side (verification V5).** Not chosen: the host would hold a second copy of the worker's rule for what `agent()` returns, and the frozen `runtime.ts` would have to export `outputText` with its export JSDoc. The worker reports the output, as the diagnosis's B2 describes.
- **Record a completed call reported without an output as having none**, as the diagnosis wrote it (`&& event.output !== undefined`). Not chosen: three frozen `journal-host.spec.ts` cases report completed calls without an output and assert that the step is skipped on resume. The observer keeps the placeholder for such a call.
- **Reject the placeholder in `resume.ts` when deciding what is reusable (A7).** Not chosen: the frozen `journal-resume.spec.ts` uses `'agent-result-1'` as its fixture output and asserts that it is reusable. The fallback sits in `runtime.ts`: a recorded output that is not JSON runs its step again.
- **Drive the end-to-end cases with a detached run (V4).** Not chosen here: the switch needs a delegate ruling. The cases use a foreground run and read its id from the journal file name.
- **Cap the size of an inline output (V8).** Not done: the write cost is stated in `AgentEndEvent.output`'s JSDoc, and a cap awaits a ruling.
- **Pass the model's `resume` value to the engine unchecked**, as the work order has it. Not chosen: the id becomes the journal file name (`join(directory, id + '.json')`, which is also written) and the lease row's name, so an unchecked value lets the model write a `.json` file outside the journal directory.
- **Keep the stub model's tool-call ids fixed at `stub-<n>`.** Not chosen: a session driven through two stubs in turn meets `stub-1` twice, so `StubToolCall.id` lets a case name its call; the default is unchanged.
- **Record the call identity in the entry's `inputs`**, the empty slot the blind review pointed to. Not chosen: compaction at settlement clears the `inputs` of every verified step, so a later resume of the same run would find no identity and start those steps again.
- **Add `args` to the digest a resume is admitted under.** Not chosen: it refuses a resume whose arguments changed, but leaves step numbers decided by completion order handing one call another's output; the identity check covers both.
- **Match a recorded step to a call by identity whatever its number.** Not chosen: it needs a second index over the journal, and the step-number key with an identity check is the smallest change that stops a wrong output from being returned.
- **Refuse a changed-script resume without running the script.** Not chosen: acceptance[1] refuses the resume and the run starts over, as above; the refused journal is kept instead.

## Consequences

- The host rewrites the whole journal at every step edge, so each inline output is written once per later edge; nothing caps an output's size.
- A journal written before this change holds placeholders and no call identities, and a resume reruns those steps.
- A refused resume still runs the script from its first step under the same id; `resumeRefused` is the caller's only sign that nothing was reused.
- A step whose number moved, because calls started in a different order than in the interrupted run, starts its child again rather than being matched to its record under another number.
- Nothing deletes a journal kept under `refused/`, and a later refusal of the same run under the same recorded digest replaces the copy kept before.
- A journal directory that already exists keeps its mode; only a directory the journal writer creates is 0700.
- `WorkflowExecution` constructed without call identities reuses recorded steps by number alone; the host always passes them.
- The tool refuses a `resume` value outside `^[\w-]+$`, for example one containing `.`; the worker-thread engine mints UUIDs, which match.
- The tool never shows a foreground run's id, and a crashed run returns no result, so on the shipped product nothing hands the model an id to resume; the end-to-end cases observe the tool resuming a run it is given (V4).
- When a child is disposed before its result is forwarded, for example by `dispose()` while a run still has a child running, the flush fails and the host logs a warning.
- `engine.resume` takes the run's lease first; when reconciliation throws or `launch` validation fails, the lease is not released until it expires 30 s later, and a retry with the same id is refused meanwhile. A model can now reach this path through the tool.
- A resume writes a second `tool-workflow/run-start` for the same run id in the same session, which the test invariant reports as a repeated run (A8).
- Journals are named by run id alone and record no owner, so any session that knows a run id can resume that run with its own authority.
- `stub-model.ts` has no unit tests; its coverage status is unchanged.
