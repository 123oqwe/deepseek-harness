# preFlight — P3-01 (一等公民 ExecutionWorld Capability Seam)

Written 2026-09-11 by lane B during the push-wait, under the delegate's explicit authorisation (option (a)).

## The premise this page is written on, stated first

**P3-01 is not READY today.** Measured against the three criteria — not started, every predecessor ACCEPTED, not lane A's — the READY set across all 101 ledger rows is **empty (0)**. P3-01's predecessors are `P0-03` and `P2-05`; `P0-03` is ACCEPTED, `P2-05` is not.

**`P2-05` is finished and unsigned, not unstarted.** Its row carries `C/P/U/F` all `GREEN`, `independentVerdict: PENDING`, `openFindings: null`. So the gate on this epic is a sign-off, not anyone's implementation, and the delegate is running P2-05's 4.4 review as this page is written. The moment P2-05 is ACCEPTED, P3-01 becomes genuinely READY with no other blocker.

**Why P3-01 rather than the other three that unblock on P2-05** (`P2-06`, `P2-10`, `P2-12`): direct dependents, counted from the registry's `predecessors` fields — P3-01 has **14**, more than P2-05's own 11. Six W8 epics (`P1-04`, `P1-06`, `P3-02`, `P3-03`, `P3-06`, `P3-10`) are blocked by P3-01 alone.

A correction that belongs here because it changed the answer: the first pass at this measurement read each ledger cell's state from a `state` field. The field is `status`. With the wrong field, finished-but-unsigned rows (`P2-05`, `P1-10`, `P4-11`) read as READY and the set looked like 3. Every count on this page comes from the corrected read.


**PREMISE SUPERSEDED 2026-09-11, later the same day.** P2-05 is now **ACCEPTED** (`independentVerdict: APPROVED`) on lane A's tip `2d62ab0430`, which this branch is rebased onto — P1-10 was accepted in the same advance, taking the ACCEPTED count from 25 to 27. **P3-01 is therefore READY now**, with an empty blocking set: `P0-03` and `P2-05`, both ACCEPTED. The premise above is kept as written because it records what was true when the census below was taken, and every reading on this page was measured against the pre-accept tree. Nothing in the census depended on P2-05's status, but that is an assertion a re-reader should check rather than take — the first thing to re-measure is named at the end of this page.

## makeVsUse census — from real references, not from the assignment

`spec/first100/exec/make-vs-use-ledger.json`'s P3-01 row gives `verdict: REUSE_UPSTREAM`, `verdictSecondary: CONTRACT_WRITE`, `deletedPct: 30`, and a residual naming the types, the lifecycle, the unforgeable handle and the fake-world conformance suite. The census below checks that row against the tree.

### What the name already touches

`grep -rn 'ExecutionWorld|WorldSpec|WorldHandle|WorldAttestation|WorldSnapshot'` over `packages apps scripts`, excluding `node_modules`, tests and `lib/`: **25 hits, and not one of them is an implementation.**

| where | what it is |
|---|---|
| `policy-engine/src/types.ts:97` | `export type ExecutionWorldFact = { readonly kind: 'absent' }` — the whole type, one variant |
| `policy-engine/src/types.ts:127` | `readonly world: ExecutionWorldFact` on `PolicyRequest` |
| `policy-engine/src/types.ts:87` | the comment that says it is absent by construction and P3-01's to define |
| `policy-engine/README.md:31`, `:99` | `world` is `absent` because P3-01 owns the model; recorded as BLOCKED-178 under the §12.46-B split — this package owns the rule half, P3-01 the producer |
| `policy/README.md:61` | "a declared slot with one value … no policy can yet decide from where an action would run" |
| `policy-engine-cedar/src/index.ts` | passes `world: request.world.kind` into the Cedar context with `absent until P3-01 lands ExecutionWorld (BLOCKED-178)` |
| `capability-token/README.md:19`, `:211`; `src/types.ts:370` | the ExecutionWorld is named as one of four boundaries a token must be presented at |
| `subagent/src/control-convergence.ts:18` | a recorded decision NOT to shape a hook before `ExecutionWorld` is designed |
| `tool-cordis/src/api-catalog.ts:4669` | the generated catalog echoing the one-variant type |

**So the seam is already referenced by four packages and implemented by none.** That is the strongest thing this census found, and it sets the shape of the work: P3-01 does not introduce a concept, it replaces a placeholder every consumer already names. `ExecutionWorldFact` having exactly one variant is what makes acceptance[1] ("fail closed when no provider satisfies policy") currently unprovable — there is no second value for a policy to refuse on.

### What exists to reuse, measured

- **`packages/execution/` does not exist.** All five `N` files in the registry entry are new, and the group is new.
- **The operational seam the ledger's residual claims is already there, is there.** `ctx.shell.sandboxMode` is real (`shell/src/index.ts:74`), and `SandboxExecutionPolicy` has **16 real (non-test) consumer files**, the heaviest being `tool-cordis/src/api-catalog.ts` (8), `tool-pwsh` (5), `tool-bash` (5), `tool-fs/src/sandbox.ts` (5). This is the "hot zone" the ledger's `risk` field warns about, and the count is why: a contract change here reaches sixteen files.
- **Four sandbox packages ship today**: `sandbox/`, `sandbox-local/`, `sandbox-policy/`, `sandbox-windows-acl/`. The `B` files P3-01 must touch are small — `sandbox/src/index.ts` 178 lines, `escalation.ts` 189, `roots.ts` 55, `core/tools/src/types.ts` 58, `agent-loop/src/runtime-context.ts` 173.
- **`packages/sandbox/README.md:12` already draws P3-01's boundary for it**: "Confinement is same-world only: it shares the host kernel and filesystem, while containers, microVMs, and remote executors replace whole capabilities instead of registering here." That sentence is the compat-layer argument in must[2] already written down by the sandbox group.
- **`e2b` is a real dependency at `2.29.1`** (`packages/e2b/e2b/package.json:34`), matching the ledger's claim. The ledger calls E2B a *reference*, not an adapt target.

