# preFlight — P2-05 Fault stage (the policy decision boundary matrix)

Per lifecycle §1, written before any code. Measured at `ed5bbe16d3`, which is the tree carrying BLOCKED-187's mount slice — the engine mounted in `dsh-base` and the kernel decider wired. That matters for this stage's subject and is stated under *Reality set* below.

## Question 3 — each clause's subject, with the line that is it

| clause | subject | where |
| --- | --- | --- |
| must[0] five policy inputs | `toCedarRequest` builds principal / action / resource and a nine-key context | `policy-engine-cedar/src/index.ts:60-92` |
| must[1] closed decision | `PolicyEffect = 'permit' \| 'deny' \| 'ask'`; `ClosedDecision` carries effect, reason, policySet | `policy-engine/src/types.ts:147-158` |
| must[2] kernel enforces; plugins may only narrow | `composeDecision` folds constraints, then `enforceAction` binds through `kernel.policyEnforcement` | `policy-engine/src/evaluate.ts:46-67`, `policy-enforcement/src/index.ts:107-148` |
| must[3] explain trace, hidden from the model | `PolicyAuditRecord` → `kernel.auditAppend`; the model sees a closed reason code only | `policy-enforcement/src/index.ts:160-176` |
| acceptance[0] one PEP for every originator | `enforceManifestedAction` from both dispatch paths | `agent-loop/src/tool-calls.ts:262`, `core/tools/src/ptc.ts:684` |
| acceptance[1] any hard deny is final | forbid-overrides-permit inside Cedar; `composeDecision` cannot widen | `policy-engine-cedar/src/index.ts`, `evaluate.ts:56-58` |
| acceptance[2] the service resists replace/unmount | **contested — see Open questions** | `policy-enforcement/src/index.ts:96-99` vs `policy-engine/README.md` |

## The delegate's six candidates, measured before accepting any

Four already have live frozen cases. Writing them again would re-prove what the register already pins.

| candidate | measured | verdict |
| --- | --- | --- |
| provider unmounted mid-session | frozen TWICE — C: *"losing the provider denies by name"* (×2), U: *"losing the provider mid-session denies by name"* (×2) | **covered — drop** |
| policy set fails to load, loudly | frozen at P (*"refuses to LOAD when the policy set does not parse"*) and U (*"fails the mount loudly rather than deciding with a broken set"*) | **covered — drop** |
| Cedar `failure` mapping | frozen at P (*"maps a Cedar FAILURE to its own named deny"*, *"still tells an ordinary deny apart from that failure"*) and C (*"reports a malformed policy set as a FAILURE"*) | **covered — drop** |
| decision when no token is presented | frozen at U (*"refuses when NO token was presented and the policy requires one"*) | **covered — drop** |
| kernel with no decider | **no frozen case anywhere.** This is the state BLOCKED-187 found in production: `policyEnforcement` denies every query when `config.policyDecider` is absent (`trust-kernel/src/index.ts:169-171`), and `enforceAction` rewrites that into `policy-unavailable` (`policy-enforcement/src/index.ts:136-138`) | **real and new** |
| a constraint that throws | **no frozen case, and no guard.** `composeDecision` calls `constraint(request)` bare (`evaluate.ts:53`); an exception propagates out of `enforceAction` into the dispatch path | **real and new — and a defect** |

## The two that are real

### A kernel with no decider refuses everything, and nothing pins it

This shipped. Every tool call on a factory profile came back `policy-unavailable` because the kernel's placeholder overrode a real engine's permit, and no case anywhere would have caught it — the C and U cases about "losing the provider" are about the ENGINE being absent, a different producer of the same reason code. The fault case pins the state itself: a kernel constructed without a decider denies a decision the engine permitted, and the refusal is reported as `policy-unavailable`.

**The mutation that must redden it:** wire `endorseComposedDecision` into the kernel under test. If the case stays green with a decider present, it is not measuring the placeholder.

### A constraint that throws escapes as an exception rather than a refusal

