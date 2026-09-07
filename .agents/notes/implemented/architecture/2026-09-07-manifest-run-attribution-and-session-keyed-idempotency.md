# Agent Note: A manifest's run is the identity's run, and its idempotency key is keyed on the session

Status: implemented

## Problem

Both manifest call sites wrote `runId: brandString<RunId>(session.id)`.

The field must[0] mandates was present and its value was something else. `RunId` is `dsh-principal`'s "execution-run identifier: the invocation a principal is currently acting inside", and P4-01's Run Service mints `run-<uuid>`; a session id is neither. Two runs inside one session therefore shared a "runId", and P4-12 keys a reservation scope on that field — so the ledger would have scoped two runs' external effects together.

The real run was two lines away: `attachedIdentity(session)` was already being called for the actor, and `IdentityContext.runId` is on the value it returns.

`manifestIdempotencyKey` then compounded it by deriving from that same value under the name `runId`.

## Decision

- **`manifestActor` became `manifestAttribution(identity, sessionId): { runId, actor }`.** The two answers come from one branch, because they answer from the same source: an attached identity supplies both its run and its principal chain, and its absence has to be answered once rather than twice. Splitting them is exactly how the run id came to be the session id — the call site asked the identity for an actor and the caller for a run, and the caller had only a session.
- **The anonymous fallback is unchanged in shape and now distinct in value.** With no attached identity the actor stays `anonymous:<sessionId>` and the run becomes `anonymous:<sessionId>` rather than the bare session id, so a session and a run are never the same string even in the fallback.
- **`manifestIdempotencyKey` is keyed on the SESSION, not the run**, and its JSDoc says why: a retry needs an identity that survives a restart. A session id is replayed when the session is; `run-<uuid>` is minted per invocation, so a key derived from it would be new after every restart and a replayed action would present an unrecognized key — the external effect happening twice is precisely what P4-12 acceptance[0] refuses.
- **The key's scope type is `IdempotencyScope`, declared in `dsh-action-manifest`** as `Branded<'SessionId'>`. Structurally the same brand as `dsh-session`'s `SessionId`, so a real session id is assignable with no cast and a bare string is still refused. Importing `SessionId` was measured: it adds `dsh-action-manifest -> dsh-session: capability-definitions -> providers`, a definition sitting above its own consumers for a type carrying no behaviour. **This is the one judgment call in this change** — a restated brand against a layer violation — and it is flagged rather than assumed.

## Evidence

Two cases, one per dispatch path, plus their mutations:

- `tool-calls.spec.ts`: "logs the ATTACHED identity's run, not the session id wearing a RunId brand" — asserts `runId === 'run-9f3c'` and `!== sessionId`. Reverting the source to `brandString<RunId>(session.id)` reddens **two** cases, not one: the new case, and the existing fallback case whose expectation is now `anonymous:manifest-fields`. Both are assertions about the mutated fact, so the second red is coverage rather than noise.
- `ptc.spec.ts`: "records the ATTACHED identity's run, so code mode cannot bypass the run attribution either (must[2])". The same mutation on `ptc.ts` reddens exactly this one.

`verify-manifest-constructed` still reports 2 production callers; `check-layer-deps` findings unchanged at 120.

## Consequences

- Anything that read `action/manifest-appended`'s `runId` as a session id is now wrong. Nothing did: the field had no reader, which is how the defect survived.
- `manifestActor` is gone from the public surface, replaced by `manifestAttribution`. Pre-release stance: no shim.
- If a session identity ever moves into a definitions package, `IdempotencyScope` aliases that instead and nothing else changes.
