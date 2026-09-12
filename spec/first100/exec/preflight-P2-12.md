# preFlight — P2-12 (全局 Emergency Stop 与通用 Human Interaction Channel)

Written 2026-09-11 by lane B during the push-wait, same discipline as `preflight-P3-01.md` and `preflight-P2-06.md`: every assertion carries a reading or is marked unverified. BLOCKED-215 and BLOCKED-219 appear only as precedent, never as a reading about this epic — P2-12's own surfaces were measured fresh.

## The premise, stated first

**P2-12 is not READY today**, and for the same single reason as the other two pages. Predecessors are `P2-05` and `P4-06`: `P4-06` is **ACCEPTED** (C/P/U/F all GREEN), `P2-05` is `status: NOT_RUN` with all four cells GREEN and `independentVerdict: PENDING`. One gate, P2-05's sign-off.

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

## Open questions this preFlight does NOT settle

1. **What "所有 surface 的状态一致" (acceptance[3]) ranges over.** Five profile templates ship, but only one answers both human verbs. Whether "all surfaces" means all profiles, all answerers, or all remote transports decides whether the clause is testable at all — and on the answerer reading it is nearly vacuous today, since there is one.
2. **Whether P2-12 adds the missing answerers or only the seam.** Three standards are declared (`MCP elicitation/create`, `ACP session/request_permission / elicitation_create`, `ACP session/cancel`), and ACP today answers approvals but not questions. If the seam lands without an ACP question answerer, must[0]'s `ask question` has one surface and the ACP standard is adopted in name. **This is the P2-06 ruling's question in a second place**, and it should be ruled the same way or deliberately differently, not left to the C stage.
3. **Where the durable stop is stored, and what "kernel 广播" means mechanically.** must[1] says the kernel broadcasts and persists it. The Trust Kernel's published surface is six members (`trust-kernel/src/types.ts`), none of them a broadcast channel, and `auditAppend` is the only write. Whether this is a kernel change (P0-02's file list) or a plugin that the kernel's policy entrypoint consults is unsettled; a kernel change would cross into another epic's files.
4. **How `kill execution world` is specified before P3-01 exists.** must[0] names the verb; `preflight-P3-01.md` measured that no world implementation exists and the type has one variant. Either this verb is specified against P3-01's contract and left unimplemented here, or P2-12 ships four verbs and declares the fifth deferred. Both are defensible; neither is chosen here.
5. **`process-shutdown.ts`'s reusability** — unverified, above.
6. **`layerStatus` is `AGENT_A_PROPOSED`**, `usageConsumers` is empty, and there is no `verifyCommand`; none of the three is adjudicated or guessed here.

## What this page deliberately does not do

No code, no command registered, no freeze, no ledger or coverage change. It also does not claim the epic is oversized — only that, measured, the stop has zero existing surface, one of the two human verbs has a single answerer, must[2]'s gate lands on a lease path that reads no stop state, and two of the five verbs depend on seams that are themselves incomplete.