`composeDecision` calls each registered constraint with no `try`. A constraint is plugin-supplied — `ctx.policyConstraints.register` takes any `(request) => string | undefined` — so a plugin can make a policy decision throw, and the exception leaves `enforceAction` and lands in whichever dispatch path called it.

Whether that is a defect depends on a reading this preFlight does not take:

- **It does not fail open.** The action does not execute; the throw becomes a tool error. So the security direction is right.
- **It is not a decision, though.** must[2] says a plugin may narrow and never widen. A plugin that throws produces no decision at all — not a deny with a recorded reason, not an audit record naming the constraint. The dispatch path reports an exception instead of a refusal, and the audit record for that action is never built.
- **One plugin can therefore break every dispatch** that reaches the enforcement point, without being able to permit anything.

**The honest options, for the delegate rather than for me:** (1) a throwing constraint is treated as its own named deny, with the throw's message as the constraint reason, so must[2]'s "narrow" covers it and the audit sees it; (2) a throwing constraint is refused at registration time, which cannot work because the throw is data-dependent; (3) it is recorded as accepted behaviour and the matrix pins the propagation. **I recommend (1)** — it is the only one that produces a decision, and "a plugin may narrow" reads naturally as "a plugin that fails narrows". But it changes what `composeDecision` returns, so it is a ruling, not a fault case.

## Reality set, and its relation to the mount slice and BLOCKED-191

F's reality set is the four files the registry declares for the stage plus whatever the freeze cites: `policy-engine/tests/monotonic.spec.ts` and `agent-loop/src/tool-calls.ts` are the declared pair. Two relations have to be stated because both were opened in the last day:

- **BLOCKED-187's mount slice is a PRECONDITION of this stage's subject, not part of it.** Before it, `enforceAction` on a shipped profile returned `policy-unavailable` for every call, so a fault matrix measured there would have been measuring the absence of an engine rather than the behaviour of a decision. The slice's own payload proof is in `evidence-P2-05.md`; F does not re-prove it.
- **BLOCKED-191 bounds what F can observe.** must[3]'s explain trace reaches no reader on a shipped profile: no session event, and an audit record that dies in a no-op sink. So every F case about the audit's CONTENT must observe it through a test sink, and cannot claim anything about the shipped path. The `policySet` field that separates the two `policy-unavailable` producers is exactly this problem, and it is why the kernel-without-decider case above asserts the decision rather than the record.

## The matrix, as it stands before the ruling

1. a kernel with no decider denies a decision the engine permitted, reported as `policy-unavailable`
2. the same kernel WITH the deployment decider permits it — the control that stops 1 from passing under any kernel
3. a constraint that throws *(shape depends on the ruling above)*
4. a constraint that returns a reason still narrows a permit to `constrained-by-plugin`, with the reason recorded — the control that keeps 3 from being read as "constraints are broken"
5. two constraints, one throwing and one returning a reason, in both orders — the same outcome either way, since acceptance[1] and validation[1] both turn on order-independence

## Question 4 — the execution card, re-read

The ledger row is `PROVIDER_ADAPT` / secondary `PROVIDER_WRITE`, with `cedar-policy/cedar` (`@cedar-policy/cedar-wasm` 4.12.0, form `runtime`, `landsIn: P2-05.P`) the single adopt. **F adopts nothing.** The card's §3.1 engine-slice rule (a consumer does not re-verify the engine) applies directly: none of the five cases above asserts a Cedar semantic — forbid-overrides-permit and default-deny are the C stage's conformance cases and stay there. `standardsOwned` is empty; AuthZEN ownership sits with P2-05 per §1's table but is a C-stage shape question, untouched here. The residual the card records — and this stage inherits — is that the decision's audit has no shipped reader, now tracked as BLOCKED-191.

## Open questions this preFlight does NOT settle

