# preFlight — P2-12 (全局 Emergency Stop 与通用 Human Interaction Channel)

Written 2026-09-11 by lane B during the push-wait, same discipline as `preflight-P3-01.md` and `preflight-P2-06.md`: every assertion carries a reading or is marked unverified. BLOCKED-215 and BLOCKED-219 appear only as precedent, never as a reading about this epic — P2-12's own surfaces were measured fresh.

## The premise, stated first

**P2-12 is not READY today**, and for the same single reason as the other two pages. Predecessors are `P2-05` and `P4-06`: `P4-06` is **ACCEPTED** (C/P/U/F all GREEN), `P2-05` is `status: NOT_RUN` with all four cells GREEN and `independentVerdict: PENDING`. One gate, P2-05's sign-off.


**PREMISE SUPERSEDED 2026-09-11, later the same day.** P2-05 is now **ACCEPTED** (`independentVerdict: APPROVED`) on lane A's tip `2d62ab0430`, which this branch is rebased onto — P1-10 was accepted in the same advance, taking the ACCEPTED count from 25 to 27. **P2-12 is therefore READY now**, with an empty blocking set: `P2-05` and `P4-06`, both ACCEPTED. The premise above is kept as written because it records what was true when the census below was taken, and every reading on this page was measured against the pre-accept tree. Nothing in the census depended on P2-05's status, but that is an assertion a re-reader should check rather than take — the first thing to re-measure is named at the end of this page.

## Emergency stop does not exist today — measured, and the strongest reading on this page

`grep -rniE 'emergencyStop|emergency-stop|globalPause|pauseNewActions'` over `packages apps`, excluding `node_modules`, `lib/` and the generated catalog: **zero hits.**

Both new packages are absent: `packages/interaction/human-channel` and `packages/interaction/control-plane` do not exist. So every one of must[0]'s five verbs — `pause new actions`, `cancel run`, `kill execution world`, `ask question`, `resume` — has no named home, and two of them (`kill execution world`, `ask question`) depend on seams this program has separately measured as incomplete: the execution world is P3-01's and has no implementation (`preflight-P3-01.md`), and the question channel is measured below.

The adapt row agrees and says it plainly: `verdict: PROVIDER_WRITE / CONTRACT_WRITE`, `deletedPct: 5` — the lowest reuse share of the three epics I have preFlighted. `planError: None`.

## The human-interaction answerer census — measured on P2-12's own two hooks

The residual names a `human-channel` Service Definition with `askQuestion`/`requestApproval`/`notify`, "implemented by MCP-elicitation, ACP, CLI, web and IM answerers". Today those two verbs are two separate waterfalls with separate answerer sets. Counted the same way for both (all mentions, minus `lib/`, the generated catalog, infrastructure, the owning service, fixtures and tests):

| verb | waterfall | real answerers today |
|---|---|---|
| approval | `'approval/request'` | **2** — ACP (`acp/acp/src/index.ts:155`) and Web (`client/ui-approval/src/client/index.ts:90`) |
| question | `'user-questions/request'` | **1** — Web only (`client/ui-user-questions/src/client/index.ts:104`) |

**ACP answers approvals and does not answer questions.** `grep -rn 'user-questions/request\|elicitation' packages/acp/acp/src/*.ts` returns **zero**, even though `ACP session/request_permission / elicitation_create` is one of this epic's three declared standards. And no CLI answerer exists for either verb — `grep` over `apps/cli`, `packages/bundle`, `packages/interaction/commands` returns zero for both.

Both services fail closed with no answerer, and both say so at the seam: approval's `ASK_SENTENCE` (`user-approval/src/index.ts:71`) states "without an available answerer, the request fails closed", and questions reject through `noAnswerer` with code `NO_PROVIDER` (`user-questions/src/index.ts:130-133`).

**This is the measurement that reframes the epic's risk line.** The adapt row's `risk` says "today every remote plugin re-implements approval+question transport on `approval/request` and `user-questions/request`". As measured, the problem is narrower and sharper than re-implementation: **only ONE surface implements both verbs.** Four profiles ship (`acp`, `web`, `headless`, `sdk`, plus `sdk-minimal`), and on this count the Web profile is the only one where a human can both approve and answer. So the seam P2-12 is asked to unify has one complete implementation to generalise from, not five competing ones — which changes what "unify" can be evidenced against.

