---
description: "The Contract-stage type surface and state-machine signatures for Epic P4-01's first-class Run Service and Run event log, for maintainers picking up the RED-scaffold fix-round."
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

This package currently ships this epic's Contract-stage RED scaffold only:
`src/types.ts`'s types, `src/events.ts`'s event-log signatures, and
`src/state-machine.ts`'s Run-lifecycle signatures are real and epic-accurate,
but every decision function (`genesisRunEvent`, `appendRunEvent`,
`referencesByKind`, `createRun`, `transition`, `attachSessionToRun`,
`listNonTerminalRuns`, `resumeRun`) throws `'not implemented: ...'` — the
pure decision logic itself is a later fix-round's deliverable, proven by
`tests/state-machine.spec.ts`'s real assertions against that (currently
failing) behavior. `LEGAL_RUN_TRANSITIONS`, `TERMINAL_RUN_STATES`, and
`RUN_SERVICE_OWNER_ID` are the one exception: real, already-correct data —
the declared transition table and the Run Service's fixed owner identity —
not themselves the adjudication logic under test.

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

Every export is a pure function over already-computed data: no export in
this package reads a file, spawns a process, or constructs a Cordis
`Context` — a later Provider-stage caller (`src/index.ts`) supplies real
Run storage and calls these functions to decide and record each transition.

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

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

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

- **Every decision function throws `'not implemented'`.**
  `genesisRunEvent`, `appendRunEvent`, `referencesByKind`, `createRun`,
  `transition`, `attachSessionToRun`, `listNonTerminalRuns`, and `resumeRun`
  are Contract-stage RED-scaffold stubs: real signatures and real
  JSDoc-documented behavior, no working body.
  `tests/state-machine.spec.ts` fails every case against this today, by
  design — a later fix-round implements the logic these signatures and
  tests already commit to.
- **No wiring into real durable storage or Cordis registration exists
  yet.** `packages/run/run/src/index.ts` (this epic's own Provider-stage
  file) and `packages/session/session-persistence/src/coordinator.ts`
  (acceptance[0]'s restart path) do not call into this package — this
  package alone cannot list, resume, or durably record a real Run.
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
