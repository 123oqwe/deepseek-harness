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

1. **RESOLVED — delegate ruling 2026-09-11: rendering IS in scope.** The reasoning on the ruling: if must[0]'s six fields reach the payload and not the answerers, the epic is "the service can do it, production never arrives" **from day one** — the shape this program has now recorded four times. Both real answerers are admitted through `files-overlay` with the reason *"must[0] 无渲染即不可观测，答复者是决策者唯一看到请求的地方"*: `packages/acp/acp/src/index.ts:155` and `packages/client/ui-approval/src/client/ApprovalPanel.tsx:28`. The change is the minimum that discharges the clause — present the six to the decider — and the U stage proves it on a real `acp` profile rather than on the service alone.

   Two consequences this page records so the C stage does not rediscover them: the registry's `files` list does NOT name either answerer, so the overlay entry is what makes the edit legal; and `usageConsumers` is empty, so the U stage's subject has to be named when the command is registered.
2. **RESOLVED — delegate ruling 2026-09-11: reuse P2-03's canonical form, write no second canonicalizer.** P2-03's RFC 8785 differential conformance and its NFC/NFD distinction are already frozen; a second form would be the "second copy of the truth nothing keeps honest" of BLOCKED-206. **P2-06 does binding and digest only.**

   Measured, so the C stage knows this is implementable as ruled: `@deepseek-ai/dsh-action-manifest` already exports `canonicalizeArguments(args)` (`src/canonicalize.ts:70`) and `computeArgumentsHash(args)` (`:133`), both re-exported from `src/index.ts:13`. So the reuse is a direct import, not an extraction.

   **This changes what `canonical.ts` IS without removing it.** The registry still declares `packages/interaction/user-approval/src/canonical.ts` as an `N` file in the C stage, and it stays — but its content is the binding and digest over P2-03's functions, not a canonicalizer. Worth stating because the filename invites exactly the re-implementation the ruling forbids, and a later reader comparing the registry's file list to the ruling would otherwise see a contradiction.
3. **Left for the C stage to measure (delegate ruling: both remaining unverified items are C-stage measurements, not preFlight blockers).** What "切换账户" means on this tree (acceptance[0]). Account identity would be the `Principal`, P2-01's noun; whether approval binds the principal and what re-verification compares it against is not established here. **Unverified**: I did not measure whether `ApprovalRequest` can reach a `Principal` at all.
4. **Whether the ACP answerer's `callId === undefined → next()` guard interacts with batch approval** (validation[1]'s "batch mutation"). A batch without per-call ids would be delegated past by the only protocol answerer. Measured: the guard is real (`acp/src/index.ts:157`). Not measured: whether any batch path exists today.
5. **How acceptance[2]'s one-to-one reference is audited.** The audit pair `approval/asked` + `approval/decided` exists and is enforced — `src/index.ts:237` rejects an ask outside an open turn precisely so the pair is enclosed by the durable log's commit boundary. Whether validation[3]'s "从 action 反查唯一 approval" needs a new query surface or a projection over those two events is unsettled.
6. **`layerStatus` is `AGENT_A_PROPOSED`** and `usageConsumers` is empty; this page adjudicates neither.
7. **No `verifyCommand`** — as with P3-01, the registry requires a manifest-registered focused command with fixture path and expected exit code before implementation, explicitly not guessed. None is proposed here.

## What the two rulings together change about the stage shape

Recorded here rather than left implicit in the open-questions list:

- **The U stage acquires a real subject.** Before ruling (1) the U files were `tool-calls.ts` and `src/index.ts`, both service-side; the clause's observable half (six fields in front of a decider) had nowhere to be seen. With the answerers admitted, the U case is a real `acp` profile boot where the request carries the six and the protocol surface presents them. That is the same correction P4-01 needed — its U citation asserted a property no production path reached — applied before the freeze instead of after the withdrawal.
- **The C stage shrinks rather than grows.** Ruling (2) removes a canonicalizer from the work and leaves binding plus digest, so `canonical.ts` is thin and its cases are about what the digest COVERS (acceptance[1]: redacted display, hash over the real canonical value), not about canonicalization properties P2-03 already froze. A C case re-asserting key ordering or number spelling here would be re-proving another epic's clause, which is the "cases proving a different proposition" shape this program started by cataloguing.

## What this page deliberately does not do

No code, no command, no freeze, no ledger or coverage change. It also does not assert that P2-06's clauses are unsatisfiable — only that six of must[0]'s six fields are absent today, that the display half has no owner in the file list, and that the canonicalizer question must be answered before the C stage is frozen rather than after.