1. **The constraint-throw ruling above.** Required before case 3 has a shape.
2. **acceptance[2]'s wording against the provider's own README.** The clause says the policy service may not be replaced or unmounted; `policy-engine`'s README calls the provider an ordinary plugin, unmountable like any other, and the C/U cases freeze the *consequence* of unmounting it (`policy-unavailable`) rather than its impossibility. One of the two statements has to change, and it is an acceptance-surface question for P2-05.U rather than a fault case. Recorded in BLOCKED-187 already.
3. **validation[2]'s audit replay** cannot run on a shipped profile for the reason BLOCKED-191 records. Whether F owes a test-sink replay or whether validation[2] waits for the sink is the delegate's call.

## Draft for boundary ① only — the case, its control, and the mutation

Drafted per §5.1.13 assignment. **Not entered in `command-freeze.json`; nothing is frozen by this section.** Boundary ② is untouched, waiting on OQ7.

### What the existing harness makes hard, and why the draft does not reuse it

`enforcement.spec.ts`'s `stack()` helper always builds its kernel with a `policyDecider` — an inline lambda (`enforcement.spec.ts:65-66`) that endorses `permit` and refuses everything else. Two consequences decide the draft's shape:

- **No existing case can reach the state ① is about.** Every case in the file runs with a decider present. The one `createTrustKernel()` with no decider (`:250`) never dispatches an action — it asserts that a broken policy set refuses to mount — so the placeholder's deny is never observed.
- **That lambda is a copy, not the shipped decider.** It endorses `permit` only, so it would refuse `ask` where `endorseComposedDecision` endorses it. The control below therefore uses the exported symbol, exactly as `endorseComposedDecision`'s own JSDoc requires: *"a test asserting the enforcement point's behaviour uses the same symbol, so what is under test is the shipped decider rather than a copy that happens to look alike."*

So `stack()` needs one new option — which kernel to pin: none, or the shipped decider — rather than a second harness. Three values, not a boolean, because "no decider" and "the shipped decider" are two of them and the existing lambda is the third the file's other cases keep using.

### The two cases

**① the case.** Engine mounted with a policy set that permits the action; kernel built as `createTrustKernel()` with no `policyDecider`; run a turn that calls a tool.

- the tool does not run
- the closed decision's reason is `policy-unavailable`
- the audit record (observed through a test sink, per BLOCKED-191) carries the real `policySet` digest, not `EMPTY_POLICY_SET` — this is the field that separates the kernel-override producer (`policy-enforcement/src/index.ts:138`) from the engine-absent producer (`policy-engine/src/evaluate.ts:85-91`). Without it the case cannot tell itself apart from the already-frozen "losing the provider" cases in C and U.

**② the control.** Byte-identical setup except the kernel is `createTrustKernel({ policyDecider: endorseComposedDecision })`.

- the tool runs
- the decision is a permit carrying the same `policySet` digest

The control is not decoration: it is what stops ① from passing under a kernel that denies for any other reason, and it is the only thing that makes the mutation below meaningful.

### The mutation

**Wire `endorseComposedDecision` into ①'s kernel.** ① must redden — the tool runs and the reason is no longer `policy-unavailable` — and ② must stay green, since the mutation makes ① into ②. If ① stays green with a decider present it is not measuring the placeholder, and the case is void whatever else it asserts.

**The control mutation, in the other direction:** remove the decider from ②'s kernel. ② must redden and ① stay green. Running only the first mutation would leave a case that passes for both kernels undetected.

**What a mutation here must NOT be.** Deleting `endorseComposedDecision`'s body or its call site leaves the function unused and the build non-zero, which is the mistake retracted in `evidence-P2-05.md`: the snapshot then runs on a stale artifact and the proof reads as passing while measuring nothing. Both mutations above keep the build at exit 0 because they only move which kernel a test constructs.

### The shape of the file this lands in

Not `enforcement.spec.ts`. These are F-stage cases for P2-05 and belong with the epic's other fault cases; the freeze entry, when it is written, names the F command's argv and a `dryRunProof` from a real run. `stack()`'s new option is a change to `enforcement.spec.ts` that both files then share, and that change lands with the cases rather than ahead of them.

## Status

**No code written.** Two candidates are real, ② needs a ruling (OQ7) before it has a shape, ① is drafted above but not frozen, and four of the delegate's six are already frozen elsewhere.
