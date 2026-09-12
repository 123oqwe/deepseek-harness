# preFlight — P3-01 F (一等公民 ExecutionWorld Capability Seam,Fault 阶段)

Written 2026-09-12 by lane B while the U stage's re-record waits on host memory. Table first, same discipline as C, P and U: every row is a measurement or a declared decision, and rows marked **RULING** need settling rather than inferring.

## What the registry assigns to F, and what that leaves out

`tests/first100/registry.json`'s `stages.F` names two files — `execution-world/tests/world.spec.ts` and `src/lifecycle.ts` — and one clause: **validation[3]**, *"测试 world 被 kill、超时、失联时返回统一 typed outcome"*. The other two validation items are assigned nowhere by the stage table, and both are F-shaped:

| item | text | where it lands |
|---|---|---|
| validation[1] | 实现 fake world conformance suite,所有 provider 必须通过 | **F**, per the delegate's ruling on the U table: the shared `tests/fake-provider.ts` is built once in U and the whole matrix runs here |
| validation[2] | 运行 provider swap composition test | **F**, and it is the only place acceptance[0]'s cross-provider half can be closed |
| validation[3] | kill / 超时 / 失联 统一 typed outcome | **F**, as the registry says |

**RULING 1 — validation[1] and [2] are part of this stage's must-table even though the registry's `stages.F` file list does not reach them.** Both need `tests/fake-provider.ts` and a second registry mount, neither of which is in the two declared files, so F will cite files outside the stage list and carry overlay reasons for them. Declaring it here is cheaper than discovering it at freeze.

## The fault matrix

`WorldStopReason` is a closed set of **five** — `completed`, `terminated`, `timeout`, `lost-contact`, `provider-failed` — and the matrix is organised around it rather than around a list of faults I thought of, because the failure to avoid is a union member no test ever produces. Two rows below are not stop reasons at all (a refused handle and a refused attestation settle nothing), and they are in the table because "produces no outcome" is the assertion.

Each row names the observable that distinguishes it from its neighbour. A matrix whose rows all assert "an outcome came back" tests one thing five times.

| # | fault | how it is induced | typed outcome | what distinguishes it from the row above |
|---|---|---|---|---|
| 1 | the caller kills the world | `terminate(handle)` on a live world | `reason: 'terminated'` | it is the only one the CALLER chose; every other row happens to it |
| 2 | the lifetime ceiling passes | `nowMs()` advanced past `maxWallClockMs`, then any operation touches the world | `reason: 'timeout'` | outranks the caller's own reason: a world past its clock settles `timeout` even when `terminate` asked, because an expired world is not a failed world |
| 3 | the provider fails underneath | the fake provider's `create`/`terminate` rejects | `reason: 'provider-failed'` | an operator RETRIES a timeout and INVESTIGATES a provider failure; collapsing the two is the reason the vocabulary has both |
| 4a | a forged or foreign handle | an object literal with a real world id and the right provider name; and a handle another instance minted | **no outcome at all** — the operation is refused | this row must NOT produce a `WorldOutcome`: a forged handle that settles an outcome has been admitted, and acceptance[2] is about refusing it before any state changes |
| 4b | the world finishes on its own | the fake provider settles a world whose work ended | `reason: 'completed'` | the only NON-fault member of the union, and it must be produced by something or `completed` is a value no test ever writes — the same defect `lost-contact` would have |
| 5 | attestation is refused | `attest(handle)` for a world the kernel's verifier rejects | evidence only; **no outcome, no state change** | attestation is a READ; a failed attestation must not stop the world, or a verifier outage becomes an outage |

**Row 5 is the one carrying an open question, and the U stage already declared it.** `sandboxAttestationVerifier` returns `false` unconditionally (P0-02's deliberately inert slot), so "the kernel refused this attestation" is today indistinguishable from "the kernel refuses everything". **RULING 2:** F should therefore prove the PROVIDER half only — `attest` produces evidence and changes nothing — and record the verifier half as still open, rather than writing a case whose green depends on an inert slot. A case that passes because nothing can ever verify is the failed-probe shape.

**`lost-contact` is the row that does not exist for the local provider, and that absence is an assertion.** The U stage's `local-provider.spec.ts` already pins `never reports lost-contact, which is this provider being honest about what it is` — a local world cannot lose contact with itself. F must therefore drive `lost-contact` through the FAKE provider, which can simulate it, and keep the local provider's refusal to report it as the contrasting case. Without both, the outcome union has a member no test ever produces.

## The conformance suite (validation[1])

**Shape: one table of provider-independent obligations, run against every registered provider.** The suite takes a provider factory and asserts what any provider must do regardless of what it confines:

1. `unsatisfiableDimensions` is total over the nine dimensions — it answers for a spec it refuses and for one it accepts.
2. A handle it minted is accepted by its own operations; a handle another instance minted is refused.
3. `terminate` is idempotent: asked twice, the same outcome, and never two different ones.
4. Every terminal path settles exactly one `WorldOutcome`, and `stopped` has no successor.
5. `snapshot` of a stopped world and `restore` of a foreign provider's snapshot are both refused by name.

**The local provider must pass it, and so must the fake.** Two providers passing one table is what makes the table a contract rather than a description of the local one. **RULING 3:** if the local provider fails a row, the answer is to change the row or the provider — never to add a "local exception", because an exception is the suite admitting it describes one implementation.

## The provider swap composition test (validation[2])

This is where acceptance[0]'s cross-provider half closes, and the claim has to be stated narrowly enough to be true:

**The claim:** one `ToolExecution`, dispatched twice under two different registered providers, produces the same `ActionManifest` digest and the same policy question apart from the world's own identity.

**What that requires:** the U stage's registry with the fake provider registered instead of the local one, a dispatch through the real path, and a comparison of the two manifests and the two `PolicyRequest`s. The U stage already proved the narrow half — the same spec digests identically whichever provider builds the world — and this is the end-to-end version.

**What it does NOT prove, declared now:** neither provider is a container or a microVM. The clause names those three, and a fake that satisfies every dimension is not evidence that a real container provider would. F closes the clause against the seam, not against a second real world, and any later page claiming otherwise is over-reading this stage.

## What this page does NOT settle

1. **RULING 1** (validation[1]/[2] belong to F and will cite files outside `stages.F`), **RULING 2** (attestation: provider half only), **RULING 3** (no per-provider exceptions in the conformance table).
2. **Whether the fault matrix needs a crash campaign.** P4-12's F stage used a randomized crash-point campaign with per-point lower bounds; this matrix is five named faults over a pure-ish provider, and a campaign would add a generator to maintain for outcomes that are already enumerable. I lean against, and it is a ruling rather than an assumption — the reason to reconsider is if the five rows turn out to interact (a timeout DURING a terminate, a provider failure DURING a snapshot).
3. **Whether `WorldOutcome` gains consumed-resource fields.** The package README already records that no provider reports usage back; F is where a fault's outcome would naturally carry "how far it got", and adding it there without a consumer would be building a field nothing reads.
