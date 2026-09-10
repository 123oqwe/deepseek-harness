# preFlight — P4-09 must[2] `detached`

Per §12.61's ruling: **build it, do not withdraw it.** A `must` is a registry requirement and withdrawing one is the user's call, not the executor's or the delegate's. This document precedes any code.

Measured at `9000b374ec`.

## Why the finding stood, and what changed

BLOCKED-100 recorded that `detached` had no implementation: across `packages/workflow/*/src` and `packages/run/*/src` every `detach` occurrence is `detachInputSignal` (removing an event listener), and the only occurrence of the word "detached" is a `nesting.ts` comment stating that a detached run is NOT nested. That measurement still holds.

What changed is the **subject**. §12.61 names it: the Run service now exists and is accepted — P4-05/P4-07's lease, P4-06's journal, and resume. A detached run needs an owner that outlives the turn, and until this session there was none.

## make-vs-use — no new OSS, and more reuse than the ruling assumed

Expected: no new dependency; reuse `RunPlugin` + lease + journal. Measured, and there is a closer precedent than that:

| existing mechanism | where | what it already does |
| --- | --- | --- |
| `run_in_background` (default **true**) | `subagent/tool-subagent/src/index.ts:61,278,293` | Returns a durable id immediately and lets the child run past the call |
| settlement outbox + drain | `subagent/subagent/src/continuation.ts:503-517` | **"A settlement committed while the parent was gone reaches it on the next start rather than being lost with the process that could not deliver it"** — its own words |
| lease + `reclaim` | `run/run/src/index.ts` | An owner that survives the process, and a reclaim path for one that did not |
| journal + resume | `collaboration/workflow-journal`, `workflow-worker-thread/src/resume.ts` | Durable step receipts and reconciliation on resume |

**The "disconnect ≠ cancel" semantics §12.61 specifies already exist for subagent children.** The continuation seam drains on `agent/session-start` and `agent/pre-step` precisely so a settlement outlives a parent that went away. P4-09's `detached` should reuse that pattern — ideally that seam — rather than build a second answer to the same question. A second outbox with its own delivery triggers would be the `circuit.ts` mistake at the architecture level.

## 4.4a — consumers, and the launched profile that reaches them

The clause is about a workflow run that leaves its turn, so the consumer must be a real caller on a shipped path:

- **Producer**: `tool-workflow`'s run entry, which today notes "background collection remains deferred" (`tool-workflow/src/index.ts:7`) — that deferral is the gap this closes.
- **Owner**: `RunPlugin`, mounted in `packages/bundle/base/cordis.patch.yml:529` with a real `storePath`, and therefore reached by every shipped bundle that inherits base — `acp-app`, `headless`, `sdk-app`, `sdk-minimal`, `web-app`. This answers §12.20's third question: the path is reached on launched profiles, not merely present.
- **Re-attach**: `resume(runId, request)` exists, but §12.66 asked whether it attaches to a LIVE run or only restores a stopped one, and the answer is the second — with a hazard attached.

**Measured** (`workflow-worker-thread/src/index.ts:298`): `resume` calls `reusableSteps(...)` to reconcile the journal and then `this.launch(request, runId, reconciled)`. It **starts a new worker**. It does not attach to anything.

So calling `resume` on a live detached run would spawn a SECOND worker under one run id — two masters for one run, which is the hazard P4-07's lease exists to prevent and which this epic must not reintroduce through its own re-attach path. The two routes are therefore genuinely different mechanisms, not one with two entry points:

| launcher | route | mechanism |
| --- | --- | --- |
| still alive | observe / await / cancel a LIVE run | the registry's observation surface, NOT `resume` |
| gone | collect the result later | the settlement outbox, drained on the next `agent/session-start` or `agent/pre-step` |

`resume` keeps its own meaning — continuing an INTERRUPTED run — and a detached run that outlived its launcher and then died is exactly what it is for. What it must never be handed is a run that is still executing.

## Cancellation boundary (§12.66)

Two arms, and the negative one is what distinguishes detached from nested:

- `cancel(parent run)` → nested children cancel, **detached children do NOT**. This is the negative control; without it "detached" is just a word for a nested run.
- `cancel(detached id)` → it terminates.

The launcher (session id + parent run id) is RECORDED on the detached run, but recording is not ownership: the launcher is who started it, and the Run service is who owns it. A cancel that reached a detached child because its launcher went away would make "disconnect is not cancellation" false in the one case it exists for.

## Semantics to freeze (§12.61)

1. A detached run is held by the Run service and **holds its own lease**, renewed independently of the turn that started it.
2. The starting turn returns the run id immediately.
3. **Session end or UI disconnect does NOT cancel it** — disconnect is not cancellation.
4. An **explicit** cancel still propagates (P5-10's cancellation semantics).
5. It can be re-attached by run id to observe, await, or cancel.
6. It carries a capability token derived at start, attenuated from the parent's — the same mechanism as P4-09's other open finding, and the reason it still has authority after the turn that authorized it is gone.

Frozen cases: start detached → turn ends → the run is still alive with its lease renewed → re-attach by id retrieves the result; explicit cancel → it terminates; `cancel(parent)` leaves the detached child running while cancelling a nested sibling; launcher alive → observation surface, launcher gone → settlement outbox. **Mutation: "the turn ending cancels the run" must go red**, which is the one that distinguishes this from current behaviour.

## Dependency on the other open finding

Point 6 needs the capability-token slice, which is P4-09's other reopened finding. They share one mechanism: a nested or detached run derives a narrowed token from its parent's attenuable token. Building `detached` without it would leave a run outliving its turn **with no answer to what authorizes it** — worse than the current gap, because it would look complete. **The capability-token slice lands first, or both land together.**

## Point 6 after P2-02.U (SETTLED below by measurement; the three readings are kept for the record)

The shared mechanism point 6 waits on has landed: `capabilityTokens.deriveChild(parentSession, childSession, filter)` derives a child from its parent under the parent's declared filter, records it through `service.attenuate` so `lineageOf` can reach it, and re-derives when the child's visible tools grow. `subagent-spawn-in-process` and `ralph-loop` are its observation.

**What that does NOT yet answer for `detached`, and must be settled before this slice freezes:** a detached run outlives the turn that authorized it, and the provider drops a session's token at `agent/disposed`. So a detached run re-attached after its launcher is gone finds its parent's token gone with it, and today's `deriveFromParent` — which resolves the parent through `whenSessionToken` — would refuse. Three readings, none picked here:

1. **The derived token is durable and self-standing.** It is already recorded in the store with its `parentDigest`, so re-attachment reads it back rather than re-deriving. Revocation still reaches it through the lineage walk. This is the reading point 6's own wording implies ("carries a capability token derived at start").
2. **A detached run re-derives from a durable parent record** rather than from the parent's live in-memory token. Needs the parent's root to survive `agent/disposed` in the store, which it does — only the in-memory map is cleared.
3. **A detached run is refused after its launcher ends.** Consistent and safe, and it makes "detached" mean "outlives the turn but not the session", which contradicts semantics 3 and 5 above.

(1) and (2) differ in where the authority is read from, not in what it permits; (3) changes the feature. **Not chosen** — the difference decides whether `revokeSession(parent)` kills a detached child, which is a security-visible property and belongs to the delegate.

## Measured after the token slice landed: (1) is right, and the hole is on the revocation side

The three readings above are now settled by measurement rather than by choice, and the measurement also finds a gap none of them named.

**Disposal forgets; it does not revoke.** The `agent/disposed` listener deletes this session's entries from `sessionTokens`, `issuing`, `sessions`, `sessionRoots`, `issuanceErrors` and `delegations`. It calls nothing on the service. So a token derived at launch is untouched when its launcher goes away: reading (1) holds, and semantics 3 — disconnect is not cancellation — extends to authority without any new mechanism.

**Explicit revocation is what cascades.** `revokeSession` calls `service.revoke(digest)` for every root recorded for the session, and `lineageOf` walks recorded `parentDigest` hops, so a revoked parent reaches its derived children. That is the boundary must[2] wants and P2-02 already established in another form: cancel is not revoke, and now disconnect is not revoke either.

**The gap: after the launcher is disposed, revoking it reaches nothing.** `sessionRoots` is an in-memory `Map` (`capability-token-file/src/index.ts:160`), deleted per session at `agent/disposed` (`:224`) and cleared wholesale at plugin dispose (`:233`). `revokeSession` iterates `this.sessionRoots.get(session) ?? []` (`:384`). So once the launching session has ended — which for a detached run is the NORMAL case, not an edge — an operator asking to revoke everything that session authorized revokes nothing, silently and successfully. The same is true for every session after a process restart.

This is not a reason to delay the slice, but building on it silently would ship a detached run that cannot be revoked once its launcher is gone, which is the exact combination "outlives its turn" makes dangerous. **The question for the delegate: does a detached run have to remain revocable through its launcher after that launcher has ended, and if so, what durable record carries the root list?** The store already holds the tokens and their `parentDigest` hops; what is memory-only is the session→roots index. Recovering it is a lookup over durable data, not a new authority.

## The ruling's carrier holds for children and NOT for session roots

Ruled: a detached run stays revocable after its launcher ends and after a restart, carried by deriving the session→roots index from the store by `subject` rather than by adding a record. Measured, that carrier is sound for half the cases and unsound for the half the ruling is about.

- **A child token's subject IS its session.** `deriveFromParent` sets `subject: brandString<PrincipalId>(childSession)` (`capability-token-file/src/index.ts:435`). So a detached run's own token is findable in durable data by its session id, across a restart, with no new record. The operational path the ruling names — run id → the detached session id in the run's persistent state → `revokeSession` — works today on durable data alone.
- **A session ROOT's subject is the PRINCIPAL, not the session.** `issueSessionToken` sets `subject: principal ?? brandString<PrincipalId>(session)` (`:511`), and the live caller passes one: `agent.identity?.principal.id` (`:265`). So in any composition where the agent has an identity — which is the shipped case — the session id is nowhere in the token. `CapabilityTokenStoreState` is `{ tokens, revokedDigests, spentNonces, auditRecords }`, and `CapabilityTokenLogRecord` carries `subject` too (`capability-token/src/types.ts:378-384`), so neither array recovers it.

Every session of one principal therefore shares a subject. A subject-derived index cannot say which roots belong to session S; it can only say which belong to S's principal.

### Ruling (c) — the session id goes in `constraints` — needs one more change to be sound

Measured against the three things it rests on:

- **`constraints` is a must[0] field, so the shape holds.** `TokenConstraints` today carries only `budget?` (`capability-token/src/types.ts:165`); a session key is a new member of that interface, not a new top-level field.
- **`attenuateToken` does not constrain a new key.** It compares `constraints.budget` alone (`attenuate.ts:226`) and takes the child's constraints from the request verbatim (`:235`). So a child carrying its OWN session constraint is compatible with the existing rule and needs no change to attenuation. The cost is that nothing narrows the new key either: a caller could request a child constrained to some other session, and only the provider — the single production caller — would stop it. An independent key (`issuedFor`) is therefore better than a growable `sessions: [...]` list, because a list invites superset semantics that attenuation does not actually enforce.
- **But the digest does NOT cover it, and that is disqualifying as written.** `digestToken` enumerates fields explicitly and hashes `token.constraints.budget ?? null` — not the constraints object (`attenuate.ts:255-267`). A session constraint added today would sit OUTSIDE the digest and therefore outside the signature: an unsigned field, alterable without breaking verification. The gate the ruling wants for depth — "presenter session equals constrained session" — would then be enforcing a forgeable value, which is worse than not having it.

**So (c) is sound only with `digestToken` extended to cover the session constraint.** That is a format change — every token digest moves — which the pre-release stance permits, and the blast radius is small because session tokens are short-lived (`sessionTokenTtlMs`).

**Counted field by field, and the fix is not "add one more entry".** `CapabilityToken` has ten top-level fields and `digestToken` enumerates ten entries, so every field is covered; the single projection is `constraints`, represented by its one member `budget`. The contract's promise — "any single-field difference produces a different one" — is therefore TRUE today, and it is this addition that would falsify it. That makes the durable fix to hash the constraints OBJECT canonically rather than to append `issuedFor` beside `budget`: appending keeps the projection, so the third constraint member added later escapes the digest exactly as the second would have, and the next person inherits this same finding. Canonicalizing the object closes the class instead of the instance.

**The tradeoff, not chosen here.** Either (a) revoke by subject and accept that revoking one session revokes every session of that principal — over-revocation, which is the safe direction but must be stated in the API rather than discovered, or (b) carry the session id on an issued root so the index is exact, which changes must[0]'s "complete, closed token shape". What must NOT survive either way is the present behaviour: a silent successful no-op. Over-revoking is defensible; reporting success while revoking nothing is not.

## The `resume` boundary case is already enforced — and its guard is in the wrong place

§12.66 asks that handing a LIVE run to `resume` be refused. Measured, it is: `LeaseStore.acquire` refuses whenever an unexpired incumbent exists (`run/lease/src/store.ts:90`), and it does NOT special-case a matching holder, so even the same process re-resuming its own live run is denied `held-by-another` and surfaces as `RUN_HELD_BY_ANOTHER_HOST`.

Two things are still worth freezing, because the case is real rather than vacuous:

- The refusal arrives AFTER the work. `resume` runs `reusableSteps` first (`workflow-worker-thread/src/index.ts:323`) and the lease is only taken inside `launch` (`:513`). Reconciliation reads a journal that another holder is actively writing, and the answer it computes is discarded. The guard belongs before the reconciliation, not after it.
- The message says "held by another host" when the holder may be this one. An operator re-attaching to their own run is told to look for a second host that does not exist.

## Cases to freeze

**C — the digest covers the class, not one member** (`capability-token`):

1. Changing `issuedFor` changes the digest, and a signature over the old digest no longer verifies.
2. Adding a NEW constraint member and changing only it changes the digest. This is the class negative control: an implementation that appended `issuedFor` beside `budget` in the enumeration passes case 1 and FAILS this one, which is the whole difference between fixing the instance and fixing the class.
3. Changing `budget` still changes the digest — the coverage that already existed is not lost by canonicalizing the object.

**U — revocation reaches a detached run after its launcher is gone** (`capability-token-file`, real provider):

4. Launcher session disposed → `revokeSession(launcher)` → the detached child's next tool call is refused.
5. The same, on a NEW provider instance over the same store directory: a process restart does not restore authority that was revoked, and does not lose the ability to revoke.
6. Another session of the SAME principal is unaffected. This is the precision control, and it is the case ruling (a) could not have passed — subject-derived revocation cannot tell two sessions of one principal apart.
7. `revokeSession` for a session with no recorded roots reports `nothing-to-revoke` rather than succeeding silently.

**U — the detached run itself** (`workflow-worker-thread`, real engine):

8. A detached run outlives the turn that started it: the turn ends, the run is still alive with its lease renewed, and re-attaching by id retrieves its result.
9. `cancel(parent run)` cancels a NESTED sibling and leaves the detached run running. This is the case that makes "detached" more than a word.
10. `cancel(detached id)` terminates it.
11. Handing a LIVE run to `resume` is refused, and the refusal happens BEFORE reconciliation — observable as the journal not being read and no reconciliation having run. The mutation "take the lease after `reusableSteps`" must redden this.

Mutations to RUN and paste (§12.68), not predict: removing the canonical constraints hashing must redden C2; revoking from the in-memory map alone must redden U4 and U5; matching by `subject` instead of by the session constraint must redden U6; taking the lease inside `launch` rather than before reconciliation must redden case 11.

## Status

**Measurements recorded; no code written for this slice.** The token slice it depended on has landed (`f8d3bce3d1`), so the ordering condition is met. Awaiting the ruling on post-disposal revocability before the semantics above are frozen, since that answer changes what a frozen case must observe.
