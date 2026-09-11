# P4-01 — production-arrival evidence for re-signing

Written for the delegate's signature pass, which re-greps every row below. P4-01's sign-off was WITHDRAWN (BLOCKED-183) because its clauses were implemented and reached by nothing: `advance`, `listNonTerminal`, `resume` and `attachSession` had no production caller, and `@deepseek-ai/dsh-run` had no consumer outside its own package. This page is the answer to "what calls it now", one row per named thing, with the line to check.

Every path is at `61f6bb761e` unless stated.

## 4.4a — the noun, and the production call site that reaches it

| named thing | production call site | reached from |
|---|---|---|
| `RunService.restore` | `packages/run/run/src/index.ts:1147` | `Service.init`, on every mount |
| **`RunService.listNonTerminal`** | `packages/run/run/src/index.ts:1148` | `Service.init`, one statement after the restore — acceptance[0]'s enumerate half |
| `RunPlugin.restoredNonTerminal` | `packages/run/run/src/index.ts:713` | the plugin's public answer to "what did this process come back to"; read by the Loader driver at `tests/first100/fixtures/loader/p4-01-run-resumed/driver.ts` |
| **`RunService.resume`** | `packages/run/run/src/index.ts:735`, inside `RunPlugin.adoptable` | called per session from `open`, `:759` — acceptance[0]'s resume half |
| `RunService.runsForSession` | `packages/run/run/src/index.ts:734` | the adoption lookup |
| `RunService.openForSession` | `packages/run/run/src/index.ts:801` | only when nothing was continued |
| **`RunService.advance`** | four production callers, below | acceptance[1] becomes reachable |
| `RunService.attachSession` | **none, deliberately** | BLOCKED-196 — a Run spanning sessions is writable under two independent authorities |

**The four `advance` callers**, which are the whole of must[0]'s state occupancy:

| transition | call site | when |
|---|---|---|
| `accepted → planning` | `packages/run/run/src/index.ts:918` | `RunPlugin.recordTaskProfile`, at the first `agent/pre-step`; names P4-02's TaskProfile as a `task-profile` reference |
| `planning \| paused → running` | `packages/run/run/src/index.ts:1020`, in `startRun` | the same first step, after the profile — and a parked Run's next step |
| `running → verifying → succeeded \| failed` | `packages/run/run/src/index.ts:1060`, `:1061`, in `endRun` | `agent/disposed`, via `finish` at `:929` |
| `accepted \| planning → cancelled` | `packages/run/run/src/index.ts:1056`, in `endRun` | a session disposed before any model step |
| `running → paused` | `packages/run/run/src/index.ts:1076`, in `pauseRun` | the plugin's own disposer, `:1255` — a clean unload |

## 4.4b — the mount row a shipped profile actually carries

| what | where |
|---|---|
| the Run Service row | `packages/bundle/base/cordis.patch.yml:595` — `- id: run`, `name: '@deepseek-ai/dsh-run'`, `storePath: !!js dshHomePath('runs', 'runs.json')` |
| its lease provider | `packages/bundle/base/cordis.patch.yml:498` — `@deepseek-ai/dsh-lease-sqlite`, mounted before the row that injects it |

**The row is ENABLED and carries no `disabled: true`.** It was enabled in `2f263fa7e2` ("enable the Run Service on shipped profiles"). `packages/run/run/README.md` claimed the opposite in two places until this slice — including a whole Known-Limitation bullet asserting that "a default `dsh` boot still creates no Run" — which is how a stale document can make an epic's own arrival look weaker than it is. Both corrected.

## 4.4c — what a model or a user can observe

Nothing. The Run's own records are host-side: the `RunStore` document and the Run event log reach no model request and no transcript. The one session event this epic's work produces is `run/task-profile`, and that is P4-02's, declared by `@deepseek-ai/dsh-task-profile` and appended by `RunPlugin`. Recorded here because "no model-visible surface" is a claim the signature pass should be able to check rather than assume.

## 4.4d — the observation, per clause

| clause | observed by | where |
|---|---|---|
| must[0] — the states are occupied | `walks a successful session accepted → planning → running → verifying → succeeded, one log entry each` | `packages/run/run/tests/restart.spec.ts:416` |
| must[0] — `paused` reached | `PARKS a running Run at 'paused' when the mount unloads cleanly, rather than ending or abandoning it` | `:180` |
| must[0] — `paused` left | `takes a parked Run back to 'running' at the next model step, so 'paused' is a pause and not a stop` | `:236` |
| must[1] — one log entry per transition | the same three-step cases, read back through a fresh `RunService.restore` | `:416`, `:436` |
| must[2] — the service owns the Run | `owns that Run with RUN_SERVICE_OWNER_ID, never the agent session that started it` | `tests/first100/fixtures/P4-01.composition.spec.ts:78` (pre-existing) |
| acceptance[0] — enumerate | `reports the non-terminal Runs the store held, at mount, before any agent exists` + its control | `restart.spec.ts:85`, `:101` |
| acceptance[0] — resume | `gives a session exactly ONE Run across a restart…`, `MINTS a fresh Run when the restored one is terminal…`, `adopts a Run that was mid-running when the process CRASHED…` | `:117`, `:137`, `:158` |
| acceptance[0] — on a shipped profile | `CONTINUES one durable session's Run across a restart, rather than opening a second (U2)` and `enumerates what it restored at mount, which the durable document cannot show (U2)` | `tests/first100/fixtures/P4-01.composition.spec.ts:158`, `:176` |
| acceptance[1] — refusal reachable | `refuses a transition the table does not allow, naming the pair it refused` + `writes nothing when it refuses` | `restart.spec.ts:335`, `:347` |
| acceptance[2] — first half | satisfied by adoption making it ONE Run per session, not by the old accident | `:117` |
| acceptance[2] — negative half | `opens an independent Run per session, so a second session never joins the first's Run` | `:364` |
| acceptance[2] — positive second half | **not implemented; held by BLOCKED-196** | — |
| validation[1] — kill/restart | `adopts a Run that was mid-running when the process CRASHED…` (the first mount is deliberately not disposed) | `:158` |

## What re-signing must record as still open

- **BLOCKED-196** — acceptance[2]'s positive second half. A Run spanning sessions needs a Run-level work item, which reopens §12.35-2.
- **BLOCKED-197** — a cleanly unloaded host cannot hand its work item back, so the next host cannot tell a clean shutdown from a crash. The parking half is implemented; the release is not.
- **A readiness note against P7-05**, not a defect: `verifying` here is the end decision over this plugin's failure ledger, and P7-05 owns output verification.
