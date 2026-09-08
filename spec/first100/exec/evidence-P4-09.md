# Evidence package — P4-09 Detached、Saved、Versioned 与 Nested Workflow

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured at `d3401ca734`. **§12.48-A(1) has since landed**, so the counts below are labelled as *measured* (what the audit found) and *now* (after the fix). Nothing in this file is left in the present tense about a state that no longer holds.

## Summary

Nesting closes. Registration and versioning were bypassed: the engine kept its own `Map` instead of the registry, so version admission, digest recomputation and the self-recursion check had no production caller. §12.48-A(1) put the registry in the path. What remains open is a *producer*: no shipped composition registers a definition, so nesting is reachable only from a test.

| clause | verdict |
| --- | --- |
| must[0] definition registered as a signed, version-pinned artifact | closes for pinning since §12.48-A(1); no producer registers one |
| must[1] a run references the digest | closes for resolution; the digest is never verified against the body |
| must[2] detached workflow held by the run service | closes |
| must[3] nested run inherits/decays budget, detects recursion | closes since §12.48-A(1) |
| acceptance[0] load/save executes no unverified code | closes narrowly, and weaker than it reads |
| acceptance[1] parent cancel propagates | closes |
| acceptance[2] child failure follows the declared policy | closes |
| acceptance[3] depth, total agents, total budget bounded | closes |

## must[0] — a definition is registered as a signed artifact with its version pinned

| question | answer |
| --- | --- |
| exists | `admitRegistration` (`workflow-registry/src/version.ts:69`) recomputes the digest from the body and refuses `digest-mismatch`; `DefinitionRegistry` (`src/store.ts:43`) holds versions per name and definitions per digest |
| production callers of `admitRegistration` | measured **0** outside its own package; **now 1**, through `DefinitionRegistry.register` on the engine's registration path |
| production callers of `DefinitionRegistry` | measured **0** outside its own package (the hits in `packages/client/ui-conversation/` are an unrelated class of the same name); **now 1** — the engine holds one |
| production callers of `WorkerThreadWorkflowEngine.registerDefinition` | **0**, unchanged — the only callers are in `tests/nested-run.spec.ts`. This is the open half. |

**As measured**, the engine did not use the registry it depends on. It declared `private readonly definitions = new Map<DefinitionDigest, RegisteredDefinition>()` (`workflow-worker-thread/src/index.ts:192`) and its register method is one statement:

```ts
registerDefinition(definition: RegisteredDefinition): void {
  this.definitions.set(definition.digest, definition)
}
```

So the digest was **stored as the caller gave it and never recomputed**. `admitRegistration` exists precisely to reject a registration whose digest does not match its body, and nothing on the production path calls it. The method's own JSDoc states the choice — "the digest is the caller's, not computed here… a registry that derived the digest itself would be attesting the bytes rather than recording an attestation" — which is a coherent position about *signing*, but it leaves must[0]'s version pinning to a store that no production code reaches.

`signer` is recorded and not verified, which the JSDoc also states: this build has no signature root. That part is honestly declared rather than implied.

## must[1] — a run references the digest

| question | answer |
| --- | --- |
| exists | `resolveDefinition` (`workflow-registry/src/types.ts`), called at `workflow-worker-thread/src/index.ts` in `startNested` |
| production callers | **1** cross-package — the engine's `startNested` |
| reached | yes — a script's `workflow()` call reaches it through the nesting port, on any profile carrying the `workflow` tool |

A run does reference a digest and a mismatch refuses the start. What it does not do is establish that the digest names the body it resolves to, because registration never checked.

`isCurrentDigest` (`version.ts:99`), which answers whether a run's pinned digest is still the current version, has **0** production callers.

## must[2] — a detached workflow is held by the Run service, and a disconnected UI or turn does not terminate it

| question | answer |
| --- | --- |
| exists | `WorkerRun` owns the worker, the lease and settlement; the engine captures the SubagentRuntime handle before returning the run so an engine HMR unload cannot stop a live run's children |
| production callers | the engine itself, on every start |
| reached | yes, unconditionally |

## must[3] — a nested run inherits and decays budget, capability token and trace, and recursion is detected

| subject | production callers | verdict |
| --- | --- | --- |
| `planNestedRun` (budget/limit decay) | **1** cross-package — the engine's `startNested` | closes |
| ancestor chain carried into the child's budget record | same call site | closes |
| `isSelfRecursive` | measured **0**; **now 1** via the registry | closes |

