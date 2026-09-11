---
description: "The `/trust-skills` command: raises this workspace to trusted-execute after confirming with the host user, so the project's own skills become available."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-workspace-trust

English | [中文](README.zh.md)

## Summary

`/trust-skills` raises the workspace a session is running in to `'trusted-execute'`, which is the state at which [`@deepseek-ai/dsh-skill-filesystem`](../../skill/skill-filesystem/README.md) admits the project's own skill directories. It asks the host user to confirm through [`@deepseek-ai/dsh-user-approval`](../../interaction/user-approval/README.md), then hands the decision to `@deepseek-ai/dsh-workspace-trust`'s `requestTrustUpgrade` behind the mounted provider. It holds no trust rule of its own.

**Why a command rather than a prompt at the point of use.** Project skills are not listed at `'trusted-read'` — their names and descriptions are text the project supplied, and putting that in front of the model is what an untrusted repository would want. So there is no moment where the agent reaches for a project skill and could be asked about it: the reach never happens. The request has to come from the host user, who is the only participant that can want this without having been influenced by the repository.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## Use this package

Mount it in a composition that has `commands`, `approval`, and a `workspaceTrust` provider. With any of those absent the command still registers and reports what is missing, because a command a user typed deserves an answer.

```yaml
- name: '@deepseek-ai/dsh-command-workspace-trust'
```

Typing `/trust-skills` confirms once and, on `allowed-once`, raises the workspace. Every other outcome — refused, cancelled, or no answerer at all — leaves it exactly as it was.

<a id="understand-the-implementation"></a>

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The command is confirmed through approval **even though the user typed it**. The command says what the user wants; the `approval/asked` + `approval/decided` pair is what records that they were shown what it means and agreed. A command alone leaves no such pair, and must[2] asks for an audit as well as an interaction.

`grantTrust` is called with the principal attached to the session, never with one this package constructs: `requestTrustUpgrade` refuses a non-host principal, and a package that could supply its own would be a second place trust can be granted.

</details>

<a id="model-experience"></a>

## Model Experience

### The `/trust-skills` grant

#### What the model sees

Nothing directly: this package registers no tool, injects no prompt, and writes no model-visible message. The model sees the consequence — after a successful grant, the project's own skills appear in the catalog it is offered, where before there were none.

#### Token effect

None from this package. A successful grant makes `skill-filesystem` list the project's skill directories, so the catalog that reaches the model grows by whatever the project supplies; nothing this package writes is in the request.

#### KV Cache effect

None of its own. A successful grant changes what `skill-filesystem` lists, which invalidates the cached prefix once, on the step where the new catalog first reaches the request.

<a id="known-limitations-and-deferred-work"></a>

## Known Limitations and Deferred Work

- **`trusted-read` has a different path.** The read state is asked for automatically, the first time a session would load an untrusted workspace's instruction files; this command is only for the execute state. The two are separate answers with different consequences.
- **No downgrade command.** `downgradeTrust` exists in the decision package and has no caller. Lowering a workspace's trust from the host UI is not in this epic.
- No runtime invariant companion is published: this package holds no state and owns no relation — it asks, and the provider it calls owns the binding, so a checker here would have nothing of its own to compare.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The command's first version called the trust provider directly and its spec called the handler directly. Both passed, and both would have passed with the command unregistered: the spec proved a function worked, not that typing `/trust-skills` reached it. It dispatches through the real command registry now, and that is the shape any case about this package has to take.

</details>
