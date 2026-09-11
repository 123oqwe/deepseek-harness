# P4-02.U — preFlight for the Usage stage

Recorded before the first line of U code, at `792f8bc7aa` (base `d69d6e5b3e`). The machine-readable half stays in `clause-subject-audit.json`'s `preFlight.P4-02`; this page is the U stage's own measurement.

The delegate ruled the shape (gq-92, carried by gq-04): the compiler is called from `RunPlugin`'s **first `agent/pre-step`**, the profile body is appended to the session log as `run/task-profile`, and P4-02 itself performs `advance(accepted → planning, [{kind: 'task-profile', id}])` — becoming P4-01's first production caller of that transition. This page measures whether each of those lines exists to be written on, and finds one place where my own P-stage code would state something it does not know.

## The `check-ready` result the C preFlight could not produce

The C preFlight recorded that the post-withdrawal readiness run belonged to whichever SHA carried the withdrawal. It now does — `d69d6e5b3e` carries P4-01's and P1-07's — and the run on this tree is:

```
READY: P4-02 — every predecessor ACCEPTED or fully landed, no declared-file overlap with any in-flight epic
exit 0
```

So the mechanical half of §12.83 is observed, not only read: P4-01 is `BLOCKED_ON_ACCEPTANCE` with four GREEN cells, and `check-ready.mjs:220` admits it on the cells.

## The four things U needs, measured

| question | measurement |
|---|---|
| Does `dsh-run` need `dsh-task-profile` moved from `peerDependencies` to `dependencies` for a runtime import? | **No.** It is already `peerDependencies: workspace:^` (plus dev), and `peerDependencies` is one of the three sections an installed consumer receives — the same rule `verify-import-integrity` enforces (`SHIPPED_SECTIONS`). A runtime import of `compileTaskProfile` from `dsh-run/src` therefore needs no manifest change, and the gate I wrote will not flag it. Measured rather than assumed because the answer decides whether U touches a manifest at all. |
| Which API writes the profile body? | `Session.append<T>(type, data, ...opts)` (`core/session/src/index.ts:692`), typed by `SessionEventMap`, reachable as `agent.session.append('run/task-profile', { ref, profile })`. It **validates and snapshots the payload at the append site** — `snapshotJsonValue` returning `undefined` throws "carries non-JSON-serializable data" — so the event's JSON-only discipline is enforced where it is written, not at a later flush. `opts` is required only for `SurfaceEventType`, and that union is three members (`user/message`, `assistant/message`, `tool/result`); `run/task-profile` is log-only, so it takes none. |
| Does a new log-only event need registration anywhere else? | **No, and this was worth checking because the ledger warned about it.** P4-01's row carries a `planError` saying `run/*` types must reach `core/session`'s closed list and that plugin-side event registration does not work. The closed list is `KNOWN_SESSION_EVENT_TYPES`, and it is GENERATED from in-repo `SessionEventMap` members — already regenerated for this event. Beyond it: `SURFACE_EVENT_TYPES` is a closed runtime set of three and this event is not one; the per-event validation switch in `session/src/invariant.ts` ends in a `default:` rather than `assertNever`, so a log-only event needs no case. Nothing else registers events. |
| Where does the `accepted → planning` transition get driven from? | `RunPlugin`'s `agent/pre-step` listener (`run/run/src/index.ts:862`), which already calls `ensureRunning(agent)` there. The listener is a waterfall returning `Promise<PreStepDecision>`, so the async `RunService.advance` can be awaited inside it. "First pre-step" needs no new flag: `ensureRunning` already distinguishes it as `agent.lifecycle?.state === 'queued'`, and reusing that marker keeps one definition of "about to take the first model step" instead of two. |

## What the payload can be built from, at that point

All of it is on the `agent/pre-step` payload or the `Agent` handle — no new service injection:

- `messages: UserMessage[]` — the messages taken from the inbox for this step. `goalRef.messageId` is `message.id`; `origin` is `taskOriginOf(message.source)`; the goal text is the message's text block. The existing flattening idiom is `agent-loop/src/runtime-context.ts:23`: a single `text` block yields its text and anything else yields `undefined`. **A multi-block or image-bearing first message therefore has no goal text under that idiom**, which is open question 2.
- `budget` — `agent.options.budget`.
- `identityKnown` — `agent.identity !== undefined`.
- `workspaceTrust` — `@deepseek-ai/dsh-workspace-trust-local` IS mounted in the base bundle (`cordis.patch.yml:351`), so a trust state is obtainable in the shipped profile.

