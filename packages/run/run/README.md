---
description: "The type surface, state machine, durable registry, and mounted Cordis plugin for Epic P4-01's first-class Run Service and Run event log."
kind: "package-reference"
---

# @deepseek-ai/dsh-run

## Summary

`dsh-run` owns Epic P4-01's first-class Run Service: the closed `accepted`/`planning`/`waiting`/
`running`/`paused`/`verifying`/`reconciling`/`succeeded`/`failed`/`cancelled`
Run-state set and its legal-transition table (must[0]); the append-only Run
event log, whose entries reference Session, Workflow, Action, Artifact,
Approval, and Verification entities (must[1]); and a Run owned by the Run
Service's own fixed identity, never a UI session or "current turn" pointer
(must[2]).

This package's type, state-machine, and registry layers are real and green:
`src/types.ts`'s types, `src/events.ts`'s append-only event-log
mechanics, and `src/state-machine.ts`'s Run-lifecycle decisions
(`createRun`, `transition`, `attachSessionToRun`, `listNonTerminalRuns`,
`resumeRun`) are implemented and proven by `tests/state-machine.spec.ts`'s
111 cases — an exhaustive 10x10 state-pair sweep derived from the real
`LEGAL_RUN_TRANSITIONS` table, so every legal edge has a passing-direction
case and every illegal pair a rejected one. `src/index.ts` adds the
durable registry (`RunStore`, `createFileRunStore`, `RunService`), proven by
`tests/run-service.spec.ts`'s 19 cases, each restart case using a fresh
store and service over the same path so a Run can only reappear from durable
bytes, and `RunPlugin`, the mounted Cordis plugin that opens a Run for every
agent session a real harness boot starts.

No invariant companion is published: there is no live Workflow/Action/
Artifact/Approval/Verification store to cross-reference a Run event log
entry's reference against. A real invariant — "no Run event log entry
references a nonexistent Session/Workflow/Action/Artifact/Approval/
Verification" — needs the real stores those entity kinds' own owning
packages eventually publish; minting one here would re-derive a fact only
this package's own registry produces, not an independent second source.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The Run lifecycle surface is called with plain data — no file, process, or
Cordis `Context` access:

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

The package root adds the durable registry that supplies those functions
with real Run storage, so a Run survives the process that accepted it
(acceptance[0]):

```ts
import { createFileRunStore, RunService } from '@deepseek-ai/dsh-run'

// Every boot, including the first, restores the registry from durable storage.
const service = await RunService.restore(createFileRunStore('/var/lib/dsh/runs.json'))
await service.accept(RunId('run-1'), SessionId('session-1'), Date.now())

// After a restart, a fresh service over the same path lists the same Runs.
for (const run of service.listNonTerminal()) service.resume(run.id)
```

Mounted as a plugin, the service acquires a real caller: every agent session
the harness starts opens a Run, and the live `Agent` handle carries its id.
The `packages/bundle/base` row is `disabled: true`, so a profile opts in and
supplies the store path:

```yml
- id: run
  name: '@deepseek-ai/dsh-run'
  config:
    storePath: !!js dshHomePath('runs.json')
```

```ts
// Anywhere holding the booted Context and a live agent:
const run = ctx.runs.runFor(agent)
// agent.runId === run.id, and run.ownerId === RUN_SERVICE_OWNER_ID
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
  `*Id` brands.** No branded id exists in this repository for
  Action/Artifact/Approval/Verification, and `WorkflowRunId`
  (`@deepseek-ai/dsh-workflow/types`) is a different concept — one workflow
  *execution*. `WorkflowRef`/`ActionRef`/`ArtifactRef`/`ApprovalRef`/
  `VerificationRef` deliberately avoid the `*Id` suffix so reconciling one
  against a real id is a distinguishable, greppable step rather than a
  same-named type silently swapped for a different one. `workflowRefOf`
  (`src/index.ts`) is that step for Workflow, and the single place the two
  brands meet.
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
| [`src/events.ts`](src/events.ts) | The append-only event-log mechanics: `genesisRunEvent`, `appendRunEvent`, `referencesByKind` |
| [`src/state-machine.ts`](src/state-machine.ts) | `LEGAL_RUN_TRANSITIONS`/`TERMINAL_RUN_STATES`/`RUN_SERVICE_OWNER_ID`, and the pure decisions over them: `createRun`/`transition`/`attachSessionToRun`/`listNonTerminalRuns`/`resumeRun` |
| [`src/index.ts`](src/index.ts) | The durable Run registry (the `RunStore` durability seam, `createFileRunStore`, `RunService`), the mounted `RunPlugin` and `workflowRefOf`, plus the package barrel re-exporting the three modules above |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/run-service.spec.ts`](tests/run-service.spec.ts) — `RunService`
  and `createFileRunStore` exercised over a real on-disk store, with a
  "process restart" modelled as a fresh store and a fresh
  `RunService.restore` sharing nothing but the file (acceptance[0]).
