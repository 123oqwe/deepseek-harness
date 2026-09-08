# Evidence package — P2-03 一等公民 ActionManifest

Per §12.34. Each clause gets the three questions: **(1)** does the subject exist, **(2)** how many PRODUCTION callers does it have (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`, `scripts/`), **(3)** is it REACHED on a launched profile (§12.20).

Tree: the P4-08 U supplement's working tree. Nothing in this package was modified by that change.

## must[0] — the manifest's fields

| question | answer |
| --- | --- |
| exists | `ActionManifest` (`action-manifest/src/types.ts`) carries every named field: `actionId`, `runId`, `actor`, `capability`, `target`, `argumentsHash`, `sideEffectClass`, `idempotencyKey`, `preconditions`, `expectedDiff`, `compensation`, `evidenceRequirements` |
| production callers of `createActionManifest` | **1** — `appendManifestThenGate` (`action-manifest/src/index.ts:90`); no caller outside the package constructs one directly, which is the intended single door |
| reached | yes — `appendActionManifest` (`agent-loop/src/tool-calls.ts:400`) sits inside `appendToolCall`, the single point every native tool call passes through, on every profile that runs the agent loop |

`runId` and `actor` come from `manifestAttribution(attachedIdentity(session), session.id)` together, not from the session id branded as a run id.

## must[1] — append the manifest durably, THEN gate

| question | answer |
| --- | --- |
| exists | `appendManifestThenGate` — construct, `appender.append(manifest)`, then `assertManifestPrecedesExecution` (`index.ts:86–94`); the order is the function body, not a convention |
| production callers | **3** — `agent-loop/src/tool-calls.ts`, `core/tools/src/manifest-log.ts`, `core/tools/src/ptc.ts` |
| reached | yes — unconditional on the native dispatch path; no flag, config field or capability guard stands between a tool call and it |

The appender is real durability, not a buffer: `createSessionManifestAppender` writes `action/manifest-appended` to the session log (`manifest-log.ts:80`), which is the harness's durable record.

## must[2] — code-mode embedded tools cannot bypass it

| question | answer |
| --- | --- |
| exists | the reserve/confirm pair lives in `core/tools/src/external-effect.ts` precisely so the code-mode dispatch reaches the same one (§12.35-2) |
| production callers of `reserveExternalEffect` | **2** — `agent-loop/src/tool-calls.ts:219`, `core/tools/src/ptc.ts` |
| reached | yes on both — the native path and the PTC/code path append through their own entry points into one shared implementation, which is what closed the earlier duplicate-sequence drift |

## acceptance[0] — every external write has a manifest PRECEDING it in the log

| question | answer |
| --- | --- |
| exists | `assertManifestPrecedesExecution`, called inside `appendManifestThenGate` and separately by `gateExecution` for a path whose arguments were rewritten after the manifest |
| production callers | as must[1]; `gateExecution` additionally exists for the rewrite case |
| reached | yes — and answerable by reading one session log in order, with no clock or join, which is the property the placement buys |

## acceptance[1] — stable argument canonicalization

| question | answer |
| --- | --- |
| exists | `computeArgumentsHash` over `canonicalizeArguments` (`canonicalize.ts`) |
| production callers | **2 outside the package** — `agent-loop/src/tool-calls.ts:402`, `core/tools/src/ptc.ts` |
| reached | yes — every native call hashes its arguments before the manifest is built |

## acceptance[2] — an unclassifiable action defaults to high risk AND requires approval

**This clause does not close, and the two halves fail differently.**

| half | subject | production callers | verdict |
| --- | --- | --- | --- |
| defaults to high risk | `classifySideEffect(undefined)` → `{ sideEffectClass: 'destructive', classified: false, requiresApproval: true }` (`canonicalize.ts:154`) | reached on **every** native call — the tool registry carries no declared class at that point (`tool-calls.ts:389`), so this is not an edge case but the standing behaviour | **closes** |
| requires approval | `manifest.requiresApproval` | **0 enforcing consumers** | **does not close** |

Measured for the second half: `requiresApproval` is read in exactly two production places, `core/tools/src/manifest-log.ts:48` and `:87`, and both are the same act — copying the flag into the `action/manifest-appended` session event. Grepping every `packages/interaction/*` and `packages/policy/*` source for `requiresApproval`, `sideEffectClass` or `manifest-appended` returns nothing. The only readers of the event itself are the session's own type table, the tools package that writes it, and snapshot normalization.

So an unclassifiable action is durably recorded as requiring approval and is then executed without one. The gate that does run is `assertManifestPrecedesExecution`, which asks whether a manifest preceded the call — a different question from whether the approval the manifest demands was obtained.

This is the shape §12.44 rejected for P4-08 must[2]: a clause true of a computed field and of nothing the harness enforces. It is smaller than that one — the producer exists and the value is right — but the enforcement half has no consumer at all, so predicate (i) fails for acceptance[2] and **P2-03 is not signable as it stands**.

**The obvious owner is out of reach, and that is the decision to make.** P2-04 (通用副作用与风险分类体系) is the classifier this flag wants: `classify` and `KERNEL_HARD_DENY_CLASSES` exist in `packages/policy/risk-taxonomy/` and, measured, have **0** production callers outside that package. But P2-04 is W5 and depends on P2-03, so P2-03 cannot be signed on a consumer that a later wave builds — that is the wave order, not a preference.

Two ways out, both rulings rather than measurements:

1. **Enforce inside P2-03**, through the approval/interaction capability that already exists at W4: an action whose manifest says `requiresApproval` does not dispatch until approval is obtained. Faithful to acceptance[2]'s wording. It changes behaviour on **every** native tool call, because `classifySideEffect(undefined)` marks all of them unclassifiable today — so it would gate the whole tool path behind approval until declared classes arrive, which is almost certainly not wanted as it stands.
2. **Rule that P2-03 owns the DECLARATION and P2-04's U stage owns the enforcement**, sign P2-03 with acceptance[2]'s second half recorded as deferred to a named epic, and make that deferral part of P2-04's readiness gate so it cannot be lost.

**Ruled §12.46-B: (2).** P2-03 owns the declaration; enforcement is P2-04's Usage subject. The deferral is recorded as BLOCKED-159 with `landsIn: P2-04.U` and carried by P2-04's readiness gate, and the product fact — recorded as requiring approval, then executed without one — is in `packages/action/action-manifest/README.md`'s Known Limitations rather than only in this file.

**Signing position.** must[0], must[1], must[2], acceptance[0] and acceptance[1] close on measured production consumers reached unconditionally on every profile. acceptance[2] closes on its first half and is deferred on its second under §12.46-B.
