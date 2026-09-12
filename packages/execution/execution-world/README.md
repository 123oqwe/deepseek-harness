---
description: "ExecutionWorld capability seam vocabulary for Epic P3-01: the nine confinement dimensions a world is described in, the unforgeable handle that names one, the OCI-adapted lifecycle, the typed stop outcome, and the fail-closed provider selection."
kind: "package-reference"
---

# @deepseek-ai/dsh-execution-world

English | [中文](README.zh.md)

## Summary

`dsh-execution-world` fixes what an ExecutionWorld IS in this harness — the nine dimensions a request decides, the unforgeable handle that names a live world, the lifecycle states a world walks, the one outcome shape every stop settles to, and the rule that a request nothing can satisfy is refused rather than weakened. It also holds the LOCAL provider (`./local-provider`), the adapter that makes `dsh-sandbox` one world among several, and the MOUNT (`./plugin`, `./local`): the registry a dispatch path asks "where would this action run", answering with a world or with nothing. Read it when writing a provider, or when deciding what a policy may know about where an action would run.

## Table of Contents

- [What a world is](#what-a-world-is)
- [Why there is no `execute`](#why-there-is-no-execute)
- [The handle, and what it proves](#the-handle-and-what-it-proves)
- [Selection fails closed](#selection-fails-closed)
- [What the local provider refuses, and why that is the honest answer](#what-the-local-provider-refuses-and-why-that-is-the-honest-answer)
- [What the mount does, and what it does not](#what-the-mount-does-and-what-it-does-not)
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

<a id="what-the-local-provider-refuses-and-why-that-is-the-honest-answer"></a>
## What the local provider refuses, and why that is the honest answer

`dsh-sandbox` governs FILE effects: its policy carries a mode, a workspace root and a session id, and nothing about network, devices, IPC or resource ceilings. So the local provider satisfies `filesystem` (for `read-only` and rooted `workspace-write`), `lifetime` (it enforces a wall-clock ceiling), and `tenant` (its own host's), and it names every other dimension as unsatisfiable.

**The consequence is intended and is not "local is unusable".** A policy demanding `network: none` gets no provider in a composition that mounts only this one, and the request fails closed — which is correct for a harness whose local sandbox cannot deny egress. A spec the sandbox can honestly confine is satisfied and selected.

Two refusals are worth naming because they look like over-caution and are not. An EMPTY device set is refused: it asks for no devices at all while the sandbox always admits the standard sinks, so honouring it would promise something narrower than the world delivers. And `full-access` is refused at creation rather than narrowed, because it maps to `danger-full-access`, which is outside the sandbox's confined modes — handing back a confined policy instead would silently tighten a request, the mirror image of the widening `restore` refuses.

`lost-contact` is never reported by this provider, and a characterization case says so: a local world has no existence outside the host process, so contact cannot be lost without the host being gone. The reason exists for the container and microVM providers that will have a remote side.

<a id="what-the-mount-does-and-what-it-does-not"></a>
## What the mount does, and what it does not

`./plugin` is `ctx.executionWorlds`: providers register into it (as effects, so unmounting the registering plugin removes the provider), and `bindingFor(agent)` answers which world that agent's session runs in. `./local` is a separate row that registers the local provider, because a deployment shipping a container world removes a provider row rather than reconfiguring the registry.

**Mounting creates no world.** A world is minted at the first dispatch that asks for one, from a spec `resolveWorldSpec` states in all nine dimensions out of the row's partial request plus the file-effect boundary `ctx.sandboxPolicy` already resolved. Keeping the request partial is what makes a refusal reachable: a deployment asking for `network: 'none'` is refused by a provider that cannot deliver it, rather than given the unrestricted world that provider could build.

The two vocabularies differ by one name and `filesystemForSandboxMode` translates explicitly: `dsh-sandbox`'s widest mode is `danger-full-access`, a `WorldSpec`'s is `full-access`, and an unknown mode is refused at the boundary rather than carried into a spec no dimension rule recognises.

`bindingFor` answers `undefined` — which a dispatch path reads as the fail-closed `absent` policy fact — when no provider is registered, when every provider refuses the request, when no file-effect boundary is mounted, and when the chosen provider rejects the create.

<a id="model-experience"></a>
## Model Experience

None: this package registers no tool and contributes no prompt text, and a world is not described to the model. Where an action ran is recorded for the audit by `@deepseek-ai/dsh-tools`' `action/world-bound` session event (`ignorable: true`), which this registry supplies the values for and does not declare.

#### KV Cache effect

Nothing here enters a model request. A refused world reaches a model only as its enforcement point's refusal, which carries a closed reason code and never a spec, a path or a provider name.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **A bound world names where an action ran; it does not yet confine it.** `dsh-base` mounts the registry and the local provider, and a dispatch carries the world into the policy question and the audit — but `dsh-sandbox` is still what actually confines commands, reached the way it always was. A reader must not take a `action/world-bound` event as evidence that the tool ran inside a confinement this package built.
- **On a `danger-full-access` profile no world binds at all.** That mode maps to the `full-access` effect, which the local provider refuses by dimension because the sandbox confines nothing there. It is an honest refusal, and it is indistinguishable in the log from the registry not being wired — so a zero-diff recorded corpus is not evidence that the mount works.
- **Eight of nine dimensions are refused by the only provider that exists.** Until a container or microVM provider lands, a spec asking for network confinement, device limits, IPC posture, resource ceilings, secret brokering, process limits, a detached lifetime or another tenant has nowhere to run. That is fail-closed rather than broken, and it is the measurement that says what a second provider would buy.
- No runtime invariant companion is published: this package holds no state of its own and observes nothing two observers could disagree about — a world's state lives in the provider that minted its handle.
- **A policy can read the world's identity, not its dimensions.** `ExecutionWorldFact` now carries `bound` with the world id, the provider id and the confinement digest (BLOCKED-178's producer half), so a rule can refuse an unknown world or compare confinement by digest — but it cannot ask "is the network confined", because the nine dimensions do not cross into the policy request. Adding them is a policy-vocabulary decision, not this package's.
- **`restore` compares confinement by digest equality, which also refuses a NARROWER target.** The rule implemented is "same confinement or refuse", not "may narrow"; a snapshot taken under `read-only` is refused into a `workspace-write` world even though that widens nothing. Tightening this needs a partial order over `WorldSpec` that does not exist yet, and the conservative direction was chosen because the failure it prevents — restoring a `full-access` snapshot into a confined world — is a silent privilege grant.
- **No provider reports resource usage back.** `WorldResourcesSpec` states ceilings and `WorldOutcome` carries none of what was consumed, so a deployment cannot yet bill or alert on a world. The outcome shape is the place to add it, once a provider has real numbers to put there.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether the local provider should satisfy `devices` for a NON-empty subset of the sinks, rather than only for an exact match, is undecided: it would need a statement about which sinks the sandbox admits on every platform, which `dsh-sandbox` does not publish. Whether a wall-clock ceiling should be enforced by a timer instead of on access is the other open one — a timer would report a deadline without anyone asking, and would also make the ceiling depend on the event loop's liveness.

</details>
