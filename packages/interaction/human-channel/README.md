---
description: "Human-interaction channel vocabulary for Epic P2-12: the five control verbs, the durable stop record only an explicit resume lifts, the waiting point an answer may be routed by, and the approval grant a question's answer cannot produce."
kind: "package"
---

# @deepseek-ai/dsh-human-channel

English | [中文](README.zh.md)

`dsh-human-channel` fixes the words for two things a long-running task needs and this harness had no vocabulary for: stopping everything new, and suspending to ask a human a question that is not a permission request. It also holds the stop's durable record (`./store`), because a stop that does not outlive its process is not the thing acceptance[2] asks for. It holds no service and no answerer: the channel that composes the decisions is `@deepseek-ai/dsh-control-plane/channel`, and wiring the answerers that already exist is the Usage stage. Read it when writing a control surface, or when deciding what answering a question is allowed to authorize.

## Contents

- [Why a stop is a record and not a flag](#why-a-stop-is-a-record-and-not-a-flag)
- [An answer is input, never a grant](#an-answer-is-input-never-a-grant)
- [The waiting point is the only routing key](#the-waiting-point-is-the-only-routing-key)
- [`kill-execution-world` is specified and not implemented](#kill-execution-world-is-specified-and-not-implemented)
- [The stop record on disk](#the-stop-record-on-disk)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="why-a-stop-is-a-record-and-not-a-flag"></a>
## Why a stop is a record and not a flag

acceptance[2] says the stop survives a restart and must be lifted explicitly. A boolean cannot carry that: restored from disk it is indistinguishable from a default, and "must be lifted explicitly" is not a property a value can have unless lifting it is a transition over that value. So `StopRecord` carries the requester, the reason and the release that is permitted, `ControlState` is the record's presence or absence, and `resume` is the only verb that releases — `cancel-run` ends work and leaves the stop standing, because ending a run is not a statement that new work may start.

`release` is a field with one value today rather than an implied rule, so a later automatic release — a deadline, a policy re-evaluation — is a new value here instead of a second code path that happens to clear the record.

<a id="an-answer-is-input-never-a-grant"></a>
## An answer is input, never a grant

must[3] separates questions from approvals, and the separation is enforced by what is absent. `HumanAnswer` has two fields — the waiting point and the text — and nothing an approval path can consume: no decision, no boolean, no verdict. Authority is carried by `ApprovalGrant`, branded with a module-private `unique symbol`, so no answer can be widened into one and no value cast from JSON can inhabit the type. A shared `approved` field would have made the separation a rule about who reads it, which is the kind of rule that holds until someone reads it differently.

<a id="the-waiting-point-is-the-only-routing-key"></a>
## The waiting point is the only routing key

`WaitingPointId` is opaque and required on both the question and the answer. An answer routed by anything coarser — the asking child, the session, the agent — satisfies whichever question that coarser key happens to name, and with two outstanding that is the wrong one. BLOCKED-215 is the record of the same seam built with the destination optional: the delivery callback was an optional third constructor parameter that production omitted, the only entry designating a destination had zero production callers, and the guard checking it could never fire. Here the destination is a required parameter of the question and `AnswerDelivery` is a required field, so neither absence type-checks.

<a id="kill-execution-world-is-specified-and-not-implemented"></a>
## `kill-execution-world` is specified and not implemented

must[0] lists five verbs and this package names all five, but the world reference is an opaque `WorldRef` rather than P3-01's `WorldHandle`. P3-01 owns what an execution world is; importing it would make this vocabulary wait on that one's, and restating it here would create a second definition. The verb is refused as `verb-unimplemented`, which a caller can read — a silent no-op would report the world as killed.

<a id="the-stop-record-on-disk"></a>
## The stop record on disk

`openStopStore(directory)` keeps one `emergency-stop.json` and replaces it atomically: the document is written to a temporary file in the same directory and renamed over the target, because a partially written stop record is the one state a recovering process must never read. `read()` returns the record, so a channel built over a store that holds one comes up stopped with nothing re-applying the stop, and `write()` returns only once the document is replaced — the record is durable before any caller is told the stop is in force, for the same reason P4-12 writes its reservation before the send.

An unknown `version` is refused at `read()`, naming the path and both versions. That is the repository's pre-release stance and BLOCKED-221's precedent; a record this build cannot read might be a stop in force, so guessing either way is worse than refusing. A MISSING document is not a failure: it reads as "no stop", which is the ordinary first boot.

## Model Experience

None, as this package exports types and one durable record store and registers no tool, prompt text or session event.

#### KV Cache effect

Nothing here enters a model request. A question reaches a model only through the asking tool's own result, and a refusal carries a closed reason code rather than a record or a principal.

## Known Limitations and Deferred Work

- **Nothing mounts this yet.** There is no Cordis service and no answerer here, and no production code imports either package, so no case is evidence that a stop reaches a worker. must[2]'s gate lands on `packages/run/lease/src/plugin.ts`, which reads no stop state today; wiring it is the Usage stage.
- **The stop record is not registered with P0-06's schema registry.** P0-06's must literally covers every persistent object, and this is one. It is not registered, by ruling: doing it inside this stage would touch another epic's semantic surface and create two sources of truth for one version number, since the file already carries its own. The whole-repo production caller count for `registerSchema` is one (`settings/src/index.ts:455`), and P4-12's SQLite store is unregistered for the same reason — so this is a discipline that is declared and has no enforcer, not a gap specific to this package.
- **One surface can answer a question today, and this package does not add another.** Measured on P2-12's own two hooks: approvals have two answerers (ACP and Web), questions have one (Web). Per the ruling on this epic's second open question, P2-12 wires the answerers that exist and creates no CLI or ACP question answerer, so the ACP `elicitation_create` standard stays adopted in name for questions. A surface with no answerer fails closed, which both existing services already do.
- **`ApprovalGrant` is declared here and minted nowhere.** The brand makes it unforgeable; what mints it is the approval seam, which this package does not contain. Until that lands, the type documents the separation rather than carrying a real grant.
- No runtime invariant companion is published: this package holds no state and observes nothing, so there is no owned relation two observers could disagree about.
