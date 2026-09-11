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

## Open questions this preFlight does NOT settle

1. **Is the profile appended before or after the Run event, and what happens if the second fails?** The session append is synchronous and validated; `advance` is async and can be refused (`RunTransitionDecision.accepted === false`). Appending the body first and then failing to reference it leaves an orphan profile in the log; advancing first leaves a Run event naming a digest whose body never landed. Neither is obviously worse, and the choice is a durability decision rather than a coding one.
2. **What is the goal text of a first message that is not a single text block?** Under the existing idiom it is `undefined`, which my compiler turns into an `empty-goal` refusal — so an image-led task would silently produce no profile. Refusing is safe and may be wrong; the alternative needs a rule for flattening multi-block content that no clause states.
3. **Does a resumed or compacted session re-compile?** `agent/session-start` carries `'resume' | 'clear' | 'compact'`, but the compile is driven from the first `agent/pre-step`, which also fires after a resume. Re-compiling the same goal is harmless by construction — the same input yields the same `TaskProfileRef`, so the revision chain sees no new revision — but appending a second identical `run/task-profile` event is a real log entry. Whether to skip when the ref is unchanged is a small decision with a visible consequence in every snapshot.
