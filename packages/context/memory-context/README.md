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

<a id="model-experience"></a>
## Model Experience

### Recalled durable memory

#### What the model sees

One user-role message per step that recalled at least one record. A step that recalled nothing injects nothing, though the read is still recorded.

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

Each recall adds one message that accumulates until compaction shadows it, bounded per step by `maxRecords` and by each record's own content size. A step whose query recalls nothing costs no tokens.

#### KV Cache effect

Append-only within a step, so a recall follows the reusable request prefix. Because the recalled set is re-read every step, a turn whose recall differs from the previous turn's invalidates the request suffix from the point the recall text changed.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Recall is unranked and unfiltered beyond the provider's own matching** — the consumer passes the open turn's user text through to `ctx.memory.query()` and injects what comes back, capped to `maxRecords`. Relevance ranking and consolidation policy are later first100 stages' job.
- **The configured `tenantId` is the read boundary, not the agent's** — when an agent carries an attached identity from a different tenant, the read is refused rather than silently widened. A per-agent tenant mapping is out of this package's scope.
- **No write path** — this package only reads. Nothing here proposes, revises, or forgets a record, so it cannot be the route by which a model writes durable memory (`acceptance[1]`).