- [`tests/state-machine.spec.ts`](tests/state-machine.spec.ts) — an
  exhaustive 10x10 Run-state transition sweep (must[0]/acceptance[1]) plus
  one case per remaining must[]/acceptance[] clause.
- [`tests/plugin.spec.ts`](tests/plugin.spec.ts) — `RunPlugin` mounted on a
  real `Context` with the real agent registry and agent loop.
- [`tests/first100/fixtures/P4-01.fault.spec.ts`](../../../tests/first100/fixtures/P4-01.fault.spec.ts) —
  the registry under fault rather than on the happy path: concurrent writers
  over one Run, two stores over one path, and store documents that are damaged
  rather than clean.
- [`@deepseek-ai/dsh-principal`](../../identity/principal/README.md) — this
  package's source for `RunId` (Epic P2-01, already accepted).
- [`@deepseek-ai/dsh-session`](../../core/session/README.md) — this
  package's source for `SessionId`; `packages/core/session/src/types.ts` is
  this epic's one read-only Contract-stage reference into that package (no
  additive change was needed — see Known Limitations below).
- [`@deepseek-ai/dsh-plugin-ownership`](../../plugin/plugin-ownership/README.md) —
  this repo's other pure-decision package, followed here for package layout.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure state-machine-function
signatures only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Concurrent Run writers are serialized within one process only.**
  `createFileRunStore` chains every read and write on the store's resolved
  path, shared by every store instance over that path in this process, and
  `RunService` chains every mutation of one Run on that Run's id. Two separate
  *processes* writing one store path still interleave their read-modify-write
  cycles and can lose a Run; closing that needs filesystem locking, which this
  store does not take. A deployment that wants several processes over one store
  path is not supported today.
- **`RunService.advance` decides against the Run as of its turn, not as of the
  call.** Concurrent transitions on one Run are decided one after another, each
  seeing the previous one's accepted result. This is what stops two callers
  both being told `accepted: true` for mutually exclusive transitions, but it
  is an observable change for a caller that assumed its decision was computed
  the moment it called. There is no way back to the older behavior, and
  reproducing it by reading `get` first and acting on the result is exactly the
  stale-snapshot race the ordering exists to close.
- **A damaged store document is refused whole, never repaired.**
  `createFileRunStore` rejects a store carrying a Run whose state is outside
  must[0]'s closed set, whose `ownerId` is not `RUN_SERVICE_OWNER_ID`, or whose
  event log has a `seq` gap — the whole boot fails rather than restoring a
  registry that silently omits the damaged Run. There is no salvage path that
  recovers the undamaged Runs from such a document; a corrupt store is an
  operator problem, and the epic's `rollback` (restore the journal checkpoint)
  is the intended response.

- **`RunPlugin` mounts on request; it is not a shared-base default, so a
  default `dsh` boot still creates no Run.** `packages/bundle/base`'s `run`
  row is `disabled: true`, matching `baseline-preflight`: `storePath` names a
  real write target with no neutral value, so a profile that wants
  first-class Runs enables the row and supplies that path. A profile that
  does not enable it mounts no Run Service and opens no Run — the plugin
  exists and works, but nothing in the shipped default profiles turns it on
  yet. `tests/first100/fixtures/P4-01.composition.spec.ts` is the proof that
  enabling it does open a Run for a real agent session; it enables the row in
  its own fixture `cordis.yml`.
- **A Run's lifecycle is not yet recorded in the session log.** `RunPlugin`
  keeps its Runs only in its own `RunStore` document; it registers no
  `SessionEventMap` member, so a session log carries no trace of the Run its
  agent ran inside. Adding one requires registering the event type in
  `packages/core/session/src/known-event-types.ts` first — an unregistered
  type makes replay refuse the log — and is deferred with the state
  transitions that would populate it.
- **`RunPlugin` opens a Run and advances nothing.** A Run is accepted when its
  agent session starts and stays in `accepted`; the transitions through
  `planning`/`running`/`verifying` to a terminal state, and the
  `workflow/*`-driven references that would accompany them, are deferred.
  `workflowRefOf` reconciles the brands those references need, but no mounted
  listener calls it yet. A consequence: every Run a boot opens is still
  non-terminal at the next boot, so `listNonTerminal` grows with each run
  against one store path until the transitions land.
- **One Run per agent session, opened from the agent registry only.**
  `RunPlugin` opens a Run for each agent it observes — those started while it
  is mounted, and those a profile configured before it mounted, which it
  adopts at mount because Cordis load order follows service availability
  rather than `cordis.yml` row order. A session that never enters that
  registry gets no Run, and `Agent.runId` stays absent. Multi-session Runs
  (acceptance[2]) are supported by `RunService.attachSession` but no mounted
  listener calls it yet.
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
