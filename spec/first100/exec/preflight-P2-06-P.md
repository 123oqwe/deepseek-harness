# preFlight — P2-06 P (审批绑定完整规范化参数、资源与前置状态,Provider 阶段)

Written 2026-09-12 by lane B at `fb04ae1d3b`, branch `lane-b-p2-06`. Table first. Continues `preflight-P2-06.md` and `preflight-P2-06-C.md`; neither is restated.

## The stage's one declared file, and what that says about the work

The registry gives P exactly one file: `packages/interaction/user-approval/src/index.ts`. That is the mounted service, and it is the right subject — **C decided what a binding IS and P is where one gets MADE and CHECKED against a real request**. The C stage's binder and verifier are pure functions over values; nothing calls them.

**The registry also names `preconditions.ts` as a C-stage `N` file, and C did not create it.** Recorded here rather than left as a silent divergence: the C stage bound preconditions as a `readonly string[]` the manifest already carries, because acceptance[0]'s "file inode / remote object version" reaches the binding as a precondition STRING rather than as a filesystem call this layer makes. A `preconditions.ts` that captured inodes itself would put a stat call inside the approval seam, which is the layering error the manifest's own vocabulary exists to prevent. **P does not create it either**, and if the delegate wants the capture to live in this package the ruling should say so before P freezes.

## What P must build, per acceptance clause

| clause | C already decided | P must build | how it fails if built wrong |
|---|---|---|---|
| **acceptance[0]** no substitution of parameters, account or object version survives | `bindApproval` captures the tuple; `verifyApprovalBinding` compares recorded against present and names the field that moved | The service MAKES a binding at `request()` — where the ask happens and the tuple is still the one the decider will see — and RETURNS it with the outcome, so a caller has something to re-verify against | **The failure is binding at the wrong moment.** A binding made at execution time binds what is about to run, not what was decided, and every test still passes: the recorded and present tuples agree because both were read after the substitution. The P cases must therefore make the binding at the ask and change the world between ask and verify |
| **acceptance[1]** redacted display, hash over the real value | the digest covers the unredacted canonical form; a redacted placeholder digests differently | The `ApprovalRequestEvent` carries the six display fields for the decider AND the binding, with the audit event `approval/asked` carrying the DIGEST rather than the values | **The failure is the audit event carrying the arguments.** `approval/asked` is durable session state a later reader replays; writing raw arguments there puts the secret in the log the redaction exists to keep it out of, and no test about display would catch it because display is a different surface |
| **acceptance[2]** one-to-one reference between the decision and the action | the binding carries the action identity | `approval/asked` and `approval/decided` already share an `ApprovalRequestId` (`src/index.ts:249-258`); P adds the other direction — the binding carries that id, so an action names exactly one approval | **The failure is a reference that only the approval holds.** Then "look up the unique approval from an action" is answerable only by scanning every approval, and two approvals for one action are indistinguishable from one. The case must fail when a second approval is minted for the same action |

**must[1]'s "re-verify before execution" is NOT P's.** The service can hand back a binding; the dispatch path that re-verifies it before running the tool is `agent-loop/src/tool-calls.ts`, which the registry assigns to **U**. P's obligation is that the binding EXISTS and is reachable; U's is that something consults it. Stating the split here so a P-stage case does not assert a re-verification no production path performs — that is the shape this program has now recorded five times.

## The validity period's clock owner: P names it, U supplies it

**Decision: the clock owner is the CALLER, and P's job is to make that explicit rather than to own a clock.** `verifyApprovalBinding(binding, present, now)` already takes `now` as a parameter (C), and P should mint `expiresAtMs` from a clock the composition provides rather than calling `Date.now()` inside the service.

The reasons, in order:

1. **A service that reads the wall clock cannot be tested for expiry without waiting.** Every other time-sensitive seam in this repository injects its clock — the world provider takes `nowMs`, the ledger takes a generation — and the alternative is a test that sleeps or a service that exposes a test hook, which the repository's own rule calls not-configurability.
2. **The expiry VALUE is a deployment choice, so it is `Config`, not a constant.** How long an approval stays usable is exactly the "deployment-varying choice" the no-hardcoded-tunables rule names.
3. **What happens to an in-flight execution when the approval lapses mid-dispatch is still U's**, and this page does not settle it. must[1] says re-verify BEFORE execution, so expiry is decided at the re-verification moment; nothing here introduces mid-execution revocation.

## The two real answerers, listed read-only

Neither is touched by P. Listed with line numbers so the U stage starts from measurements rather than a search, and so a reader can see what the six display fields must reach:

| answerer | entry point | what it builds today | what it does NOT carry |
|---|---|---|---|
| ACP | `packages/acp/acp/src/index.ts:155` — `ctx.on('approval/request', …)` | a `RequestPermissionRequest` with `sessionId`, `toolCall: { toolCallId }`, and two options (`allow_once`, `reject_once`) | the arguments, the resources, the risk class, the expected diff, the validity period, the manifest digest — the decider sees a tool call ID |
| Web | `packages/client/ui-approval/src/client/ApprovalPanel.tsx:26` — `answer(outcome)` | a card with the pending key and two buttons | the same six |

**One measured consequence for U, recorded now:** the ACP answerer delegates (`next()`) when `request.callId === undefined` (`:157`). Every ask that is not a tool call — the workspace-trust question is the live example — therefore reaches no ACP decider at all today. The six fields cannot be "presented to the decider" on a path that has no decider, so U's clause is about the tool-call path and the other path's absence is a limitation to declare, not a gap to fill by widening the guard.

## What this page does not settle

1. **Whether `preconditions.ts` should exist**, and if so whether capture belongs in this package or in the manifest's. C did not create it; P does not either.
2. **Where the binding is STORED between ask and re-verification.** Returning it from `request()` makes it reachable; whether the service also keys it by request id for an audit query (validation[2]) is a P-or-U question this page leaves open, and answering it by adding a map before a caller needs one would be the wired-code-with-no-caller shape.
3. **The `Config` shape for the expiry** — one duration for every approval, or per risk class. I lean to one duration until a rule needs more, because a per-class table with one value is a table pretending to be a policy.
