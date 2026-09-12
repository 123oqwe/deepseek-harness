# dsh policy language

English | [中文](language.zh.md)

A dsh policy is a [Cedar](https://www.cedarpolicy.com/) policy. This page is the other half of what that means: the vocabulary a policy may name, what happens to one that names something else, and what a policy set's version pin is taken over.

There is no second syntax. Epic P2-10's "finite declarative language" is Cedar's language restricted to the vocabulary below — a syntax of dsh's own compiling to Cedar would be a second trust root, and would re-verify authorization semantics `@deepseek-ai/dsh-policy-engine-cedar` already owns.

## The vocabulary

Every policy request carries three entities and one context record. A policy may name these and nothing else.

| position | entity type | what its id is |
| --- | --- | --- |
| principal | `Dsh::Principal` | the acting identity's id |
| action | `Dsh::Action` | the **capability** the ActionManifest names, never a tool name — two tools invoking one capability are one authorization question |
| resource | `Dsh::Resource` | a kind-qualified action target, so a filesystem path and a process command with the same text are different resources |

The context record has exactly ten keys:

| key | what it carries |
| --- | --- |
| `sideEffectClass` | the manifest's declared side-effect class |
| `classified` | whether that class was declared by the capability or reached by the unclassifiable default |
| `workspaceTrust` | the workspace's trust state |
| `permissionPosture` | the session's permission posture |
| `riskClass` | the class the deployment's risk policy put this action in |
| `world` | the execution world's KIND — `absent` or `bound` — never the world itself |
| `tokenPresented` | whether an authority was presented at all |
| `tokenCapability` | the presented token's capability claim, or `''` when none was presented |
| `tokenDelegationDepth` | the presented token's delegation depth, or `-1` when none was presented |
| `tokenTenant` | the presented token's tenant claim, or `''` when none was presented |

Each key exists because a request carries it: the list is a declaration of what `toCedarRequest` sends, not a wish list. `@deepseek-ai/dsh-policy-language`'s Contract-stage drift case compares this vocabulary against a request that mapper actually built, and fails in **both** directions — a key declared and never sent, and a key sent and never declared. **This page's own key table is inside that machine check**: under ruling (b) it is the authority the "schema" refers to, so changing the code without this page — or this page without the code — reddens.

## What a policy set is refused for

A policy set is read at load, before anything is enforced, and the three refusals are kept apart because they send a deployment to different places.

| refusal | what it means |
| --- | --- |
| `empty` | the set has no policies. Cedar denies when no `permit` matches, so an empty set forbids **everything** — which is a legitimate posture but almost never the intended one, so it must be stated rather than reached by omission |
| `unparsable` | at least one policy is not valid Cedar. The refusal names the policy id, because Cedar's own source offsets point into whatever text it was handed and are useless across a set |
| `unknown-context-key` | a policy reads a context key no request carries. Every offending key in the set is reported, not the first |

**Why the third refusal exists at all**, measured against Cedar 4.12.0: such a policy parses clean and loads clean, then denies with no matched reason on every decision it touches. It is not silent — the audit carries `record does not have the attribute …` each time — but it is late, repeated, and only visible to someone reading decision-time diagnostics after actions have already been refused against a rule that was never going to match. Refusing at load turns that into one failure, before any action is decided, where the deployment is configured rather than where it runs.

The vocabulary check is dsh's own rather than Cedar's schema validator, and the reason is a property of the pinned engine: cedar-wasm 4.12.0's schema entry points accept a single unnamed namespace, so a schema declaring `Dsh::Principal` cannot be expressed at all. What is hand-written is one membership test over context attribute names; every authorization semantic is still Cedar's.

## The version pin

A compiled policy set carries a pin, and a replay keys on it. The pin is taken over three inputs, because the same policy text can mean different things:

1. **the canonical policy text** — reformatting is not a revision, so the text is canonicalised before it is digested;
2. **the vocabulary** — a set whose context keys changed is a different evaluator wearing the same policies;
3. **the engine version** — the canonical form is produced by the engine, so a release that changed it would otherwise drift every pin silently.

**Upgrading `@cedar-policy/cedar-wasm` re-pins every policy set.** That is the point rather than a cost: an upgrade becomes an intentional, visible re-pin instead of a quiet change in what a pin means.
