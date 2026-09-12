# Evidence package — P3-01 一等公民 ExecutionWorld Capability Seam

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured at `b4b57ff461`, covering the **Contract and Provider stages only**. The U and F stages are not in this slice, and this page says what that leaves unanswered rather than leaving a reader to infer it from a green cell.

**The U stage has since landed and its section is at the end of this page.** Three statements in the C/P sections below were true when measured and are now superseded by it, and they are kept rather than rewritten because they record what those stages could answer: question (3) ("no launched profile reaches any of this"), the single-variant `ExecutionWorldFact`, and the provider's zero callers. Read the U section before citing any of the three.

## Summary — what C and P can and cannot answer

| clause | verdict after C and P |
|---|---|
| must[0] the lifecycle states are the OCI ordering, `stopped` terminal | decided and cased; `stopped` has no successors, so one `WorldId` never names two confinements |
| must[0] a restore may narrow and never widen | decided as a digest comparison (`mayRestoreInto`) and cased |
| must[1] a `WorldSpec` answers all nine confinement dimensions | decided; `missingWorldSpecDimensions` reads `WORLD_SPEC_DIMENSIONS` rather than a second list, so a tenth dimension cannot leave the check behind |
| must[2] the local provider is a compat adapter over today's sandbox | built, and it refuses eight of the nine dimensions — the honesty is the content of the stage, not a gap in it |
| acceptance[0] a `ToolExecution` moves between providers without changing manifest or policy semantics | **only half provable, and declared**: the provider exposes no `execute`, which is the structural half. The cross-provider half needs a second provider and has none — see the declaration below |
| acceptance[1] no provider satisfying the policy fails closed, never degrades | decided and cased against constructed providers; the **policy** half is still unprovable because `ExecutionWorldFact` has one variant |
| acceptance[2] the handle cannot be forged by a model or a third-party plugin | closes at the P stage by construction: module-private `unique symbol` plus a `WeakMap` keyed on object identity |
| validation[3] a stopped world settles to one typed outcome | decided in C (`lifetimeExceededReason`) and delivered in P (`settle` / `expireIfOver`), including the refusal to ever report `lost-contact` |
| must[3] / U-stage clauses — the handle reaching a real agent request | **not in this slice.** `agent-loop/src/runtime-context.ts` is untouched, and the preFlight's unresolved question about the named contribution pattern is still unresolved |

## Question (2), stated once for both stages

`git ls-files` over `@deepseek-ai/dsh-execution-world`, excluding `tests/` and `*.spec.ts`, finds **exactly one production importer outside the package**: `packages/core/tools/src/types.ts:9`, which imports `WorldId` and `WorldProviderId` for the `ToolWorldBinding` record.

**`ToolWorldBinding` has no producer.** `git ls-files | xargs grep -ln ToolWorldBinding` returns the declaring file, the two subsystem pages, and a planning document — nothing constructs one. That is recorded in the type's own JSDoc ("do not read its presence as evidence that any tool call records a world today"), and it is repeated here because a later reader counting importers would otherwise find one and conclude the seam is in use.

**The provider has zero callers.** Nothing outside `execution-world`'s own tests calls `createLocalWorldProvider` or `selectWorldProvider`. For the C and P stages that is the correct state — the U stage is where question (2) must change — but it is the same state BLOCKED-215 describes as a defect in a later stage, so it is written down here rather than discovered at sign-off.

**The placeholder this epic exists to replace is still a placeholder.** `packages/policy/policy-engine/src/types.ts:97` remains `export type ExecutionWorldFact = { readonly kind: 'absent' }`, one variant. Neither of these stages touched it, per the preFlight's open question 3, which says that cross-epic edit is not authorised by that page. So acceptance[1]'s *policy* half — a policy refusing on where an action would run — is still unprovable, and the cases frozen under acceptance[1] prove the *selection* half only: provider choice fails closed and never degrades.

## Question (3): no launched profile reaches any of this

**No bundle row names `execution-world`.** `grep -rln execution-world packages/bundle/` matches one file and it is `packages/bundle/web-app/lib/tsconfig.tsbuildinfo`, a build artifact — there is no `cordis.patch.yml` entry in any bundle. The package ships no plugin and no service: it is types, pure decisions, and a provider factory a caller must construct. So the answer to (3) for every clause above is **not reached, on any profile**, and no 4.4c citation exists or is claimed.

This is a deliberate shape rather than missing wiring. `createLocalWorldProvider` takes its sandbox policy resolution as an option, so the decision about which composition owns a world is the U stage's to make; mounting a provider in `dsh-base` now would pick that answer before the clause that needs it exists.

