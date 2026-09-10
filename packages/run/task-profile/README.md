---
description: "The generic compiled task profile for Epic P4-02: a reference back to the user goal rather than a copy of it, constraints that each carry their own source and confidence, a side-effect classification borrowed from P2-04 that has no way to call an unknown effect harmless, and questions carried as data instead of guesses."
kind: "package-library"
---

# @deepseek-ai/dsh-task-profile

## Summary

`dsh-task-profile` holds the vocabulary Epic P4-02's must[0] fixes — a goal reference, an objective, hard and soft constraints, one side-effect classification, and the questions a compile produced instead of guessing — together with the validation that vocabulary needs at a durable boundary and the content-addressed reference the Run event log names a profile by.

`src/types.ts` carries the types and the `run/task-profile` session event the profile itself lives in; `src/validate.ts` carries the schema, the two clause rules a shape cannot express, and `taskProfileRef`. `tests/profile.spec.ts` covers them. `spec/task-profile.schema.json` is the same requirements in P0-06's JSON Schema 2020-12 family, for readers outside TypeScript.

## What this package imports rather than declares

Three of the four decisions in this contract are about NOT minting something.

`TaskSideEffect` carries P2-04's `RiskClass` and `RiskGroundKind`. That import is what makes acceptance[2] — an unknown side effect is never marked `none` — true by construction: `RiskClass` has eight members and none of them is `none`, so there is nothing for an unknown effect to be marked with, and `RiskGroundKind`'s `unknown-default` already tells a class nothing decided apart from one a rule decided. A locally declared side-effect enum with a `none` member would reopen precisely the hole the clause names.

`TaskGoalRef` is a `SessionId` and a `MessageId`, both already owned elsewhere, pointing at the `user/message` event the profile was compiled from. must[1] asks the profile to keep the original goal *reference*; a copy of the goal text would be a second record of a durable fact with no way to notice when the two disagree.

`taskProfileRef` canonicalizes through P2-03's `canonicalizeArguments` (RFC 8785 JCS). This repository has already decided what its canonical JSON form is, and a second one would let the same profile carry two different references depending on which module hashed it.

The one thing this package does mint is `TaskProfileRef`, and it mints it here rather than in `@deepseek-ai/dsh-run` — the reverse of that package's five `*Ref` brands, which it had to declare locally because none of their owners existed yet. The dependency edge runs one way: `dsh-run` reads this type, and this package reads nothing of `dsh-run`.

## What is deliberately absent

**There is no task-kind field.** validation[0] asks for fixtures over four task kinds — code, research, external action, personal plan — and those four are test inputs, not a member of the contract. A closed four-member union on the type would be a taxonomy of tasks baked into a profile whose entire subject is being generic, and a fifth generic task shape would have nowhere to go.

**Questions are data, not a call.** must[2] says an ambiguous or high-risk missing field produces a question rather than a guessed authorization. The `ctx.userQuestions` seam blocks on an answerer, and acceptance[0] requires the same input to produce the same profile, so a compiler that asked a human inside the compile step would return different profiles depending on who was at the keyboard. `TaskQuestion` is carried in the profile and asked by a consumer that is allowed to wait.

**There is no compiler here.** `compileTaskProfile` is the Provider stage's deliverable. This stage observes acceptance[0]'s stability over the reference a profile canonicalizes to, which is the property the Run event log depends on and the one a compiler must preserve.

## Where a profile lives

A profile's body is a `run/task-profile` session event; the Run event log carries only a `TaskProfileRef` to it. That split follows every other entity P4-01's Run events reference — an event names an approval or an artifact, and their bodies live with their owners — and a TaskProfile's owner is the session, because it is compiled from a message in that session's log and means nothing outside it.

Persistence and revision (validation[2]) are then the same mechanism. The session log is append-only, so a revised profile is a new event with a new `ref` and a `previousRef` naming what it revises, and a new Run event log entry referencing it. Nothing is edited in place, so the revision chain is recoverable by reading events in order, and the three records cannot disagree about which profile is current.

## Known limitations

- **Nothing writes these events yet.** The Provider stage adds the compiler and the Usage stage mounts it on `RunPlugin`'s `accepted → planning` transition; until then this package is a contract with tests and no production caller, which is the state its Contract stage is supposed to be in and not a claim that the epic is built.
- **`validateTaskProfile` checks the profile, not the goal it refers to.** A `TaskGoalRef` naming a session event that does not exist is structurally valid here; resolving it is a reader's business, and this package deliberately takes no session dependency at runtime to do it.