### Standard dispositions

`spec/first100/exec/standards-ownership.json`'s `perEpic['P3-01']` carries two, both owned here and neither deferred:

| standard | family | owner | note |
|---|---|---|---|
| OCI runtime-spec lifecycle/state (`creating`/`created`/`running`/`stopped`) | OCI runtime-spec | P3-01, `thisEpicOwns: true` | the adapt target: state vocabulary and lifecycle ordering |
| E2B/Daytona SDK shape as reference | — | P3-01, `singleAdopter: true` | reference only, not adapted |

The OSS column marks `opencontainers/runtime-spec` `role: adapt` and E2B, Daytona and `kubernetes-sigs/agent-sandbox` `role: reference`. **So exactly one standard is adopted and three are consulted** — worth stating plainly, because "REUSE_UPSTREAM" on the verdict line reads like more reuse than the row actually licenses: the secondary verdict is `CONTRACT_WRITE`, and `deletedPct: 30` is the smallest reuse share among the P3 rows I read.

## Stage shape

From the registry's `stages`, with the file counts it declares:

| stage | count | files | what it must decide |
|---|---|---|---|
| C | 5 | `execution-world/src/types.ts`, `src/lifecycle.ts`, `tests/world.spec.ts`, `docs/subsystems/execution-world.md`, `core/tools/src/types.ts` | the four types and the nine `WorldSpec` dimensions (filesystem, network, process, IPC, devices, secrets, resources, lifetime, tenant), plus the lifecycle ordering adapted from OCI |
| P | 4 | `execution-world/src/index.ts`, `sandbox/src/index.ts`, `src/escalation.ts`, `src/roots.ts` | the local provider as a compat adapter over today's sandbox, per must[2] |
| U | 2 | `agent-loop/src/runtime-context.ts`, `core/tools/src/types.ts` | the handle reaching a real agent request |
| F | 2 | `execution-world/tests/world.spec.ts`, `src/lifecycle.ts` | kill / timeout / lost-contact returning one typed outcome (validation[3]) |

**The U stage is the one to be careful about, and the ledger says so in a field I should quote rather than paraphrase.** `planError`: "Epic lists B `packages/core/agent-loop/src/runtime-context.ts` (hot zone) — attach the world handle via the sandbox-policy runtime-context snapshot contribution pattern, no loop edits."

I tried to verify that named pattern and **could not fully resolve it — marked unverified**. What I did measure: `sandbox-policy/src/index.ts:9` documents contributing "the resolved policy to the cache-safe runtime-context snapshot", and `RuntimeContextProjection` lives at `agent-loop/src/runtime-context.ts:27` and projects `readonly ContextSnapshotSection[]`. But a grep for an `agent/runtime-context` hook across `packages/*/*/src/*.ts` returns **0 files**, and the only registration I found in `sandbox-policy` is `ctx.sessionProjections.register(...)` at `:132`. So whether the "contribution" is a request-context plugin, a session projection, or something `system-prompt/src/index.ts:302`'s `renderContextSections` assembles is **not established by this page**. Resolving it is the first implementation question, not a preFlight conclusion.

## Open questions this preFlight does NOT settle

1. **How a contributor actually reaches the runtime-context snapshot** — above. Until this is answered the U stage has no known mount point, and guessing one would be the loop edit the `planError` forbids.
2. **What acceptance[0] can mean with one provider.** The clause requires one `ToolExecution` to switch across `local`/`container`/`microVM` without changing `ActionManifest`/Policy semantics. Only a local provider is in scope (must[2]), and no container or microVM provider exists — `grep -rln 'microVM|firecracker'` hits only sandbox READMEs and a built `lib/` type. So the clause is testable **only** against a fake provider from validation[1]'s conformance suite. That is legitimate, but it is the P4-08 acceptance[2] shape — a decision proved against constructed inputs — and it must be declared at freeze time, not discovered at sign-off.
3. **Whether `ExecutionWorldFact` gains variants in this epic or a later one.** P3-01 owns the producer half of BLOCKED-178, and acceptance[1]'s fail-closed requirement needs at least one non-`absent` value for a policy to refuse on. Whether that lands here, and whether `policy-engine`'s type therefore changes, is a cross-epic edit this page does not authorise.
4. **What `WorldAttestation` verifies against.** The Trust Kernel already holds `sandboxAttestationVerifier`, which returns `false` unconditionally (`trust-kernel/src/index.ts`, P0-02's deliberately inert slot). Whether P3-01 wires that entrypoint or defines a second attestation path is unsettled, and acceptance[2] ("the handle cannot be forged by a model or a third-party plugin") probably depends on the answer.
5. **`layerStatus` is `PENDING_MAINTAINER_ADJUDICATION`** and `canonicalOwner` is `UNASSIGNED_UNTIL_APPROVAL`. The registry records `primaryLayer: L1_CONTRACT` from Agent A's mapping; this page does not adjudicate it.
6. **`verifyCommand` is absent by design.** The registry says the source carries no item-level command and that one must be registered in the manifest with its fixture path and expected exit code before implementation — explicitly "不得猜". No command is proposed here.

## What this page deliberately does not do

It writes no code, registers no command, freezes nothing, and changes no ledger or coverage artifact. It also does not claim P3-01 is READY: the premise section says what is true today, and the first thing to recheck when P2-05 is accepted is whether anything in this census moved — particularly the 16 `SandboxExecutionPolicy` consumers, since P2-05's own slice touched the policy group.
