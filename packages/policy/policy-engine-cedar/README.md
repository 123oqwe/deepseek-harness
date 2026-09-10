---
description: "Cedar policy provider for Epic P2-05, for deployments configuring a policy set and maintainers reading how a harness request becomes a Cedar one."
kind: "package-reference"
---

# @deepseek-ai/dsh-policy-engine-cedar

English | [中文](README.zh.md)

## Summary

`dsh-policy-engine-cedar` mounts `ctx.policy` over a Cedar authorizer: it translates a harness policy request into Cedar's entity and context shape, reads the answer back into `@deepseek-ai/dsh-policy-engine`'s closed decision, validates the configured policy set at LOAD, and records that set's digest on every decision. Cedar owns the authorization semantics; this package owns the translation and the failure taxonomy. Mount it in a host composition that enforces policy — it is host-only, because the wasm artifact is 13 MB and loads through a CommonJS entry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

### Configure the policy set as a map, never as one source string

```yaml
- name: '@deepseek-ai/dsh-policy-engine-cedar'
  config:
    policies:
      baseline-permit: 'permit(principal, action, resource);'
      destructive-forbid: 'forbid(principal, action, resource) when { context.sideEffectClass == "destructive" };'
```

The key is the policy's identity, and it is what the audit trail records. Submitted as one source string, Cedar assigns generated ids (`policy0`, `policy1`) and an `@id(...)` annotation in the source does **not** become the id the explain reports — an audit built that way names policies nobody wrote.

### What a policy can match on

| Cedar | From |
|---|---|
| `principal` | `Dsh::Principal::"<identity id>"` |
| `action` | `Dsh::Action::"<the manifest's capability>"` — two tools invoking one capability are one question |
| `resource` | `Dsh::Resource::"<kind>:<path\|host\|command\|ref>"` — the target kind survives, so a path and a command with the same text are different resources |
| `context.sideEffectClass` | the manifest's class |
| `context.classified` | whether that class was declared or defaulted |
| `context.workspaceTrust`, `context.permissionPosture` | the declared context facts |
| `context.world` | `"absent"` until P3-01 lands `ExecutionWorld`; a policy may refuse on it |
| `context.tokenPresented` | whether a capability token accompanied the action |

### Failures stay distinguishable

A policy that said no is `forbidden-by-policy` (a rule matched) or `no-matching-permit` (nothing did). A policy set that cannot be read is `policy-set-invalid`. No engine mounted at all is `policy-unavailable`, which the enforcement point answers because this service is gone. Collapsing any of the three into the others would make a broken deployment look like a strict one.

A set that does not parse fails at LOAD, not at the first decision: a misconfigured deployment should refuse to boot rather than surface as a denied action.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### The digest

`policySetDigest` hashes ids and sources in sorted order, each length-prefixed. Sorted, because a reordered set is the same set. Length-prefixed, because `{ab: 'c'}` and `{a: 'bc'}` would otherwise hash identically. Every decision carries it, so a replay can tell "the policy changed" from "the decision changed".

### Why `decisionFromAnswer` is exported and pure

Its `failure` branch is not reachable through a loaded engine: the policy set is validated at load, and the entity types are constants this module writes rather than request data. It is a fail-closed mapping for a state only a defect or a future Cedar version could produce, so it is proven as a mapping instead of being staged as a runtime situation that cannot occur.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The request translation, the digest, the load-time validation, and the answer mapping |
| [`tests/provider.spec.ts`](tests/provider.spec.ts) | Translation, audit ids, digest behaviour, load refusal, unload and remount |
| — | No invariant companion is published: this package owns no relationship two observers could see differently — a decision is produced and returned inside one call. |

</details>

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Cedar's own semantics — forbid overrides permit, default deny, matched-policy explain — are proven in `@deepseek-ai/dsh-policy-engine`'s `tests/cedar-conformance.spec.ts`, against this same 4.12.0. Asserting them again here would test the library twice and the translation not at all.

Two facts those cases measured that shaped this module: Cedar reports decisions in lower case (`allow`/`deny`), and a malformed policy set comes back as `type: 'failure'` rather than as a deny.

</details>

## Model Experience

None, as this package answers policy questions for an enforcement point and registers no tool, prompt text or session event.

#### KV Cache effect

Nothing here enters a model request; a decision reaches a model only as its enforcement point's refusal, which carries a closed reason code and never policy text.

## Known Limitations and Deferred Work

- **Nothing consults `ctx.policy` yet.** The enforcement point is the Usage stage's — it belongs to the Trust Kernel, and until it exists no action in this harness is policy-checked. A reader must not take a mounted provider as evidence that anything is enforced.
- **No Cedar schema is loaded.** `isAuthorized` is called without one, so policies are validated for parse errors but not against a declared entity/action schema — a policy naming `Dsh::Action::"typo"` parses and simply never matches. Adding the schema means declaring the harness's action vocabulary as data, which is the Usage stage's decision because that vocabulary is what the enforcement point routes.
- **Entities are empty.** No entity hierarchy is passed, so `in` relationships (groups, folders) cannot be expressed by a policy. The harness has no such hierarchy to project yet.
- **Host only.** The wasm artifact is 13 MB and loads through the CommonJS `nodejs` entry; a Client face must never mount this package.