The engine's run-time recursion protection is the depth ceiling (`maxNestingDepth`, default 3) plus the ancestor chain it threads into each child's budget. The *structural* refusal — a definition that names itself never enters the registry — is `isSelfRecursive`'s, and it now runs on the registration path.

A second defect surfaced while wiring it: `declaresNestedCall` matched only a quoted first argument, `workflow('name')`, so it could not fire on `workflow({ name, digest })` — the shape a nested run actually carries. The check was a false negative in exactly its own case. Both call shapes are matched now.

## acceptance[0] — saving and loading do not execute unverified code

| question | answer |
| --- | --- |
| exists | the resolve step refuses a digest that is not registered or that resolves under another name, and no worker is spawned on refusal (`startNested`) |
| production callers | the engine's `startNested` |
| reached | yes |

As measured it closed only as written, and was weaker than it read: a definition's body is a string throughout the registry — registering cannot execute it — so the literal claim held, but nothing verified that a registered digest matched its body, so registering body B under digest A would make a run pinned to A execute B with no refusal anywhere. Since §12.48-A(1) the registry recomputes the digest and refuses the mismatch, so "unverified" now means what it says.

## acceptance[1] — a parent cancel propagates

| question | answer |
| --- | --- |
| exists | `cancelPropagationForNested` (`workflow-registry/src/nesting.ts`) |
| production callers | **1** cross-package — `workflow-worker-thread/src/host.ts` |
| reached | yes — a cancel reaches every nested run the parent holds |

## acceptance[2] — a child failure is handled per the declared policy

| question | answer |
| --- | --- |
| exists | `applyChildFailure` (`workflow-registry/src/nesting.ts`) |
| production callers | **1** cross-package — `workflow-worker-thread/src/host.ts` |
| reached | yes — on the nested-run failure path, which logs and continues or fails the parent per `ChildFailurePolicy` |

## acceptance[3] — recursion depth, total agents and total budget are bounded

| question | answer |
| --- | --- |
| exists | `maxNestingDepth`, `maxTotalAgents`, `maxNestedTokens` as validated `Config` fields; per-run decay through `planNestedRun` |
| production callers | the engine's `launch` and `startNested`, unconditionally |
| reached | yes — a nested run starts with its DECAYED limits, so the tree total is bounded rather than each run claiming the ceiling |

## What P4-09 needs before it is signable

The gap is one shape repeated: `workflow-registry`'s store half is complete, tested, and bypassed. `admitRegistration`, `DefinitionRegistry`, `isCurrentDigest` and `isSelfRecursive` have no production consumer, and the engine substitutes a `Map` that performs none of their checks. On top of that, `registerDefinition` — the only way a definition enters the engine — is called by nothing outside tests, so no shipped composition can start a nested workflow at all.

Two things would close it, and they are different in size:

1. **The engine holds a `DefinitionRegistry` instead of a `Map`.** Registration then goes through `admitRegistration` (digest recomputed, mismatch refused) and `isSelfRecursive`, and must[0], acceptance[0]'s real meaning and must[3]'s structural half all acquire the consumer they are missing. Contained: one field and one method in `workflow-worker-thread/src/index.ts`, whose behaviour change is that a registration with a wrong digest is now refused.
2. **A production producer for `registerDefinition`.** Nothing registers definitions, so nesting is reachable only from a test. Supplying one is a product question — where saved workflows come from (a settings file, a skill, a tool) — and is not decidable here.

**(1) is DONE** (§12.48-A(1)): the engine now holds a `DefinitionRegistry`, so `registerDefinition` recomputes the digest, refuses `digest-mismatch`, and refuses a self-recursive definition before it can be shipped or started. `admitRegistration`, `DefinitionRegistry` and `isSelfRecursive` each have a production consumer as a result. Two fixture consequences were themselves evidence the gap was real: the nested-run fixtures had been registering made-up digests, and the self-recursion case had relied on re-registering one digest with a *different body* — a trick only possible while nothing checked.

Measured while doing it and fixed in the same change: `declaresNestedCall` matched only a quoted first argument, `workflow('name')`, so it could never fire on `workflow({ name, digest })` — the shape a nested run actually carries. The self-recursion refusal was a false negative in exactly the case it exists for.

**(2) remains open.** Per §12.48-A(2) a saved workflow is a definition file under the profile's storage root, loaded at boot by a filesystem provider and registered through `admitRegistration`, in the same shape as `skill-filesystem` loading skills. That producer is not yet built; until it is, `registerDefinition` still has no production caller and nesting is reachable only from a test.
