---
description: "execution group guide: the ExecutionWorld capability seam — where an action would run and under what confinement — kept separate from what the action is."
kind: "package-group"
---

# packages/execution

English | [中文](README.zh.md)

## Overview

The `execution/` group answers **where would this action run, and under what confinement** — and deliberately nothing else. It holds the vocabulary a world is described in, the unforgeable handle that names a live one, the lifecycle a world walks, and the rule that a request nothing can satisfy is refused rather than weakened. What an action IS stays with the action: the `ActionManifest` never names a world, because a manifest that did would produce a different digest for the same action run in two places.

One package today, because the seam is a contract first. No provider exists in this repository, so every operation the contract declares is unreachable; `sandbox/` is what confines commands now, same-world.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`execution-world`](execution-world/README.md) | The ExecutionWorld Service Definition's vocabulary: nine confinement dimensions, the branded handle, OCI-adapted lifecycle states, the single typed stop outcome, and fail-closed provider selection. Holds no provider and mounts no service | — (types and pure decisions) |

## Subsystem ownership

This group owns the [ExecutionWorld subsystem](../../docs/subsystems/execution-world.md) — the authoritative contract for what a world is, what a handle proves, and why selection refuses rather than degrades.

## What is not arrived yet

- **No provider.** The local provider adapting `sandbox/` is a later stage of the same epic; a container or microVM provider is a later epic. Until one exists, nothing in this group changes how any command is confined.
- **Policy cannot yet decide on a world.** `@deepseek-ai/dsh-policy-engine` keeps `ExecutionWorldFact = { kind: 'absent' }` until the producer lands, so the dimension this group exists to describe is still invisible to every policy.

## Related documentation

- [ExecutionWorld subsystem](../../docs/subsystems/execution-world.md) — the contract this group owns.
- [sandbox group](../sandbox/README.md) — what confines commands today, and why it is same-world only.
- [Policy subsystem](../../docs/subsystems/policy.md) — the consumer that will decide on a world once one is reported.
