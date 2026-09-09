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

## Status

**No code written.** Submitted for review. `detached` follows this slice or lands with it.