## The declaration acceptance[0] needs, made at freeze time

The preFlight's open question 2 said this must be declared at freeze time rather than discovered at sign-off, so it is declared here.

**acceptance[0] requires one `ToolExecution` to switch across `local` / `container` / `microVM` without changing `ActionManifest` or policy semantics. Only a local provider exists.** No container or microVM provider is in scope for this epic (must[2] scopes it to the local compat adapter), so the cross-provider half of the clause is **not proved by these two stages**. What is proved is the structural precondition, and it is worth separating:

- `exposes no execute, so a provider swap cannot move the dispatch path` — the provider interface has no execution method at all, so there is no dispatch path for a swap to change. This is a property of the type, which is why it can be asserted with one provider.
- `ToolWorldBinding` is deliberately **not** part of `ActionManifest`, with the reason in its JSDoc: a manifest naming its world would produce a different `argumentsHash` per provider, which is exactly the manifest-semantics change acceptance[0] forbids.

The remaining half is the P4-08 acceptance[2] shape — a decision provable only against a constructed second provider — and it belongs to the conformance suite named in validation[1], not to this slice. `world.spec.ts`'s selection cases already drive `selectWorldProvider` with constructed providers; that is legitimate for the *selection* decision and is not a substitute for a second real world.

## C stage — observations

**Subject:** `packages/execution/execution-world/src/types.ts` (the four types and `WORLD_SPEC_DIMENSIONS`), `src/lifecycle.ts` (the transition table, the missing-dimension reader, provider selection, the restore rule, the expiry reason). **Cases:** `tests/world.spec.ts`, 17.

**The transition table has no edge back out of `stopped`, and that absence is the decision.** A revival edge would let one `WorldId` name two different confinements over time, making every audit record naming that id ambiguous; `restore` therefore mints a new world from a snapshot instead. The case `refuses every edge out of stopped, so one WorldId never names two confinements` is what holds it.

**Provider selection refuses rather than degrading, and the return type is what enforces it.** There is no partial result to return, so a caller cannot mistake a weakened world for the requested one. Three refusal reasons are kept distinct — `incomplete-spec` (refused before any provider is consulted, so no provider fills the gap), `no-provider` (none registered), `unsatisfiable` (every provider missed something, with per-provider unmet dimensions) — because an operator retries one and investigates another.

**Candidate order is the caller's registration order and the first satisfying provider wins.** "Most confined wins" would need a total order over nine dimensions that nothing in this harness defines; inventing one here would silently re-rank a deployment's own preference. The case `does NOT fall back to a provider that misses fewer dimensions` is the degradation acceptance[1] forbids, stated as a test rather than as prose.

**Sensitivity.** Recorded in the freeze entry: the mutation is inside `selectWorldProvider`, and it reddens exactly the degradation case while leaving the control (`selects the first satisfying provider`) green.

## P stage — observations

**Subject:** `packages/execution/execution-world/src/local-provider.ts`. **Cases:** `tests/local-provider.spec.ts`, 24.

**The provider refuses eight of the nine dimensions, and each refusal names a real property of the host sandbox.** Filesystem (every confining mode still leaves a readable root), network and IPC (the sandbox governs file effects only), process spawn and descendant ceilings, devices (anything but the sinks the sandbox always permits), secrets (a local world shares the host environment), resources (the sandbox expresses no ceiling), and tenant (a local world belongs to its host). Lifetime is the one partial: a wall-clock ceiling is delivered and a `detached` world is refused, so lifetime is not refused wholesale. `names EVERY unsatisfiable dimension at once` is the case that keeps the refusal from being a one-at-a-time probe.

**acceptance[2] closes by construction, not by a check.** The handle carries a module-private `unique symbol` and the provider resolves it through a `WeakMap` keyed on object identity, so a forged handle carrying a real world id and the right provider name is refused, and so is a handle minted by a *different instance of the same provider*. That second case is the one that distinguishes identity from shape: a structural check would accept it.

**`settle` is idempotent and `expireIfOver` outranks the caller's reason.** Asked twice, a settled world returns the same outcome, so a recovery path may ask again; a world past its wall clock settles as `timeout` even when the caller asked to terminate, because an expired world is not a failed world. And the provider never reports `lost-contact` — a local world cannot lose contact with itself, and saying so in a case is what keeps the outcome union honest rather than aspirational.

