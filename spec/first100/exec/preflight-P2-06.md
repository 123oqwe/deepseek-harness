# preFlight — P2-06 (审批绑定完整规范化参数、资源与前置状态)

Written 2026-09-11 by lane B during the push-wait, under the delegate's authorisation, same discipline as `preflight-P3-01.md`: every assertion carries a reading or is marked unverified.

## The premise, stated first

**P2-06 is not READY today.** Predecessors are `P2-03` (ACCEPTED) and `P2-05` (`status: NOT_RUN`, C/P/U/F all `GREEN`, `independentVerdict: PENDING`). Same single gate as P3-01: P2-05's sign-off, which the delegate is running now. P2-06 has **3 direct dependents** (`P1-11`, `P2-07`, `P8-04`), against P3-01's 14 — P3-01 was written first for that reason, and this page does not re-argue the order.

## The subject today, measured

`packages/interaction/user-approval` ships three source files and two test files. `src/types.ts` is 113 lines, `src/index.ts` 328, and `core/agent-loop/src/tool-calls.ts` — the `B` file P2-06 must touch in both C and U — is 653.

**What an approval request carries today is the whole gap.** `ApprovalRequestEvent` (`src/types.ts:66`), the payload declared for the answerer waterfall, has these fields: `agent`, `toolName`, `callId?`, `subject?`, `reason?`, `signal?`. `ApprovalRequest` (`src/index.ts:121`) extends it with nothing new for this purpose.

Against must[0] — "ApprovalRequest 引用 ActionManifest digest，并展示经脱敏的完整参数、资源、风险、预期 diff、有效期":

| must[0] requires | present in `ApprovalRequestEvent` today |
|---|---|
| `ActionManifest` digest reference | **absent** — `grep -n 'digest\|ActionManifest\|manifest' src/types.ts` returns **0 hits** |
| redacted full parameters | absent (`subject?: string` is a display string, not arguments) |
| resources | absent |
| risk | absent |
| expected diff | absent |
| validity window | absent |

So six of six are missing, and the first one is checkable in one grep. **P2-06 is not a hardening pass over an existing binding — the binding does not exist yet.** That framing matters for the stage shape below: `canonical.ts` and `preconditions.ts` are both `N`.

## The answerer distribution — the (B) problem, measured on this epic's own hook

The answerer seam is the waterfall `'approval/request'` (declared `src/types.ts:107`, dispatched `src/index.ts:300` through `scopeTarget(req.agent, req.agent)`). Listeners either return an outcome to claim the request or call `next()` to delegate.

`grep -rln "'approval/request'"` over `packages apps`, excluding `node_modules`, `lib/` and the generated `api-catalog`, gives 19 files. Separating them by what they actually are:

| role | file | reading |
|---|---|---|
| **real answerer** | `packages/acp/acp/src/index.ts:155` | `ctx.on('approval/request', (request, next) => …)`; claims only for agents it owns (`ownedRecord(request.agent)`) **and only when `request.callId !== undefined`** — otherwise `next()` |
| **real answerer** | `packages/client/ui-approval/src/client/index.ts:90` | `ctx.remote.$on('approval/request', function (request, next) …)` — the Web panel; `ApprovalPanel.tsx:28` is where a human's click calls `pending.answer(outcome)` |
| infrastructure | `core/scope/src/scoped-events.generated.ts:23` | the scope key, `args[0]['agent']` |
| infrastructure | `api/remotes/src/remote-events.ts:18` | declares the event `mode: 'waterfall'` for remoting |
| the service itself | `user-approval/src/{types,index}.ts` | declaration and dispatch |
| fixture | `client/connection/src/client/fixture.ts:3106` | a connection fixture, not a deployment |
| tests | 11 further files | `.spec.ts` / `tests/` / `apps/web/tests/*.e2e.ts` |

**So there are exactly two real answerers, ACP and the Web panel, and `grep -rn "approval/request" apps/cli packages/bundle packages/interaction/commands` returns zero** — no CLI, headless or terminal answerer exists. With no answerer the service fails closed by design, and it says so in model-visible text: `ASK_SENTENCE` (`src/index.ts:71`) reads "without an available answerer, the request fails closed."

