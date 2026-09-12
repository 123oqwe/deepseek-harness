---
description: "Control-plane decisions for Epic P2-12: which control verb changes the stop state, whether a worker may take new work under a stop, and where one human answer goes — including the waiting points it must not reach."
kind: "package"
---

# @deepseek-ai/dsh-control-plane

English | [中文](README.zh.md)

`dsh-control-plane` holds P2-12's decisions as pure functions over a caller-supplied state: what a control verb does to a stop, whether new work may start, and where one answer goes. `./channel` composes them into the host-side surface — the registry of unanswered questions, out-of-band settlement, and a stop that is persisted and announced. The lease gate and the answerer wiring are Usage. Keeping the decisions separable from the composition is what lets a stop be injected before, during and after a tool start, which is validation[1].

## Contents

- [What the decisions return, and why](#what-the-decisions-return-and-why)
- [Check order is load-bearing](#check-order-is-load-bearing)
- [A settlement names what it did NOT settle](#a-settlement-names-what-it-did-not-settle)
- [The channel, and why it lives here](#the-channel-and-why-it-lives-here)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="what-the-decisions-return-and-why"></a>
## What the decisions return, and why

`decideControl` distinguishes `unchanged/already-stopped` from `unchanged/not-stopped` because an audit reads the transition rather than the resulting value: stopping an already stopped run and stopping a running one leave the same state and are not the same event. `resume` is the only verb that produces `released`, which is acceptance[2]'s "must be lifted explicitly" stated as a return type rather than as a convention.

`mayStartNewWork` is must[2] in one predicate, and it takes the control STATE rather than a flag the caller cached. The window must[2] closes is exactly the one where a worker decided it could proceed and then the stop arrived, so a gate consulting a value read earlier is a gate against the past.

<a id="check-order-is-load-bearing"></a>
## Check order is load-bearing

`decideAsk` checks the stop BEFORE the destination. A question is a new action, so a stopped run must be told `stopped` rather than told its waiting point is unknown — the second answer sends a caller to fix a registration that is not the problem. Within the destination check, a point that never existed and one that is gone are different refusals: the first is an asker and a router disagreeing about what exists, the second is a question whose asker has already left.

<a id="a-settlement-names-what-it-did-not-settle"></a>
## A settlement names what it did NOT settle

acceptance[1] is "an answer reaches only the waiting point that asked", which is a claim about the points it did not reach. So `decideSettlement` returns `stillOpen`, and a case with two outstanding questions can check the one that was not addressed; a decision returning only success would make the property unobservable from its own result.

A settlement for a vanished point is a typed refusal, never a no-op. A no-op is indistinguishable from success at the call site, which is how an answer that reached nobody reads as an answer delivered — and it is half of what BLOCKED-215 found in the same seam's previous build.

<a id="the-channel-and-why-it-lives-here"></a>
## The channel, and why it lives here

`createHumanChannel({ store, broadcast, delivery })` needs the vocabulary AND the decisions. This package already depends on the vocabulary, so composing here is one edge; putting the channel in `dsh-human-channel` would have made the two packages import each other — a cycle the module graph rejects, and a layering inversion besides, since a vocabulary that depends on decisions over it cannot be read on its own. All three options are required: a channel with nowhere to persist cannot keep acceptance[2], one that announces nothing cannot satisfy must[1], and one that cannot deliver an answer is BLOCKED-215's optional callback again.

The order inside `commit` is the contract: persist, then change the state, then announce. A report that outlives its record is a lie the next process cannot detect — every worker told to halt, and a file saying nothing was stopped. The registry is the channel's own rather than each surface's, because a per-surface copy of what is pending is acceptance[3]'s failure in miniature and is how one question answered twice looks reasonable to both answerers. A settled point moves to `closed` rather than simply leaving `open`, so a second answer for it is refused as vanished rather than as never registered: a surface that delivered twice and a surface that invented an id need different answers.

## Model Experience

None, as this package exports pure decisions and one host-side channel and registers no tool, prompt text or session event.

#### KV Cache effect

Nothing here enters a model request. A refusal reaches a model only through its enforcement point, which reports a closed reason code rather than a stop record or a principal.

## Known Limitations and Deferred Work

- **Nothing in production calls any of this.** The lease path (`packages/run/lease/src/plugin.ts`) reads no stop state, which is the measurement must[2] lands on, and no production module imports the channel. A reader must not take these cases as evidence that a stop reaches a worker; wiring is the Usage stage.
- **The broadcast is whatever the caller passes.** must[1] says the kernel broadcasts the stop, and this package deliberately does not know what the kernel is: it reports every transition to one injected listener. Handing it the kernel's own publish is Usage, and until then "broadcast" means "told the one listener the test supplied".
- **`kill-execution-world` returns a refusal rather than killing anything.** The verb is in must[0] and P3-01 owns what a world is; this package specifies the verb and refuses it as unimplemented so the gap is readable instead of silent.
- **`cancel-run` changes no control state here.** Terminating in-flight work or marking it reconciliation-required is acceptance[1]'s other half and belongs to P4-06's settlement outbox, which already exists; this module would duplicate it by deciding anything more than "the stop is unaffected".
- **The waiting-point registry is a parameter, not a store.** `WaitingPointRegistry` is two read-only sets the caller supplies, so nothing here can tell whether the sets it was handed match what actually exists. The Provider stage owns that registry, and the disagreement between asker and router is exactly what `unknown-waiting-point` reports.
- No runtime invariant companion is published: this package holds no state and observes nothing, so there is no owned relation two observers could disagree about.