**Sensitivity, with a correction to what I first expected.** The mutation replaces the identity lookup with a structural one — a `Map<WorldId, LocalWorld>` populated at create, `mine()` reading `byId.get(handle.id)` instead of the `WeakMap` — and reddens **exactly one** case: `refuses a forged handle that carries a real world id and the right provider name`. I expected it to redden both forgery cases; it does not, and the reason is worth keeping. `refuses a handle another instance of the same provider minted` survives because each provider instance owns its own map, so a structural lookup *within* one instance never sees the other instance's world. That case is held by instance ownership, not by the symbol; the forged-handle case is what the symbol and the `WeakMap` hold. A first attempt at this mutation looked the world up in `live` instead, which reddened five cases including the positive control — it was a different mutation (it also broke every lookup of a stopped world) and proves nothing about identity, so it is not the one recorded.

## What a re-reader should check first

1. Whether `ExecutionWorldFact` has gained a second variant. Until it does, acceptance[1]'s policy half stays unprovable, and any later page claiming acceptance[1] is fully closed is over-reading these two stages.
2. Whether anything constructs a `ToolWorldBinding`. The importer count is 1 and the producer count is 0; a page that reports only the former would read as production use.
3. The preFlight's unresolved U-stage question — whether the runtime-context "contribution pattern" the ledger names is a request-context plugin, a session projection, or something `renderContextSections` assembles. It was not established then and is not established now.

## U stage — observations

Measured at the U branch tip. **Subject:** `policy-engine/src/types.ts` (the fact's second variant), `policy-enforcement/src/index.ts` (`world` into `EnforcementInput`), `core/tools/src/external-effect.ts` (`readExecutionWorldFact`), `core/tools/src/index.ts` (the `action/world-bound` event), `execution-world/src/plugin.ts` + `src/local.ts` (the registry and the provider row), `bundle/base/cordis.patch.yml` (the two rows). **Cases:** `execution-world/tests/registry.spec.ts` 17, `tests/world-fact.spec.ts` 6, `policy-engine-cedar/tests/provider.spec.ts` +1, `session-snapshot/tests/identity.spec.ts` +5.

**`world` was the last input the enforcement point supplied to itself.** `enforceManifestedAction` hardcoded `{ kind: 'absent' }`, so every policy question a shipped composition ever asked said the world was unknown even where one was mounted — BLOCKED-201's finding for `facts`, one field later, and its own comment states the rule this stage inherited: *a field a path may omit is a field every path eventually omits*. It now comes from `EnforcementInput`, read by `readExecutionWorldFact` beside `readPolicyContextFacts`, on **both** dispatch paths — the native one at `agent-loop/src/tool-calls.ts` and the code-mode one at `core/tools/src/ptc.ts`, which has its own `FAIL_CLOSED_WORLD` for a sub-dispatch with no agent. A world read by only one path would be must[2]'s bypass in the shape §12.35-2 already closed once for the reservation.

### The honest boundary of the corpus evidence, stated because "zero diff" would otherwise read as "wired"

**Most recorded scenarios run `danger-full-access`** (`cordis.yml`: `process.env.DSH_SNAPSHOT === undefined ? 'workspace-write' : 'danger-full-access'`). That mode maps to the `full-access` effect, which the local provider refuses **by dimension** — the sandbox confines nothing at that mode — so no world binds, no event is appended, and those fixtures are byte-identical after this stage. **That zero is not evidence of wiring.** It is an honest refusal, and an honest refusal and dead code produce the same empty log. The wiring is evidenced by the scenarios that run `workspace-write`, where the event appears.

**A second reading belongs beside it: running `workspace-write` is not sufficient either.** `snapshots/sdk/text-turn` runs that mode and is unchanged, because the world binds at the FIRST DISPATCH and that scenario makes no tool call. A reader checking "did this profile bind a world" must look for a dispatch, not for a mode.

### A defect this stage produced and caught, recorded because the zero would have vouched for it

The first `bindingFor` passed the sandbox's mode string straight through as the `WorldSpec` filesystem effect. **The two vocabularies differ by one name**: `dsh-sandbox` calls its widest mode `danger-full-access`, a `WorldSpec` calls the same thing `full-access`. The spec therefore carried an effect no dimension rule recognises — the local provider's per-dimension check had no case for it, answered "satisfiable", and `create` then refused. The result was a profile that bound **no world at all while looking exactly like an honest refusal**, which is BLOCKED-215's shape, and the corpus's zero diff would have been read as confirmation. `filesystemForSandboxMode` now translates the three modes explicitly and refuses an unknown one at the vocabulary boundary; two cases pin it, one mapping each mode and one requiring `undefined` for a mode the mapping does not know.

### acceptance[1]'s policy half: closed, with the control that shows what changed

The Cedar evidence is **one case with a byte-identical rule**: `forbid(principal, action, resource) when { context.world == "absent" }`. Before the second variant that rule forbade everything — `absent` was the only value the field could take, so "refuse when the world is unknown" and "refuse always" were the same policy and no deployment could tell them apart. Now `bound` is permitted and `absent` is still denied, by the same engine, with **the translation untouched** (`policy-engine-cedar/src/index.ts` still passes `request.world.kind`).

**A second Cedar case was written and deleted**, and the reason is part of the evidence: it matched on `context.worldProvider`, which would require widening the Cedar context — outside the ruling that authorised the type edit — and a rule keyed to the provider cuts against acceptance[0]'s "a provider swap does not change policy semantics". The narrower case is the stronger one.

### The fixture cost, and the two routes refused

The event carries two values that differ on every run: `world` is a `randomUUID()`, and `spec` digests a spec whose `workspaceRoot` is the run's generated temporary directory. **Re-recording alone could not fix that** — a refreshed fixture reddens on the next run — so `session-snapshot/src/identity.ts` tokenizes both as numbered placeholders (`{{world:N}}`, `{{worldSpec:N}}`), field-scoped to this event, beside the `{{run:N}}` and `{{message:N}}` rules that already exist for exactly this class of value. The control that keeps this from being a weakened normalizer: **`provider` stays raw**, so a provider swap still shows as a diff, and two different worlds in one log get different numbers.

Two alternatives were refused, and the reasons are recorded rather than the choice alone:

- **Not logging the event in U** would leave acceptance[0]'s audit half with no evidence at all, reducing the clause to its structural precondition.
- **Digesting the spec without the workspace root** would make two `workspace-write` worlds under different roots digest identically, which would make the cross-provider digest-equivalence case pass by weakening its own control.

### What U does NOT close

- **acceptance[0]'s cross-provider half stays open**, as the P stage declared. `tests/fake-provider.ts` is the shared second provider — built once here, reused by validation[1]'s conformance suite, which belongs to F — and what U proves with it is the narrow, stated claim: the same spec digests identically whichever provider builds the world, so a policy comparing confinement sees one answer across a swap.
- **`WorldAttestation` is untouched.** The Trust Kernel's `sandboxAttestationVerifier` returns `false` unconditionally (P0-02's deliberately inert slot), and the provider's `attest` produces evidence only. acceptance[2] closed by construction in P, so U needs no answer here and does not invent one.
- **`agent-loop/src/runtime-context.ts` is deliberately untouched** — declared in `preflight-P3-01-U.md` under RULING 1, adopted. A model-visible context section naming the world would make the provider identity part of the model's input, so the same action in two worlds would produce two different request bodies; acceptance[0] forbids exactly that, one layer out from the manifest digest the C stage refused it for.

