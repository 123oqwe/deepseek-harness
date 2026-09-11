# Agent Note: The policy context facts are supplied by the dispatch path

Status: implemented

English | [中文](2026-09-11-policy-context-facts-are-supplied-by-the-dispatch-path.zh.md)

## Problem

`PolicyRequest.facts` declared the context facts a policy may read, and `enforceManifestedAction` took them as `facts?: Partial<PolicyRequest['facts']>`, filling the gaps with `'untrusted'` and `'default'`. A census of its two call sites — `agent-loop/src/tool-calls.ts` and `core/tools/src/ptc.ts` — found neither passed the argument. So every policy question any composition has ever asked carried those two constants, whatever the session's workspace or preset actually was, and `riskClass` was not in the request at all.

Nothing failed. A `Partial` with defaults produces a valid request from an empty input, and the defaults are fail-closed, so the omission showed up as a rule that never matched — indistinguishable from a rule that correctly did not apply. The prose one layer up said the opposite: *"The facts are read from what the composition actually mounts."* True of the function, false of the system.

The visible cost was in `packages/bundle/base/cordis.patch.yml`, where the Cedar row carried a paragraph explaining why the kernel hard-deny band could not be forbidden by policy: `safety-critical` was not in the value domain of anything Cedar received.

## Decision

**The dispatch path reads the facts and passes them; the type says so.** `EnforcementInput.facts` is required. The defaulting moved out to one reader, `readPolicyContextFacts` in `@deepseek-ai/dsh-tools/external-effect`, where an unmounted service is a decision with one home instead of a `??` at each point of use. `dsh-tools` is where it belongs for the same reason the external-effect reservation lives there: it is the package both dispatch paths can reach, so there is one implementation rather than two that can drift.

**Classification moves ahead of the manifest, not the gate behind it.** `enforceManifestedAction` runs before `gateActionRisk` on both paths, and that order is deliberate and documented — a claim on an effect the deployment will not permit would leave a `sent` row for something that never happened. So `classifyActionRisk` runs first and its `ActionRiskClassification` is handed to `gateActionRisk` as an argument. One action classified twice is two answers free to disagree, and the policy layer and the risk gate disagreeing about what an action IS would be the worst pair to have drift.

**The base bundle states the rule it had been explaining.** `forbid(principal, action, resource) when { context.riskClass == "safety-critical" };`. It is a second refusal of a band `gateActionRisk` also refuses, which the previous comment rejected as "a second declaration of a live rule, free to disagree with the first". It cannot disagree now: both read the one classification the dispatch computed, and the policy layer having its own say is what makes the audit record name the band as a policy decision rather than only as a gate that happened first.

## Alternatives considered

**Leave `facts` optional and just start passing it.** The wiring would work and the type would still permit the next dispatch path to omit it silently — which is exactly how this defect survived the epic that introduced it.

**Have `gateActionRisk` classify and hand the result to policy.** Would mean moving the risk gate ahead of the policy decision. The order is a real constraint, not an accident, and reversing it to avoid a parameter is the wrong trade.

**Read the facts inside `enforceManifestedAction`.** Tempting, and it would need no call-site change. It would also put a `workspaceTrust` and a `permissionPresets` dependency inside the policy layer, which sits below both, and it would make the enforcement point asynchronous.

**Make `PolicyContextFacts` an open record.** Rejected for the reason the type already states: a free-form fact bag makes adding a fact a silent policy change.

## Consequences

- `gateActionRisk` takes an optional fifth parameter. A caller that passes nothing still classifies for itself, so a composition that only reaches the gate behaves exactly as before. Every live P2-04 frozen case was compared by NAME before and after: all 60 still pass.
- The keyless snapshot suite is unchanged (115 passed, 1 skipped). No shipped tool declares a tag classifying `safety-critical`, so the new `forbid` is stated and unexercised outside the fixture — as `gateActionRisk`'s `hardDenied` branch has always been.
- **The permission posture is still a constant, and there is nothing to read it from.** `PermissionPostureFact` enumerates `default | plan | accept-edits | bypass`, and a whole-tree search finds those four names only in the declaration itself and its generated echo. The shipped preset table is `read-only`, `workspace-write`, `danger-full-access`, and preset names are deployment config, so no real posture can be spelled in that vocabulary. Recorded as BLOCKED-203; `readPolicyContextFacts` returns the literal with a comment naming it, and two CHARACTERIZATION cases pin it from both sides so whichever ruling closes 203 reddens them.