## A defect in my own P-stage code, found by measuring rather than by running it

`undeterminedSideEffect` does `const trust = input.workspaceTrust ?? 'untrusted'` and writes the result into the rationale as `workspace trust is untrusted`. That is wrong in the one case it exists for: when no trust state was supplied the truth is **unmeasured**, not untrusted, and the rationale would state a fact the compile does not have. Defaulting the *behaviour* closed is right; describing the default as if it were an observation is the same error as a comment asserting what the code does not do.

The fix belongs to P, before its freeze: keep the fail-closed default for any decision, and have the rationale say `workspace trust was not supplied` when the field is absent. The P stage's frozen case for the trust rationale must then cover both spellings, and the mutation is collapsing them back into one.

**Done, in the uncommitted P code:** the two spellings are separate, the id token uses the same word as the sentence so a reader matching one against the other lands on the same case, and a case asserts both halves — the absent state says "was not supplied" and does NOT say "untrusted", AND the class is still `unknown-default` at confidence 0, because asserting only the wording would leave room for a version that distinguishes them and stops failing closed. The named mutation was run: collapsing the spellings back into one reddens that case alone, 44 others green.

## Open questions this preFlight does NOT settle

1. **Is the profile appended before or after the Run event, and what happens if the second fails?** The session append is synchronous and validated; `advance` is async and can be refused (`RunTransitionDecision.accepted === false`). Appending the body first and then failing to reference it leaves an orphan profile in the log; advancing first leaves a Run event naming a digest whose body never landed. Neither is obviously worse, and the choice is a durability decision rather than a coding one.
2. **What is the goal text of a first message that is not a single text block?** Under the existing idiom it is `undefined`, which my compiler turns into an `empty-goal` refusal — so an image-led task would silently produce no profile. Refusing is safe and may be wrong; the alternative needs a rule for flattening multi-block content that no clause states.
3. **Does a resumed or compacted session re-compile?** `agent/session-start` carries `'resume' | 'clear' | 'compact'`, but the compile is driven from the first `agent/pre-step`, which also fires after a resume. Re-compiling the same goal is harmless by construction — the same input yields the same `TaskProfileRef`, so the revision chain sees no new revision — but appending a second identical `run/task-profile` event is a real log entry. Whether to skip when the ref is unchanged is a small decision with a visible consequence in every snapshot.

---

## Snapshot impact, measured before any refresh is run

The U stage appends one `run/task-profile` event per agent, so every keyless snapshot whose fixture reaches a first model step grows. Counted rather than estimated, because "a line per fixture" and "a line per goal" differ by a factor this corpus actually exercises.

**The unit is one session log, not one fixture and not one goal.** The compile fires at the first `agent/pre-step` of an agent, which `ensureRunning` identifies as `lifecycle.state === 'queued'`. A second user goal later in the same session does not re-enter that state, so it adds no second line; a subagent, which is its own session and its own agent, does.

`dsh-run` is mounted for every one of them: `cordis.patch.yml:596` mounts it in base, headless is "directly over dsh-base", and none of the four app profiles disables it. All 135 fixtures run with the Run Service present.

| | count |
|---|---|
| snapshot fixtures | 135 (session 76, web 35, sdk 16, acp 8) |
| session logs inside them | 147 |
| **logs that gain exactly one `run/task-profile` line** | **134** — session 90, sdk 20, web 19, acp 5 |
| logs that gain nothing | 13 |

**The 13 that gain nothing, by reason — and two of the reasons are findings rather than bookkeeping:**

- **6 logs have no `user/message` at all.** Nothing to compile; these are fixtures that assert on startup or on a surface that never runs a turn.
- **6 logs whose first message is a user goal that is NOT a single text block.** Under the existing flattening idiom (`agent-loop/src/runtime-context.ts:23`) the text is `undefined`, so my compiler refuses with `empty-goal` and no line appears: `acp/image-compaction`, `sdk/inline-image-prompt`, and the first child log of `sdk/subagent-continuable`, `subagent-continuable-inheritance`, `subagent-list-agents`, `subagent-send-message`. **This is open question 2 with names attached** — `inline-image-prompt` exists precisely to exercise an image-led prompt, and under the current design it is the one kind of real task that produces no profile at all.
- **1 log whose first message has `source.kind === 'goal'`.** That is the goal plugin's admitted continuation round (`GoalMessageSource`, `goal-round-driver/src/index.ts:178`), and `user/message`'s own JSDoc lists "an entered goal continuation round" alongside a direct human prompt as a user-role message. **My `taskOriginOf` maps it to `unknown-source`, so it is silently not a task.** The fail-closed default behaved exactly as designed and excluded something that looks like a human goal. Whether `goal` should map to `user-goal` is a product decision I am not taking — it is raised as question 4 below.

