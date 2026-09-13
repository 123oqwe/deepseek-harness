---
description: "Epic P2-10's policy vocabulary: the Cedar schema dsh's own requests are shaped by — three entity types and ten declared context keys — for deployments writing policy and for readers checking that a policy can match anything at all."
kind: "package-reference"
---

# @deepseek-ai/dsh-policy-language

English | [中文](README.zh.md)

## Summary

`dsh-policy-language` declares the vocabulary a dsh policy may name: the three Cedar entity types every policy request carries (`Dsh::Principal`, `Dsh::Action` whose id is the manifest's capability, and `Dsh::Resource` whose id is a kind-qualified action target) and the ten context keys the request builder sends. It defines no syntax. Under Epic P2-10's ruling (b), dsh's "finite declarative language" IS that vocabulary plus its conventions — a second syntax compiling to Cedar would be a second trust root and would re-verify the authorization semantics `@deepseek-ai/dsh-policy-engine-cedar` already froze for P2-05.

Around that declaration the package adds the operations the vocabulary exists for: `parsePolicySet` refuses a policy set that does not parse or that reads a key outside the vocabulary, `compilePolicySet` turns an accepted set into the pinned, digested artifact a replay keys on, and the plugin registers the whole thing as the `policy-set` settings namespace so a deployment has somewhere to state one. The plugin also provides `ctx.policySet`, which `@deepseek-ai/dsh-policy-engine-cedar` asks for the set in force and its pin on every decision, so every decision, and the audit record the enforcement point appends for it, carries the pin the set was accepted under.

## Table of Contents

- [Use this package](#use-this-package)
- [Where a deployment states its policy set](#where-a-policy-set-lives)
- [Why a schema at all](#why-a-schema-at-all)
- [Source map](#source-map)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Read `DSH_CONTEXT_KEYS` to know what a policy may reference, and `DSH_PRINCIPAL_TYPE` / `DSH_ACTION_TYPE` / `DSH_RESOURCE_TYPE` for the entity types. A policy naming anything outside them is a policy that can never match.

Call `parsePolicySet(policies)` where a deployment's policy set arrives. It answers `{ok: true}` or one of three named refusals — `empty`, `unparsable` (with the offending policy id), `unknown-context-key` (with every offending key, not just the first) — and it checks syntax before vocabulary, so an unparsable policy is reported as unparsable rather than as a key nobody sends. Call `compilePolicySet(policies, {contextKeys, engineVersion})` on an accepted set to get its pin: a digest over the canonical policy text, the vocabulary, and the engine version together, so a Cedar upgrade or a vocabulary change re-pins visibly instead of silently meaning something else.

<a id="where-a-policy-set-lives"></a>
## Where a deployment states its policy set

Mounting this plugin registers the **`policy-set`** settings namespace, whose section is `{policies: {<id>: <cedar source>}}`. It requires a `settings` provider and says so through `inject`: a harness that mounted it without one would register nothing, state no policy set, and enforce nothing, silently.

```yaml
- id: policy-language
  name: '@deepseek-ai/dsh-policy-language'
  config:
    maxPolicies: 256
    maxSourceBytes: 1048576
```

Both bounds are configuration rather than constants because a laptop profile and a fleet control plane do not admit the same policy set. They are applied over the **complete** set — total policy count and total UTF-8 bytes — and before parsing, because a set too large to admit should be refused before work proportional to its size is done on it.

**This package holds no policy set.** `@deepseek-ai/dsh-settings` already refuses a registration whose stored section its owner cannot serve, and already keeps a namespace's last good value when a later document fails while other namespaces still commit. What this plugin contributes is the function that says no. The three observed consequences, from a real boot rather than from those guarantees' documentation:

| the document | what happens |
|---|---|
| already unacceptable at start | the **boot fails**: `policy set refused (unknown-context-key): …`. There is no last good value at start, so mounting a harness over a policy set it rejected is not an option |
| becomes unacceptable while running | the namespace **keeps the set it last accepted** — not an empty one, which is the difference between failing closed and failing off |
| becomes acceptable again | the new set is **taken**. Keeping the last good value is not latching |

<a id="why-a-schema-at-all"></a>
## Why a schema at all

Measured against Cedar 4.12.0: a policy referencing a context key dsh never sends **parses clean and passes the provider's load probe**, then denies with no matched reason on every decision it touches. It is not silent — `policy-engine-cedar` maps Cedar's per-decision error into `PolicyExplain.diagnostics`, so the audit carries `record does not have the attribute …` each time — but it is late, repeated, and only visible to someone reading decision-time diagnostics after actions have already been refused against a rule that was never going to match.

What this declaration buys is moving that report from decision time to load time: fail once, before any action has been wrongly denied, where a deployment is configured rather than where it runs.

**Every key here is justified by a line in `toCedarRequest`**, and the Contract stage's drift case compares this list against a request that mapper actually built. It fails in both directions — a key declared here that nothing sends, and a key sent that is not declared here — because a schema wider than the request builder manufactures exactly the quiet failure above.

<a id="source-map"></a>
## Source map

| File | Role |
|---|---|
| [`src/schema.ts`](src/schema.ts) | The three entity types and the ten context keys — the vocabulary itself |
| [`src/parser.ts`](src/parser.ts) | `parsePolicySet` and its three refusals, syntax checked before vocabulary |
| [`src/compiler.ts`](src/compiler.ts) | `compilePolicySet` and the pin over canonical text, vocabulary and engine version |
| [`src/index.ts`](src/index.ts) | `acceptPolicySet` — bound, then parse, then pin — and `PolicySetProvider`, which registers the `policy-set` namespace with it and answers `current()` from that namespace on every call |
| — | No invariant companion is published: this package owns no relationship two observers could see differently. `parsePolicySet`, `compilePolicySet` and `acceptPolicySet` are pure functions over their arguments, and `PolicySetProvider` holds no policy set of its own — it reads the `policy-set` settings scope on every `current()`, and what happens when a reload fails belongs to `@deepseek-ai/dsh-settings`. |

## Model Experience

None, as this package declares a vocabulary and registers no prompt, schema, tool, or session event.

#### KV Cache effect

None; nothing here assembles or contributes to a provider request, so no prefix moves and no cached prefix is invalidated.

## Known Limitations and Deferred Work

- **Shadow evaluation, diff explain and a pre-upgrade impact report are not built** — Epic P2-10 asks for a policy set to be evaluated in shadow, for an explanation of how two sets' decisions differ, and for historical `ActionManifest`s to be replayed before an upgrade into an impact report. The pin every decision records is the key such a replay would compare on, but nothing in the tree performs the shadow evaluation, the diff, or the replay.
- **A non-atomic edit of the policy document can commit the baseline alone** — an empty or truncated document parses as the valid baseline-only set, so a write that truncates before rewriting can briefly replace the deployment's policies with the baseline and commit that (BLOCKED-243). Replace the document atomically, as `docs/policy/language.md` states; the fix belongs to the settings-file watcher.
- **The entity ids are not constrained here** — `Dsh::Action`'s id is whatever capability a manifest names, and `Dsh::Resource`'s is a kind-qualified target. Closing those sets would be a second vocabulary with its own drift problem, and no clause asks for it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The open question is whether the entity ids should ever be closed. `Dsh::Action`'s id is a capability name minted by whichever plugin declared it, so closing that set would make this package depend on every capability in the tree. Leaving it open means a policy can name a capability that does not exist, which parses, loads, and never matches — the same quiet shape a context-key typo has, one level up. No clause asks for it and the drift case does not cover it.

</details>
