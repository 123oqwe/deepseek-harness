# P2-05 — Policy Decision Service and monotonic deny

PreFlight, recorded before the first line of code. The machine-readable half is `clause-subject-audit.json`'s `preFlight.P2-05`; this page is the reasoning that half compresses.

## What the tree looks like at the moment of recording

Measured at `0b70339760`, not assumed:

| question | measurement |
|---|---|
| Is Cedar installed? | No. `require.resolve('@cedar-policy/cedar-wasm')` throws `MODULE_NOT_FOUND`. |
| Does `packages/policy/policy-engine` exist? | No. `packages/policy/` holds `capability-token`, `capability-token-file`, `risk-taxonomy`. |
| Does anything provide `ctx.policy`? | No. The only `'policy'` string outside tests is a Web fixture's `approval/policy` event field. |
| Is there a monotonic deny stage? | For TOOLS, yes. `ToolGuard` is `(execution) => string \| undefined` — deny-only by type — and runs after the extensible `tools/pre-execute` waterfall, so listener order cannot turn a denial back into permission. |
| Is there ONE enforcement point? | No. Tool calls pass `tools/pre-execute` + `ToolGuard` + `assertTokenPresented`; subagent spawn derives a token in `child-agent.ts`; a detached workflow derives one in the worker-thread engine. Three gates, one authority question. |
| Is BLOCKED-011's Cordis fix in place? | Yes — the vendored `Fiber` store pin behind `pinTrustKernel`. The sheet lists it as a hard prerequisite; it is met. |

## The verdict, and why it is not one verdict

`PROVIDER_ADAPT` with a `PROVIDER_WRITE` secondary. Cedar decides; **nothing about how a dsh action becomes a Cedar request exists upstream**, and that translation is the clause subject. The split matters because an epic recorded as pure adaptation would be measured against the wrong residual: adopting the engine closes must[1]'s overriding rule and acceptance[1]'s hard-deny property, and closes nothing else.

### Why an engine at all

The three properties this epic turns on — forbid overrides permit, default deny, and a matched-policy explain — are Cedar's documented semantics, with a Lean proof of the authorizer in `cedar-spec`. A hand-written evaluator would be a second set of semantics with no proof and the same surface area. That is the make-vs-use rule's central case: the library deletes owned code AND owned risk.

### Why not the alternatives

**OPA** (`@open-policy-agent/opa-wasm`) only evaluates wasm produced by the Go `opa build` CLI, making a Go toolchain a build prerequisite for a harness that ships as npm packages. **casbin** matchers are expression strings with no schema validation and no formal semantics, so the overriding rule would be a property of how the strings were written. **CASL** has no explain output, and must[3] needs a reason it can redact — an engine that cannot say why cannot have its why redacted. **OpenFGA, SpiceDB and Keto** are ReBAC servers: each makes a policy decision a network call, inside the tool-execution path, against the harness's local-by-default posture.

## What the closest community package proves, and what it disproves

`dsh-permission-rules` (102 stars) is ordered allow/deny/ask YAML on `tools/pre-execute` with **first-match** semantics — a nearer user allow overrides a baseline deny. That is precisely the property must[2] forbids, so the nearest thing to this epic in the wild is a counter-example rather than a starting point. It is still evidence about the SEAM: plugins want to express policy at `tools/pre-execute`, and they reach for the extension point this repository already has.

`dsh-auto-mode` decides from a raw `ToolExecution`. Four of must[0]'s five inputs — capability token, `ActionManifest`, `ExecutionWorld`, context facts — are not derivable from one.

## Stage shape, from the registry's own file list

- **C** — the decision vocabulary and the monotonic composition rule (`types.ts`, `evaluate.ts`, `monotonic.spec.ts`), plus the TrustKernel and user-approval faces the rule is enforced through. It must not import an engine: a composition rule that could only be tested with Cedar mounted would be a claim about Cedar.
- **P** — `policy-engine/src/index.ts`: the provider that translates a request into Cedar's entity/context shape and back. This is where the adoption lands (`landsIn: "P2-05.P"`).
- **U** — the PEP acceptance[0] asks for: `tools/src/index.ts`, `agent-loop/src/tool-calls.ts`, `cordis-host-runner/src/guard.ts`, `user-approval/src/index.ts`. The clause is a statement about unification, so the U stage is where it is either true or not.
- **F** — the fault matrix over `monotonic.spec.ts` and `tool-calls.ts`.

## Open questions this preFlight does NOT settle

1. **Acceptance[2] asks for more than the trust-kernel pin gives.** `pinTrustKernel` freezes the reflect-store `Impl` so the value cannot be forged by mutation. A service can also be LOST by unmount, which is a different attack and needs its own answer.
2. **Cedar's semantics are unprobed on this tree.** The row is recorded `differs`, not `ok`. It becomes checkable when the provider lands; the C stage's conformance cases are where it is proven.
3. **13 MB unpacked, CJS-loaded.** Fine for the host; not for the browser bundle. Whether any Client-face composition may mount the provider is a placement decision the P stage owes an answer to.
