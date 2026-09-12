---
description: "ExecutionWorld capability seam vocabulary for Epic P3-01: the nine confinement dimensions a world is described in, the unforgeable handle that names one, the OCI-adapted lifecycle, the typed stop outcome, and the fail-closed provider selection."
kind: "package"
---

# @deepseek-ai/dsh-execution-world

English | [中文](README.zh.md)

`dsh-execution-world` fixes what an ExecutionWorld IS in this harness — the nine dimensions a request decides, the unforgeable handle that names a live world, the lifecycle states a world walks, the one outcome shape every stop settles to, and the rule that a request nothing can satisfy is refused rather than weakened. It holds no provider, mounts no service, and imports no sandbox: the local provider adapting `dsh-sandbox` is P3-01's Provider stage, and a world reaching a real agent request is its Usage stage. Read it when writing a provider, or when deciding what a policy may know about where an action would run.

## Contents

- [What a world is](#what-a-world-is)
- [Why there is no `execute`](#why-there-is-no-execute)
- [The handle, and what it proves](#the-handle-and-what-it-proves)
- [Selection fails closed](#selection-fails-closed)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="what-a-world-is"></a>
## What a world is

A `WorldSpec` answers nine dimensions — `filesystem`, `network`, `process`, `ipc`, `devices`, `secrets`, `resources`, `lifetime`, `tenant` — and every one is required. An absent dimension is a question the provider would answer from its own defaults, and a policy comparing two worlds could not tell a deliberate `none` from an unstated one. `WORLD_SPEC_DIMENSIONS` is the closed list; `missingWorldSpecDimensions` reads it rather than a second copy, so adding a dimension fails every incomplete spec instead of silently passing.

The lifecycle states are the OCI runtime-spec ordering (`creating` → `created` → `running` → `stopped`), adapted because the ordering is the part providers must agree on and a container or microVM provider already reports it. OCI's `paused` is deliberately absent: nothing in this harness suspends a world, and a state no provider can enter would be vocabulary that cannot be tested. `stopped` is terminal — `restore` mints a NEW world from a snapshot rather than reviving the old one, so one `WorldId` never names two different confinements and no audit record naming that id becomes ambiguous.

<a id="why-there-is-no-execute"></a>
## Why there is no `execute`

A world does not run commands. It is the confinement a command runs inside, and the harness already owns the seams that run things — `ctx.shell`, `ctx.subprocess`, `ctx.fs`. Giving `WorldProvider` an `execute` would create a second dispatch path for every tool, which is the opposite of acceptance[0]'s requirement that one `ToolExecution` survive a provider swap unchanged.

<a id="the-handle-and-what-it-proves"></a>
## The handle, and what it proves

`WorldHandle` is branded with a module-private `unique symbol`, so no object literal a model emitted and no value cast from JSON can inhabit the type (acceptance[2]). The handle carries no authority of its own: what it proves is that the world was minted by the provider that issued it, and every operation takes the handle so a forged object reaches nothing. This is the shape the Trust Kernel uses for its own handles, for the same reason.

Attestation is handed to the kernel rather than verified here. `WorldAttestation` is evidence; the kernel already publishes `sandboxAttestationVerifier`, and a second verifier in this package would be a second root of trust.

<a id="selection-fails-closed"></a>
## Selection fails closed

`selectWorldProvider` returns the first provider satisfying every dimension, or a refusal — never the closest provider, never the local one, never the request with the unmet dimension dropped. Silent degradation is the specific failure acceptance[1] names, and the return type is what prevents it: there is no partial result to return, so a caller cannot mistake a weakened world for the requested one. The refusal carries each provider's unmet dimensions, because "nothing could do it" and "everything failed the same dimension" call for different operator action.

Candidate order is the deployment's own registration order. "Most confined wins" would need a total order over nine dimensions that nothing in this harness defines, and inventing one here would silently re-rank a deployment's preference.

## Model Experience

None, as this package exports types and pure decisions only and registers no tool, prompt text or session event.

#### KV Cache effect

Nothing here enters a model request. A refused world reaches a model only as its enforcement point's refusal, which carries a closed reason code and never a spec, a path or a provider name.

## Known Limitations and Deferred Work

- **This is the Contract stage: no world can be created.** `WorldProvider` is an interface with no implementation in this repository, so every operation on it is unreachable today. A reader must not take these cases as evidence that any action runs confined — `dsh-sandbox` is what confines commands now, same-world, and it is unchanged by this package.
- **`ExecutionWorldFact` still has one variant until the producer lands.** `@deepseek-ai/dsh-policy-engine` declares `{ kind: 'absent' }`, so a policy still cannot decide from where an action would run. P3-01 owns the producer half of that split (BLOCKED-178); this package supplies the vocabulary the producer will report in, and wiring it is a later stage of the same epic.
- **`restore` compares confinement by digest equality, which also refuses a NARROWER target.** The rule implemented is "same confinement or refuse", not "may narrow"; a snapshot taken under `read-only` is refused into a `workspace-write` world even though that widens nothing. Tightening this needs a partial order over `WorldSpec` that does not exist yet, and the conservative direction was chosen because the failure it prevents — restoring a `full-access` snapshot into a confined world — is a silent privilege grant.
- **No provider reports resource usage back.** `WorldResourcesSpec` states ceilings and `WorldOutcome` carries none of what was consumed, so a deployment cannot yet bill or alert on a world. The outcome shape is the place to add it, once a provider has real numbers to put there.
