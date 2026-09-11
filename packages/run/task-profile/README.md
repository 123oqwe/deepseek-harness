---
description: "The generic compiled task profile for Epic P4-02: a reference back to the user goal rather than a copy of it, constraints that each carry their own source and confidence, a side-effect classification borrowed from P2-04 that has no way to call an unknown effect harmless, and questions carried as data instead of guesses."
kind: "package-library"
---

# @deepseek-ai/dsh-task-profile

## Summary

`dsh-task-profile` holds the vocabulary Epic P4-02's must[0] fixes — a goal reference, an objective, hard and soft constraints, one side-effect classification, and the questions a compile produced instead of guessing — together with the validation that vocabulary needs at a durable boundary and the content-addressed reference the Run event log names a profile by.

`src/types.ts` carries the types and the `run/task-profile` session event the profile itself lives in; `src/validate.ts` carries the schema, the two clause rules a shape cannot express, and `taskProfileRef`; `src/index.ts` carries `compileTaskProfile`, the one runtime export — a pure, total function with no clock, no I/O and no policy. `tests/profile.spec.ts` covers them. `spec/task-profile.schema.json` is the same requirements in P0-06's JSON Schema 2020-12 family, for readers outside TypeScript.

## Table of Contents

- [What this package imports rather than declares](#what-this-package-imports-rather-than-declares)
- [What is deliberately absent](#what-is-deliberately-absent)
- [What the compiler reads, and what it refuses to](#what-the-compiler-reads-and-what-it-refuses-to)
- [Where a profile lives](#where-a-profile-lives)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## What this package imports rather than declares

Four of the five decisions in this contract are about NOT minting something.

`TaskSideEffect` carries P2-04's `RiskClass` and `RiskGroundKind`. That import is what makes acceptance[2] — an unknown side effect is never marked `none` — true by construction: `RiskClass` has eight members and none of them is `none`, so there is nothing for an unknown effect to be marked with, and `RiskGroundKind`'s `unknown-default` already tells a class nothing decided apart from one a rule decided. A locally declared side-effect enum with a `none` member would reopen precisely the hole the clause names.

`TaskGoalRef` is a `SessionId` and a `MessageId`, both already owned elsewhere, pointing at the `user/message` event the profile was compiled from. must[1] asks the profile to keep the original goal *reference*; a copy of the goal text would be a second record of a durable fact with no way to notice when the two disagree.

`TaskGoalRef.goalRound` carries the goal domain's own `GoalId` for a message that continues an entered goal, which is why this package takes a type-only dependency on `@deepseek-ai/dsh-goal` — the `goal` member of `MessageSourceMap` is declaration-merged there, and without that file in the program `taskOriginOf` cannot have a case for it at all. The identity sits on the goal *reference* rather than on each `InferenceProvenance`, so it reaches every inference while existing once.

`taskProfileRef` canonicalizes through P2-03's `canonicalizeArguments` (RFC 8785 JCS). This repository has already decided what its canonical JSON form is, and a second one would let the same profile carry two different references depending on which module hashed it.

The one thing this package does mint is `TaskProfileRef`, and it mints it here rather than in `@deepseek-ai/dsh-run` — the reverse of that package's five `*Ref` brands, which it had to declare locally because none of their owners existed yet. The dependency edge runs one way: `dsh-run` reads this type, and this package reads nothing of `dsh-run`.

## What is deliberately absent

**There is no task-kind field.** validation[0] asks for fixtures over four task kinds — code, research, external action, personal plan — and those four are test inputs, not a member of the contract. A closed four-member union on the type would be a taxonomy of tasks baked into a profile whose entire subject is being generic, and a fifth generic task shape would have nowhere to go.

**Questions are data, not a call.** must[2] says an ambiguous or high-risk missing field produces a question rather than a guessed authorization. The `ctx.userQuestions` seam blocks on an answerer, and acceptance[0] requires the same input to produce the same profile, so a compiler that asked a human inside the compile step would return different profiles depending on who was at the keyboard. `TaskQuestion` is carried in the profile and asked by a consumer that is allowed to wait.

**There is no model here.** `compileTaskProfile` performs no natural-language inference: a constraint nobody stated does not become a constraint because the goal text hints at one. Model-assisted extraction belongs behind a provider in a later epic, because the moment it lands in this function acceptance[0]'s "same input, same output" stops holding.

## What the compiler reads, and what it refuses to

`compileTaskProfile` is the package's one runtime export and takes a closed `TaskProfileInput`: the goal message's reference, its text, what kind of message it was, the budget the composition stated, the workspace trust state, whether an acting identity is attached, and a tally of the message parts the text does not include. A closed input is what makes acceptance[0] checkable — a function that could reach a clock, a filesystem or a model would not have "the same input" twice.

It is pure and total. It never awaits, and it returns a refusal rather than throwing: `not-a-task` for every message that is not a direct human goal (injected plugin context, most of them), `empty-goal` for a goal with no text at all.

It does NOT take a `RiskPolicy`. Classification is the business of a consumer holding one, and taking a policy here would make the profile a function of the organisation as well as the goal. So every side effect it reports is P2-04's unknown default at confidence 0, accompanied by the question must[2] owes — and an `untrusted` workspace narrows the rationale without deciding the class.

Content the objective could not carry is asked about rather than dropped. A goal message whose text is only part of it — an image-led prompt, say — compiles from the text that is there, and the tally of unread blocks becomes one more question naming their kind and count. Refusing such a message instead would have meant the one real task shape with no profile was the one a fixture was written for.

## Where a profile lives

A profile's body is a `run/task-profile` session event; the Run event log carries only a `TaskProfileRef` to it. That split follows every other entity P4-01's Run events reference — an event names an approval or an artifact, and their bodies live with their owners — and a TaskProfile's owner is the session, because it is compiled from a message in that session's log and means nothing outside it.

Persistence and revision (validation[2]) are then the same mechanism. The session log is append-only, so a revised profile is a new event carrying the revised body, and a new Run event log entry referencing it. Nothing is edited in place, so the revision chain is recoverable by reading events in order, and the records cannot disagree about which profile is current.

The session event carries the body and no digest. A `TaskProfileRef` is the sha256 of a profile's canonical form, and a profile's `goalRef` names the session and message it was compiled from — ids minted fresh on every run — so a stored digest was a run-varying value in a durable log and the same recorded scenario could never replay to the same bytes. The ids themselves normalize; a digest taken over them before normalization cannot. `taskProfileRef` derives the digest from the body wherever one is needed, including the Run event log entry that references it.

## Known Limitations and Deferred Work

- **One caller, and it is the only one.** `@deepseek-ai/dsh-run`'s `RunPlugin` calls the compiler at an agent's first `agent/pre-step`, appends the profile as a `run/task-profile` session event, and names its digest in the Run's `accepted → planning` transition. Nothing reads those events back yet: putting a profile into a model request is P4-03's, and `validateTaskProfile` exists for that reader before it exists.
- **A profile is compiled once per agent and never amended.** The compile fires at the first model step, when the goal, the identity and the budget are all in hand; a constraint the user adds three turns later reaches no profile. Recompiling is how a revision would arrive, and the only recompile today is a resumed session's — which writes nothing when the profile is unchanged.
- **Two unread blocks of the same kind are indistinguishable from each other.** The tally carries kinds and counts, not the blocks, so the question says "2 image blocks" and cannot say which one is which. That is deliberate: carrying the content would put a second copy of the goal message in the profile, which is what `TaskGoalRef` exists to avoid.
- **`validateTaskProfile` checks the profile, not the goal it refers to.** A `TaskGoalRef` naming a session event that does not exist is structurally valid here; resolving it is a reader's business, and this package deliberately takes no session dependency at runtime to do it.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

The open question is what a deterministic parser may honestly extract. Today the answer is "only what arrives already structured" — a budget stated in `AgentOptions`, the workspace trust state, the goal message's own id — and everything else becomes a question. That keeps the compiler pure and `acceptance[0]` checkable, and it means the first profiles are mostly questions. Whether model-assisted inference ever reaches this package, or stays behind a provider in a later epic, is undecided; if it arrives here the purity this contract depends on goes with it.

The second open question is `TaskProfileRef`'s digest input. It covers the whole profile today, so a rationale reworded by a later compiler produces a new ref and a new revision for an unchanged decision. Narrowing the digest to the decision-bearing fields would make revisions mean more and would also make two profiles with different explanations indistinguishable. Neither is obviously right.

</details>
