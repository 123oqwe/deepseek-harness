# P4-01.U2 — preFlight for the remediation slice

Recorded before the first line of U2 code, at `b2ecf8a52c`. The machine-readable half is `clause-subject-audit.json`'s `preFlight["P4-01.U2"]`; this page is the reasoning it compresses.

P4-01's sign-off is WITHDRAWN (BLOCKED-183). This slice is the remediation the delegate scheduled: **arrival only** — the agent loop drives `planning → running → terminal`, startup lists non-terminal Runs and takes `resume()`'s decision, and both are frozen and observed on a shipped profile. **It changes no event vocabulary**, which is what settles the three adapt dispositions below.

## What production actually reaches today

Measured at `b2ecf8a52c`, by reading the one production consumer — `RunPlugin` itself, since nothing outside `packages/run/run` touches the `runs` service (BLOCKED-183).

| `RunService` member | production caller |
|---|---|
| `restore` | **yes** — `index.ts:849`, in `Service.init`, over `createFileRunStore(config.storePath)` |
| `openForSession` | **yes** — `index.ts:669`, from the `agent/session-start` listener |
| `get` | **yes** — via `runFor(agent)` |
| `advance` | **no caller** |
| `listNonTerminal` | **no caller** |
| `resume` | **no caller** |
| `attachSession` | **no caller** |
| `accept` | **no caller** |
| `runsForSession`, `reclaim` | **no caller** |

**This corrects one line of BLOCKED-183.** That entry listed `openForSession` among the members unreachable from outside the package, which is true of "outside the package" and false of production: `RunPlugin` calls it on every session start. The entry's load-bearing claim — no consumer outside the package, and `advance`/`listNonTerminal`/`resume` with no caller at all — stands; the membership of that list needs the correction, and it is reported to the delegate rather than quietly fixed here, because BLOCKED-183 is the basis of the withdrawal.

## Clause by clause, what U2 owes

- **must[0]** (ten Run states) — the vocabulary exists and is closed. In production a Run only ever occupies `accepted`: `createRun` mints the genesis entry and nothing advances. U2 owes the transitions, not the table.
- **must[1]** (append-only log referencing six entities) — the log exists, is persisted through `store.put`, and every Run carries its genesis entry whose `references` is `[{kind: 'session'}]`. **No second entry is ever appended in production.** U2 owes appends; P4-02.P supplies the first one (`accepted → planning` with a `task-profile` reference).
- **must[2]** (the service owns the Run, not a UI session or turn holder) — **arrived.** `ownerId` is `RUN_SERVICE_OWNER_ID` with no argument position to substitute, and `openForSession` is the production path.
- **acceptance[0]** (after a restart, list every non-terminal Run and resume) — **half arrived, and the halves are worth separating.** The durable half is real: `RunService.restore` reads the whole store at mount, so a new process does start from the persisted registry. The decision half is absent: `listNonTerminal()` and `resume()` have no caller, so nothing enumerates what was restored or decides what to do with it. U2 owes the enumeration and the resume decision, not the persistence.
- **acceptance[1]** (an illegal transition is refused) — the refusal is implemented and tested, and is unreachable in production because its only entry point is `advance`. U2 makes it reachable; the clause becomes observable the moment a production caller exists.
- **acceptance[2]** (one Session ↔ many Runs; one Run across Sessions/Agents) — **not arrived, and the current shape actively prevents it.** `open()` returns early when `agent.runId` is set and otherwise mints `run-<uuid>` fresh per session, and `attachSession` has no caller, so in production a Run never spans sessions. Whether U2 owes this or it belongs to the subagent seam is question 1 below.

## The three adapt dispositions, restated live

P4-01's preFlight recorded three deviations with reasons opening `accepted-unadopted (R6/§7.9): this epic is ACCEPTED …`. `verify-adapt-dispositions.mjs:165-167` treats `accepted-unadopted` and `ownership-transferred` as **read-only reasons valid only while the row is ACCEPTED**, so a withdrawn row carrying them is a gate failure — correctly: a reopened epic owes a live disposition, and the sentence "this epic is ACCEPTED" is no longer true.

The live reason is the same for all three, and it follows from the slice's scope rather than from its status: **U2 changes no event vocabulary.** The sunk-cost judgement R6/§7.9 made still holds for the hand-written event log — the implementation runs and nothing propagates from it — and the numbers that judgement rested on are carried forward rather than re-asserted. Re-evaluated at U2's F stage, when the surfaces the names would appear on are the thing under test:

