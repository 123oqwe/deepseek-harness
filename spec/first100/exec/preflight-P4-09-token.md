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
- `subagent/subagent/src/child-agent.ts:17,286+` already calls it to mint the token a child agent runs under. Its own doc states the discipline this slice inherits: the function **computes a request and never a grant**, so the two ways a child could widen — a filter naming a tool the parent lacks, or a request raising budget or expiry — are refused by the same checked path, "not by a second copy of the rule here".

A nested run and a detached run therefore go through **one** derivation, the same one a child agent uses. A second attenuation path would be the `circuit.ts` mistake in the security layer, where it is least affordable.

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

## Cases to freeze

1. A nested run's token is derived from its parent's and is narrower — the accepted arm.
2. **A request that widens is REFUSED**, with the denial reason surfaced: the negative control, and the one that distinguishes deriving from minting.
3. A detached run carries its derived token after the launching turn ends — the point of the ordering constraint.
4. **§12.66's negative control for the sibling slice**: handing a LIVE run to `resume` is refused because its lease holder is current. Measured at `workflow-worker-thread/src/index.ts:298`, `resume` reconciles then `launch(...)`, so without this the re-attach path would spawn a second worker under one run id — two masters, from inside the epic meant to prevent them. The boundary gets a test rather than a design note.

Mutation expectations, to be RUN and pasted rather than predicted (§12.68): removing the widening check must redden case 2; removing the lease check must redden case 4.

## Status

**No code written.** Submitted for review. `detached` follows this slice or lands with it.
