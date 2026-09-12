# Policy

English | [中文](policy.zh.md)

How the harness decides whether an action may happen: what a policy question carries, what a closed answer is, what a plugin may add to one, and where the decision becomes enforcement. The vocabulary and the composition rule live in [`packages/policy/policy-engine`](../../packages/policy/policy-engine/README.md); the Cedar authorizer behind it is [`policy-engine-cedar`](../../packages/policy/policy-engine-cedar/README.md); the enforcement point is [`policy-enforcement`](../../packages/policy/policy-enforcement/README.md).

Source: [`packages/policy/policy-engine/src/types.ts`](../../packages/policy/policy-engine/src/types.ts)

<a id="a-policy-question"></a>

## A policy question

`PolicyRequest` carries five inputs and every one is required: the acting `Principal`, the capability token presented (or `undefined` where a deployment issues none), the `ActionManifest` describing what is attempted, the execution world, and the declared context facts. An optional input would let a caller omit one and receive a decision anyway, which is how an engine quietly starts answering a smaller question than the one it documents.

`world` is `{ kind: 'absent' }` on this tree. `ExecutionWorld` belongs to a later epic; the slot is declared so a policy that must know where an action would run can REFUSE when the world is unknown — different from a policy that never asked.

Context facts are a closed enumeration: the workspace's trust state (mirroring `@deepseek-ai/dsh-workspace-trust`) and the session's permission posture. A free-form fact bag would make adding a fact a silent policy change.

<a id="a-closed-decision"></a>

## A closed decision

`PolicyEffect` is `permit | deny | ask`, and `ask` means a human answer is owed. Use `isImmediatelyAllowed` rather than `effect !== 'deny'`: the latter reads as "allowed" and silently admits the state where nobody has answered yet.

Every decision carries the `PolicySetDigest` it was decided against, refusals included. A replay that cannot tell "the policy changed" from "the decision changed" proves nothing.

A `PolicyReasonCode` is closed because it crosses to the model: `no-matching-permit`, `forbidden-by-policy`, `constrained-by-plugin`, `approval-required`, `policy-unavailable`, `policy-set-invalid`, `missing-capability-token`. The matched policy ids and the engine's diagnostics stay in `PolicyExplain`, which reaches the audit trail and never a request.

<a id="what-a-plugin-may-add"></a>

## What a plugin may add

`PolicyConstraint` is `(request) => string | undefined` — deny-only by type, the same construction `ToolGuard` uses. `composeDecision` applies every registered constraint: a `deny` stays denied, a `permit` or an `ask` becomes a `deny` as soon as one objects, and order does not affect the outcome. Constraints are evaluated even after a deny, so the audit records everything that refused an action rather than whichever refusal came first.

There is no shape in which a plugin returns a permit, which is why order-independence is structural rather than a rule the composer applies.

<a id="where-a-decision-becomes-enforcement"></a>

## Where a decision becomes enforcement

`enforceManifestedAction` is called where a dispatch path has just appended its `ActionManifest` — the manifest IS the policy question, so a path that skipped the decision also skipped the manifest, which `assertManifestPrecedesExecution` already refuses. The engine answers, plugins may narrow, the pinned Trust Kernel binds the result and appends the audit record, and only then does the caller act.

Three failures stay distinguishable: an engine answered (`forbidden-by-policy` / `no-matching-permit`), the policy set could not be read (`policy-set-invalid`), or no engine is mounted at all (`policy-unavailable`). Collapsing any into the others would make a broken deployment look like a strict one.

The provider is an ordinary plugin and may be unmounted mid-session. What may not be lost is the enforcement, so the enforcement point answers `policy-unavailable` for itself rather than falling open.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpolicy--policyenginecontract"></a>

### `ctx.policy` — `PolicyEngineContract`

What a mounted policy provider answers, whichever engine a profile mounts.

Declared in the DEFINITION so the name means the contract rather than one implementation, and two providers cannot disagree about what `ctx.policy` is. The Cedar provider is `@deepseek-ai/dsh-policy-engine-cedar`.

```ts cordis-catalog
/**
 * Answer one policy question.
 * @param request - the five declared inputs.
 * @returns the closed decision the enforcement point acts on, plus the
 *   audit-only explain it appends.
 */
evaluate(request: PolicyRequest): PolicyEvaluation
```

Source: [`packages/policy/policy-engine/src/types.ts`](../../packages/policy/policy-engine/src/types.ts)

<a id="ctxpolicyconstraints--policyconstraints"></a>

### `ctx.policyConstraints` — `PolicyConstraints`

The registry a plugin adds a constraint to (must[2]).

A service rather than a bare array so a constraint disposes with its plugin's fiber: a plugin that unmounts must stop constraining, and a constraint that outlived its owner would be a policy nobody can find.

```ts cordis-catalog
/**
 * Register one deny-only constraint.
 * @param constraint - returns a reason to deny, or undefined to abstain.
 * @returns the disposer that unregisters it.
 */
register(constraint: PolicyConstraint): () => void

/**
 * Every live constraint, for the enforcement point.
 * @returns the registered constraints, in registration order.
 */
all(): readonly PolicyConstraint[]
```

Source: [`packages/policy/policy-enforcement/src/index.ts`](../../packages/policy/policy-enforcement/src/index.ts)

<a id="ctxpolicyset--policysetprovidercontract"></a>

### `ctx.policySet` — `PolicySetProviderContract`

Where an engine gets the set it enforces (Epic P2-10's Usage stage).

Declared HERE, in the definition, rather than on either side of the seam: the provider that resolves a deployment's policy set and the engine that decides against it must agree on what "the set in force" means, and neither of them owning the word is what keeps a second provider from meaning something else by it.

**`current()` is asked per decision, and returns the set and its digest together.** Both halves matter. Per decision, because the set changes under a running harness — a deployment edits it and the provider re-resolves. Together, because a digest fetched separately can describe a set the provider is no longer yielding: before this seam an engine re-read its policies per call while its digest was computed once at construction, so a reload moved the enforced rules and left every decision citing a set no longer in force.

```ts cordis-catalog
/**
 * The set to decide against, and the pin to record with the decision.
 * @returns the policy set in force at this instant.
 */
current(): CurrentPolicySet
```

Source: [`packages/policy/policy-engine/src/types.ts`](../../packages/policy/policy-engine/src/types.ts)
<!-- END GENERATED cordis-surface -->
