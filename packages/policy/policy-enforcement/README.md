---
description: "The Policy Enforcement Point for Epic P2-05, for maintainers wiring a dispatch path or registering a plugin constraint."
kind: "package-reference"
---

# @deepseek-ai/dsh-policy-enforcement

English | [中文](README.zh.md)

## Summary

`dsh-policy-enforcement` is where a harness action is decided, whichever originator started it: it reads the decision from `ctx.policy`, applies every registered plugin constraint through `composeDecision`, and asks the pinned Trust Kernel to bind the result and record it. Mount it in any composition that enforces policy, and call `enforceManifestedAction` from a dispatch path immediately after that path appends its `ActionManifest`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Deciding one action

`enforceManifestedAction(ctx, { manifest, token, origin, facts })` returns a `ClosedDecision`. `facts` is required and comes from `readPolicyContextFacts`, which the dispatch path calls first. Call it where the manifest exists — the manifest IS the policy question, so a path that skipped the decision also skipped the manifest, which P2-03's `assertManifestPrecedesExecution` already refuses.

The order inside is the contract: the engine answers, plugins may narrow, the kernel binds, and the audit record is appended BEFORE the caller acts. A record written afterwards would be missing exactly when the process dies between deciding and doing.

### Registering a constraint

`ctx.policyConstraints.register(constraint)` takes a `(request) => string | undefined` and returns its disposer. A constraint disposes with its plugin's fiber: a plugin that unmounts stops constraining, and there is no shape in which a constraint widens a decision.

### When no engine is mounted

The decision is `deny` with reason `policy-unavailable`, naming the last policy-set digest this context saw. The provider is an ordinary plugin and may be unmounted mid-session; what may not be lost is the enforcement.

A composition with no pinned Trust Kernel THROWS rather than deciding: a harness that cannot enforce must not proceed as though it had.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The kernel is resolved through `ctx.get('trustKernel')` on every call, never captured: it is pinned before any entry mounts, so a plugin that replaced the policy service still cannot make an action permitted. A kernel `deny` overrides a permit that reached it; a kernel `allow` never widens a refusal the engine or a constraint already made.

The context passed in is the COMPOSITION's, not an agent's. An `Agent` handed to a dispatch path by a test harness may carry no `ctx` at all — reading `agent.ctx` there was a real defect, found by three concurrency cases timing out rather than failing.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `enforceAction`, `enforceManifestedAction`, the constraint registry, and the audit record |
| — | No invariant companion is published: this package owns no relationship two observers could see differently — one decision is produced, bound and recorded inside a single call. |

</details>

## Model Experience

None, as this package decides an action for a dispatch path and registers no tool, prompt text or session event.

#### KV Cache effect

Nothing here enters a model request; a refusal reaches the model as its dispatch path's own error result, carrying a closed reason code and never policy text.

## Known Limitations and Deferred Work

- **Two dispatch paths call it, not five.** The native tool path and the code-mode sub-dispatch both reach it, and a subagent's or a workflow child's own tool calls arrive through the native path. An out-of-process SDK dispatch and a plugin's own RPC do not have manifest producers yet, so they are not decided here — the plugin-RPC producer is a separate epic's.
- **A policy cannot see the token's verbs or resources.** What crosses is `redactTokenForLog`'s projection — digest, subject, tenant, capability, delegation depth, expiry — which P2-02 audited as safe outside the token layer. A policy can therefore refuse an action whose authority names the wrong capability, but not one whose authority omits a specific verb on a specific resource. Extending that projection is P2-02's decision, not this package's to fork.
- **The permission posture is still a constant, and there is nothing to read it from.** `workspaceTrust` and `riskClass` are read from the composition by `@deepseek-ai/dsh-tools/external-effect`'s `readPolicyContextFacts`, which both dispatch paths call before this enforcement point. `permissionPosture` is the literal `default`: `PermissionPostureFact`'s four values name no preset any composition configures, so no real posture can be spelled in that vocabulary (BLOCKED-202). An unmounted fact service reads as its most restrictive value rather than its most permissive, because a policy written against a fact that silently defaulted open would enforce something other than what it says.
- **The audit record goes to the kernel's `auditAppend`, which is inert unless a deployment configured a sink.** A composition that wires none decides and enforces but records nothing.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
