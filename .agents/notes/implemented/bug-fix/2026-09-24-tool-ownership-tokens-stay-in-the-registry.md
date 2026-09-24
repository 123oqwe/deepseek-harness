# Agent Note: ownership tokens stay in the tool registry, and only the dynamic runner declares owners

Status: implemented

English | [中文](2026-09-24-tool-ownership-tokens-stay-in-the-registry.zh.md)

## Problem

[Namespace and ownership adjudication](../feature/2026-09-04-tool-registry-namespace-and-ownership-adjudication.md) minted an ownership token with every admitted tool registration and made `revokeOwned(token)` the revocation path, on the reasoning that a caller holding only a token has nothing to substitute. The token was not private. `ToolRuntime.ownershipOf` and `ownershipHistory` returned the whole `CapabilityRegistration`, token included, and every statically loaded plugin reaches the real `ctx.tools`, so any plugin could read another plugin's token and revoke that plugin's tools with it (BLOCKED-308).

Two routes also let a statically loaded plugin record a registration under another plugin's name, which the inventory chain then shows as that plugin's:

- `declareOwner(identity)` bound the caller's subtree to any identity, whoever the caller was.
- `resolveOwner` compared the caller's fiber chain with `loader.entries()`, a generator, and iterated that one generator once per fiber. The first pass exhausted it, so only the innermost fiber was ever compared, and a plugin registering from a child fiber it created fell through to that fiber's `Fiber.name`, which the plugin writes itself.

## Decision

- **The read APIs return `CapabilityRecord`**, a registration without its token (`@deepseek-ai/dsh-plugin-ownership`'s `Omit<CapabilityRegistration, 'ownershipToken'>`). `claimCapability` and `requestReplace` still mint the token, and the registry holds it; no method hands it out.
- **`revokeOwned` is removed.** It had no production caller. A tool registration is removed only through its own effect disposer, which Cordis runs when the registering fiber unloads. Each disposer removes exactly its own tool and record, which is how must[3] ("unload revokes only the effects matching the token") holds on the real path. `revokeByOwnershipToken` stays in the library, where its frozen cases observe the token contract, and has no production caller.
- **`declareOwner` accepts only callers under an entry that `ownership.ownerDeclarers` names.** The caller's innermost enclosing Loader entry must be in that list. The default is `@deepseek-ai/dsh-cordis-host-runner`, the one shipped caller: the runner builds each dynamic package's fiber under a group fiber that its own service context creates, so the innermost entry of a dynamic package is the runner's. In a tree with no Loader every caller may declare, because identities there are fiber names each plugin chooses and no entry identity exists to protect.
- **The Loader's entries are read into an array once per lookup**, and `resolveOwner` and `declareOwner` share that lookup. A registration from a nested fiber is attributed to its innermost enclosing entry.

## Alternatives considered

- **Keep `revokeOwned` and also check the caller's identity** (option two of lane A's preFlight A-302). Rejected: the token would stay readable while no longer being a credential on its own, which duplicates the identity check, and the option needs the `declareOwner` restriction anyway.
- **Hand the token only to its owner** (option three). Rejected: one record would have two shapes depending on the reader, and the option also needs the `declareOwner` restriction.
- **Refuse `declareOwner` for every fiber that resolves to a Loader identity.** Rejected: every dynamic package resolves to the runner's entry, so the rule refuses the one production caller. Narrowed to a Loader entry's own fiber, it is bypassed by declaring from a child fiber.
- **A fixed declarer instead of a config field.** Rejected: which entry hosts dynamic definitions is a deployment choice. A deployment that mounts the runner under another name, or runs a second dynamic host, names that entry in `ownerDeclarers`.

## Consequences

- A statically loaded plugin that reaches another service's private state can still act through it: a call made through the runner's own service context passes the `declareOwner` check. The restriction closes the public API; plugins in one process are not isolated from each other.
- Two plugins nested under one entry now share that entry's identity, so a name clash between them is refused by the per-layer duplicate error instead of `capability-collision`. Both refuse the second registration.
- `CapabilityRecord` joined `CapabilityRegistration` and `OwnershipToken` in `gen-cordis-catalog`'s `TYPE_LINK_EXEMPTIONS`, and `RevocationResult` left it with `revokeOwned`.
