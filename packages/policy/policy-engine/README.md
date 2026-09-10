---
description: "Policy decision vocabulary and monotonic composition for Epic P2-05, for maintainers wiring an enforcement point or writing a policy provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-policy-engine

English | [中文](README.zh.md)

## Summary

`dsh-policy-engine` fixes what a policy question IS in this harness — identity, capability token, `ActionManifest`, `ExecutionWorld` and declared context facts — what a closed answer carries, and the one rule that governs how plugins may affect an answer: they may narrow it and never widen it. It holds no policies, mounts no service and imports no engine; the Cedar provider is `@deepseek-ai/dsh-policy-engine-cedar` and the enforcement point belongs to the Trust Kernel. Read it when writing either, or when deciding what a plugin is allowed to contribute to a decision.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### A policy request carries five inputs, and all five are required

`PolicyRequest` declares identity (P2-01's `Principal`), the presented capability token (P2-02), the `ActionManifest` (P2-03), the execution world (P3-01), and the declared context facts. None is optional. An optional input would let a caller omit one and still receive a decision, which is how an engine quietly starts answering a smaller question than the one it documents.

`world` is present in its `absent` form on this tree, because `ExecutionWorld` is P3-01's to design and does not exist yet. `absent` is a value a policy can match on, not a missing field: a policy that must know the world can refuse when the world is unknown.

Context facts are a closed enumeration — a workspace trust state mirroring `@deepseek-ai/dsh-workspace-trust`, and the session's permission posture. A free-form fact bag would make adding a fact a silent policy change.

### A decision is closed, and `ask` is not a soft deny

`PolicyEffect` is `permit | deny | ask`. `ask` means a human answer is owed and comes only from a policy; nothing a plugin returns can produce it, and nothing a plugin returns can turn a `deny` into one. Use `isImmediatelyAllowed` rather than `effect !== 'deny'`: the latter reads as "allowed" and silently admits the state where nobody has answered yet.

Every decision carries the `PolicySetDigest` it was decided against, including a refusal. A replay that cannot tell "the policy changed" from "the decision changed" proves nothing.

### What a plugin may contribute

`PolicyConstraint` is `(request) => string | undefined` — deny-only by type, the same construction `@deepseek-ai/dsh-tools`'s `ToolGuard` uses. `composeDecision` applies every registered constraint: a `deny` stays denied, a `permit` or `ask` becomes a `deny` as soon as one constraint objects, and order does not affect the outcome. Constraints are evaluated even when the decision is already `deny`, so the audit records everything that refused an action rather than whichever refusal came first.

### When the provider is gone

`decisionWhenUnavailable` returns `deny` with reason `policy-unavailable`. The provider is an ordinary plugin and may be unmounted like any other; what may not be lost is the enforcement, so the enforcement point answers for itself when its engine is missing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Why no engine here

The composition rule is a property of the harness, not of Cedar. A rule that could only be stated with an engine mounted would be a claim about that engine, and its tests would prove Cedar's behaviour rather than this repository's. The split mirrors `dsh-retry` / `dsh-retry-cockatiel`: definition and decisions in one package, the adopted runtime in another.

Cedar is nevertheless a devDependency **of this package's tests**, and that is deliberate. The make-vs-use record's argument for adopting an engine is that forbid-overrides-permit, default-deny and a matched-policy explain are Cedar's semantics rather than something this repository must write. `tests/cedar-conformance.spec.ts` runs those three against `@cedar-policy/cedar-wasm` 4.12.0, so the argument rests on a measurement instead of on the upstream documentation.

That file also pins one fact a provider must not get wrong: submitted as a source STRING, Cedar assigns generated policy ids (`policy0`, `policy1`) and an `@id(...)` annotation does not become the id the explain reports. A provider must submit the id → source map, or the audit trail will name policies nobody wrote.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The request, the closed decision, the reason codes, the audit-only explain, and `PolicyConstraint` |
| [`src/evaluate.ts`](src/evaluate.ts) | `composeDecision`, `decisionWhenUnavailable`, `isImmediatelyAllowed` |
| [`tests/monotonic.spec.ts`](tests/monotonic.spec.ts) | The composition rule, including order-independence and the deny-only control |
| [`tests/cedar-conformance.spec.ts`](tests/cedar-conformance.spec.ts) | The three adopted semantics, run against the real engine |
| — | No invariant companion is published: this package owns no relationship two observers could see differently — every export is a pure function over its arguments, and a decision is made and returned inside one call. |

</details>

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`dsh-permission-rules`, the closest community package, resolves ordered allow/deny rules by FIRST MATCH — a rule nearer the user overrides a baseline deny. It is the negative example the order-independence case exists for, not prior art: under that shape, whether an action is permitted depends on which of two independently installed plugins loaded first.

</details>

## Model Experience

None, as this package exports types and pure decisions only and registers no tool, prompt text or session event.

#### KV Cache effect

Nothing here enters a model request; a decision reaches a model only as its enforcement point's refusal, which carries a closed reason code and never policy text.

## Known Limitations and Deferred Work

- **`ExecutionWorld` is a declared slot with one value.** P3-01 owns the world model and has not landed, so `world` is always `{ kind: 'absent' }` and no policy can yet decide from where an action would run. Recorded as BLOCKED-178 under the §12.46-B split: this package owns the rule half, P3-01 owns the producer.
- **Nothing consults these decisions yet.** This is the Contract stage. The provider that answers a request and the enforcement point that acts on a decision are the later stages, and a reader must not take these tests as evidence that any action is policy-checked today.
- **The reason codes are closed and may be too coarse.** They cross to the model, so each is deliberately unable to name a rule, a tenant or a path. If an operator needs finer model-visible reasons, the answer is a new code here rather than free text at a call site.
