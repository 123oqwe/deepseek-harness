---
description: "The memory group map: the provider-neutral durable Memory seam, what separates it from the session log, and where the consumer that actually recalls for a model lives, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/memory

English | [中文](README.zh.md)

## Summary

The memory group holds one thing: the capability seam for records a caller *deliberately kept* — facts a user stated, decisions a team made — durable across every session and keyed by tenant and principal rather than by conversation. It is deliberately silent on how a provider finds a record: `query()` takes free text, and whether an embedding index, a graph, or a substring scan answers it is the provider's business and never the seam's vocabulary. The group is optional and host-side; mount it when something must be remembered past the session that learned it, and omit it entirely otherwise.

The group is one package because the seam is one contract. What makes it *useful* — recalling records into a model's context — is a Consumer, and Consumers live with their concern rather than with the capability they consume.

## Table of Contents

- [Packages](#packages)
- [What memory is not](#what-memory-is-not)
- [What is not arrived yet](#what-is-not-arrived-yet)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`memory`](memory/README.md) | The provider-neutral Memory service: propose/query/get/revise/forget/export, per-call provider selection, the `principal`/`purpose`/`scope`/`contextBudget` read scoping the seam enforces itself, and the in-memory and durable-file providers | `ctx.memory` |

`propose()` is the only mutation verb the seam has — there is no `write`, `set`, or `put` — so a durable record cannot originate anywhere else. Reads are scoped at the seam rather than in providers: `query()`, `get()` and `export()` refuse an incomplete access context with `MEMORY_ACCESS_CONTEXT_REQUIRED` before any provider is reached, which is why a provider can never be handed an unscoped read.

**The recall Consumer is not in this group.** [`@deepseek-ai/dsh-memory-context`](../context/memory-context/README.md) — the plugin that recalls records into a model request and writes one `memory/access` event per read — sits in `packages/context/` with the other request-context plugins. That placement is the capability-seam split, not an accident: this group owns what a memory *is*, and a Consumer owns when a model should see one.

-----

<a id="what-memory-is-not"></a>
## What memory is not

The distinction the group is most often asked about is Memory versus [Session Query](../../docs/subsystems/session-query.md), and the two are never interchangeable. Memory holds only what a caller explicitly proposed, spans every session, and can be revised or forgotten. Session Query reads the conversation corpus that ordinary session activity already produced, is scoped to a session, and is read-only because a session log is append-only. Neither is a backend for the other: Memory never reads the session log to answer a query, and Session Query never reads a memory record.

"What did we say earlier in this conversation" is a Session Query question. "What has this user told us, durably, across every conversation" is a Memory question.

-----

<a id="what-is-not-arrived-yet"></a>
## What is not arrived yet

Recorded here because this group's READMEs describe a contract that production reaches only in part, and a reader comparing the prose to a running system should know which is which.

- **The model cannot call memory.** There is no model-facing tool: the model reads what the recall Consumer put in front of it and has no way to query or propose on its own. A tool package that changes that is out of the owning epic's scope.
- **The log is complete only for reads that went through the Consumer.** `memory/access` has a real emitter, but it belongs to `memory-context`. Another caller of `ctx.memory` records nothing unless it appends the event itself.
- **The durable provider is single-host.** `createDurableFileMemoryProvider` rewrites one JSON document in full per mutation, serialized on a per-instance chain and committed write-temp-then-rename. That suits one host's record counts; a multi-writer store across processes is out of scope, and the two in-memory providers exist to prove providers are replaceable, not to retain anything.
- **A format change refuses an older store rather than migrating it.** This build writes and accepts document version 3 only, and an older store fails its first read by name. That is the pre-release stance applied deliberately: filling in `createdAt`, `validFrom`, `validUntil`, `status` and `relations` for a record written before they existed would present this build's assumptions as facts the writer stated.

-----

<a id="related-documentation"></a>
## Related documentation

- [Memory subsystem](../../docs/subsystems/memory.md) — the authoritative contract for `ctx.memory`, the provider-neutral vocabulary, and the Memory-versus-Session-Query table this page summarizes.
- [Session Query subsystem](../../docs/subsystems/session-query.md) — the seam Memory is most often confused with.
- [Persistence catalog](../../docs/persistence-catalog.md) — the durable session events involved, `memory/access` among them.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package's own README.

The open question at group level is **whether a one-package group should exist at all**. The alternative is to put the seam in an existing group and let `packages/memory/` disappear. The argument for keeping it is that the group is the unit a deployment omits, and memory is exactly the kind of capability a composition declines wholesale; the argument against is that a group whose only Consumer lives elsewhere is a directory with one occupant. Not decided, and worth deciding before a second memory package is written rather than after.

The second is **where a provider that is neither in-memory nor single-host-file would go**. An embedding- or graph-backed provider is the case the seam was made provider-neutral for, and nothing has been written to test that claim against a real backend. Whether such a package joins this group or ships outside the repository is open, and the answer decides whether this group's shape generalizes.

</details>
