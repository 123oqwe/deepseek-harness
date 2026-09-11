# P4-01 — production-arrival evidence for re-signing

Written for the delegate's signature pass, which re-greps every row below. P4-01's sign-off was WITHDRAWN (BLOCKED-183) because its clauses were implemented and reached by nothing: `advance`, `listNonTerminal`, `resume` and `attachSession` had no production caller, and `@deepseek-ai/dsh-run` had no consumer outside its own package. This page is the answer to "what calls it now", one row per named thing, with the line to check.

Every path is at `61f6bb761e` unless stated.

## How to re-verify this page

Every row below carries a command that reproduces it. They are the check, not an illustration: a row whose command stops matching is a row that has gone stale, which is what happened twice to this epic's own README. Run them from the repository root.

**One trap, named because a re-verifier will hit it.** A bare `grep attachSession` finds `Workspace.attachSession` — a different method on a different service, with real callers in `session-controller`, `webhook` and `workspace`. The command in that row is scoped to the Run service's own receiver for exactly that reason.

## 4.4a — the noun, and the production call site that reaches it

| named thing | reached from | command |
|---|---|---|
| `RunService.restore` + **`listNonTerminal`** | `Service.init`, the restore and then acceptance[0]'s enumerate half one statement later | `grep -n "RunService.restore(createFileRunStore\|restoredAtMount = this.restored.listNonTerminal()" packages/run/run/src/index.ts` → 2 lines |
| `RunPlugin.restoredNonTerminal` | the plugin's public answer to "what did this process come back to" | `grep -n "restoredNonTerminal()" packages/run/run/src/index.ts tests/first100/fixtures/loader/p4-01-run-resumed/driver.ts` → the declaration and the Loader driver's read |
| **`RunService.resume`** + `runsForSession` | `RunPlugin.adoptable`, called per session from `open` — acceptance[0]'s resume half | `grep -n "this.service.resume(run.id)\|this.service.runsForSession(agent.id)\|const continuing = this.adoptable(agent)" packages/run/run/src/index.ts` → 3 lines |
| `RunService.openForSession` | only when nothing was continued | `grep -n "this.service.openForSession(" packages/run/run/src/index.ts` → 1 line, inside `if (continuing === undefined)` |
| **`RunService.advance`** | six calls, five transitions — the whole of must[0]'s state occupancy | `grep -n "this.service.advance(" packages/run/run/src/index.ts` → 6 lines |
| `RunService.attachSession` | **no caller, deliberately** — BLOCKED-196 | `grep -rn "runs\.attachSession(\|service\.attachSession(" --include='*.ts' packages/ apps/ tests/` → **no output, exit 1**. Scoped to the receiver on purpose: a bare `attachSession` grep hits `Workspace.attachSession` |

**The four `advance` callers**, which are the whole of must[0]'s state occupancy:

The single command above prints all six; each is identified by the state it names, so the rows below say what each is FOR rather than repeating a line number that moves.

| transition | when |
|---|---|
| `accepted → planning` | `RunPlugin.recordTaskProfile`, at the first `agent/pre-step`; names P4-02's TaskProfile as a `task-profile` reference |
| `planning \| paused → running` | `startRun` — the same first step after the profile, and a parked Run's next step |
| `running → verifying → succeeded \| failed` | `endRun`, from `agent/disposed` via `finish` |
| `accepted \| planning → cancelled` | `endRun`, for a session disposed before any model step |
| `running → paused` | `pauseRun`, from the plugin's own disposer — a clean unload |

## 4.4b — the mount row a shipped profile actually carries

| what | command |
|---|---|
| the Run Service row, and that it carries **no** `disabled: true` | `node -e "const y=require('node:fs').readFileSync('packages/bundle/base/cordis.patch.yml','utf8').split('\n');const i=y.findIndex(l=>/^\s*- id: run$/.test(l));console.log(i+1, y.slice(i,i+4).join('\n'), /disabled:\s*true/.test(y.slice(i,i+5).join('\n')))"` → the row, and `false` |
| its lease provider, mounted before the row that injects it | `grep -n "dsh-lease-sqlite\|- id: run$" packages/bundle/base/cordis.patch.yml` → the provider's line number is the smaller one |

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

**The two argvs that run every case in this table**, and the only two numbers a signature pass needs from them:

