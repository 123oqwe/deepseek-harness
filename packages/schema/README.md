---
description: "The schema group map: one identity and one version for every persisted or wire-protocol leaf object, and the compatibility rule that decides whether this build may read that record, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/schema

English | [中文](README.zh.md)

## Summary

The schema group answers one question: **may this build read that record?** It gives every persisted or wire-protocol leaf object a `schemaId` and a major/minor version, and it holds the compatibility rule those versions are judged by — a minor difference is readable, a major one is not, and the decision is a function rather than a convention each reader reimplements. One package, no plugin, no ctx key, nothing model-visible: the group is a vocabulary and a decision, and the readers that will consult it live elsewhere.

The package's own README sits one directory down and is English-only for now, which is why the name below is not a link: this page would have to claim a Chinese counterpart that does not exist.

## Table of Contents

- [Packages](#packages)
- [What is not arrived yet](#what-is-not-arrived-yet)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| `schema-registry` | `schemaId` identity, major/minor versioning, the compatibility rule, migration registration, and `negotiateSchema` | — (a library) |

-----

<a id="what-is-not-arrived-yet"></a>
## What is not arrived yet

Taken from the package's own Known Limitations. This group is further from its readers than most, and the entries say so plainly rather than reading as near-complete.

- **`negotiateSchema` is not wired into any read path.** It is real and tested; no session replay, SDK initialize, or plugin load consults it yet.
- **No real second-version schema exists.** Every bootstrapped schema is at its own first version with an identity migration, so the compatibility rule has never had to refuse anything in production.
- **The SDK-protocol `schemaId` list is hand-mirrored.** `PROTOCOL_WIRE_SCHEMA_IDS` is kept in sync by hand rather than derived, which is the shape this repository treats as a defect class elsewhere.

-----

<a id="related-documentation"></a>
## Related documentation

- [Control protocol subsystem](../../docs/subsystems/control-protocol.md) — per-message schema negotiation, resolved through this registry: "can this build read this message", scoped to one message shape and saying nothing about the peer as a whole.
- [Settings subsystem](../../docs/subsystems/settings.md) — a live consumer of the identity: each namespace carries its registry version under `schemaId` `settings:${ns}`.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package's README.

The open question is **whether a rule with no refusal is a rule**. Every schema is at version one, so `negotiateSchema` has never told a reader no in production, and the first time it does will be the first time anything downstream has to have a plan for that answer. Wiring it into a read path and introducing a second version are the same piece of work seen from two ends, and doing either alone leaves the other untested.

The second is **how `PROTOCOL_WIRE_SCHEMA_IDS` stops being hand-mirrored**. Elsewhere this repository derives such lists from the declarations themselves and gates the result; here it is a list someone must remember to update, which is the failure mode `BLOCKED-192` generalises.

</details>
