---
description: "The ExecutionWorld subsystem: what a world is across nine confinement dimensions, the unforgeable handle that names one, the OCI-adapted lifecycle, the single typed stop outcome, and why selection refuses rather than degrades."
kind: "subsystem"
---

# ExecutionWorld subsystem

English | [中文](execution-world.zh.md)

The ExecutionWorld seam answers one question — **where would this action run, and under what confinement** — and keeps the answer separate from what the action IS. Epic P3-01 owns it. This page describes the contract; no provider implements it yet.

## What it is, and what it replaces

Four packages already name the ExecutionWorld in prose and none implements it. `@deepseek-ai/dsh-policy-engine` has carried `ExecutionWorldFact = { kind: 'absent' }` — a single-variant type — since P2-05, `policy-engine-cedar` passes `world: request.world.kind` into the Cedar context, `capability-token` names the ExecutionWorld as one of four boundaries a token must be presented at, and `subagent` records a decision not to shape a hook before the world is designed. So this subsystem replaces a placeholder rather than introducing a concept.

The single-variant fact is also why one acceptance clause was unprovable: a policy cannot fail closed on a world when there is no value other than `absent` to refuse on.

## The nine dimensions

A `WorldSpec` answers `filesystem`, `network`, `process`, `ipc`, `devices`, `secrets`, `resources`, `lifetime` and `tenant`. All nine are required. An absent dimension is a question the provider answers from its own defaults, and a policy comparing two worlds could not distinguish a deliberate `none` from an unstated one. The list is exported as a closed constant and every completeness check reads it, so adding a dimension fails incomplete specs instead of passing silently.

## Lifecycle

`creating` → `created` → `running` → `stopped`, adapted from the OCI runtime-spec state vocabulary because the ordering is what providers must agree on and a container or microVM provider already reports it. OCI's `paused` is absent: nothing in this harness suspends a world, and an unenterable state is vocabulary that cannot be tested.

`stopped` is terminal. `restore` mints a NEW world from a snapshot rather than reviving the old one, so one `WorldId` never names two confinements and no audit record naming it becomes ambiguous.

Every stop settles to one `WorldOutcome` shape, whatever stopped it — `completed`, `terminated`, `timeout`, `lost-contact`, `provider-failed`. One shape for all five is the requirement: a caller must not be able to handle a killed world and fall through on an unreachable one.

## Why a provider has no `execute`

A world is the confinement a command runs inside, not the thing that runs it. `ctx.shell`, `ctx.subprocess` and `ctx.fs` already run things. An `execute` on the provider would create a second dispatch path for every tool, which is the opposite of the requirement that one `ToolExecution` survive a provider swap unchanged.

The same requirement is why the world is **not** part of the `ActionManifest`. A manifest naming its world would yield a different canonical form, digest and approval for the same action run in two places, so swapping providers would invalidate every binding made against it. `ToolWorldBinding` in `@deepseek-ai/dsh-tools/types` records the world beside the dispatch, for the audit.

## The handle, and where trust lives

`WorldHandle` is branded with a module-private `unique symbol`: no object literal a model emitted and no value cast from JSON can inhabit the type. The handle carries no authority itself — it proves the world was minted by the provider that issued it, and every operation takes it, so a forged object reaches nothing.

Attestation is handed to the Trust Kernel, which already publishes `sandboxAttestationVerifier`. A verifier in this subsystem would be a second root of trust.

## Selection refuses rather than degrades

`selectWorldProvider` returns the first provider satisfying every dimension, or a refusal carrying each provider's unmet dimensions. It never returns the closest provider, the local one, or the request with the unmet dimension dropped. The return type is what prevents degradation: there is no partial result, so a caller cannot mistake a weakened world for the requested one.

Candidate order is the deployment's registration order. "Most confined wins" would need a total order over nine dimensions that nothing here defines.

## What is not arrived yet

- **No provider exists.** Every operation on `WorldProvider` is unreachable in this repository. `dsh-sandbox` confines commands today, same-world, and is unchanged by this contract — its own README already draws the boundary: containers, microVMs and remote executors replace whole capabilities instead of registering there.
- **`ExecutionWorldFact` still has one variant.** The policy vocabulary keeps `{ kind: 'absent' }` until the producer lands, so no policy can yet decide on a world. P3-01 owns that producer half (BLOCKED-178).
- **`restore` compares confinement by digest equality.** It therefore refuses a narrower target too, not only a wider one. The conservative direction was chosen because the failure it prevents — restoring a `full-access` snapshot into a confined world — is a silent privilege grant; relaxing it needs a partial order over `WorldSpec` that does not exist.
- **No usage reporting.** Ceilings are stated and nothing reports what a world consumed, so a deployment cannot bill or alert on one yet.