**Precedent, not evidence** (my own findings today, cited because the shape recurs): BLOCKED-215 found P5-10's answer routing fully written with no production path (`answerWaitingPoint` unpassed at the single construction site; `awaitHuman` with zero production callers). BLOCKED-219 found that a throwing `agent/pre-step` listener silently loses the user's message, with the only record in a `turn/end.reason` nothing reads. Both are about human-in-the-loop seams that typecheck and do not arrive. P2-12's must[3] — "Question 与 approval 分离，回答只作为输入，不自动授予权限" — is a property of exactly that kind, and validation[3] asks for it directly.

## What exists to build the stop on

- **`P4-06`'s outbox is real and ACCEPTED.** `packages/subagent/subagent/src/settlement-outbox.ts` exists with `commitSettlement`/`drainSettlements`, consumed by `continuation.ts:58`. The residual routes must[1]/acceptance[1]'s "terminate vs reconciliation-required" through it, and that dependency is satisfied rather than pending.
- **The lease seam exists and has no stop gate.** `packages/run/lease/src/plugin.ts:68` `acquire(workItem, worker, nowMs, leaseMs)` delegates straight to `store.acquire` (`store.ts:87`). must[2] requires a worker to check the stop before taking a new lease or action; **nothing in that path reads any stop state today**, which follows from the zero-hit grep above. This is where must[2] lands.
- **`apps/cli/src/process-shutdown.ts` is 77 lines** with `PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000`, a `ProcessShutdown` interface and `createProcessShutdown`. It is process teardown, not a durable stop — **unverified** whether any of it is reusable for acceptance[2]'s "重启后 stop 状态保持"; I did not read its body beyond the exported names.

## Stage shape

| stage | count | files | what it must decide |
|---|---|---|---|
| C | 5 | `human-channel/src/types.ts` (N), `control-plane/src/index.ts` (N), `control-plane/tests/emergency-stop.e2e.ts` (N), `sdk/protocol/src/types.ts`, `core/agent/src/inbox.ts` | the five verbs' vocabulary, the durable stop record, and the question/approval separation that must[3] requires |
| P | 1 | `human-channel/src/index.ts` (N) | the channel implementation behind the Service Definition |
| U | 4 | `apps/cli/src/process-shutdown.ts`, `core/agent/src/dispatch.ts`, `sdk/protocol/src/transport.ts`, `control-plane/src/index.ts` | the stop observed on a real dispatch path and across the remote transport |
| F | 2 | `control-plane/tests/emergency-stop.e2e.ts`, `core/agent/src/dispatch.ts` | stop injected before / during / after a tool start (validation[1]), and the partitioned-worker case (validation[2]) |

**`core/agent/src/inbox.ts` is a C file, and that is worth one line of warning.** It is the file P4-06's consume-once change rewrote, and the file I spent a measurement on today while chasing BLOCKED-219 (the splice pair that records insertion and removal). A C-stage edit there touches the path every turn's input takes. The ledger's `planError` is `None`, so nothing warns about it — this page does.

## What the C stage must decide, written against BLOCKED-215's four gaps

BLOCKED-215 is P5-10's answer routing: correct code, stated property, no production path. Its four gaps are a checklist for anything that routes a human answer, and P2-12 is the second such seam, so the C stage's must-list is written so that each gap is a type error or a failing case rather than a thing to remember.

| BLOCKED-215's gap | what the C stage must decide so it cannot recur |
|---|---|
| the delivery callback is the THIRD, OPTIONAL constructor parameter | **The answer-delivery seam is required at construction.** No optional parameter, no `?? noop` default. A composition that cannot deliver an answer must fail to construct, loudly, rather than construct and never deliver. |
| production's only construction site passes two of three arguments | **There is no construction shape that type-checks while omitting it.** This is the same decision from the caller's side, and it is the one that makes an argument-count comparison unnecessary. |
| `awaitHuman(waitingPointId)` has zero production callers | **Designating a waiting point is the only way to ask.** The ask entry takes the waiting point as a parameter, so no "ask without a destination" overload exists for production to reach for instead. |
| therefore `waitingPointId` is permanently `undefined` and the guard never fires | **Absence of a waiting point is not representable at the ask boundary.** A guard that cannot fire is worse than no guard: it reads as enforcement. |

Two more must-list lines come from the clauses rather than from 215, and both are about not granting authority by accident:

- **A question's answer is not an approval.** must[3] and validation[3] ask for this directly. The answer type must carry nothing an approval path can consume — no shared decision field, no boolean a caller could forward — so "answer as input, never as grant" is a property of the vocabulary and not of the code that happens to read it.
- **The stop is a durable record with an explicit release.** acceptance[2] says the stop survives a restart and must be lifted explicitly, so the C stage decides a stop VALUE (with its reason and its release) rather than a flag, and `resume` is a transition over that value rather than the absence of one.

### The two settlement cases this stage owes, named now so they are not discovered later

The registry/settlement half of the C stage must include both of these, because each is a way for a correct-looking router to be wrong about which waiting point it touched:

1. **Settling the WRONG id leaves every other waiting point untouched.** This is BLOCKED-215's acceptance[1] property stated as a negative: an answer routed by anything coarser than the waiting point's own identity satisfies some other outstanding question, and the only way to see that is to have two outstanding and check the one that was not addressed.
2. **Settling a VANISHED waiting point is refused and leaves a trace.** A settlement for an id that is gone — cancelled, timed out, or never registered — must be a typed refusal that is recorded, not a silent no-op. A no-op here is indistinguishable from success at the call site, which is how an answer that reached nobody reads as an answer delivered.

Neither case is satisfied by a fixture that supplies both the waiting point and the delivery callback, which is exactly what made P5-10's six C/P citations sound about a proposition and silent about production. The U stage is where delivery is observed on a real surface, per OQ2's ruling above.

## Open questions this preFlight does NOT settle

1. **What "所有 surface 的状态一致" (acceptance[3]) ranges over.** Five profile templates ship, but only one answers both human verbs. Whether "all surfaces" means all profiles, all answerers, or all remote transports decides whether the clause is testable at all — and on the answerer reading it is nearly vacuous today, since there is one.
2. **Whether P2-12 adds the missing answerers or only the seam.** Three standards are declared (`MCP elicitation/create`, `ACP session/request_permission / elicitation_create`, `ACP session/cancel`), and ACP today answers approvals but not questions. If the seam lands without an ACP question answerer, must[0]'s `ask question` has one surface and the ACP standard is adopted in name. **This is the P2-06 ruling's question in a second place**, and it should be ruled the same way or deliberately differently, not left to the C stage.

   **RULED (delegate, 補記 132), second half only — the first half of OQ2 stands open above.** P2-12 owns the seam AND the wiring of the answerers that already exist: the Web question answerer and both approval answerers (ACP and Web). It does NOT create new CLI or ACP question answerers — a new surface is another epic's work, and writing one here would make this epic's evidence about a surface it also authored. A surface with no answerer stays **fail closed**, which is what both services already do and say at the seam (`ASK_SENTENCE`, and `noAnswerer` with `NO_PROVIDER`); the stage shape below does not change to accommodate one. The U stage therefore observes **real delivery on a surface that has an answerer**, not a fixture answerer standing in for a profile that has none — so the Usage evidence is the Web profile's, and the absence elsewhere is recorded rather than simulated. What this ruling costs is stated plainly: the ACP standard for `elicitation_create` remains adopted in name for questions, and that gap belongs to whoever adds the answerer.
3. **Where the durable stop is stored, and what "kernel 广播" means mechanically.** must[1] says the kernel broadcasts and persists it. The Trust Kernel's published surface is six members (`trust-kernel/src/types.ts`), none of them a broadcast channel, and `auditAppend` is the only write. Whether this is a kernel change (P0-02's file list) or a plugin that the kernel's policy entrypoint consults is unsettled; a kernel change would cross into another epic's files.
4. **How `kill execution world` is specified before P3-01 exists.** must[0] names the verb; `preflight-P3-01.md` measured that no world implementation exists and the type has one variant. Either this verb is specified against P3-01's contract and left unimplemented here, or P2-12 ships four verbs and declares the fifth deferred. Both are defensible; neither is chosen here.
5. **`process-shutdown.ts`'s reusability** — unverified, above.
6. **`layerStatus` is `AGENT_A_PROPOSED`**, `usageConsumers` is empty, and there is no `verifyCommand`; none of the three is adjudicated or guessed here.

## What this page deliberately does not do

No code, no command registered, no freeze, no ledger or coverage change. It also does not claim the epic is oversized — only that, measured, the stop has zero existing surface, one of the two human verbs has a single answerer, must[2]'s gate lands on a lease path that reads no stop state, and two of the five verbs depend on seams that are themselves incomplete.
