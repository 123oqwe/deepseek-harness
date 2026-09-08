# Evidence package — P5-11 通用 Taskboard、Mailbox 与 Blackboard 原语

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured on the working tree carrying §12.47 and §12.48-A(1); neither touches this epic's packages.

## Summary

The taskboard half closes. The blackboard half does not: `admitFact` and `traceToObservations` have no consumer outside their own package.

| clause | verdict |
| --- | --- |
| must[0] atomic claim, attempt, lease, owner, artifact outputs, verification status | closes |
| must[1] blackboard holds structured facts / artifact refs with provenance | **does not close** |
| must[2] roles, org chart and captain stay at the plugin/skill layer | closes, as a negative property |
| acceptance[0] concurrent multi-process claim has exactly one winner | closes |
| acceptance[1] the runtime advances task state from receipts | closes |
| acceptance[2] a dependency cycle is refused at submission | closes |

## must[0] — the Task record and its atomic claim

| subject | production callers outside its package | reached |
| --- | --- | --- |
| `decideClaim` | **2** — `run/taskboard-sqlite/src/store.ts`, `subagent/subagent-taskboard/src/index.ts` | yes |
| `decideRelease` | **1** — `run/taskboard-sqlite/src/store.ts` | yes |

`Task` carries `attempt`, lease, owner, artifact outputs and verification status, and `decideClaim` refuses a claim whose dependencies are unverified (`dependency-unmet`, `types.ts:110`). The SQLite store performs the claim inside `BEGIN IMMEDIATE`, so the decision and the write are one transaction rather than a check followed by a hopeful update.

## must[1] — the blackboard holds structured facts and artifact refs with provenance

| question | answer |
| --- | --- |
| exists | `Fact`, `FactProvenance`, `FactValue`, `admitFact`, `traceToObservations` (`collaboration/blackboard/src/index.ts`) |
| production callers of `admitFact` | **0** outside its own package |
| production callers of `traceToObservations` | **0** outside its own package |
| reached | **no** — nothing in a shipped composition writes or reads a blackboard fact |

The vocabulary and its admission rule are complete and tested; no path in the harness produces a fact or consumes one. `admitFact` refuses a fact whose provenance names an unknown observation, and `traceToObservations` walks a fact back to the observations supporting it — both correct, both unreached.

This is the same shape §12.44 rejected for P4-08's must[2]: a clause true of a function and of nothing the harness runs. It is recorded rather than papered over, and it is already queued — §12.27-3 proposes the blackboard as part of the P6 memory line, which is itself parked behind BLOCKED-155 / BLOCKED-156 pending the user's product ruling on default-on cross-session memory. **must[1] cannot close before that ruling**, because where facts come from is exactly what the ruling decides.

## must[2] — roles, org chart and captain stay at the plugin/skill layer

This clause is a negative: the primitives must NOT encode a role model. Measured as such — `collaboration/taskboard/src/types.ts` carries `owner` as an opaque identifier and no role, rank, captain or org-chart concept appears anywhere in the taskboard, mailbox or blackboard vocabularies. Nothing to call, so Rule 4.4a's caller count does not apply; what applies is that the absence is real rather than asserted.

## acceptance[0] — concurrent claims across processes have exactly one winner

| question | answer |
| --- | --- |
| exists | the claim runs inside `BEGIN IMMEDIATE` in `run/taskboard-sqlite/src/store.ts`, so the losing writer is serialized rather than racing |
| production callers | the task store's own `claim`, reached through `ctx.taskStore` |
| reached | yes — `subagent-taskboard` submits and claims on `subagent/start` |

The winner is decided by the database's write lock, not by application-level comparison, which is what makes the guarantee hold across processes rather than only across fibers in one process.

## acceptance[1] — the runtime advances task state from receipts, without the model updating anything

| question | answer |
| --- | --- |
| exists | `applyReceipt` |
| production callers | `run/taskboard-sqlite/src/index.ts` and `store.ts`, `subagent/subagent-taskboard/src/index.ts` |
| reached | yes — `subagent-taskboard` calls `applyReceipt` on `subagent/end`, then releases the claim |

The advance is driven by the child's own end receipt, so a model that never touches the board still sees its tasks progress. The release is fenced by attempt: `if (task.attempt !== attempt) return { released: false, reason: 'stale-attempt' }`, so a late release from a superseded attempt cannot free a task the next attempt now holds.

## acceptance[2] — a dependency cycle is refused at submission

| question | answer |
| --- | --- |
| exists | `validateTaskGraph` (`taskboard/src/types.ts:215`), returning `dependency-cycle`, `unknown-dependency` or `self-dependency` |
| production callers | **2** outside its package — `run/taskboard-sqlite/src/store.ts`, `subagent/subagent-taskboard/src/index.ts` |
| reached | yes — on submission, before any task is claimable |

Refused at submission rather than discovered at claim time, and the code says why: a cycle found at claim time presents as "nothing is claimable", which is indistinguishable from a board whose dependencies are merely unfinished.

## Signing position

Five of six clauses close on live consumers reached through `subagent-taskboard` and the SQLite task store. must[1] does not close and cannot be made to close by wiring alone — it needs a producer of facts, which is the P6 memory-line ruling the user has not yet given (BLOCKED-155 / BLOCKED-156). Recommend signing the taskboard clauses and recording must[1] as a directed deferral against that ruling, in the shape §12.46-B used for P2-03.
