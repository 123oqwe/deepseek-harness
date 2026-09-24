# Agent Note: ownership tokens stay in the tool registry, and only the dynamic runner declares owners

Status: implemented

English | [中文](2026-09-24-tool-ownership-tokens-stay-in-the-registry.zh.md)

## Problem

[Namespace and ownership adjudication](../feature/2026-09-04-tool-registry-namespace-and-ownership-adjudication.md) minted an ownership token with every admitted tool registration and made `revokeOwned(token)` the revocation path, on the reasoning that a caller holding only a token has nothing to substitute. The token was not private. `ToolRuntime.ownershipOf` and `ownershipHistory` returned the whole `CapabilityRegistration`, token included, and every statically loaded plugin reaches the real `ctx.tools`, so any plugin could read another plugin's token and revoke that plugin's tools with it (BLOCKED-308).

Three routes also let a statically loaded plugin record a registration under another plugin's name, which the inventory chain then shows as that plugin's:

- `declareOwner(identity)` bound the caller's subtree to any identity, whoever the caller was.
- `resolveOwner` compared the caller's fiber chain with `loader.entries()`, a generator, and iterated that one generator once per fiber. The first pass exhausted it, so only the innermost fiber was ever compared, and a plugin registering from a child fiber it created fell through to that fiber's `Fiber.name`, which the plugin writes itself.
- A fiber that no Loader entry encloses, for example a child of the root fiber, fell back to its own `Fiber.name` even in a tree with a Loader.

## Decision

- **The read APIs return `CapabilityRecord`**, a registration without its token (`@deepseek-ai/dsh-plugin-ownership`'s `Omit<CapabilityRegistration, 'ownershipToken'>`). `claimCapability` and `requestReplace` still mint the token, and the registry holds it; no method hands it out.
- **`revokeOwned` is removed.** It had no production caller. A tool registration is removed only through its own effect disposer, which Cordis runs when the registering fiber unloads. Each disposer removes exactly its own tool and record, which is how must[3] ("unload revokes only the effects matching the token") holds on the real path. `revokeByOwnershipToken` stays in the library, where its frozen cases observe the token contract, and has no production caller.
- **`declareOwner` accepts only callers under an entry that `ownership.ownerDeclarers` names.** The caller's innermost enclosing Loader entry must be in that list. The default is `@deepseek-ai/dsh-cordis-host-runner`, the one shipped caller: the runner builds each dynamic package's fiber under a group fiber that its own service context creates, so the innermost entry of a dynamic package is the runner's.
- **The Loader is read from the registry's own context.** The constructor captures the context the registry was mounted in, and every lookup reads `loader` from it. A method's `this.ctx` is the caller's context, and a caller that isolates `loader` in its own scope sees no Loader there, which would otherwise skip the check.
- **The Loader's entries are read into an array once per lookup**, and `resolveOwner` and `declareOwner` share that lookup. A registration from a nested fiber is attributed to its innermost enclosing entry. An entry of another entry tree counts too: a preset composition mounts its rows in its own tree and keeps that tree out of the host Loader's `entries()`, so the lookup also reads the `fiber.entry` the Loader sets on each fiber an entry mounts, and accepts such an entry only at its own fiber, inside a tree whose fiber is further up the caller's chain, and only when a host Loader entry is further up that chain too, because any code can write `fiber.entry`.
- **With a Loader in the tree, a registration from a fiber that no entry encloses is refused**, because the only name such a fiber has is the one it gave itself. The root fiber is the exception: no plugin names it, and it registers as `root`, which is not an official identity and so cannot claim the reserved `dsh.*` namespace. Two test drivers register on the booted root context, and this keeps them working. A tree with no Loader records a registration under its fiber's name, and every caller there may declare.

## Alternatives considered

- **Keep `revokeOwned` and also check the caller's identity** (option two of lane A's preFlight A-302). Rejected: the token would stay readable while no longer being a credential on its own, which duplicates the identity check, and the option needs the `declareOwner` restriction anyway.
- **Hand the token only to its owner** (option three). Rejected: one record would have two shapes depending on the reader, and the option also needs the `declareOwner` restriction.
- **Refuse `declareOwner` for every fiber that resolves to a Loader identity.** Rejected: every dynamic package resolves to the runner's entry, so the rule refuses the one production caller. Narrowed to a Loader entry's own fiber, it is bypassed by declaring from a child fiber.
- **A fixed declarer instead of a config field.** Rejected: which entry hosts dynamic definitions is a deployment choice. A deployment that mounts the runner under another name, or runs a second dynamic host, names that entry in `ownerDeclarers`.
- **Record every registration outside the entries under one fixed identity instead of refusing it.** Rejected: refusing names the problem at the registration, and the root fiber, the one caller outside the entries with a name no plugin chose, keeps its own identity.

## Consequences

- The checks read fiber positions, and Cordis gives every plugin in the process public access to them. Through `ctx.get('loader').entries()`, a plugin can reach another entry's fiber context and place a fiber under it: that fiber registers as the other entry, and under a declarer's entry it may also declare. A plugin can rename its own entry through `options.name`, or rewrite `ownerDeclarers` with `loader.update`, which also persists the change. The registry's private fields, the tokens among them, are readable at runtime. The `fiber.entry` link read for entries outside the host Loader is a public field too, so code inside a Loader entry that sets it on a fiber it created under that entry registers the fiber under any name. On a fiber no host entry encloses, the link names nothing and the registration is refused. The caller chain follows `fiber.parent`, also a public field, so the same code can re-parent a fiber it created under another entry. These routes are an open question for the user (BLOCKED-308, B-class); this change does not establish that a statically loaded plugin cannot register under another plugin's name.
- Code that holds `ctx.root` can register as `root`.
- Two plugins nested under one entry now share that entry's identity, so a name clash between them is refused by the per-layer duplicate error instead of `capability-collision`. Both refuse the second registration.
- `CapabilityRecord` joined `CapabilityRegistration` and `OwnershipToken` in `gen-cordis-catalog`'s `TYPE_LINK_EXEMPTIONS`, and `RevocationResult` left it with `revokeOwned`.