**The `--record` acceptance criterion, as ORIGINALLY written and then corrected by the run.** The first form was: the diff must add exactly 134 lines, every one a `run/task-profile` event, with no existing line changed, moved or disappearing. Re-measured on the rebased tree it became 141. **Both were wrong in the same way, and the run is what showed it: inserting an event into an append-only log RENUMBERS every later seq reference**, so "no existing line may change" cannot hold for any insertion that is not at the end. The delegate ruled the renumbering an inherent consequence rather than a defect, and the criterion is restated below in the shape the tree actually takes.

**The criterion, restated and measured (2026-09-11, delegate note 37):**

| clause | measured |
|---|---|
| **N** `run/task-profile` lines added | **128** — 121 in session logs, 7 in the SDK's `notifications.expected.jsonl` mirrors |
| session logs that gained at least one | **119** |
| **M** lines rewritten, and ONLY by seq renumbering | **1009** |
| **F**, the fields that renumber | `seq` (461), `sourceEventSeqs` (6641), `messageSeqs` (128), `throughSeq` (10), `start`/`end` (5 each), `shadowedSeqs` (3), plus `seedLength` (2) and `dt` (5) |
| every changed integer rose, by at most the file's insertion count | delta histogram **{+1: 7176, +2: 84}** — no value fell, none moved further |
| anything else | **0 unexplained**; the 14 residuals are the four named classes below |

**Why 119 and not 141**, itemised, because the gap is not slippage:

| | count |
|---|---|
| session logs that would gain, by first-message classification | 141 |
| − `snapshots/web/*`, driven by `apps/web/tests/*.e2e.ts` and **not by this suite at all** | −20 |
| − `error-finish`, which refuses to overwrite a failure-shaped run (BLOCKED-127) | −1 |
| − `session-query-spill`, excluded (BLOCKED-202) | −1 |
| **= gained** | **119** |

**The four residual classes, none of them a behaviour change:**

1. **`argumentsHash`, 8** — a run-nondeterministic digest; see BLOCKED-202's second observation.
2. **`data.dt[…]`, 4** — timing deltas, which may fall as well as rise.
3. **A seq embedded INSIDE a string, 1** — the title prompt carries `"seq":7` in its text, so the renumbering shows up as a string difference.
4. **`cordis-inspect-jsdoc`, 1** — the inspect payload gained `taskProfile?: Branded<'TaskProfileRef'>` on `Agent` and a new `TaskProfileRef` entry. **Checked leaf by leaf against this slice's own edits: those two and nothing else.** A legitimate refresh of a live type catalog.

**What proved it**, and what the instrument got wrong twice before it did. A one-off comparator (not committed) pairs the old and new lines of every changed file and diffs them structurally, admitting a difference only when it is an integer that rose by at most the file's insertion count. Its first version reported **657** violations because it looked for the inserted event at the top level, missing the SDK's `params.event` wrapper and pairing every later line against the wrong predecessor. Its second reported **115**, because it kept one shift counter per file while `subagent-spawn-in-process` merges a parent and a child whose session ids the normalizer collapses to one `{{sessionId}}` placeholder — so which stream a line belongs to is **not derivable from the file**, and the honest model is the bounded one above rather than an exact per-line shift.

## Open question 4, from the snapshot measurement## Open question 4, from the snapshot measurement

**Is a `goal`-source continuation round a task?** `user/message`'s documentation treats it as one of the three user-role messages; `GoalMessageSource` carries `goalId`, `revision` and the admitted `round`. If it is a task, `taskOriginOf` needs a fourth case and the goal's own identity probably belongs in the profile's provenance rather than being discarded. If it is not, a human-entered goal round runs without a profile, which is defensible only if something else compiles one for the goal itself. P4-14 owns cron-triggered tasks and may own this too. One fixture in the corpus sits on this question today.
