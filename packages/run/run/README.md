---
description: "The Contract-stage type surface and state-machine signatures plus the Provider-stage durable Run registry for Epic P4-01's first-class Run Service and Run event log, for maintainers picking up the RED-scaffold fix-round."
kind: "package-library"
---

# @deepseek-ai/dsh-run

## Summary

`dsh-run` fixes the type surface and state-machine signatures for Epic
P4-01's first-class Run Service: the closed `accepted`/`planning`/`waiting`/
`running`/`paused`/`verifying`/`reconciling`/`succeeded`/`failed`/`cancelled`
Run-state set and its legal-transition table (must[0]); the append-only Run
event log, whose entries reference Session, Workflow, Action, Artifact,
Approval, and Verification entities (must[1]); and a Run owned by the Run
Service's own fixed identity, never a UI session or "current turn" pointer
(must[2]).

This package ships this epic's Contract and Provider stages, both real and
green: `src/types.ts`'s types, `src/events.ts`'s append-only event-log
mechanics, and `src/state-machine.ts`'s Run-lifecycle decisions
(`createRun`, `transition`, `attachSessionToRun`, `listNonTerminalRuns`,
`resumeRun`) are implemented and proven by `tests/state-machine.spec.ts`'s
111 cases — an exhaustive 10x10 state-pair sweep derived from the real
`LEGAL_RUN_TRANSITIONS` table, so every legal edge has a passing-direction
case and every illegal pair a rejected one. `src/index.ts` adds the
Provider-stage durable registry (`RunStore`, `createFileRunStore`,
`RunService`), proven by `tests/run-service.spec.ts`'s 19 cases, each
restart case using a fresh store and service over the same path so a Run
can only reappear from durable bytes.

No invariant companion is published because this Contract-stage slice
constructs no Run registry or Cordis `Context` value yet to check an owned
relation over: there is no live Session/Workflow/Action/Artifact/Approval/
Verification store this stage could cross-reference a Run event log entry's
reference against. A real invariant — "no Run event log entry references a
nonexistent Session/Workflow/Action/Artifact/Approval/Verification" — needs
this epic's Provider-stage registry (`src/index.ts`) and the real stores
those five entity kinds' own owning packages eventually publish; minting one
here would either be empty or re-derive a fact only this package's own
in-memory fixtures produce, not an independent second source.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The Run lifecycle surface, once implemented, is called with plain data — no
file, process, or Cordis `Context` access:

```ts
import { createRun, transition, attachSessionToRun, listNonTerminalRuns, resumeRun } from '@deepseek-ai/dsh-run/state-machine'
import type { RunEntityReference } from '@deepseek-ai/dsh-run/types'
import { RunId } from '@deepseek-ai/dsh-principal/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'

const run = createRun(RunId('run-1'), SessionId('session-1'), Date.now())
// run.ownerId === RUN_SERVICE_OWNER_ID — never the initiating Session's id

const references: readonly RunEntityReference[] = [{ kind: 'artifact', id: artifactRef }]
const decision = transition(run, 'planning', references, Date.now())
// decision.accepted is false with reason 'illegal-transition' when the pair
// is absent from LEGAL_RUN_TRANSITIONS[run.state]
```

Every `./state-machine` and `./events` export is a pure function over
already-computed data: none of them reads a file, spawns a process, or
constructs a Cordis `Context`.

The package root adds the Provider-stage durable registry that supplies
those functions with real Run storage, so a Run survives the process that
accepted it (acceptance[0]):

