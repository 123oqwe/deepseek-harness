---
description: "Background-job settlement observer for snapshot compositions, for corpus authors who need a mock subprocess ordered strictly after a job settles."
kind: "package-reference"
---

# @deepseek-ai/dsh-job-settle-signal

English | [中文](README.zh.md)

## Summary

`dsh-job-settle-signal` writes a file when a background job reaches a terminal status, so a mock subprocess that blocks until the file appears runs strictly after that settlement. It exists because no file the job's own producer writes can establish that ordering: a producer finishes before the registry settles the job it belongs to, so a producer-written marker leaves a gap in which the consumer can still win. Only an observer of the registry's completion notification sits after settlement, and this plugin is that observer. It registers no tool, emits no session event, and changes no product plugin's decision.

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

Mount it in a snapshot composition beside the mock whose work must follow a job's settlement, and point the mock at the same path.

```yaml
- id: job-settle-signal
  name: '@deepseek-ai/dsh-job-settle-signal'
  config:
    file: !!js "process.cwd() + '/job-settled'"
    jobId: subagent-1
```

`file` is required. `jobId` is optional: omit it when the composition starts exactly one job, and the first settlement signals. The file's content is the settled job's id and status, so a barrier that released on the wrong job can be diagnosed from the file alone.

A composition that mounts this plugin must say so in its fixture explanation, naming the race it pins — see [the snapshot corpus rules](../../../snapshots/AGENTS.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`apply` registers one `jobs.onJobDone` listener through `ctx.effect`, so the registration is disposed with the fiber. The listener writes the file synchronously; a synchronous write is what makes the signal usable as a barrier, because the waiting subprocess polls for the file's existence and must never observe a partially written path.

An empty or missing `file` throws at load rather than degrading to a no-op. A silent no-op would leave the waiting subprocess blocked until its own timeout, and the failure would surface as an unexplained hang in a scenario far from the misconfiguration.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Snapshot corpus ownership and composition rules](../../../snapshots/AGENTS.md)
- [`@deepseek-ai/dsh-jobs`](../../jobs/jobs/README.md) — the registry whose completion notification this package observes
- [Testing policy](../../../docs/testing.md)

-----

<a id="model-experience"></a>
## Model Experience

None. The plugin contributes no tool, no prompt text, and no session event, so nothing it does reaches a model request.

#### KV Cache effect

None; it neither changes the request prefix nor retains state across runs.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the observer needs special care. They are current package constraints, not a task backlog.

- **The signal is one-way and never cleared** — a composition that would release the barrier twice needs two paths, and a stale file from a previous run in the same directory releases the barrier immediately.
- **Settlement is observed, delivery is not** — the file says a job reached a terminal status, not that any notice derived from it was delivered, so a barrier built on it orders work after settlement only.
- **Test-support only** — the package is `private` and exists for the snapshot corpus; it is not part of any shipped profile.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin name, injection, `Config`, and the `onJobDone` listener that writes the signal |
| — | No runtime invariant companion is published; this test-support package owns no production event stream or mutable data, and its one observable relation is the file it writes, which the consuming scenario asserts. |

</details>