**Why this bears directly on P2-06 rather than being background.** must[0] requires the request to *display* six things to whoever decides. Display happens in an answerer, and the two that exist are a protocol server and a React panel. So P2-06's own must[0] cannot be satisfied by changing `user-approval` alone — the payload can be widened there, but the rendering obligation lands in `packages/client/ui-approval` and `packages/acp/acp`, neither of which is in the registry's file list (`files` names only `user-approval/*` and `core/agent-loop/src/tool-calls.ts`). **Whether that rendering is in scope is open question 1.**

**A related finding of mine that is the same shape, reused rather than re-derived.** BLOCKED-215 (measured today, lane B) found P5-10's answer routing has no production path: `answerWaitingPoint` is the third, optional constructor parameter (`subagent/src/control-router.ts:76`), production's only construction site passes two arguments (`subagent/src/index.ts:664`), and `awaitHuman(waitingPointId)` has **zero** production callers. The pattern to carry into P2-06: *a human-decision seam can be fully written, typed and tested while no production path supplies the human.* P2-06's version of that risk is narrower and already partly real — the answerers exist, but only on two of the shipped profiles.

## Stage shape

| stage | count | files | what it must decide |
|---|---|---|---|
| C | 5 | `src/canonical.ts` (N), `src/preconditions.ts` (N), `src/types.ts`, `tests/argument-binding.spec.ts` (N), `core/agent-loop/src/tool-calls.ts` | the canonical form that the hash covers, the precondition set re-verified before execution, and the widened request type |
| P | 1 | `src/index.ts` | the service performing re-verification and invalidating on any field change |
| U | 2 | `core/agent-loop/src/tool-calls.ts`, `src/index.ts` | the binding reached from the real dispatch path |
| F | 2 | `tests/approval.spec.ts`, `tests/argument-binding.spec.ts` | TOCTOU, argument substitution, Unicode confusable, batch mutation (validation[1]) |

**P2-03 already owns the canonicalizer, and that is the main reuse question.** P2-03's frozen C cases include `objects with the same … SAME JSON value … numbers in different spellings … SECURITY: NFC and NFD are DIFFERENT values`, with a differential case against the RFC 8785 reference implementation. acceptance[1] here — "敏感值可 redacted 展示，但 hash 仍覆盖真实规范化值" — is about the same canonical form. **Whether `canonical.ts` wraps P2-03's canonicalizer or re-implements one is open question 2**, and the answer decides whether acceptance[1] inherits P2-03's RFC 8785 conformance or needs its own.

## Open questions this preFlight does NOT settle

1. **Where must[0]'s display obligation lands.** The six fields must be shown to a decider; the two real answerers (`acp`, `client/ui-approval`) are both outside the registry's file list. Widening the payload without rendering it satisfies the type and not the clause.
2. **Whether `canonical.ts` reuses P2-03's canonicalizer.** See above. Re-implementing would create a second canonical form, and acceptance[1]'s hash coverage would then be about a form nothing else validates — the "second copy of the truth nothing keeps honest" shape BLOCKED-206 recorded.
3. **What "切换账户" means on this tree** (acceptance[0]). Account identity would be the `Principal`, P2-01's noun; whether approval binds the principal and what re-verification compares it against is not established here. **Unverified**: I did not measure whether `ApprovalRequest` can reach a `Principal` at all.
4. **Whether the ACP answerer's `callId === undefined → next()` guard interacts with batch approval** (validation[1]'s "batch mutation"). A batch without per-call ids would be delegated past by the only protocol answerer. Measured: the guard is real (`acp/src/index.ts:157`). Not measured: whether any batch path exists today.
5. **How acceptance[2]'s one-to-one reference is audited.** The audit pair `approval/asked` + `approval/decided` exists and is enforced — `src/index.ts:237` rejects an ask outside an open turn precisely so the pair is enclosed by the durable log's commit boundary. Whether validation[3]'s "从 action 反查唯一 approval" needs a new query surface or a projection over those two events is unsettled.
6. **`layerStatus` is `AGENT_A_PROPOSED`** and `usageConsumers` is empty; this page adjudicates neither.
7. **No `verifyCommand`** — as with P3-01, the registry requires a manifest-registered focused command with fixture path and expected exit code before implementation, explicitly not guessed. None is proposed here.

## What this page deliberately does not do

No code, no command, no freeze, no ledger or coverage change. It also does not assert that P2-06's clauses are unsatisfiable — only that six of must[0]'s six fields are absent today, that the display half has no owner in the file list, and that the canonicalizer question must be answered before the C stage is frozen rather than after.
