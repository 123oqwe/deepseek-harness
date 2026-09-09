# preFlight — P4-09 must[3]'s capability-token noun

Per §12.66's ordering: **this slice lands before `detached`, or both land together.** A detached run that outlives its turn with no answer to what authorizes it would look complete while being worse than the current gap.

Measured at `94f577f99c`.

## The finding this closes, and the two nouns it does not

BLOCKED-100's must[3] entry names three nouns. Re-measured per 4.4c:

| noun | state | evidence |
| --- | --- | --- |
| budget | **present** | `workflow-registry/src/nesting.ts` derives a nested run's worker limits from its parent's |
| capability token | **zero** | no `capabilityToken`/`CapabilityToken` anywhere in `packages/workflow/*/src` |
| trace | **zero** | the only `trace` hits are a local `Map` of invariant state at `tool-workflow/src/invariant.ts:56` |

This slice closes the middle row only. `trace`'s owner is P7-07, which has not started; it is recorded imported-PENDING in the P4-04/DSSE form rather than built here, and the run exposes the fields a trace context will occupy (parent run id, placeholder) so the shape does not have to change when P7-07 lands.

## make-vs-use — no new mechanism, and no second derivation

§12.66 rules the derivation reuses what P2-02 already ships, and it is a real production path rather than a surface:

- `CapabilityTokenService.attenuate(parent, request)` (`policy/capability-token/src/index.ts:330`) delegates to `attenuateToken`, records the child, and appends its redacted audit record **only when the decision accepts** — a refusal writes nothing at all.
- `subagent/subagent/src/child-agent.ts:306` DEFINES `attenuateDelegatedToken`, whose doc states the discipline this slice inherits: it **computes a request and never a grant**, so the two ways a child could widen — a filter naming a tool the parent lacks, or a request raising budget or expiry — are refused by the same checked path, "not by a second copy of the rule here".

> **CORRECTION.** An earlier revision of this section said `child-agent.ts` "already calls it to mint the token a child agent runs under", and that a nested run would therefore reuse "the same derivation a child agent uses". **False, and measured false.** `child-agent.ts` DEFINES that function; every reference to it outside its own module is in `subagent/tests/capability-token-delegation.spec.ts`, and `.attenuate(` has **zero** production callers anywhere in `packages/`. I read the function's JSDoc — "mint the Capability Token one child agent runs under" — as evidence of a caller. That doc states INTENT, and intent is not reach: it is the precise error 4.4a exists to catch, made while writing a document whose own purpose is to apply 4.4a.

**What this changes.** This slice is not "add another consumer beside the subagent one". It would be the **FIRST production consumer of P2-02's attenuation path**, which makes it more valuable and also leaves it no precedent to copy — the discipline above comes from a doc comment, not from a working call site to imitate.

**And it raises a question about P2-02 that is not mine to answer.** P2-02 is ACCEPTED with zero open findings. Its VERIFICATION half genuinely has a production consumer — `core/tools/src/index.ts:28` imports `assertTokenPresented` for the `requireCapabilityToken` path. Its ATTENUATION half does not. Whether P2-02's delegation clauses were signed against a subject with no production caller is a question for the delegate, and it is recorded here rather than assumed either way.

## What this slice adds

The workflow runtime holds no token today. It must:

1. Carry the parent's `SignedCapabilityToken` into `planNestedRun`/the run launch.
2. Call `attenuate` with a request narrowed to what the nested or detached run may do.
3. Refuse the run when the decision's `accepted: false` arm fires, surfacing `TokenAttenuationDenialReason` rather than starting unauthorized work.
4. Carry the child token on the run, so a detached run still has an authority after its launching turn is gone.

## Clause subjects and stage

| clause | stage | note |
| --- | --- | --- |
| must[3]'s capability-token noun | **U** for P4-09 | The decision already exists and is proven in P2-02's Contract stage. What is missing is a CONSUMER in the workflow runtime, which is a Usage-stage fact. Adding a second decision module would be the defect, not the fix. |

## Cases to freeze — split by dependency (§12.69)

**This slice (U supplement) freezes only what it can observe on its own.** An earlier draft listed four cases, two of which need `detached` to exist; freezing those here would make this slice's observation red for a reason belonging to the next one.

| # | case | slice |
| --- | --- | --- |
| 1 | a nested run's token is derived from its parent's and is NARROWER — the accepted arm | **token** |
| 2 | a request that WIDENS is refused, surfacing `TokenAttenuationDenialReason` — the negative control that separates deriving from minting | **token** |
| 3 | a detached run still carries its derived token after the launching turn ends | detached |
| 4 | handing a LIVE run to `resume` is refused because its lease holder is current | detached |

Case 4 stays §12.66's requested boundary test and remains necessary: measured at `workflow-worker-thread/src/index.ts:298`, `resume` reconciles then `launch(...)`, so without it the re-attach path spawns a second worker under one run id — two masters, from inside the epic meant to prevent them. It belongs to the slice that introduces re-attachment, not to this one.

Mutation expectations for THIS slice, to be RUN and pasted rather than predicted (§12.68): removing the widening check must redden case 2.

## Reuse, not a second derivation (updated after P2-02.U landed `deriveChild`)

The four steps above were written when the only way to derive was to call `attenuate` directly. P2-02.U has since put that decision behind ONE production entry point — `capabilityTokens.deriveChild(parentSession, childSession, filter)` on the service contract declared in `@deepseek-ai/dsh-capability-token` — and a workflow run calling `attenuate` itself would be the second answer to "may this child hold this authority" that the lift exists to prevent.

So this slice consumes that entry point instead of steps 1–3:

