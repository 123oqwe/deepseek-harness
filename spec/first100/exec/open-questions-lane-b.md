# Lane B's open questions, for the delegate in post

Seven questions lane B raised and did not answer, each with where it came from in bytes, the options with what each costs, and lane B's leaning **marked as a leaning**. Only the ones lane B measured itself are here; lane A's are lane A's to write, because it has the first-hand measurement and a second-hand summary is how a question gets decided on the wrong facts.

Numbering is by source document, which is unambiguous in the tree. Where the outgoing delegate assigned an OQ label, it is given.

---

## 1. Does the session append or the Run event come first, and what happens when the second fails?

**Source:** `preflight-P4-02-U.md`, open question 1.

`Session.append` is synchronous and validates at the append site (`core/session/src/index.ts:692`). `RunService.advance` is async and can refuse (`RunTransitionDecision.accepted === false`).

- **Append first.** A failed `advance` leaves a `run/task-profile` body in the log that no Run event references — an orphan that a reader can find but not attribute.
- **Advance first.** A failed append leaves a Run event naming a `TaskProfileRef` whose body never landed — a dangling digest, which is worse for anything that resolves references.
- **Neither, and make it one unit.** There is no transaction across the two stores, so this would mean writing the body, advancing, and on refusal appending a compensating event — a third record for a failure that may never occur.

**Leaning:** append first. An orphan body is inert and self-describing; a dangling digest makes a later resolver fail on a record that looks complete. But this is a durability decision and a wrong guess is expensive to unwind, which is why it is here.

## 2. What is the goal text of a first message that is not a single text block? (delegate's OQ2)

**Source:** `preflight-P4-02-U.md` open question 2, named by the snapshot measurement in the same file.

The existing flattening idiom (`agent-loop/src/runtime-context.ts:23`) yields `undefined` for anything but a single `text` block, and the compiler then refuses `empty-goal`. **Six real snapshot logs sit on this**: `acp/image-compaction`, `sdk/inline-image-prompt`, and the first child log of `sdk/subagent-continuable`, `-continuable-inheritance`, `-list-agents`, `-send-message`. `inline-image-prompt` exists to exercise an image-led prompt, so the one kind of real task that produces no profile is the one a fixture was written for.

- **Refuse, as today.** Safe, and an image-led task silently has no profile.
- **Concatenate the text blocks.** Needs a rule no clause states, and an image's absence from the text is then invisible in the profile.
- **Profile it with the text that exists and a question about the rest.** Consistent with must[2] — the missing part becomes a question rather than a guess — and it is the only option that keeps a profile for those six.

**Leaning:** the third. It follows must[2]'s own shape rather than inventing a flattening rule. But it makes `objective` partial in a way nothing else in the vocabulary marks, so it may need a field.

## 3. Does a resumed or compacted session re-compile and append a second identical event?

**Source:** `preflight-P4-02-U.md`, open question 3.

The compile is driven from the first `agent/pre-step`, which also fires after a resume. Re-compiling is harmless arithmetically — the same input yields the same `TaskProfileRef`, so the revision chain sees no revision — but the append is a real second log entry, visible in every snapshot of a resumed session.

- **Append anyway.** Simplest; every resume grows the log by one inert duplicate.
- **Skip when the ref is unchanged.** Needs the previous ref read back from the log, which makes the compile's caller read durable state.
- **Skip on `source === 'resume' | 'compact'`.** Cheapest, and wrong if a resume legitimately carries a new goal.

**Leaning:** skip when the ref is unchanged. It is the only one whose condition is the thing actually being avoided. The cost is that U's caller gains a read.

## 4. Is a `goal`-source continuation round a task? (delegate's OQ4)

**Source:** `preflight-P4-02-U.md` open question 4, found by the snapshot measurement.

`taskOriginOf` maps `source.kind === 'goal'` to `unknown-source`, so the goal plugin's admitted continuation rounds are not tasks. But `user/message`'s own JSDoc lists "an entered goal continuation round" alongside a direct human prompt as a user-role message, and `GoalMessageSource` (`goal/goal/src/domain.ts:47`) carries `goalId`, `revision` and `round`. One snapshot log sits on this today.

- **Leave it.** A human-entered goal round runs with no profile. Defensible only if something compiles a profile for the goal itself.
- **Map `goal` to `user-goal`.** One line, and the goal's identity (`goalId`/`revision`/`round`) should then reach the profile's provenance instead of being discarded — so not one line after all.
- **Give it its own origin.** Honest, and it needs a clause to hang on; P4-14 owns cron-triggered tasks and may own this.

**Leaning:** none. This is a product decision about what a task is, and lane B has no standing to lean. Flagging that the fail-closed default worked exactly as designed and excluded something that looks like a human goal is the whole contribution.

## 5. Does validation[2]'s persistence half belong to F or to U?

**Source:** `preflight-P4-02-F.md`, open question 1.

Persistence is the `run/task-profile` event, which U writes, so F cannot observe it in the package suite.

- **F freezes the revision arithmetic now, persistence later.** F's cell becomes honest sooner; one clause is split across two stages, which §12.46-B has precedent for.
- **F waits for U and freezes both.** The clause stays whole; F is blocked on U and the stage order inverts.

**Leaning:** the split, citing §12.46-B. A cell that is green on what it can observe and explicit about what it cannot beats a cell that waits.

## 6. Does `realized`'s unenforced status need an entry, and which remedy?

**Source:** `preflight-P4-02-F.md`, open question 2. Measured: `verify-make-vs-use.mjs:171`'s `REQUIRED` list has ten fields and `realized` is not one; no script reads it; the gate reports VERIFIED with the field filled, empty, or deleted.

- **Extend `verify-fields-are-read.mjs`'s `RECORD_PATHS`** to include `clause-subject-audit.json`. One line, and it surfaces `realized` plus whatever else sits beside it — a list that should be read before it is acted on.
- **Add `realized` to `REQUIRED`, F stage only.** Makes §4.3 true as written; needs the gate to know which stage an epic is in, which it currently does not.
- **Accept it as evidence for a human** and correct §4.3's wording so it stops implying a gate checks it.

**Leaning:** the first and the third together — widen the scan so the class is visible, and fix the sentence that overstates the gate. The second adds stage-awareness to a gate for one field.

## 7. Which stage may `acceptance-coverage` cite for P4-02's acceptance[0]? (delegate's OQ14)

**Source:** `evidence-P4-02.md`, the coverage pre-check section.

acceptance[0] is "the same **input** produces stable output under a deterministic parser fixture" — a statement about the compiler. C has no compiler; its two cases are about a profile's canonical digest, the property the compiler's determinism is observed through.

- **Cite P only**, with the C pair named in the entry's `note` as the digest property P depends on.
- **Cite both.** Predicate (i) could then close on cases that never compiled anything.

**Leaning:** cite P only. The whole purpose of that artifact is to keep a citation from claiming more than its case observes.

---

**Not in this list, and deliberately:** the questions the outgoing delegate already ruled (the mount point, the persistence medium, the files[]-vs-stages disagreement, whether questions are data, `PACKAGE_LIBRARIES` deferral, §12.83's withdrawal consequence). They are decided and recorded where they were decided; repeating them here would make a settled ruling look open.
