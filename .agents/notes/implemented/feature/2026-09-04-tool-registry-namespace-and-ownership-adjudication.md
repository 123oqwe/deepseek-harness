# Agent Note: namespace and ownership adjudication on the real tool registry

Status: implemented

English | [中文](2026-09-04-tool-registry-namespace-and-ownership-adjudication.zh.md)

## Problem

Epic P1-09's Contract stage built a complete, tested pure-function surface for Service/Tool/Event namespace and ownership conflict detection — `claimCapability`, `requestReplace`, `revokeByOwnershipToken`, `buildInventoryChain`, `isReservedNamespace` — and nothing in the repository called any of it. A grep for `@deepseek-ai/dsh-plugin-ownership` outside its own package returned only prose: four READMEs citing it as a layout precedent. The decisions were correct and unreachable.

Two properties made the obvious wiring untrustworthy, and both were measured rather than assumed.

`ToolLayer`'s `NamedEntries` already throws ``tool "<name>" is already registered`` on any duplicate. Booting a two-plugin collision fixture against the unmodified tree already aborts with exactly that error. So the natural acceptance case — two plugins claim one name, expect the boot to fail — is green with zero new code and survives deleting the entire gate. `lifecycle.ts` carries a second route to the same string, a teaching hint that rewrites it into a stop-then-run recipe.

Cross-plugin revocation was not expressible at all. Tool disposal is by returned closure, with no API taking a name or an identity, so a test asserting that plugin B cannot revoke plugin A's tool would have been asserting a property of the API's absence rather than of any enforcement.

## Decision

`ToolRuntime.register` adjudicates every global registration before it lands.

- **Identity comes from the Loader entry, not the fiber name.** `resolveOwner` walks the caller's fiber chain and returns the innermost enclosing Loader entry's module specifier — the registrant's stable on-disk identity. `Fiber.name` walks to the nearest *named runtime* and is a diagnostic display string; it is the fallback only in a tree with no Loader at all, which no booted product tree is.
- **`declareOwner(identity)` binds a fiber subtree to an explicit identity**, for a registrant no Loader entry names. A dynamically defined Cordis package is the case it exists for.
- **`replace` is the only override.** A plain `register` of an owned name stays a `capability-collision` refusal even under `ownership.allowReplace: true`.
- **`revokeOwned` takes a token and nothing else.** There is no name or identity argument a caller could substitute, so cross-plugin revocation has no surface to attempt through.
- **Ownership records live and die with the effect.** The bookkeeping runs inside the `layers.effect` action and its undo, which is what makes the epic's "effects after unload = 0" true of the records and not only of the tools. A record a legitimate replacement superseded is retained, so the Inventory can still show the chain; an unloaded plugin's is not.

`packages/extensions/cordis-host-runner/src/guard.ts` refuses a dynamic package's `ctx.provide`/`ctx.on`/`ctx.once` inside `dsh.*`. This façade is the only non-vendored point at which a Service or Event registration is adjudicated before it reaches Cordis.

**A dynamic package's identity is the runner's, never its own.** `guardedPlugin` calls `declareOwner(pluginId)` before the host half's `apply` runs, so registrations are attributed to the runner's `CordisDynamicPluginId` threaded down from `startHostHalf`. Both fallbacks are wrong for this case and were rejected on that basis: `Fiber.name` resolves to the `name` the model wrote in its own source, so a package could declare a real plugin's package name and inherit its standing; and the enclosing Loader entry is the shared `cordis-dynamic` group, which every dynamic half hangs under, so it would collapse them all into a single owner and make dynamic-vs-dynamic collision undetectable. **An identity must not be bound to something the subject itself controls.**

**The ownership refusal had to re-teach a message it displaced.** With distinct identities, a dynamic package colliding with a different owner is refused by the ownership gate before the tool registry's duplicate error fires, so `lifecycle.ts`'s stop-then-run recipe — the model's actual instruction for what to do about the collision — stopped reaching it. The recipe is now taught on a `capability-collision` as well as on `already registered`; the two messages describe the same situation (same-package re-run versus a different owner) and both need the same fix. `composition.spec.ts`'s existing "names the replace recipe" case is what caught the loss, and a mutation removing the new arm turns it red again.

`packages/host/plugin-inventory/src/index.ts` adds `buildToolOwnershipChain(ctx)`, a plain export like `buildPluginPermissionStates` beside it.

**Scoped registrations are adjudicated differently, and the repo's own tests caught the first draft getting this wrong.** Collision adjudication and ownership records apply to global registrations only: a scoped tool shadowing a global name is what `agent.ctx` registration is *for*, and a first draft that refused it as a collision was caught by this package's existing `scoped.spec.ts`. The reserved-namespace rule still applies in every scope, or `dsh.*` would be claimable from any agent scope.

**The reserved namespace is enforced but unpopulated.** No tool name, service key, or event name in this repository contains a `.`, so nothing claims a conflicting `dsh.*` namespace today. Those cases prove the gate rejects; they caught no pre-existing conflict, and should not be read as having done so.

## Named residual

**Static-origin Service and Event registration is not gated anywhere.** `ctx.provide` and `ctx.on` are implemented in `vendor/cordis`; gating them is a vendored change that the Trust Kernel boundary puts behind the `Fiber` fix, which is unlanded. must[0] is therefore enforced as: Tool across all origins, Service/Event for the dynamic origin only. A narrower Tool-only reading of the clause would have made the residual disappear, and was rejected for being the reading that removes the obstacle.

(A second residual — a dynamic package's registrations resolving to the model-authored `Fiber.name` — was closed in this same change; see below.)

## Alternatives considered

**Derive the identity from `Fiber.name` everywhere.** Rejected: it is a diagnostic display name, and for a dynamic package it is authored by the model, so a package could declare a real plugin's package name and inherit its standing.

**Call `claimCapability` with the full live registration list.** Rejected: its collision check refuses a same-identity re-registration too, which would have swallowed the pre-existing duplicate error and its per-agent-variant guidance. Only registrations held by a *different* identity are passed as contested, and a same-identity duplicate falls through to the layer.

**Assert the collision case on boot failure alone.** Rejected as vacuous, by measurement: the unmodified tree already fails that boot.

## Consequences

`gen-cordis-catalog` refused the new service methods until `CapabilityRegistration`, `OwnershipToken`, and `RevocationResult` were classified; they are `TYPE_LINK_EXEMPTIONS` entries naming `plugin-ownership`'s README as documentation owner.

**The Cordis Loader writes back to the config it boots.** An entry whose `apply` throws is persisted with `disabled: true`. Two of this epic's compositions are designed to fail, so early runs edited the checked-in fixtures and later runs read a tree with the failing entry already switched off — producing one meaningless green followed by consistent reds. Each boot now copies the fixture directory into a git-ignored `tmp/` inside the repository; outside it, workspace packages do not resolve. Any test pointing `runLoaderSmoke` at an in-repo config whose entries can fail has this problem.