```ts
import { createFileRunStore, RunService } from '@deepseek-ai/dsh-run'

// Every boot, including the first, restores the registry from durable storage.
const service = await RunService.restore(createFileRunStore('/var/lib/dsh/runs.json'))
await service.accept(RunId('run-1'), SessionId('session-1'), Date.now())

// After a restart, a fresh service over the same path lists the same Runs.
for (const run of service.listNonTerminal()) service.resume(run.id)
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the
observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **`RunId`/`SessionId` are reused, never re-minted.** `RunId` comes from
  `@deepseek-ai/dsh-principal/types` (Epic P2-01, already accepted) and
  `SessionId` from `@deepseek-ai/dsh-session/types` — the same brands a
  `Principal`/`IdentityContext`/`Session` already carries, so this package
  never creates a second, incompatible identity universe for either.
- **The other five entity kinds get package-local `*Ref` brands, not
  `*Id` brands.** No branded id exists yet in this epic's Contract-stage
  scope for Workflow/Action/Artifact/Approval/Verification (`WorkflowRunId`
  in `@deepseek-ai/dsh-workflow/types` is a different concept — one workflow
  *execution* — and that package is this epic's Usage-stage scope, not
  Contract-stage's). `WorkflowRef`/`ActionRef`/`ArtifactRef`/`ApprovalRef`/
  `VerificationRef` deliberately avoid the `*Id` suffix so a later
  Usage-stage reconciliation is a distinguishable, greppable rename rather
  than a same-named type silently swapped for a different one.
- **Service ownership is structural, not conventional.** `createRun` accepts
  no owner parameter at all — there is no argument position through which a
  UI session id or "whichever turn is currently active" could reach
  `Run.ownerId`. The sole producer is the exported `RUN_SERVICE_OWNER_ID`
  constant (must[2]).
- **Every Run-mutating function is pure and immutable.** `transition`,
  `attachSessionToRun`, and the event-log append functions return a new
  `Run`/event array rather than mutating their input, matching this
  repository's `@deepseek-ai/dsh-plugin-ownership` precedent.
- **A Session id doubles as an Agent instance id.** `Run.sessionIds`
  (acceptance[2]'s "跨多个 Session/Agent") mints no separate Agent identity —
  it treats a `SessionId` as an Agent instance's id on the subagent seam,
  mirroring `@deepseek-ai/dsh-workflow/types`'s `WorkflowAgentInfo.childId: SessionId`.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The Run/RunEvent/RunEntityReference type surface: `RunState`, `RunEvent`, `Run`, `RunEntityReference`, `RunTransitionDecision`, `RunResumeDecision`, plus the `*Ref` brands |
| [`src/events.ts`](src/events.ts) | The append-only event-log mechanics (Contract-stage RED scaffold): `genesisRunEvent`, `appendRunEvent`, `referencesByKind` |
| [`src/state-machine.ts`](src/state-machine.ts) | `LEGAL_RUN_TRANSITIONS`/`TERMINAL_RUN_STATES`/`RUN_SERVICE_OWNER_ID` (real), and `createRun`/`transition`/`attachSessionToRun`/`listNonTerminalRuns`/`resumeRun` (Contract-stage RED scaffold) |
| [`src/index.ts`](src/index.ts) | The Provider-stage durable Run registry (RED scaffold): the `RunStore` durability seam, `createFileRunStore`, and `RunService`, plus the package barrel re-exporting the three modules above |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/run-service.spec.ts`](tests/run-service.spec.ts) — the
  Provider-stage RED scaffold: `RunService` and `createFileRunStore`
  exercised over a real on-disk store, with a "process restart" modelled as
  a fresh store and a fresh `RunService.restore` sharing nothing but the
  file (acceptance[0]).
- [`tests/state-machine.spec.ts`](tests/state-machine.spec.ts) — the
  Contract-stage RED scaffold: an exhaustive 10x10 Run-state transition
  sweep (must[0]/acceptance[1]) plus one case per remaining must[]/
  acceptance[] clause.
- [`@deepseek-ai/dsh-principal`](../../identity/principal/README.md) — this
  package's source for `RunId` (Epic P2-01, already accepted).
- [`@deepseek-ai/dsh-session`](../../core/session/README.md) — this
  package's source for `SessionId`; `packages/core/session/src/types.ts` is
  this epic's one read-only Contract-stage reference into that package (no
  additive change was needed — see Known Limitations below).
- [`@deepseek-ai/dsh-plugin-ownership`](../../plugin/plugin-ownership/README.md) —
  this repo's other Contract-stage pure-decision package, followed here for
  package layout and RED-scaffold conventions.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure state-machine-function
signatures only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The Provider-stage registry is a RED scaffold, and nothing mounts it
  into a Cordis `Context` yet.** `src/index.ts`'s `RunStore`,
  `createFileRunStore`, and `RunService` carry real signatures with
  `'not implemented: ...'` bodies, proven by `tests/run-service.spec.ts`'s
  assertions against that (currently failing) behavior. No plugin registers
  a `RunService` on a `Context`, and no product surface calls one, so a real
  harness run still creates no Run.
- **`packages/session/session-persistence/src/coordinator.ts` was read, not
  modified.** Runs are deliberately not stored through
  `PersistenceCoordinator`: its storage contract is keyed on session
  identity and session-log structure (`PersistenceBackend` reads and writes
  by `SessionId`, its records are `SessionEvent`s under a `SessionHeader`
  gated by `SESSION_FORMAT_VERSION`, every operation serialized on a
  per-`SessionId` chain). Storing a Run there would make a Run's durable
  existence a function of some Session's, which must[2] forbids, and a Run
  that spans several Sessions (acceptance[2]) cannot be a row inside any one
  of their logs. `src/index.ts` owns the Run durability seam instead.
- **`packages/core/session/src/types.ts` was read, not modified.** This
  epic's file scope lists that file as a Contract-stage read (kind `B`) for
  the Session/Run relationship acceptance[2] names. No additive change to
  it was needed: `SessionId` already exists there and is reused as-is
  (see Design philosophy above), and "one Session associates with multiple
  Runs" needs no Session-side field — it is the natural inverse of multiple
  `Run.sessionIds` arrays naming the same `SessionId`, which this package's
  `Run` type already represents. Should a later stage find a genuine reason
  to add a field to `SessionHeader`/`Session` itself, that is that stage's
  change to make and justify, not this one's.
- **The `WorkflowRef`/`ActionRef`/`ArtifactRef`/`ApprovalRef`/`VerificationRef`
  brands are not reconciled with any entity's real id type.** No branded id
  exists yet for Action/Artifact/Approval/Verification anywhere in this
  repository, and `WorkflowRunId` (`@deepseek-ai/dsh-workflow/types`) is a
  different concept (one workflow execution) that this epic's Usage-stage
  file scope, not this Contract stage's, is responsible for reconciling
  against `WorkflowRef`.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