- The nested run's child session derives from the launching session, under the run's own restriction as the filter. The provider resolves the parent's CURRENT token, applies `delegatedChildResources`, and records the child through `service.attenuate` — which is what keeps `lineageOf` able to walk to it, without which acceptance[1]'s revocation check is blind to nested runs.
- The refusal in step 3 stays this slice's to surface: `deriveChild` reports its failure through `issuanceError(session)`, and the run must refuse rather than start unauthorized work. A run that started anyway on a failed derivation would be the same "looks enforced, enforces nothing" shape P2-02's withdrawal was about.
- Step 4 (a detached run keeping its authority after the launching turn ends) is unchanged and still belongs to the `detached` slice.

**What this slice must NOT do:** call `attenuate`, `attenuateDelegatedToken`, or `issue` directly. Those are the definition package's, and the provider is the only production caller.

## Measured before writing: a nested run has NO session, so there is nothing to derive TO

The four steps above, and the rewrite under them, both assume a nested run is a session that can be a `deriveChild` child. Measured, it is not.

- `startNested` (`workflow-worker-thread/src/index.ts:365`) admits the run, then `launch(...)` with `parent: parent.parentAgent` (`:381`) — the SAME `Agent` as the parent run. No session is created for a run anywhere in the package: `withInitiator`, `createSession` and `SessionId` do not appear in `host.ts`.
- Model work happens one level down. `startChild` (`host.ts:459`) calls `this.subagents.start(this.provider, { prompt, parent: this.parentAgent, … })`, and it is THAT child which gets a session — the path P2-02.U already wired, where `applyChildComposition` calls `deriveChild(parent.id, composition.childSession, composition.toolFilter)` (`child-agent.ts:263`).

So the derivation this slice was going to add already runs, once per child session. What does NOT happen is the DECAY must[3] names: `startChild` passes no `toolFilter`, so a child of a nested run holds exactly the authority a child of the root run holds. Budget and worker limits decay through `planNestedRun`/`inheritWorkerLimits`; the capability token does not decay at all. That, not a missing derivation, is the gap.

**`ChildStartRequest` has no `toolFilter` field, and must not gain one.** Its fields are `prompt`, `schema`, `provider`, `model` (`types.ts:52`). The request crosses the port FROM the worker, and a worker script naming its own filter would be choosing its own authority. The bound is the HOST's to apply, from the run's own nesting state, exactly as the host already decides admission because it is the side that holds the budget.

The seam needs no new mechanism: `SubagentStartRequest.toolFilter` already exists (`subagent/src/types.ts:148`) and already flows to `deriveChild`. This slice makes the host pass it.

## Ruling received: the definition declares the bound (reading 2) — and one measurement it depends on

Ruled: the registered definition declares the tools its run may use; `planNestedRun` computes `bound = parent bound ∩ declaration`, an absent declaration inherits the parent's unchanged, recursion intersects at every level, and the bound travels with `budget`/`ancestors` in the run's state. The host's `startChild` passes it as `toolFilter`, reaching the existing `deriveChild`. `ChildStartRequest` gains nothing. A caller-side narrowing at the `workflow()` hook is a later addition, not must[3]'s.

The ruling's strength is that a re-registration cannot widen, which holds only if the declaration is covered by the digest. **Measured, there is no place in the digest for it today.**

- `computeDigest` hashes the BODY and nothing else: `sha256(body)` at `workflow-registry/src/version.ts:28`. `RegisteredDefinition`'s other fields — `name`, `version`, `signer` — sit outside it. A sibling `tools` field would too, so the same body could be re-registered under another name with a wider declaration and produce the same digest.
- The declaration cannot ride `meta` either. `meta` is a closed field set (`name`/`description`/`whenToUse`/`phases`, `meta.ts:19`) that arrives on the REQUEST, and the body is explicitly forbidden from carrying it: `assertBodyParses` throws "workflow meta rides the `meta` request field, not the script" when `META_STATEMENT` matches (`workflow-worker-thread/src/index.ts:110`). For a nested run the host builds `meta` itself (`:379`), so nothing in it is signed by the digest.

So making the ruling true requires the digest to cover the declaration: `computeDigest` hashes a canonical `(body, tools)` pair rather than the body alone. That is a format change — every registered digest changes — which the pre-release stance permits and prefers over a shim, but it is not a detail to slip in under a `tools` field: the identity of a definition would now include what it may do, which is the property the ruling is buying.

## The one choice I am not making alone

Where a nested run's bound COMES FROM. Two readings, and they differ in observable behavior:

1. **Inherit-and-intersect.** The nested run's restriction is the parent run's, intersected with anything the nesting declares. Symmetric with budget decay, and a nested run can never widen. But no field carries a declaration today — `NestedStartRequest` is `name`/`digest`/`args` (`types.ts:122`) — so under this reading the first version decays nothing measurable at depth 1, and the case that proves it needs depth ≥ 2 with a declared narrowing.
2. **Definition-declared.** The registered definition declares the tools its run may use, and the host intersects that with the parent's. The digest already fixes the body, so the declaration is signed with it and a run cannot widen by re-registering. This adds a field to the definition and touches `workflow-registry`, which is in P4-09's `files` list.

Reading 2 gives must[3]'s "衰减" something to decay at every depth and puts the declaration inside the signed artifact must[0] already requires. Reading 1 is smaller but risks freezing a case that observes an intersection of two identical sets, which is the "the mechanism exists but is never reached" shape 4.4a exists to catch.

**Not choosing between them here.** §12.62's lesson is that writing the code first is how a hand-rolled answer gets ahead of the ruling.

## Status

**No code written.** The measurement above supersedes steps 1–4 and the `deriveChild` rewrite; both were written against a session that does not exist. Awaiting the ruling on the bound's source.
