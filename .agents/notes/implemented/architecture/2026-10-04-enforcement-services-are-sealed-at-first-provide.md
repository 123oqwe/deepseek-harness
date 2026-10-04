# Agent Note: The services the enforcement point decides with are sealed at their first provide

Status: implemented

English | [中文](2026-10-04-enforcement-services-are-sealed-at-first-provide.zh.md)

## Problem

`pinTrustKernel` pinned only `trustKernel`. The enforcement point takes its decision from `ctx.get('policy')`, the Cedar engine reads `ctx.policySet`, and the risk gate reads `ctx.get('permissionPresets')`, and all three are ordinary plugins that mount after the pin. A plugin could rewrite their store slots, mutate the provided record, delete the slot and provide the name again, shadow the property, or unload the provider and provide a forgery in its place. The kernel endorses a forged engine's `permit`, and a forged or removed risk policy lifts the hard-deny band and every approval (B-728; P2-05 acceptance[2], P2-04 acceptance[1]-[2]).

## Decision

- Vendored Cordis local modification 23 adds a per-tree seal table. After `Fiber.sealOnProvide(names)`, a sealed name resolves only from that table, in `ReflectService._getImpl` and in the proxy `get` trap before an own property, a `props` accessor, a fiber store or an `internal/get` listener. Its first provide freezes and records the `Impl`, and any later provide throws. When the provider unloads, the name becomes a tombstone that resolves to nothing until the process restarts. `Fiber.sealedServiceState` reports `awaiting` before the first provide and `tombstone` after the unload.
- `pinTrustKernel` seals `KERNEL_SEALED_SERVICES` (`policy`, `policySet`, `permissionPresets`) as its last step, before any entry mounts. The list is fixed, because which services a plugin may not replace is a security invariant.
- `boot()` refuses a tree in which a sealed service was provided by a plugin other than its profile row (`policy-engine`, `policy-language`, `permission`) in the include tree. Rows are matched by id, not by package, so a deployment can still change a row's package or config.
- A tombstone fails closed. `enforceAction` answers `policy-unavailable` with `POLICY_ROW_CHANGED` in the audit diagnostics, also when an engine throws because the sealed policy set it reads has unloaded, and the refusal the model reads says the host must restart. `gateActionRisk` refuses every call with `policy-row-changed` while `permissionPresets` is a tombstone; a composition that never mounted it still has no gate.

## Alternatives considered

- **Pin the three names the way `trustKernel` is pinned.** Their providers mount from config rows after the pin, so there is no value to pin when the pin runs.
- **Check the provider's identity at each decision.** The check would read the same store it is meant to protect.
- **Accept a provide again after the provider unloads.** A plugin could then unload the real row's fiber and provide a forgery in the gap.
- **Treat an unloaded `permissionPresets` like one that was never mounted.** The gate would fail open after any restart of the permission plugin.

## Consequences

- A live reload of the `policy-engine`, `policy-language` or `permission` row, or of a service the `permission` row injects (`shell`, `approval`, `sessions`, `sessionProjections`), takes effect only when the host restarts, and until then every action is refused with a restart reason. Profiles that do not live-reload those rows are unaffected. A policy-set edit in `settings.yaml` changes what `policySet.current()` returns and provides nothing again, so it still applies live.
- Reading a sealed name by property access throws while it is not provided, as reading an unsealed service without injecting it does.
- Not covered: a plugin in the same realm can still mutate the provided engine object or its prototype in place. Isolating plugins from each other's objects is P1-06's scope.
- Not covered: the boot check reads `Fiber.entry`, a writable field that a plugin could set on its own fiber before it provides a sealed name. This is in-realm mutation too, also in P1-06's scope.
