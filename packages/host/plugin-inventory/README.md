---
description: "Read-only projection of the current Cordis Loader plugin state with each agent preset's composition beside it: the pluginInventory service and its pluginInventory/list Remote for web GUI host clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

## Summary

Clients and settings pages can show what is currently composed in the host: calling `pluginInventory/list` returns the current non-group Loader entries in Loader order — entry id, module specifier, effective enablement, and root Fiber phase (`pending`, `loading`, `active`, `failed`, or `unloading`, or `null` when an entry has no live root Fiber). When an agent-preset roster is composed, the snapshot also carries one group per preset — id, trust, display name, default marking, health, and flattened composition rows — because a deployment that mounts the roster runs its model-facing plugins there rather than on the Loader's own entries. The snapshot is point-in-time: the Loader is the sole lifecycle authority, and this package owns no cache, history, provenance model, event stream, or mutation path. Client packages consume the Remote through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

Epic P1-01.U adds this package's first real live-`Context` introspection: `buildObservedPluginCapabilities` walks one plugin entry's own Cordis Fiber subtree (the global `ReflectService` store for services, `Fiber.getEffects()` labels for tools/skills/events, a live MCP-client entry's resolved `config.serverName` for MCP servers) and reports what it actually registered, in `@deepseek-ai/dsh-plugin-manifest`'s declared vocabulary; `buildPluginPermissionStates` composes that with each entry's own `package.json` `dsh` field (`classifyPluginDeclaration`) and, for a `'manifest-v2'` declaration, a real `compareDeclaredToObserved`/`decidePluginTrust` result — one `PluginPermissionState` per live, non-group, package-resolvable Loader entry. `apps/cli/src/profile-boot.ts` calls both at real profile boot for acceptance[0]'s enforcement and acceptance[1]'s declared-vs-observed display; see [Known Limitations and Deferred Work](#known-limitations-and-deferred-work) for why neither is exposed as a `pluginInventory` Remote method yet.

Epic P1-02.U adds the recorded provenance state acceptance[2] asks the Inventory to carry ("Inventory 和审计事件记录验证结果而不记录密钥"). Every `PluginPermissionState` now carries two facts, deliberately named apart. `manifestDigest` is a **local recomputation, not an attestation**: sha256 over the exact bytes of the entry's own `package.json`, taken from the same read the identity and declaration are parsed from, so it detects a modified manifest and says nothing whatever about origin. It is not `@deepseek-ai/dsh-plugin-provenance`'s `PackageDigest`, which binds a package tarball no installation leaves on disk. `provenanceAudit` is that package's `ProvenanceAuditRecord`, and today it always reports `trust: 'unverified'`, `reason: 'no-provenance-claim'` — the true state of every package installed here, because none ships a `PackageProvenanceClaim`. That is not a refusal, and recording it as one would name a rejection reason none of which is true of them. Nothing read out of the entry's `package.json` — the raw `dsh` field above all — reaches the record, at any nesting depth.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Call `pluginInventory/list` when a client or settings page needs to show what is currently composed in the host — which plugins are loaded, enabled, and alive, and what each agent preset would give a session. The Remote is the only entry point: the service is Remote-only and deliberately declares no same-process Cordis `Context` merge.

### What a snapshot contains

Each row is one non-group Loader entry: its entry id, the exact module specifier, the effective enablement (including disabled ancestor groups), and the current root Fiber phase. `pending` means the entry waits to load, `loading` that it is being read, `active` that it is running, `failed` that its fiber rejected, and `unloading` that it is being torn down; `null` means no live root Fiber exists at all. Structural group rows are skipped.

### Per-preset compositions

With a roster composed, `agentPresets` carries one group per preset in roster order: its id, whether the deployment ships it or the user owns it (`trust`, which clients use to localize shipped names), published display name, whether a session naming no preset composes it, and flattened plugin rows — entry id (null when the file row declares none), module specifier, effective enablement, the row's own `!!js` disabled expression when it carries one, and a root-fiber phase when the composition is live. A preset some session already composed answers from its newest standing generation — even when its file has since broken, because the mount is what those sessions run; one never composed since boot answers from its composition file with disabled gates evaluated against the Loader context, and reading never mounts a preset. `conditional` enablement marks a gate the Host could not evaluate, and a broken preset nothing composed stays listed with its reason and no rows. Without a roster the field is absent.

### What you can and cannot do with it

The inventory is a snapshot for display and diagnostics: a client can render the roster, flag failed entries, and detect changes by comparing snapshots. It cannot enable, disable, add, or remove plugins, and it carries no history — a fiber that already failed and was removed is absent. Because the service reads the Loader on every call, the answer always reflects the current composition rather than a cached view.

### Tool ownership chains

`buildToolOwnershipChain(ctx)` is a plain export, not a `@Remote` method: it reads the live tool registry's ownership history and returns one entry per tool name — its current owner, and the owner a legitimate replacement displaced. A tool whose first owner still holds it reports no `replaces`. An unloaded plugin's records are gone, so the chain never names an owner that is no longer mounted. It returns an empty list when no tool registry is composed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The gateway is a direct projection with no second lifecycle truth: every `list()` call reads `ctx.loader.entries()` and maps each non-group entry to its public row. Cordis's internal plugin/status events already maintain `Entry.fiber` and `Fiber.state`, so a cache would only add another lifecycle truth to keep synchronized. The agent-preset roster is an optional peer resolved per call through `ctx.get('agentPresets')`: its `compositionInventory()` owns every preset read, and this package only maps root-fiber states onto the public phase vocabulary.

### The phase mapping

Fiber states map onto the public phase vocabulary, with `disposed` folding into `null` — an entry whose fiber is gone has no live root to report. The phase therefore never distinguishes why no live root exists: the entry may never have started, or its fiber may already have been disposed.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `PluginInventoryGateway`: the `pluginInventory` Remote service and the Loader projection; plus Epic P1-01.U's plain exports `buildObservedPluginCapabilities`, `buildPluginPermissionStates`, `mcpServerNameOf`, and `resolveEntryPackageDir` |
| [`src/types.ts`](src/types.ts) | Public payload types: `PluginInventoryEntry`, `PluginInventorySnapshot`, `PluginFiberPhase`; plus Epic P1-01's declared-vs-observed permission types — `PluginPermissionState`, `PluginPackageIdentity`, `PluginProvenance` — and Epic P1-02.U's `PluginManifestDigest` |
| — | No runtime invariant companion is published; every snapshot is projected directly from Loader-owned state. |

Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the inventory contract is not enough: how the Remote reaches clients, then the Loader it projects and the surface that renders it.

- [Remote assembly](../../api/remotes/README.md) — how clients consume `pluginInventory/list` without importing the Host implementation.
- [Cordis plugin loader](../../../vendor/loader/README.md) — the Loader whose entries this package projects.
- [Plugin inventory settings surface](../../client/ui-settings-plugin-inventory/README.md) — the browser-side projection that renders the inventory.

-----

<a id="model-experience"></a>
## Model Experience

None, as the host-side read-only Loader projection registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what a point-in-time inventory cannot tell a client. They are current package constraints, not a task backlog.

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **`pluginInventory/list` still carries no permission state** — `buildPluginPermissionStates` exists and is real (Epic P1-01.U), but it is not exposed as a `pluginInventory` Remote method: the typert Zod-schema emitter cannot serialize `PluginManifestV2`'s non-empty-tuple fields (`readonly [X, ...X[]]`, e.g. `CapabilityEffectDeclaration.authAudience`), confirmed by a real build failure (`tuple rest element must retain an array type`) when this class carried a `@Remote('permissions')` method returning it. `apps/cli/src/profile-boot.ts` calls the plain function directly at real profile boot, for boot-time enforcement and the declared-vs-observed display (acceptance[0]/[1]); `apps/cli/src/plugin.ts` does not and cannot — it is a pnpm forwarder with no Cordis `Context`; a future Remote surface needs a typert-generator fix or a serialization-friendly projection of `PluginPermissionState`, neither of which is this stage's job.
- **Provenance is best-effort, from the caller's own boot composition, not this package's own knowledge** — `buildPluginPermissionStates`' `provenance` field marks an entry `'bundle'` only when the caller supplies its module name in `bundlePackageNames` (`apps/cli/src/profile-boot.ts`'s admitted profile layers); everything else reports `'built-in'`, including a real agent-preset composition row, which this function does not cross-reference at all (that granularity stays on `PluginInventorySnapshot.agentPresets`, unchanged by this stage).
- **No plugin here presents a provenance claim, so nothing is actually verified** — `provenanceAudit` records `'unverified'` for every entry because no installed package ships a `PackageProvenanceClaim`. Even when one does, `@deepseek-ai/dsh-plugin-provenance` verifies a claim against caller-supplied observed facts with no key material behind it (BLOCKED-050), so a `'trusted'` record would not mean the Trust Kernel endorsed anything. The audit-event half of acceptance[2] is not addressed here at all: a real audit event needs a `SessionEventMap` member and a `known-event-types.ts` registration, neither of which is in this package.
- **Presets appear only with a roster** — a deployment without `dsh-agent-presets` serves Loader entries alone; the `agentPresets` field is absent rather than empty.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
