---
description: "Epic P2-10's policy vocabulary: the Cedar schema dsh's own requests are shaped by — three entity types and ten declared context keys — for deployments writing policy and for readers checking that a policy can match anything at all."
kind: "package-reference"
---

# @deepseek-ai/dsh-policy-language

English | [中文](README.zh.md)

## Summary

`dsh-policy-language` declares the vocabulary a dsh policy may name: the three Cedar entity types every policy request carries (`Dsh::Principal`, `Dsh::Action` whose id is the manifest's capability, and `Dsh::Resource` whose id is a kind-qualified action target) and the ten context keys the request builder sends. It defines no syntax. Under Epic P2-10's ruling (b), dsh's "finite declarative language" IS that vocabulary plus its conventions — a second syntax compiling to Cedar would be a second trust root and would re-verify the authorization semantics `@deepseek-ai/dsh-policy-engine-cedar` already froze for P2-05.

Around that declaration the package adds the two operations the vocabulary exists for: `parsePolicySet` refuses a policy set that does not parse or that reads a key outside the vocabulary, and `compilePolicySet` turns an accepted set into the pinned, digested artifact a replay keys on.

## Table of Contents

- [Use this package](#use-this-package)
- [Why a schema at all](#why-a-schema-at-all)
- [Source map](#source-map)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Read `DSH_CONTEXT_KEYS` to know what a policy may reference, and `DSH_PRINCIPAL_TYPE` / `DSH_ACTION_TYPE` / `DSH_RESOURCE_TYPE` for the entity types. A policy naming anything outside them is a policy that can never match.

Call `parsePolicySet(policies)` where a deployment's policy set arrives. It answers `{ok: true}` or one of three named refusals — `empty`, `unparsable` (with the offending policy id), `unknown-context-key` (with every offending key, not just the first) — and it checks syntax before vocabulary, so an unparsable policy is reported as unparsable rather than as a key nobody sends. Call `compilePolicySet(policies, {contextKeys, engineVersion})` on an accepted set to get its pin: a digest over the canonical policy text, the vocabulary, and the engine version together, so a Cedar upgrade or a vocabulary change re-pins visibly instead of silently meaning something else.

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
| — | No invariant companion is published: this package owns no relationship two observers could see differently — every export is a pure function over its arguments, and a parse or a pin is produced and returned inside one call. |

## Model Experience

None, as this package declares a vocabulary and registers no prompt, schema, tool, or session event.

#### KV Cache effect

None; nothing here assembles or contributes to a provider request, so no prefix moves and no cached prefix is invalidated.

## Known Limitations and Deferred Work

- **Nothing in production calls `parsePolicySet` yet** — the refusal exists and is frozen, but the load-time failure it buys arrives only when the Provider stage's fail-closed loader reads a deployment's policy set through it. Until then a misspelled context key still reaches decision time.
- **The entity ids are not constrained here** — `Dsh::Action`'s id is whatever capability a manifest names, and `Dsh::Resource`'s is a kind-qualified target. Closing those sets would be a second vocabulary with its own drift problem, and no clause asks for it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The open question is whether the entity ids should ever be closed. `Dsh::Action`'s id is a capability name minted by whichever plugin declared it, so closing that set would make this package depend on every capability in the tree. Leaving it open means a policy can name a capability that does not exist, which parses, loads, and never matches — the same quiet shape a context-key typo has, one level up. No clause asks for it and the drift case does not cover it.

</details>
