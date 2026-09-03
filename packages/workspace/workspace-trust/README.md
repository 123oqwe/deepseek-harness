---
description: "The type surface and pure decision functions for Epic P1-07's project trust boundary: identity-bound trust states, the project-load gate, reconciliation against a re-observed workspace, and audited upgrades."
kind: "package-library"
---

# @deepseek-ai/dsh-workspace-trust

## Summary

`dsh-workspace-trust` ships the type surface and decision functions for Epic P1-07's project trust boundary: every workspace holds one of three trust states — `'untrusted'`, `'trusted-read'`, `'trusted-execute'` — bound to both its canonical realpath and the `fs.Stats` device/inode identity observed at bind time, never to the path string alone (must[0]); while `'untrusted'` or `'trusted-read'`, only safe reads are permitted and no project plugin, hook, MCP server, executable skill, or home/profile patch override ever loads (must[1]); and raising trust requires a genuine host user principal and produces an audit record (must[2]).

`src/types.ts` carries the types and `src/index.ts` six working functions: `isHostUserPrincipal`, `bindWorkspaceTrust`, `authorizeProjectLoad`, `reconcileWorkspaceTrust`, `requestTrustUpgrade`, and `downgradeTrust`, covered by `tests/trust.spec.ts` in 11 cases. `downgradeTrust` derives its `revokedKinds` by running `authorizeProjectLoad` over every `ProjectContentKind` under both the old and the new state, so the load gate and the revocation set can never disagree. No invariant companion is published because this package constructs no registry, table, or `Context` value to check an owned relation over — every export is a pure function over caller-supplied plain data.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The trust decision surface is called with plain data — no file, process, or Cordis `Context` access:

```ts
import { authorizeProjectLoad, bindWorkspaceTrust, requestTrustUpgrade } from '@deepseek-ai/dsh-workspace-trust'
import type { WorkspaceIdentity } from '@deepseek-ai/dsh-workspace-trust/types'
import type { Principal } from '@deepseek-ai/dsh-principal/types'

declare const identity: WorkspaceIdentity // canonical realpath + fs.stat dev/ino, resolved by the caller
declare const hostPrincipal: Principal // the interacting principal; only kind === 'user' can upgrade trust

const record = bindWorkspaceTrust(identity, new Date().toISOString())
// record.state === 'untrusted' — every workspace starts here, no auto-inherited trust

const denied = authorizeProjectLoad(record.state, 'mcp-server')
// denied.permitted === false, denied.requiredState === 'trusted-execute'

const upgrade = requestTrustUpgrade(record, 'trusted-execute', hostPrincipal, new Date().toISOString())
// upgrade.upgraded is false with reason 'non-host-principal' for a non-'user' principal;
// otherwise upgrade.record and upgrade.audit are both produced together
```

