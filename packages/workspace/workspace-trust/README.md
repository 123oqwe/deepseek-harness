---
description: "The Contract-stage type surface and pure decision-function signatures for Epic P1-07's project trust boundary, for maintainers picking up the RED-scaffold fix-round."
kind: "package-library"
---

# @deepseek-ai/dsh-workspace-trust

## Summary

`dsh-workspace-trust` fixes the type surface and function signatures for Epic P1-07's project trust boundary: every workspace holds one of three trust states — `'untrusted'`, `'trusted-read'`, `'trusted-execute'` — bound to both its canonical realpath and the `fs.Stats` device/inode identity observed at bind time, never to the path string alone (must[0]); while `'untrusted'` or `'trusted-read'`, only safe reads are permitted and no project plugin, hook, MCP server, executable skill, or home/profile patch override ever loads (must[1]); and raising trust requires a genuine host user principal and produces an audit record (must[2]).

This package currently ships this epic's Contract-stage RED scaffold only: `src/types.ts`'s types and `src/index.ts`'s function signatures are real and epic-accurate, but every decision function (`bindWorkspaceTrust`, `authorizeProjectLoad`, `reconcileWorkspaceTrust`, `requestTrustUpgrade`, `downgradeTrust`) throws `'not implemented: ...'` — the pure decision logic itself is a later fix-round's deliverable, proven by `tests/trust.spec.ts`'s real assertions against that (currently failing) behavior. `isHostUserPrincipal` is the one exception: a real, already-correct one-line predicate directly grounded in must[2]'s "宿主用户交互" (host user interaction) text, not itself the fail-closed adjudication `requestTrustUpgrade` performs. No invariant companion is published because this Contract-stage slice constructs no registry, table, or `Context` value yet to check an owned relation over — every export here is a pure function over caller-supplied plain data.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The trust decision surface, once implemented, is called with plain data — no file, process, or Cordis `Context` access:

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
| [`src/index.ts`](src/index.ts) | `isHostUserPrincipal` (real), and `bindWorkspaceTrust`/`authorizeProjectLoad`/`reconcileWorkspaceTrust`/`requestTrustUpgrade`/`downgradeTrust` (Contract-stage RED scaffold — real signatures, `'not implemented'` bodies) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/trust.spec.ts`](tests/trust.spec.ts) — the Contract-stage RED scaffold: one case per registry-declared must[]/acceptance[] clause (must[2] split into its refuse/admit halves, acceptance[1] split into its three named identity-change vectors plus an unchanged-identity control).
- [`packages/workspace/workspace/src/{entity,index,paths}.ts`](../workspace/src) — the real `Workspace` entity and `realpathNormalize` this epic's Usage-stage wires trust observation into (Usage-stage wiring, not this package's job).
- [`packages/context/agent-instructions/src/{index,files}.ts`](../../context/agent-instructions/src) and [`apps/cli/src/profile-boot.ts`](../../../apps/cli/src/profile-boot.ts) — the real project-instruction/plugin/patch load sites acceptance[0]'s zero-subprocess/network/credential-read guarantee is meant to gate (Usage-stage wiring, not this package's job).
- [`@deepseek-ai/dsh-principal`](../../identity/principal/README.md) — the identity package `isHostUserPrincipal`/`requestTrustUpgrade` build must[2]'s host-user-interaction requirement on.
- [`docs/architecture/trust-kernel-boundary.md`](../../../docs/architecture/trust-kernel-boundary.md) — why `TrustUpgradeAuditRecord` (`src/types.ts`) is this package's own plain data rather than a real `@deepseek-ai/dsh-trust-kernel` `auditAppend` call: any epic wiring a real audit enforcement point consuming the Trust Kernel needs the vendored Cordis `Fiber` structural fix first.
- [`@deepseek-ai/dsh-plugin-ownership`](../../plugin/plugin-ownership/README.md) — this repo's other Contract-stage pure-decision-logic package, followed here for package layout and conventions.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure decision-function signatures only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No wiring into real `fs.realpath`/`fs.stat` observation, real project plugin/hook/MCP-server/skill loaders, or `apps/cli/src/profile-boot.ts`'s home-patch layer exists yet** (registry's own `stages.P`/`stages.U` files) — this package alone cannot observe a real directory's identity or gate a real load.
- **No real `@deepseek-ai/dsh-trust-kernel` audit-append wiring exists yet, and cannot until the vendored Cordis `Fiber` structural fix lands** (`docs/architecture/trust-kernel-boundary.md`) — `TrustUpgradeAuditRecord` fixes only the shape a later append call will carry.
- **The exact fail-closed default for a headless/non-interactive boot is unfixed here.** Registry validation ("验证 headless profile 无交互时默认不信任") implies `bindWorkspaceTrust` always starts at `'untrusted'` with no interactive path to skip that — this Contract stage's signature already forces that (there is no constructor argument to seed a non-`'untrusted'` initial state), but the real headless-boot call site enforcing it is a later Usage-stage's job.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
