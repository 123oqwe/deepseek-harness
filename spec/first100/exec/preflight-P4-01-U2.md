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