Every export is a pure function over already-resolved data: no export in this package stats a path, spawns a process, or constructs a Cordis `Context` — a later Usage-stage caller supplies `identity`/`hostPrincipal` from a real `fs.realpath`/`fs.stat` observation and a real, already-authenticated `Principal`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Trust binds to identity, never to a path string alone.** `WorkspaceIdentity` pairs the canonical realpath with the `fs.Stats.dev`/`fs.Stats.ino` pair observed for it. A directory replaced in place or a symlink retargeted keeps the path string fixed while the device/inode pair changes; a directory moved keeps the device/inode pair fixed while the path string changes. Requiring both fields to match is what makes `reconcileWorkspaceTrust` catch all three of acceptance[1]'s named attacks with one comparison, not three special cases.
- **Reading is not executing.** `'trusted-read'` is a distinct state from `'trusted-execute'`, not a lesser degree of the same permission: `authorizeProjectLoad` never admits a project plugin, hook, MCP server, executable skill, or home/profile patch override below `'trusted-execute'`, regardless of how much read trust a workspace has accumulated.
- **A downgrade computes what it revokes.** `downgradeTrust` does not merely change `record.state` — it returns exactly the `ProjectContentKind`s the prior state authorized that the new state does not, so acceptance[2]'s "immediately revokes project capabilities" has a concrete, checkable answer rather than an implicit one callers must re-derive.
- **A trust upgrade is inseparable from its audit record.** `requestTrustUpgrade` returns the new `TrustRecord` and the `TrustUpgradeAuditRecord` together on success, and neither on refusal — there is no code path that raises trust without also producing the record must[2] requires.
- **Host user identity reuses `@deepseek-ai/dsh-principal`, not an ad hoc shape.** must[2]'s "宿主用户交互" is modeled as `Principal.kind === 'user'` (`isHostUserPrincipal`), the same already-ACCEPTED (first100 registry P2-01) identity vocabulary the rest of the harness uses — an upgrade requester is an already-branded `Principal`, never text extracted from a prompt.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The trust-state/identity/decision type surface: `TrustState`, `WorkspaceIdentity`, `TrustRecord`, `ProjectContentKind`, `LoadDecision`, `TrustUpgradeResult`, `TrustDowngradeResult` |
| [`src/index.ts`](src/index.ts) | `isHostUserPrincipal`, `bindWorkspaceTrust`, `authorizeProjectLoad`, `reconcileWorkspaceTrust`, `requestTrustUpgrade`, `downgradeTrust` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/trust.spec.ts`](tests/trust.spec.ts) — 11 cases: one per registry-declared must[]/acceptance[] clause (must[2] split into its refuse/admit halves, acceptance[1] split into its three named identity-change vectors plus an unchanged-identity control).
- [`packages/workspace/workspace/src/{entity,index,paths}.ts`](../workspace/src) — the real `Workspace` entity and `realpathNormalize` this epic's Usage-stage wires trust observation into (Usage-stage wiring, not this package's job).
- [`packages/context/agent-instructions/src/{index,files}.ts`](../../context/agent-instructions/src) and [`apps/cli/src/profile-boot.ts`](../../../apps/cli/src/profile-boot.ts) — the real project-instruction/plugin/patch load sites acceptance[0]'s zero-subprocess/network/credential-read guarantee is meant to gate (Usage-stage wiring, not this package's job).
- [`@deepseek-ai/dsh-principal`](../../identity/principal/README.md) — the identity package `isHostUserPrincipal`/`requestTrustUpgrade` build must[2]'s host-user-interaction requirement on.
- [`docs/architecture/trust-kernel-boundary.md`](../../../docs/architecture/trust-kernel-boundary.md) — why `TrustUpgradeAuditRecord` (`src/types.ts`) is this package's own plain data rather than a real `@deepseek-ai/dsh-trust-kernel` `auditAppend` call: any epic wiring a real audit enforcement point consuming the Trust Kernel needs the vendored Cordis `Fiber` structural fix first.
- [`@deepseek-ai/dsh-plugin-ownership`](../../plugin/plugin-ownership/README.md) — this repo's other Contract-stage pure-decision-logic package, followed here for package layout and conventions.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure decision functions only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No wiring into real `fs.realpath`/`fs.stat` observation, real project plugin/hook/MCP-server/skill loaders, or `apps/cli/src/profile-boot.ts`'s home-patch layer exists yet** (registry's own `stages.P`/`stages.U` files) — this package alone cannot observe a real directory's identity or gate a real load.
- **No real `@deepseek-ai/dsh-trust-kernel` audit-append wiring exists yet, and cannot until the vendored Cordis `Fiber` structural fix lands** (`docs/architecture/trust-kernel-boundary.md`) — `requestTrustUpgrade` returns a `TrustUpgradeAuditRecord` as plain data, and nothing appends it anywhere.
- **`requestTrustUpgrade` does not check that `target` raises trust.** It gates on the requester being a host user principal and then writes `target` verbatim, so a host user may pass any `TrustState`, including one below `current.state`. Which transitions are legal is the caller's to decide; `downgradeTrust` is the entry point that also computes what a lowering revokes.
- **`bindWorkspaceTrust` always starts at `'untrusted'`**, with no argument that could seed another state, but the headless-boot call site that must reach it does not exist — a boot that never calls it is not gated by anything here.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
