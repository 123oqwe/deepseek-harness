---
description: "Plugin warnings and errors on stderr: the exporter that writes what plugins log through ctx.logger where an operator sees it, for users running a shipped host and maintainers routing its lines."
kind: "package-reference"
---

# @deepseek-ai/dsh-logger-stderr

English | [中文](README.zh.md)

## Summary

`dsh-logger-stderr` writes the warnings and errors DeepSeek Harness plugins log through `ctx.logger` to the process's stderr, one line per rendered line, each prefixed `dsh: ` as the launcher's own diagnostics are. Without it those messages stay in Cordis's in-memory buffer, which no operator reads (BLOCKED-336). It never writes stdout, where the headless host prints its result and the ACP and SDK hosts carry protocol frames. `dsh-base` and `dsh-sdk-minimal` mount it, so every shipped profile writes these lines.

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

### What reaches stderr

The row writes `error` and `warn` messages by default; `types` chooses others.

```yaml
- id: logger-stderr
  name: '@deepseek-ai/dsh-logger-stderr'
  config:
    types: ['error', 'warn']
```

| Field | Default | Meaning |
|---|---|---|
| `types` | `['error', 'warn']` | Message types written to stderr; the others stay in the in-memory buffer only |

Messages a plugin logged before this row mounted are written once, when it mounts, from the in-memory buffer. `@deepseek-ai/dsh-app-boot` mounts the tree with its loggers at `WARN`, so that buffer keeps warnings as well as errors.

### A host that owns stderr's layout

`ctx.loggerStderr.routeThrough(write)` hands every line to `write` until the returned disposer runs. The headless runner routes the lines while it streams reasoning: a line closes an open reasoning section before it is written, and the next reasoning text starts under a new `dsh: reasoning:` header. A route that throws loses nothing, because the line is then written to stderr directly.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `Config`, the `LoggerStderr` service with `routeThrough`, and the exporter that renders messages in the vendored console exporter's layout |
| — | No runtime invariant companion is published: the plugin writes lines and holds one route, and owns no durable relationship two observers could see differently. |

The exporter registers through `ctx.logger.exporter()`, so unloading the plugin removes it. Vendored Cordis modification 22 (`vendor/README.md`) makes that removal take this exporter's own registration rather than the most recent one.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Note: plugin warnings and errors reach stderr](../../../.agents/notes/implemented/bug-fix/2026-09-26-plugin-warnings-and-errors-reach-stderr.md) — why stderr, why the `dsh: ` prefix, and how the headless runner keeps the lines out of its reasoning sections.
- [Vendored packages](../../../vendor/README.md) — local modifications 21 and 22, which this package's behavior at teardown and unload relies on.
- [Runtime-diagnostics group map](../README.md) — the adjacent diagnostics package.

-----

<a id="model-experience"></a>
## Model Experience

None, as the lines go to the operator's stderr and never into a model request.

#### KV Cache effect

Nothing here enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints, not a task backlog.

- **One route at a time.** A later `routeThrough` replaces an earlier one, and the earlier route's disposer then changes nothing.
- **Lines are text, not records.** Each line is the console exporter's rendering with `dsh: ` in front. A consumer that needs structured records reads the in-memory buffer or registers its own exporter.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