1. **`cloudevents/spec`** — a specification repository, not a package; measured absent. The run seam's events use this program's own `SessionEventMap` names.
2. **CloudEvents attribute names** — no frozen case of this epic names one. P4-06's card is where the delegate has ruled the inbox table should adopt them; that remains P4-06's work and U2 makes no claim on it.
3. **A2A TaskState / MCP TaskStatus names at surfaces** — the run seam exposes its own lifecycle states and no surface maps them. Note the ownership table: `A2A TaskState` and `MCP TaskStatus names` are both owned by **P4-05** (the card's §1 table records P4-01 as crossed out — accepted without adopting, ownership moved on), so adopting them here would take a shape back from its current owner.

**I am not proposing to adopt any of the three in U2.** If the delegate reads the row differently — in particular if `accepted → running → terminal` passing through a surface makes the A2A/MCP names due now — that is an A-class call and it changes U2's scope from arrival to vocabulary.

## Open questions this preFlight does NOT settle

1. **Does acceptance[2] belong to U2?** Its two halves need different things: "one Session, many Runs" needs a second `openForSession` for an existing session, and "one Run across Sessions/Agents" needs `attachSession` wired where a subagent session joins its parent's Run — which is the subagent seam, not the run seam. U2's stated scope is the lifecycle and the restart path; pulling acceptance[2] in widens it, and leaving it out means the withdrawal's grounds are only partly answered.
2. **Where does the restart decision run?** `Service.init` already restores the registry, so the enumeration could sit there — but a resume decision taken at mount runs before any agent exists, and `resume()` only says whether a Run *may* resume, not who will drive it. The honest alternative is that the decision belongs wherever a session is re-attached to an existing Run, which is question 1's second half again.
3. **Does the Run event log stay out of the session log?** The ledger's own `planError` for this row says the choice — `run/*` event types added to `core/session`'s closed known-event-types list, or the run log in its own tables with session refs — must be made explicitly. Production chose the second (`createFileRunStore`). P4-02 is putting the TaskProfile BODY in the session log while the Run event log references it by digest, so the two epics now straddle both answers. That is coherent, but it should be coherent on purpose and recorded somewhere other than this paragraph.

## What this slice is NOT

No new registry clauses, no event-name changes, no second Run store, and no widening of P4-02's `accepted → planning` transition — that one stays with P4-02, which is its first production caller.

---

## TDD plan, written while P4-02's C cell waits on observation

Not a freeze. The argv, the case titles and the mutations are what U2 will freeze once its code exists; writing them now is what §1.12 asks of a waiting lane, and it is also the cheapest moment to notice that a case cannot be written.

**argv** — `pnpm exec vitest run packages/run/run --reporter=json`, plus the shipped-profile observation U2 owes: the lifecycle and the restart path are only true in a composition, so a Loader fixture under `packages/run/run/tests/` that boots the base profile is the subject, not a hand-built `ctx.plugin(...)`. Whether that fixture belongs to `stages.U`'s declared files or arrives as a `filesOverlay` entry is settled when the files are written; `stages.U` today is `core/agent/src/types.ts`, `workflow/workflow/src/types.ts`, `run/run/src/index.ts` and `stages.F` adds `run/run/tests/state-machine.spec.ts`.

**The cases, each with the clause whose truth it observes** — the delegate's criterion, applied before the code exists so a case with no nameable clause is dropped now rather than frozen later:

| case | clause |
|---|---|
| the agent loop advances a queued Run from `planning` to `running` at its first model step | must[0] — the states are occupied, not merely declared |
| a Run that reaches a terminal state through the loop records one log entry per transition, in order | must[1] — the log is appended after genesis, which it never was |
| an illegal transition attempted through the production path is refused, naming the pair | acceptance[1] — reachable for the first time; refusal with no caller refused nothing |
| the refusal writes nothing: the Run keeps the event log it had | acceptance[1] — the half that distinguishes a refusal from a silent failure |
| a fresh process lists the non-terminal Runs the store holds | acceptance[0] — the enumerate half; the restore half already arrives |
| a non-terminal Run resumes and a terminal one is refused, each naming its reason | acceptance[0] — `resume()`'s decision reaching a caller |
| a Run that was mid-`running` when the process died is listed and resumed, not silently dropped | validation[1] — kill/restart after a transition |
| the shipped base profile drives all of the above with no test-only plugin mounted | the withdrawal's own ground: production arrival, not library behaviour |

**Mutations, one per case, in the non-check-removing forms this epic has used** — a constant, a value or a dependency replaced, never a guard deleted: advance to `running` without passing `planning`; append the transition without its log entry; accept the illegal pair instead of refusing it; let the refusal write the Run back; return every Run from the enumeration instead of the non-terminal ones; invert `resume()`'s terminal test; skip the enumeration when the store is non-empty; mount the driver from the fixture instead of the base profile.

**Three things this plan cannot decide yet**, and each is a question already open above: whether acceptance[2] is in scope at all (question 1) — if it is, two more cases and two more mutations; where the restart decision runs (question 2), which decides whether the enumeration case observes `Service.init` or a session re-attachment; and whether the Run event log stays out of the session log (question 3), which decides whether the per-transition entry is observed in the Run store or in a session event.

---

## acceptance-coverage pre-check: what re-signing U2 must change

P4-01's coverage entries exist and cite 7 + 6 + 5 cases across the three acceptance indices. The withdrawal did not touch them, so the question for U2 is narrow: which citations still say something true once production drives the lifecycle, and which were only ever true of the library. Read case by case, not by title.

### acceptance[0] — "after a restart, list every non-terminal Run and resume"

**The one U citation asserts the absence of the behaviour the clause requires.** `tests/first100/fixtures/P4-01.composition.spec.ts:124`, titled "lists the Run a previous boot left behind as non-terminal, so a restart can resume it", boots the fixture twice over one store and then reads the store file directly:

```ts
const runs = readRuns(storePath)
for (const run of runs) expect(run.state).toBe('accepted')
```

It never calls `listNonTerminal` and never calls `resume`. What it proves is that a real boot persists Runs and a second boot leaves them at `accepted` — and `accepted` for every Run is exactly the symptom BLOCKED-183 names. The title claims "so a restart can resume it"; the body observes nothing resuming.

**So this case must change at U2, and it will go red on its own if it does not.** Once the agent loop advances `planning → running → terminal`, a booted Run is no longer `accepted`, and `expect(run.state).toBe('accepted')` fails. That is the acceptance-locks rule's "unlocks as a test starting to fail" signal arriving on schedule — the correct response is to replace the case, never to patch the assertion back to green.

| | |
|---|---|
| **REPLACE** | the U citation above, with U2's "a fresh process lists the non-terminal Runs the store holds" and "a non-terminal Run resumes and a terminal one is refused, each naming its reason" |
| **KEEP** | the four P citations (they prove the service-level happy path over a real file store, which stays true) and the two F citations (a damaged store must not satisfy the clause) |
| **NOTE** | must say that the P cases establish the service behaviour and the U2 cases establish that production reaches it — the distinction the withdrawal turned on |

### acceptance[1] — "an illegal transition is refused"

All six citations are C, P and F; **there is no U citation at all**, which is itself the finding. The refusal is proven exhaustively (a 10×10 sweep over the real transition table) and is unreachable in production, because its only entry point is `advance` and nothing calls it.

| | |
|---|---|
| **KEEP** | all six; none of them becomes false, and the C sweep is the strongest part of this epic |
| **ADD** | U2's "an illegal transition attempted through the production path is refused, naming the pair" and "the refusal writes nothing: the Run keeps the event log it had" |
| **NOTE** | must stop implying the clause is closed by the sweep alone. A refusal nothing can trigger refused nothing — that sentence belongs in the note, because the sweep will still be there and still be green |

### acceptance[2] — "one Session ↔ many Runs; one Run across Sessions/Agents"

Five citations, and they split cleanly along the direction of the relation. `packages/run/run/tests/plugin.spec.ts:115` — "opens an independent Run per agent session, so one Session never joins another Session's Run" — is real production behaviour and stays true: `open()` returns early when `agent.runId` is set and otherwise mints a fresh `run-<uuid>`. But that is the **negative** half. The positive halves — one Session seeding two Runs, `attachSessionToRun` spanning Sessions — are C and P only, and `attachSession` has no production caller.

| | |
|---|---|
| **KEEP** | all five; the U one is genuinely production, the C/P ones are true of the library |
| **ADD** | nothing, **if** the delegate rules acceptance[2] out of U2's scope (open question 1 above). If it is in scope, two citations are needed: a second Run opened for an existing Session, and a subagent session joining its parent's Run through `attachSession` |
| **NOTE** | must say which direction production reaches. Today the note says "both directions are covered" and "both are proven to survive a restart"; after the withdrawal that reads as stronger than it is, because only the negative direction has a production caller |

### The shape of all three

Nothing in the existing coverage is false about the library, and nothing in it distinguishes "the service does this" from "production reaches it". That distinction is the whole content of the withdrawal, so each of the three notes needs it added — which is cheaper than it sounds, because the citations themselves mostly stay.

**One citation to re-examine rather than keep or replace**, and it is not in this table because it belongs to no acceptance index: `P4-01.composition.spec.ts`'s other cases assert the genesis entry, the owner id and the initiating session from a real boot. Those are `must[]` coverage and they are real production arrivals — worth naming at re-sign as the part of P4-01 that was never in doubt.

---

## The three open questions, measured at `08dcbd6b7e`

Facts only. Question 1 is a scope decision the delegate reserved; 2 and 3 are answerable from the tree and are answered here.

### Question 1 — acceptance[2]: the two halves are not equally costly, and the second collides with P4-07

**"One Session, many Runs" already happens, and not by design.** Probed on this tree (a throwaway spec, run once, removed; `git status` clean afterwards): two mounts over one store path, one session id, an agent created in each.

```
runs-for-session  before=1  after=2
listNonTerminal   before=1  restored=1  after=2
```

`open()` checks only `agent.runId !== undefined` (`index.ts:691`) — it never asks `runsForSession(agent.id)` — so a restart mints a SECOND Run for the same session and the first stays non-terminal forever. acceptance[2]'s first half is therefore satisfied by an **accident of the restart path**, and the same accident is acceptance[0]'s missing half seen from the other side: the README's "`listNonTerminal` grows with each run against one store path" is this measurement.

**"One Run across Sessions/Agents" is the half with a structural cost, and it is P4-07's.** Three facts:

1. **The lease's work item is the SESSION, deliberately.** `open()` acquires on `brandString<WorkItemId>(agent.id)`, and the comment records why (§12.35-2): a `run-<uuid>` is minted per open, so two hosts driving one session asked for two different items and neither `acquire` could refuse the other — measured at the time as two granted leases at epoch 0.
2. **A Run's own writes present no lease at all.** `leaseStore` appears four times in `index.ts` — `inject`, `open`, `reclaim`, and the release in `finish`. `RunService.advance` and `RunService.attachSession` take no token and consult no store; what the lease guards is the AGENT lifecycle, through `advanceLeasedAgent`/`advanceAgentLifecycleFenced`.
3. **Run-level serialization is in-process only.** `RunService` chains mutations per Run id inside one process; the package README states the limit plainly.

Put together: **wiring `attachSession` makes one Run's append-only log writable under two independent authorities.** If a Run carried sessions A and B, two hosts could each validly hold one session's lease — neither fenced, because the leases are on different work items — and both append to that Run's log, serialized by nothing that spans them. That is the two-master state P4-07 exists to prevent, one level up from where P4-07 prevents it.

So the question is not "does U2 have room for two more cases". It is whether a Run spanning sessions needs its own work item, which would reverse §12.35-2's decision. **Not proposed here; reported.**

### Question 2 — where the restart decision runs: `Service.init` can enumerate, and nothing can drive

`Service.init` restores the registry on line 982 and subscribes on the lines after it, so `listNonTerminal()` is callable one statement later. The enumeration is available. What is not is a driver:

- `resume(id)` returns `resumeRun(run)` — a pure decision about whether a Run MAY resume. It appoints nobody.
- At the moment `init` runs, **no agent exists**. An agent arrives at `agent/session-start`, which is where `open()` runs — and `open()` mints rather than adopts, as measured above.

So the enumeration belongs in `init` (it is the only place that knows what was restored, and it needs no agent), and the ADOPTION belongs in `open()`: for a session with a restored non-terminal Run, ask `resume()` and either adopt that Run or record why a fresh one was minted. Splitting it that way makes acceptance[0] observable in two places, which is what it describes — "after a restart, list every non-terminal Run and resume" is two verbs.

This also fixes the accident in question 1's first half without touching acceptance[2]'s second: adopting is how `runs-for-session after=2` becomes `after=1`.

### Question 3 — the Run event log stays out of the session log, and the group now holds both answers on purpose

P4-02 landed, so the measurement is no longer hypothetical:

| record | where it lives | named from |
|---|---|---|
| a Run and its event log | `createFileRunStore`'s own document | nothing in the session log |
| a compiled TaskProfile's BODY | the session log, as `run/task-profile` | the Run's event log, by digest |

Both answers the ledger's `planError` named are now in use, one each, and the test that makes that coherent is **ownership**: a profile is compiled from a message in one session's log and means nothing outside it, while a Run spans sessions (in the type surface) and outlives any one of them. A Run's log in the session log would have to pick a session to live in.

The answer to the question as asked is therefore **yes — the Run event log stays out of the session log**, and the reason is not storage convenience. What is missing is that this sentence exists only in a preFlight and in `packages/run/README.md`'s Dev Note; the ledger's `planError` still reads as an open choice. Recording it where decisions are recorded is a delegate call.

---

## The TDD plan, re-anchored after the measurements (delegate note 12)

The eight cases above were written before questions 2 and 3 were measured. Three of them moved, one was dropped, and two were added. Reported before any code, per the ruling.

**argv** — unchanged in shape: `pnpm exec vitest run packages/run/run --reporter=json`, plus the shipped-profile observation the withdrawal's ground requires, which `tests/first100/fixtures/P4-01.composition.spec.ts` already provides a Loader fixture for (a real `dsh-app-boot` boot, not a hand-built `ctx.plugin`).

| case | clause | anchored at |
|---|---|---|
| the agent loop advances a queued Run from `planning` to `running` at its first model step | must[0] | `agent/pre-step` |
| a Run that reaches a terminal state through the loop records one log entry per transition, in order | must[1] | the Run store, NOT the session log — question 3 |
| an illegal transition attempted through the production path is refused, naming the pair | acceptance[1] | `advance` |
| the refusal writes nothing: the Run keeps the event log it had | acceptance[1] | the Run store |
| **a fresh process enumerates the non-terminal Runs the store restored** | acceptance[0], enumerate half | **`Service.init`**, one statement after `RunService.restore` — question 2 |
| **a session whose restored Run is non-terminal ADOPTS it, so that session has exactly one Run after a restart** | acceptance[0] resume half, and acceptance[2] first half made intentional | **`open()`** — question 2 |
| **a session whose restored Run is terminal gets a fresh one, and the refusal names `resume()`'s reason** | acceptance[0] | `open()` |
| a Run that was mid-`running` when the process died is listed and resumed, not silently dropped | validation[1] | both halves together |
| **a SECOND session does not join an existing Run: no production path calls `attachSession`** | acceptance[2] negative half — BLOCKED-196 | the absence itself |
| the shipped base profile drives all of the above with no test-only plugin mounted | the withdrawal's ground | the Loader fixture |

**What changed and why:**

- The old single "a fresh process lists the non-terminal Runs" became **three** cases, because question 2 showed the clause is two verbs at two seams and the terminal case is the branch that tells adoption from minting.
- "a non-terminal Run resumes and a terminal one is refused, each naming its reason" was **dropped as written**: it tested `resume()` the pure function, which P-stage cases already cover. What U2 owes is the CALLER, which is the two `open()` cases.
- The negative-half case is **new**, and it is the one case here whose subject is an absence. It is frozen deliberately: BLOCKED-196 is open, and a clause held by an entry needs a case that fails the day someone wires it without the ruling.
- "one log entry per transition" now names the Run store as its subject, because question 3 settled that the Run's log is not in the session log — and P4-02 put a profile BODY in the session log, so a case that looked in the wrong place could pass for the wrong reason.

**Mutations, one per case, in the constant/value/dependency forms this epic uses** — never a deleted guard: advance to `running` without passing `planning`; append the transition without its log entry; accept the illegal pair instead of refusing it; let the refusal write the Run back; return every Run from the enumeration instead of the non-terminal ones; **adopt a terminal Run instead of minting**; **mint instead of adopting a non-terminal one** (these two are each other's control — together they prove adoption is a decision and not a default); skip the enumeration when the store is non-empty; **call `attachSession` from `open()` for a second session** (the negative half's mutation, and the one that would redden it the day BLOCKED-196 is closed without re-reading this case); mount the driver from the fixture instead of the base profile.

**Still not in scope:** `attachSession` (BLOCKED-196), and no event-vocabulary change, which is what keeps the three adapt dispositions read-only.
