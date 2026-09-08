# Evidence package — P5-10 Continuation、Steer、Human Input 与 Cancellation Convergence 修复

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured on the working tree carrying §12.47 and §12.48-A(1); nothing in those changes touches this epic's packages.

## Summary

Every clause closes. The subjects are the control router's decisions, and the router is instantiated per child by `SubagentRuntime` on the ordinary control path — not behind a flag, a config field, or an opt-in.

| clause | verdict |
| --- | --- |
| must[0] distinguish continue / steer / inject / cancel / human-answer | closes |
| must[1] each kind has a priority and state preconditions | closes |
| must[2] control messages are durable, epoched, idempotent | closes |
| must[3] cancel enters a convergence barrier before the terminal state | closes |
| acceptance[0] a steer/continue racing a cancel does not wake a cancelled child | closes |
| acceptance[1] a human answer reaches only its designated waiting point | closes |
| acceptance[2] a repeated control message produces no second turn | closes |

## The consumer is one object, so the reachability question is answered once

`ChildControlRouter` (`subagent/src/control-router.ts`) is constructed by `SubagentRuntime.controlFor(childSessionId)` (`subagent/src/index.ts:663`) and cached per child in `private readonly routers = new Map<SessionId, ChildControlRouter>()` (`:248`). Every control message for a child goes through that router. There is no second path and no bypass: a caller that wants to steer, cancel, inject or answer a child reaches `controlFor` first.

That makes question (3) the same for every clause below — reached on any profile that starts a continuable child — so it is stated here rather than repeated seven times.

## must[0] — the five control kinds are distinguished

| question | answer |
| --- | --- |
| exists | the `ControlKind` union carries `continue`, `steer`, `inject`, `cancel`, `human-answer`; `decideControl` switches on it (`control-convergence.ts`, `control-router.ts`) |
| production callers of `decideControl` | **2** — `control-convergence.ts` and `control-router.ts` |
| reached | yes, per the section above |

The kinds are a closed union ending in `assertNever`, so a sixth kind is a compile error rather than a silent default.

## must[1] — each kind has a priority and state preconditions

| question | answer |
| --- | --- |
| exists | `ChildControlRouter.admit` and `.decide` apply the preconditions; the priority table is `@deepseek-ai/dsh-control-priority` |
| production callers | the router's own `submit`/`submitBatch`, reached per above |
| reached | yes |

The priority rule is worth stating precisely, because it was corrected during this program: `control-priority` promotes exactly one kind. `const PROMOTED: ReadonlySet<ControlKind> = new Set(['cancel'])`, and `rankOf` returns 0 or 1. An earlier five-rank table was a measured regression (§12.25-1, corrected by §12.37) — it reordered messages that the receiving code required in arrival order.

## must[2] — control messages are durable, epoched and idempotent

| question | answer |
| --- | --- |
| exists | `recordApplied(controlEpoch)` on the router; the epoch rides every control message and a message whose epoch was already applied is refused |
| production callers | the router, on every admitted message |
| reached | yes |

Idempotence is enforced at the decision, not at the caller: a repeat is refused because the epoch was recorded, so a duplicate delivery cannot produce a second application no matter how it arrives.

## must[3] — cancel enters a convergence barrier

| question | answer |
| --- | --- |
| exists | `decideConvergence` (`control-convergence.ts`), with `addParticipant` / `participantStopped` / `observeCancelled` on the router |
| production callers of `decideConvergence` | **3** — `continuation.ts`, `control-convergence.ts`, `control-router.ts` |
| reached | yes |

The barrier is participant-counted rather than timed: `participantStopped` returns the convergence state, and the terminal state is only taken once every registered participant has reported. A child, an in-flight world effect and an action each register, which is what makes "confirmed stopped" a count rather than a wait.

## acceptance[0] — a steer or continue sent alongside a cancel does not wake a cancelled child

| question | answer |
| --- | --- |
| exists | `observeCancelled()` moves the router's `phase`, and `admit` refuses a waking kind in that phase |
| production callers | the router |
| reached | yes |

This is the clause the single-promotion priority rule protects: `cancel` outranks the others, so a cancel arriving with a steer is applied first and the steer then meets a cancelled phase.

## acceptance[1] — a human answer reaches only its designated waiting point

| question | answer |
| --- | --- |
| exists | `awaitHuman(waitingPointId)` records `private waitingPointId: string \| undefined`; an answer naming a different point does not satisfy the wait |
| production callers | the router |
| reached | yes |

The waiting point is an identifier rather than a boolean, which is the whole content of the clause: a child that is waiting for one question is not satisfied by the answer to another.

## acceptance[2] — a repeated control message produces no second turn

Same subject as must[2]'s idempotence: the epoch is recorded when the control is applied, and `decide` refuses an epoch it has already seen. The clause is about the observable consequence — no second turn — and the mechanism that delivers it is the recorded epoch, not a separate check.

## Signing position

All seven clauses have live subjects with production callers on a path reached by any profile that starts a continuable child. No deferral is proposed.
