---
description: "Opt-in durable memory recall context: the Consumer of the provider-neutral Memory seam (ctx.memory), injecting recalled records as durable model-visible context and recording each read."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-context

English | [中文](README.zh.md)

## Summary

`dsh-memory-context` is the Consumer role of the provider-neutral Memory capability seam (first100 registry P6-01, Usage stage). On each eligible step it takes the open turn's user text, asks `ctx.memory` for the durable records that text recalls, appends them to the request as a source-attributed user message, and records one `memory/access` event for that read. It reaches memory only through the Service Definition — it never imports a provider or the `MemoryRuntime` class (`must[2]`). The injection and its event are produced from the same read result on the same path, so a memory record the model saw is always reconstructable from the session log alone.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh-base` bundle carries both this plugin and `dsh-memory` as `disabled: true` rows. A profile opts in by enabling both and naming a provider directory; `dsh-memory` registers no provider on its own, so enabling this consumer without one leaves every read failing `MEMORY_PROVIDER_UNAVAILABLE`.

```yaml
- id: memory
  disabled: false
  config:
    durableFileDirectory: './.memory'

- id: memory-context
  disabled: false
  config:
    tenantId: 'acme'
    principalId: 'operator'
    purpose: 'recall'
    maxRecords: 5
```

| Field | Required | Meaning |
|---|---|---|
| `tenantId` | yes | Tenant this consumer reads within; becomes `MemoryScope.tenantId` |
| `principalId` | yes | Principal id used when the agent carries no attached `IdentityContext` |
| `purpose` | yes | Why this consumer reads; recorded on every `memory/access` event |
| `maxRecords` | yes | Upper bound on recalled records; becomes `MemoryContextBudget.maxRecords` |

Every field is required. `must[3]` puts `principal`, `purpose`, `scope`, and `contextBudget` on every read, so a composition that omits one is a misconfiguration and fails loud at load rather than silently reading unscoped.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Model-visible and logged are one act.** The injected `user/message` and its `memory/access` event come from the same read result on the same path, satisfying this repository's model-visible ⟺ logged rule by construction rather than by a separate audit step.
- **The consumer holds no provider reference.** It injects `memory` and calls the service; swapping the mounted provider changes what it recalls with no change here (`must[1]`, `must[2]`).
- **Identity is resolved, never defaulted.** The principal is the agent's own when a prior run durably attached an `IdentityContext`; otherwise it is an `anonymous-dev` principal built from the declared `principalId` and `tenantId`. Nothing in a shipped profile attaches an `IdentityContext` today, so a consumer that simply required one could never read at all.
- **Recall runs against user-authored text only.** The request history at pre-step time also holds other context plugins' injected snapshots (runtime context, sandbox and approval policy prose, this plugin's own prior recall). Folding those into the query would make what memory recalls depend on unrelated policy text, and would let one recall's output become the next recall's input.
- **A recall is a snapshot: the newest replaces the earlier.** `Session.deriveMessages` folds every appended surface node, so keeping only the latest recall is not automatic. When a step's recall differs from the one still on the surface, the consumer shadows the earlier recall's node with an empty `system/message` — a `replace` that derives to no wire message, so the node is removed — and appends the new recall at the tail. A record forgotten since an earlier recall therefore stops reaching the model, a repeated recall within a turn does not stack, and a step whose recall is unchanged emits nothing.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The plugin: config validation, access-context resolution, recall rendering, and the prepended `agent/pre-step` listener |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@deepseek-ai/dsh-memory`](../../memory/memory/README.md) — the Service Definition this package consumes, its provider registry, and its selection rules.
- [Memory subsystem](../../../docs/subsystems/memory.md) — the request/result vocabulary and the Memory vs. Session Query boundary.

-----

**Runtime invariant:** No runtime invariant companion is published: this is a Consumer of `ctx.memory`, and every record it renders belongs to that seam rather than to this package. A companion here would re-read the source it just read, which is not two independent observations.

<a id="model-experience"></a>
## Model Experience

### Recalled durable memory

#### What the model sees

One user-role message when a step's recall differs from the one still in the request; the recall is a snapshot, so a later step's recall replaces the earlier one rather than stacking. A step that recalled nothing, or the same as the recall already present, injects nothing, though each read is still recorded.

##### Recall within the record budget

```markdown
Recalled <count> durable memory record(s):
- (<updated-at>) <json-serialized-content>
- (<updated-at>) <json-serialized-content>
```

##### Recall cut to the record budget

```markdown
Recalled <count> durable memory record(s):
- (<updated-at>) <json-serialized-content>
This recall was truncated to the configured record budget; more records may exist.
```

#### Token effect

Each step's recall is one message, bounded by `maxRecords` and each record's own content size. The recall is a snapshot: a later step's recall replaces the earlier one (shadowing its node) rather than accumulating, so a turn's steps do not stack recalls. A step whose query recalls nothing, or the same content as the recall already present, costs no additional tokens.

#### KV Cache effect

A recall that repeats the one already present adds no event, so the request prefix is reused unchanged. A recall that changed shadows the earlier recall's node and appends the new one; the shadow advances the surface's replace generation and invalidates the request suffix from the shadowed node onward — the cost of dropping a stale or forgotten recall from the request rather than letting it ride along.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Recall is unranked and unfiltered beyond the provider's own matching** — the consumer passes the open turn's user text through to `ctx.memory.query()` and injects what comes back, capped to `maxRecords`. Relevance ranking and consolidation policy are later first100 stages' job.
- **The configured `tenantId` is the read boundary, not the agent's** — when an agent carries an attached identity from a different tenant, the read is refused rather than silently widened. A per-agent tenant mapping is out of this package's scope.
- **No write path** — this package only reads. Nothing here proposes, revises, or forgets a record, so it cannot be the route by which a model writes durable memory (`acceptance[1]`).

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The recall query is built from user-authored message text only, never from the
whole open turn. An earlier revision folded in every user-role message, which
included the snapshots other context plugins inject, so a recall's input
carried unrelated sandbox-policy prose and one recall's output could become the
next recall's input. Widening that filter reintroduces the feedback loop.

</details>
