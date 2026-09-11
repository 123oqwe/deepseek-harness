---
description: "The policy group map: what a policy question carries, what a closed answer is, the attenuable token that says who is asking, the risk vocabulary that grades what is asked, and the one point where a decision becomes enforcement, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/policy

English | [中文](README.zh.md)

## Summary

The policy group answers one question — *may this action happen?* — and splits it into the four parts that can be decided independently: what the question **carries** (identity, the caller's authority, the action's manifest, the world it would run in), what a closed **answer** looks like and how a plugin may affect one, how **authority** is issued and narrowed as it is delegated, and how an action is **graded** for risk before any of that. Enforcement is deliberately not a fifth peer: a decision becomes binding at exactly one point, through the pinned Trust Kernel, and everything else in this group only produces inputs to it.

The rule that holds the group together is **monotonic narrowing**. A plugin may narrow a decision and never widen one; an attenuated token is a subset of its parent and never a superset; an unknown risk classifies higher, not lower. Every seam here fails toward refusal, so a component that is absent, misconfigured, or silent cannot become a grant.

## Table of Contents

- [Packages](#packages)
- [Where a decision becomes enforcement](#where-a-decision-becomes-enforcement)
- [What is not arrived yet](#what-is-not-arrived-yet)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`policy-engine`](policy-engine/README.md) | The vocabulary: what a policy question is, what a closed answer carries, the closed reason codes that cross to the model, and the narrow-only composition rule. Holds no policies, mounts no service, imports no engine | — (types and `composeDecision`) |
| [`policy-engine-cedar`](policy-engine-cedar/README.md) | The Cedar provider: translates a harness request into Cedar's entity and context shape, reads the answer back into the closed decision, validates the policy set at LOAD, and records its digest on every decision. Host-only — the wasm artifact is 13 MB behind a CommonJS entry | `ctx.policy` |
| [`policy-enforcement`](policy-enforcement/README.md) | The Policy Enforcement Point: reads the decision, applies every registered plugin constraint, and asks the pinned Trust Kernel to bind and record the result | — (mounts constraints; `enforceManifestedAction`) |
| `capability-token` | The attenuable Capability Token's type surface and decision functions: issuance, verification, narrowing-only attenuation, cascading revocation, a presence gate, and log-safe redaction | — (a library) |
| `capability-token-file` | The file-backed token provider: issues each session's root token, arms the tool-call requirement, and persists tokens, revocations and redacted audit records atomically under the profile's home | `ctx.capabilityTokens` |
| `risk-taxonomy` | The eight-class risk vocabulary (`read` … `safety-critical`) and the pure classifier, including the ascending order every comparison uses and the unknown-classifies-higher default | — (a library; one pure function) |

`capability-token`, `capability-token-file` and `risk-taxonomy` are English-only for now, which is why those three names are not links: this page would otherwise claim Chinese counterparts that do not exist.

The group spans three epics rather than one, and the seams show it: the token pair answers *who is asking and with what authority*, the risk classifier answers *how dangerous is what they asked*, and the engine/provider/enforcement trio answers *so may it happen*. They meet only at the enforcement point.

-----

<a id="where-a-decision-becomes-enforcement"></a>
## Where a decision becomes enforcement

Nothing in this group refuses an action on its own. `policy-engine` states what an answer is; `policy-engine-cedar` computes one; `risk-taxonomy` reports a class and whether it is hard-denied; `capability-token` verifies a token. Each of those is a *report*. The binding step is `policy-enforcement` handing the composed result to the pinned Trust Kernel, which is the one non-plugin exception in this harness and the only place an answer becomes an obligation.

This matters for reading the rest of the group: a caller that reads `riskClass` and ignores `hardDenied` is stopped by nothing here, and a mounted `ctx.policy` is not evidence that any action is checked. The check is the enforcement point, and it is reached from a dispatch path immediately after that path appends its `ActionManifest`.

-----

<a id="what-is-not-arrived-yet"></a>
## What is not arrived yet

Recorded here because this group's READMEs describe contracts that production reaches only in part, and because several of the gaps are security-visible — a reader who assumes otherwise would over-trust the system.

- **A token signature is a fixed marker, not cryptography.** Issuance and attenuation sign with constant bytes and verification accepts them, so a signature binds nothing to a token's contents; the `trustRoot` parameter is a compile-time gate on who may call, not a runtime check. This waits on the vendored Cordis `Fiber` fix recorded in the Trust Kernel boundary document.
- **Two dispatch paths are decided, not five.** The native tool path and the code-mode sub-dispatch reach the enforcement point; an out-of-process SDK dispatch and a plugin's own RPC have no manifest producer yet, so they are not decided at all.
- **A policy cannot see a token's verbs or resources.** What crosses is the redacted six-field projection, so a policy can refuse an action whose authority names the wrong capability but not one whose authority omits a specific verb on a specific resource.
- **`ExecutionWorld` is a declared slot with one value.** It is always absent until the epic that owns the world model lands, so no policy can yet decide from where an action would run.
- **No deployment maps a domain tag to a risk class.** Every shipped tool declares domain tags and no profile maps one, so every real action still classifies under the unknown default — the tags are in place and the mapping is the missing half. Nothing on the dispatch path calls `classify` yet either.
- **The context facts default closed and are not read from mounted services.** Workspace trust defaults to untrusted and the permission posture to default until a dispatch path passes real ones, which is why the direction is closed rather than convenient.
- **No Cedar schema and no entity hierarchy are loaded.** Policies are validated for parse errors but not against a declared action vocabulary, so a policy naming a typo'd action parses and simply never matches; `in` relationships cannot be expressed.
- **The audit record goes to a sink a deployment must configure.** A composition that wires none decides and enforces but records nothing.

-----

<a id="related-documentation"></a>
## Related documentation

- [Policy subsystem](../../docs/subsystems/policy.md) — the authoritative contract for a policy question, a closed answer, and what a plugin may contribute to one.
- [Trust Kernel boundary](../../docs/architecture/trust-kernel-boundary.md) — why enforcement is not a plugin, and the vendored `Fiber` residual the token signatures wait on.
- [Permission presets subsystem](../../docs/subsystems/permission-presets.md) — where the risk classification is bound to an approval answer.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in each package's README.

The open question at group level is **whether three epics' worth of seams should stay one group**. Authority (the token pair), grading (the risk taxonomy) and decision (the engine trio) meet only at the enforcement point and have no shared vocabulary otherwise — `risk-taxonomy` imports nothing from `policy-engine`, and neither knows about tokens. The argument for one group is that a deployment enables or declines *policy* as a whole; the argument against is that the group README has to introduce three unrelated vocabularies before a reader can navigate it, which this page does.

The second is **what a detached run's authority is when its launching session has ended**. The file provider drops a session's token at disposal, so a re-attached detached run finds no parent to derive from. The readings are recorded in the owning epic's preflight and none is assumed here; it is security-visible, so it wants a decision rather than a default that arrives by implementation order.

</details>
