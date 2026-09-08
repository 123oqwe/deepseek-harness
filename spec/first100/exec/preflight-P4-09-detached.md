# preFlight — P4-09 must[2] `detached`

Per §12.61's ruling: **build it, do not withdraw it.** A `must` is a registry requirement and withdrawing one is the user's call, not the executor's or the delegate's. This document precedes any code.

Measured at `9000b374ec`.

## Why the finding stood, and what changed

BLOCKED-100 recorded that `detached` had no implementation: across `packages/workflow/*/src` and `packages/run/*/src` every `detach` occurrence is `detachInputSignal` (removing an event listener), and the only occurrence of the word "detached" is a `nesting.ts` comment stating that a detached run is NOT nested. That measurement still holds.

What changed is the **subject**. §12.61 names it: the Run service now exists and is accepted — P4-05/P4-07's lease, P4-06's journal, and resume. A detached run needs an owner that outlives the turn, and until this session there was none.

## make-vs-use — no new OSS, and more reuse than the ruling assumed

Expected: no new dependency; reuse `RunPlugin` + lease + journal. Measured, and there is a closer precedent than that:

| existing mechanism | where | what it already does |
| --- | --- | --- |
| `run_in_background` (default **true**) | `subagent/tool-subagent/src/index.ts:61,278,293` | Returns a durable id immediately and lets the child run past the call |
| settlement outbox + drain | `subagent/subagent/src/continuation.ts:503-517` | **"A settlement committed while the parent was gone reaches it on the next start rather than being lost with the process that could not deliver it"** — its own words |
| lease + `reclaim` | `run/run/src/index.ts` | An owner that survives the process, and a reclaim path for one that did not |
| journal + resume | `collaboration/workflow-journal`, `workflow-worker-thread/src/resume.ts` | Durable step receipts and reconciliation on resume |

**The "disconnect ≠ cancel" semantics §12.61 specifies already exist for subagent children.** The continuation seam drains on `agent/session-start` and `agent/pre-step` precisely so a settlement outlives a parent that went away. P4-09's `detached` should reuse that pattern — ideally that seam — rather than build a second answer to the same question. A second outbox with its own delivery triggers would be the `circuit.ts` mistake at the architecture level.

## 4.4a — consumers, and the launched profile that reaches them

The clause is about a workflow run that leaves its turn, so the consumer must be a real caller on a shipped path:

- **Producer**: `tool-workflow`'s run entry, which today notes "background collection remains deferred" (`tool-workflow/src/index.ts:7`) — that deferral is the gap this closes.
- **Owner**: `RunPlugin`, mounted in `packages/bundle/base/cordis.patch.yml:529` with a real `storePath`, and therefore reached by every shipped bundle that inherits base — `acp-app`, `headless`, `sdk-app`, `sdk-minimal`, `web-app`. This answers §12.20's third question: the path is reached on launched profiles, not merely present.
- **Re-attach**: `resume(runId, request)` exists, but §12.66 asked whether it attaches to a LIVE run or only restores a stopped one, and the answer is the second — with a hazard attached.

**Measured** (`workflow-worker-thread/src/index.ts:298`): `resume` calls `reusableSteps(...)` to reconcile the journal and then `this.launch(request, runId, reconciled)`. It **starts a new worker**. It does not attach to anything.

So calling `resume` on a live detached run would spawn a SECOND worker under one run id — two masters for one run, which is the hazard P4-07's lease exists to prevent and which this epic must not reintroduce through its own re-attach path. The two routes are therefore genuinely different mechanisms, not one with two entry points:

| launcher | route | mechanism |
| --- | --- | --- |
| still alive | observe / await / cancel a LIVE run | the registry's observation surface, NOT `resume` |
| gone | collect the result later | the settlement outbox, drained on the next `agent/session-start` or `agent/pre-step` |

`resume` keeps its own meaning — continuing an INTERRUPTED run — and a detached run that outlived its launcher and then died is exactly what it is for. What it must never be handed is a run that is still executing.

## Cancellation boundary (§12.66)

Two arms, and the negative one is what distinguishes detached from nested:

- `cancel(parent run)` → nested children cancel, **detached children do NOT**. This is the negative control; without it "detached" is just a word for a nested run.
- `cancel(detached id)` → it terminates.

The launcher (session id + parent run id) is RECORDED on the detached run, but recording is not ownership: the launcher is who started it, and the Run service is who owns it. A cancel that reached a detached child because its launcher went away would make "disconnect is not cancellation" false in the one case it exists for.

## Semantics to freeze (§12.61)

1. A detached run is held by the Run service and **holds its own lease**, renewed independently of the turn that started it.
2. The starting turn returns the run id immediately.
3. **Session end or UI disconnect does NOT cancel it** — disconnect is not cancellation.
4. An **explicit** cancel still propagates (P5-10's cancellation semantics).
5. It can be re-attached by run id to observe, await, or cancel.
6. It carries a capability token derived at start, attenuated from the parent's — the same mechanism as P4-09's other open finding, and the reason it still has authority after the turn that authorized it is gone.

Frozen cases: start detached → turn ends → the run is still alive with its lease renewed → re-attach by id retrieves the result; explicit cancel → it terminates; `cancel(parent)` leaves the detached child running while cancelling a nested sibling; launcher alive → observation surface, launcher gone → settlement outbox. **Mutation: "the turn ending cancels the run" must go red**, which is the one that distinguishes this from current behaviour.

## Dependency on the other open finding

Point 6 needs the capability-token slice, which is P4-09's other reopened finding. They share one mechanism: a nested or detached run derives a narrowed token from its parent's attenuable token. Building `detached` without it would leave a run outliving its turn **with no answer to what authorizes it** — worse than the current gap, because it would look complete. **The capability-token slice lands first, or both land together.**

## Status

**No code written.** Submitted for review per §12.64's ordering, which allows P4-11's C subtask to begin once this is with the delegate.