```sh
pnpm exec vitest run packages/run/run --maxWorkers=2                              # 194 passed
pnpm exec vitest run tests/first100/fixtures/P4-01.composition.spec.ts --maxWorkers=2   # 9 passed
```

The second boots a real composition through `dsh-app-boot` twice over one store, which is the shipped-profile observation the withdrawal's ground asks for. It is slow — two real boots per case — and that is the cost of observing arrival rather than asserting it.

To check one row rather than all of them, add `-t` and the case title verbatim, for instance:

```sh
pnpm exec vitest run packages/run/run --maxWorkers=2 -t "PARKS a running Run"
```

**One caveat about reading those runs**, learned from a probe on this epic: vitest's default reporter shows a test's captured stderr only when the test FAILS. A passing case that prints diagnostics prints nothing you will see, so "no output" from a green run means **unobserved**, never zero.

## What re-signing must record as still open

- **BLOCKED-196** — acceptance[2]'s positive second half. A Run spanning sessions needs a Run-level work item, which reopens §12.35-2.
- **BLOCKED-197** — a cleanly unloaded host cannot hand its work item back, so the next host cannot tell a clean shutdown from a crash. The parking half is implemented; the release is not.
- **A readiness note against P7-05**, not a defect: `verifying` here is the end decision over this plugin's failure ledger, and P7-05 owns output verification.

-----

## The U citations prepared for re-sign, held until U.1/U.2 are observed passing

Written here rather than into `acceptance-coverage.json` because that file's coverage-closure predicate treats every citation as NECESSARY evidence (AND, not OR): a cited title that is frozen but not yet present in the ledger row's `expectCasesMatched` fails the whole acceptance index. So a row added before observation would not record a plan — it would turn a GREEN index red. These go in verbatim once U.1/U.2 green, in one edit, with no re-derivation needed.

The titles below are the LIVE frozen ones, re-read from `command-freeze.json` rather than copied from the replace/keep/add table in `fe7bbb645d`. They differ, and the difference is deliberate: question 2 split the single enumerate case into three, and "a non-terminal Run resumes and a terminal one is refused" was dropped as written because it tested `resume()` the pure function, which the P stage already covers. What U2 owes is the CALLER.

| acceptance | stage | title to cite |
|---|---|---|
| [0] | U.1 | reports the non-terminal Runs the store held, at mount, before any agent exists |
| [0] | U.1 | reports nothing for a store that holds only terminal Runs, so the enumeration is not just "everything" |
| [0] | U.1 | gives a session exactly ONE Run across a restart, adopting the non-terminal one it restored |
| [0] | U.1 | MINTS a fresh Run when the restored one is terminal, rather than resuming something already finished |
| [0] | U.1 | adopts a Run that was mid-`running` when the process CRASHED, rather than dropping it |
| [0] | U.2 | CONTINUES one durable session's Run across a restart, rather than opening a second (U2) |
| [0] | U.2 | enumerates what it restored at mount, which the durable document cannot show (U2) |
| [1] | U.1 | refuses a transition the table does not allow, naming the pair it refused |
| [1] | U.1 | writes nothing when it refuses: the Run keeps the event log it had |
| [2] | U.1 | opens an independent Run per session, so a second session never joins the first's Run |

Two things a later reader should not have to re-derive:

- **acceptance[0] gets an enumerate/adopt/mint triple rather than one case**, because the clause is two verbs at two seams and the terminal branch is what distinguishes adoption from minting. The mint case and the adopt case are each other's control: together they prove adoption is a decision, not a default.
- **acceptance[2] gets only its negative half.** The positive half — one Run spanning sessions — has no production caller, which is BLOCKED-196, and the cited case's subject is that absence. It is frozen so that wiring `attachSession` without the ruling fails a test rather than passing silently.

**One citation this page does not resolve.** acceptance[0]'s existing U citation asserts the opposite of what the clause requires (measured at `fe7bbb645d`; its body never calls `listNonTerminal` or `resume`, and asserts every Run is still `accepted`). The replace/keep/add table calls for REPLACE, but its second half cannot be written until U.1/U.2 are observed. Striking the stale citation before its replacement exists would leave the index with no U evidence, and is a deletion from a curated evidence artifact — so it is recorded as a delegate call rather than taken here. The note on the entry itself now says plainly that the citation does not evidence the clause.
