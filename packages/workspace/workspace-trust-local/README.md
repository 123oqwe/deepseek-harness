---
description: "The host-local provider for the workspace trust capability: binds a workspace to the filesystem identity it first resolved to, reconciles that binding on every read, and answers the project-load gate for a session cwd."
kind: "package-library"
---

# @deepseek-ai/dsh-workspace-trust-local

English | [中文](README.zh.md)

## Summary

`dsh-workspace-trust-local` provides `ctx.workspaceTrust`, the seam the harness reads before it loads anything a project directory supplied. `@deepseek-ai/dsh-workspace-trust` owns every decision and `@deepseek-ai/dsh-workspace`'s `observeWorkspaceIdentity` owns every filesystem observation; this package binds the two together for a session `cwd` and holds the resulting record for the process lifetime. It adds no second decision table.

A grant names a path, but trust binds to the identity that path resolved to the first time it was read. Every later read re-observes and reconciles, so a directory replaced in place, a symlink retargeted, or a directory moved out from under its path all drop to `'untrusted'`, and none of them is re-granted from configuration: a grant is permission to trust one directory, not standing permission to trust whatever later occupies its path.

## Table of Contents

- [Turn the boundary on](#turn-the-boundary-on)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="turn-the-boundary-on"></a>
## Turn the boundary on

The `dsh-base` bundle carries this row **disabled**. While no provider is mounted, `ctx.get('workspaceTrust')` is `undefined` and every consumer loads exactly what it loaded before this boundary existed — an untrusted repository's skills and instructions included. Mounting the provider is what turns the boundary on, and that is an operator action, not a default.

The default is deliberate. An enabled provider with no grants makes every workspace untrusted at once, which stops project skills and the project's own `AGENTS.md` loading for every existing user of every shipped profile. A boundary that ships on and breaks everyone gets switched off rather than adopted; this one ships discoverable and one edit from on.

To turn it on, enable the row in your `cordis.patch.yml` and grant the workspaces this host trusts:

```yaml
- id: workspace-trust-local
  disabled: false
  config:
    grants:
      - path: /home/you/projects/your-own-repo
        state: trusted-execute
```

A path absent from `grants` resolves to `'untrusted'`. `trusted-read` grants the workspace's instruction files but no executable content; `trusted-execute` additionally grants its skills.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`stateFor(cwd)` observes the directory's canonical path plus its device/inode/creation-time identity, then either reconciles an existing record against that fresh observation or, on first read, binds a new one at the granted state.

Granted paths are canonicalized **once** and reused. Re-canonicalizing per call would make a grant follow its own path rather than name a directory: retargeting a granted symlink would canonicalize the grant onto the attacker's directory, which then matches as a first binding and is trusted — precisely the inheritance the epic forbids. This package's own symlink-retarget case caught that as a real failure during implementation, which is why the memoization is load-bearing rather than a performance detail.

A path that cannot be observed at all resolves to `'untrusted'`: an unobservable path cannot be confirmed as the directory a grant was bound to, so it gets what a stranger gets.

-----

<a id="model-experience"></a>
## Model Experience

### Workspace trust resolution

#### What the model sees

Nothing directly: this package registers no tools, injects no prompts, and writes no session events, so no request field ever carries its data. What the model sees is the consequence — at `'untrusted'` the workspace's own instruction files and skills are absent from the request, exactly as if the repository carried none, with no note explaining the omission, because a withheld-content notice would itself be an injection surface an untrusted repository could aim at the model.

#### Token effect

None from this package. Consumers that withhold content emit fewer tokens than they otherwise would; nothing is added.

#### KV Cache effect

None from this package directly. A change in trust state changes the instruction baseline a consumer composes, which invalidates the cached prefix once, on the step where the change takes effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Grants stand in for host-user interaction.** The epic requires a trust upgrade to be completed by the host user interactively. No approval/interaction seam is wired here, so configured grants carry that authority for now. `requestTrustUpgrade` in `@deepseek-ai/dsh-workspace-trust` already refuses any non-`'user'` principal, and an interactive upgrade path will call it.
- **No audit record is written.** The epic also requires an upgrade to append an audit record. Wiring a real Trust Kernel `auditAppend` is gated on the vendored Cordis `Fiber` structural fix ([trust-kernel boundary](../../../docs/architecture/trust-kernel-boundary.md)); no audit sink is faked in the meantime.
- **Records live for the process lifetime.** Trust is not persisted across restarts, so a granted workspace re-binds on the next boot.

-----
