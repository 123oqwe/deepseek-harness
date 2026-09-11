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

## Mount slice (BLOCKED-187): the enforcement point had no engine, and the kernel overrode the one it got

The PEP landed wired into both dispatch paths and failing closed, and no shipped bundle mounted an engine. Every tool call on a factory profile came back `policy-unavailable`. Attributed after BLOCKED-186's boot fix stopped masking it, and fixed in two places, because it had two causes.

### The three runs that located it

Same command each time — `pnpm run test:snapshot`, replay mode, no `--record`:

| tree | failed | `policy-unavailable` |
| --- | --- | --- |
| before the mount | 78 of 116 | 92 |
| engine mounted in `dsh-base` | **78 of 116** | **92** |
| engine mounted AND kernel decider wired | **0** | **0** |

The middle row is the one that carries the argument. Mounting the engine changed the outcome by nothing at all, which puts the refusal downstream of the engine's answer rather than at the engine's absence. The kernel's `policyEnforcement` denies every query when no `policyDecider` is configured (`trust-kernel/src/index.ts:169-171`), production configured none (`profile-boot.ts`, `createTrustKernel()` bare), and the enforcement point converts a kernel deny over a non-deny decision into `policy-unavailable` (`policy-enforcement/src/index.ts:136-138`) — the same reason code the engine-absent path emits, from a different producer.

### Payload proof, both halves

A mount nothing depends on proves nothing, so each layer was removed in turn and had to redden. Representative case `replays bash-tool-turn` in both:

| mutation | build | result |
| --- | --- | --- |
| the `policy-engine` row deleted from `bundle/base/cordis.patch.yml` | n/a (data) | 1 failed, `policy-unavailable` ×1 |
| the decider constructed but not handed to the kernel | **exit 0** | 1 failed, `policy-unavailable` ×1 |

Both sources restored and confirmed with `diff -q` against a pre-mutation copy.

The second mutation is written `(void endorseComposedDecision, createTrustKernel())` — the function stays referenced deliberately. The first attempt deleted the argument outright, which left the function unused, failed the build with TS6133, and ran the snapshot against a **stale artifact**: the case went red, but the red belonged to the broken build rather than to the removal. `void` suppresses TS6133 and is there for that reason, not for style. **A mutation must move the product, not the instrument; a build that does not exit 0 has not produced the thing under test.**

### What the greens had been resting on

`policy-enforcement/tests/enforcement.spec.ts:64-68` constructs its kernel with **a `policyDecider` and an `auditSink`**, and mounts the Cedar provider itself. Three things the shipped product did not have. `grep -rn policyDecider packages apps`, excluding the kernel's own source, returns exactly two hits: that spec, and the production wiring this slice adds. The spec's decider is `effect === 'permit' ? 'allow' : 'deny'` — the same shape the product now uses. The tests were never wrong about what the kernel should do; nothing had ever told the product to do it.

### The default policy set, and why its `forbid` is empty

One rule: `permit(principal, action, resource);`. Cedar denies when no permit matches, so an empty set is a refusal of everything rather than an absence of policy.

The `forbid` half is absent by measurement, not omission. The kernel hard-deny band is `['safety-critical']` (`risk-taxonomy/src/classify.ts:36`, with no `addedHardDenyClasses` in base), and no policy can match it: the request carries the manifest's `sideEffectClass` (`read | write | network | process | destructive`) and never a `RiskClass`, confirmed by `grep -c "riskClass\|RiskClass"` returning 0 against the Cedar provider. The one reachable class is `destructive`, which every manifest this profile produces carries — forbidding it denies everything. The band is enforced a layer earlier by `gateActionRisk` on both dispatch paths, so restating it in policy would be a second declaration of a live rule, free to disagree with the first.

An earlier draft defined the default set as an allow-list measured from the snapshot corpus. Corrected before it was written: the corpus is a fixture, not the product's whole behaviour, so an allow-list built from it denies the first real action it never recorded — this defect with the sign flipped. The corpus's role here is a regression oracle instead.

### Coverage note on the run that reports 0 failures

`115 passed | 1 skipped (116)`. The skipped entry is **not** a scenario: it is `refuses to look complete when it skipped a scenario this host cannot run` (`headless.snapshot.ts:864`), an `it.runIf(mode === 'refresh')` guard that does not execute in replay. All three scenario skip conditions were checked rather than assumed — `pwsh` is installed on this host so both pwsh scenarios ran, the host is darwin so all nine `platform: posix` scenarios ran, and the authored-recording condition applies only in record mode. No scenario was silently omitted. That guard exists because three pwsh fixtures once sat an entire epic behind the rest — green locally, red on CI — which is the same confusion between a skip and a pass that this note exists to rule out.

### The kernel's frozen cases did not move, and why that is the expected result

`pnpm exec vitest run packages/kernel/trust-kernel apps/cli --maxWorkers=2` → exit 0, **173 passed | 1 skipped (174)**. Nothing red, so BLOCKED-050's "a failing kernel case is an unlock signal, not a regression" judgement never had to be made.

That is the expected outcome, and the reason is the load-bearing part: **this slice does not fill BLOCKED-050's empty slot.** There is still no kernel-level policy provider, `policyEnforcement` still defaults to deny, and all six capabilities remain exactly as hollow as 050 describes. What changed is only that a factory assembly no longer lets the placeholder override a real engine's answer. P0-02's frozen cases pin the kernel's member count and `pinTrustKernel` behaviour, and a config parameter adds no member — so they were never going to move. Measured rather than assumed.

The one skipped entry is `built CLI lazy-search startup` (`apps/cli/tests/lazy-search-startup.compat.spec.ts:102`), a `describe.skipIf(!requireBuiltArtifacts)` behind the explicit `DSH_REQUIRE_BUILT_CLI_SMOKE=1` opt-in, unrelated to this change. Named for the same reason as the snapshot skip above: a skip and a pass are indistinguishable in a summary line.