### A control of mine that could not fail, and the second pipeline it hid

The per-file proof of the re-recorded fixtures was reported as "13 files, 0 unexplained differences". **It did not check the thing it existed to check.** The first version of the script asserted that each added `action/world-bound` record carried tokenized values; it crashed on a `KeyError` partway through, and the rewrite kept only the pairing and allowed-field checks. A fixture carrying a RAW per-run digest passed it.

What that hid is a second normalization pipeline. Session fixtures go through `redactSessionSnapshotIds` and came out correct; the SDK's `notifications.expected.jsonl` goes through `normalize.ts`'s legacy identity path, whose blanket rule replaces every uuid with `{{sessionId}}` — which stabilized `world` under a misleading name, and could not reach `spec` at all, because a 64-character digest is not a uuid. So four scenarios that had been re-recorded still failed, and **re-recording could never have fixed them**: the value changes on every run.

`scrubVolatileWorldBinding` closes the legacy half, scoped to this event's two fields, with `provider` left raw as the control. Three cases pin it. The rule this cost: a check that has not been shown to fail on a bad input is not evidence, so the restored proof script is itself controlled — a raw digest is injected first and the script must report BAD before its zero is worth reading.

**The affected fixture set is now taken from the gate rather than predicted.** The earlier prediction used `"preset":"workspace-write"` in the recorded log, which is the permission PRESET and not the sandbox mode — a different service's vocabulary. The gate reports seven, two of which (`missing-sandbox-runner`, `partial-landlock-child-failure`) declare `permission: read-only`: the local provider satisfies `read-only`, so those bind a world too, and no predicate over `preset` would have found them.
