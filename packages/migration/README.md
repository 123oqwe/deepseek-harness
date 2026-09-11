---
description: "The migration group map: the Shadow/Enforce feature gate — its state, its override chain, and the shadow-versus-legacy comparison that has to agree before a gate may enforce anything, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/migration

English | [中文](README.zh.md)

## Summary

The migration group is how a behaviour change gets turned on: a gate runs the new path in **Shadow** beside the legacy one and compares them, and only a gate whose comparison agrees may move to **Enforce**. It is a resolver and a set of decisions, not a service — the resolved gates are handed to a boot by a bare `ctx.provide`, and nothing here registers a capability, injects a prompt or reaches a model request. Mount nothing; call the functions from wherever a migration is being carried out.

The package's own README sits one directory down and is English-only for now, which is why the name below is not a link: this page would have to claim a Chinese counterpart that does not exist.

## Table of Contents

- [Packages](#packages)
- [Why no subsystem page](#why-no-subsystem-page)
- [What is not arrived yet](#what-is-not-arrived-yet)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| `feature-gates` | Epic P0-05's gate state and lifecycle metadata, the pure override-chain resolver, the shadow-versus-legacy comparison, and the expiry check | — (a library; the only Cordis entry is the `./invariant` companion) |

-----

<a id="why-no-subsystem-page"></a>
## Why no subsystem page

This group carries an entry in `verify-subsystem-pages`'s `GROUPS_WITHOUT_SUBSYSTEM_PAGE` rather than linking one, and the reason is checkable: there is no service to document. The resolved gates reach a profile through a bare `hostCtx.provide('featureGates', …)` in the app boot — deliberately not a declared Context service — so the vocabulary a subsystem page would fix does not exist as a mounted surface. The mechanism's own decisions live in an Agent Note instead, linked below, the same shape the `plugin` and `kernel` groups use.

-----

<a id="what-is-not-arrived-yet"></a>
## What is not arrived yet

- **No real gate exists.** The declaration list the app boot carries is empty, so the resolver, the comparison and the expiry check are all reachable and all currently answer about nothing. That is the state the mechanism was deliberately built in — wiring before any real gate — and not a gap discovered later.
- **Nothing enforces an expiry.** `checkFeatureGateExpiry` decides; no scheduled caller asks it, so a gate that outlived its release is found by whoever looks.

-----

<a id="related-documentation"></a>
## Related documentation

- [Agent Note: feature-gate mechanism wiring before any real gate exists](../../.agents/notes/implemented/architecture/2026-09-01-feature-gate-mechanism-wiring-before-any-real-gate.md) — the decisions this group is made of: a shared resolver rather than a duplicated computation, and no new Cordis service augmentation.
- [Config catalog](../../docs/config-catalog.md) — the declaration shape a profile boot supplies.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package's README.

The open question is **whether a mechanism with no instance stays honest**. Every function here is real and tested against constructed input, and none has ever decided a live migration, so the first real gate will also be the first test of whether the shadow comparison is the right comparison. The mechanism was built that way on purpose — the Agent Note argues the wiring is worth having before the first gate rather than after — and the cost of that choice is that its first use is also its first evidence.

</details>
