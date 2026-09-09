# Agent Note: Fixture refresh pairs manifests by identity, and a guard's order decides whether a lookup runs at all

Status: implemented

English | [中文](2026-09-09-refresh-identity-pairing-and-guard-order.zh.md)

## Problem

`manifestIdempotencyKey` is `sha256(sessionId + actionId + argumentsHash)` ([`identity.ts`](../../../../packages/action/action-manifest/src/identity.ts)), so the digest a fixture carries cannot be recomputed during a refresh: a fresh run has a different session id. `preserveFixtureVolatiles` therefore copies the committed digest onto the fresh record — and it took that record from the POSITIONAL pairing that `stabilizeRefreshLog` advances with `existingIndex`.

Position is not identity. The moment a fresh log gains or loses one event anywhere earlier, every later manifest lines up against a record of another type, `'idempotencyKey' in existingData` is false, the copy is skipped, and the fixture keeps the freshly computed digest instead of its committed one.

Adding one `action/risk-gated` event did exactly that: **about 80 fixtures had their digests rewritten, and no gate failed**, because [`normalize.ts`](../../../../packages/test-support/session-snapshot/src/normalize.ts) masks the field to `{{idempotencyKey}}` when comparing. The code's own comment records that this had already happened once before, when "the packed/unpacked equality case was the only thing that noticed".

## Decision

The digest is preserved by IDENTITY — `actionId` and `sequence`, indexed from the committed fixture once per scenario by `committedManifestKeys` — rather than by where the record sits. `sequence` belongs in the key because one action can legitimately run twice with identical arguments in one session, and the two occurrences carry different digests. `argumentsHash` is deliberately absent: a committed fixture may carry it normalized while the fresh record holds the real digest, so keying on it matches nothing and falls back silently to the fresh value — the exact failure this pairing removes. Across the corpora, 153 manifest records produce no `(actionId, sequence)` collision.

**Where the lookup runs matters as much as what it looks up, and two placements had to be wrong before the third worked.** The preservation splits into `preservedManifestKey`, read from the FRESH record, and `applyPreservedManifestKey`, which writes it back:

- Read BEFORE positional preservation. `preserveNormalizedVolatiles` replaces fields of the fresh record with those of whichever committed record it lined up against, so afterwards `actionId` can name a different action and the identity resolves to another record's digest.
- Write AFTER `preserveFixtureVolatiles`. That function copies the mispaired committed record's volatile fields onto the record, `idempotencyKey` among them; a write placed earlier is silently overwritten with the wrong digest, and the fixture ends up exactly as it was before the fix.

This is [4.4a](../../../../spec/first100/exec/decisions-approved.md)'s "the mechanism exists but is never reached" one level down, in both directions: a correct lookup can be fed poisoned input by an earlier step, or have its output discarded by a later one, and every gate still passes because the field is masked before comparison.

## Alternatives considered

**Stop masking `idempotencyKey` in `normalize.ts` and let the comparison catch a rewritten digest.** Rejected: the digest covers the session id, which differs on every run, so an unmasked field would fail every legitimate refresh. Masking is correct; what was missing is that the refresh must not change a value the comparison cannot see.

**Recompute the digest during refresh from the fresh session id.** Rejected: it would agree with itself and prove nothing. The fixture's value is evidence that a specific committed run produced that action with those arguments; recomputing discards the evidence and makes the field decorative.

**Key by `actionId` alone.** Rejected: one action can run twice with identical arguments in a session, and the occurrences carry different digests — the second would silently take the first's.

**Include `argumentsHash` in the key.** Rejected on measurement: a committed fixture may carry it normalized while the fresh record holds the real digest, so the lookup matches nothing and falls back to the fresh value — reintroducing the defect while appearing more precise. `(actionId, sequence)` has no collision across the 153 manifest records in the corpora.

## Consequences

A refresh that inserts or removes an event no longer disturbs digests it did not produce. Two cases in [`manifest.spec.ts`](../../../../packages/test-support/session-snapshot/tests/manifest.spec.ts) hold it: one inserts an event ahead of two committed manifests and requires both digests preserved, and its negative control requires a genuinely new action to keep its freshly computed digest, since there is nothing to preserve and inventing one would be worse.

Reverting to the positional pairing reddens the first case. Moving the read after positional preservation, or the write before `preserveFixtureVolatiles`, reddens it too — the property this note exists for: the fix is the pairing AND both placements.

The measured refresh confirms it. Against the committed fixtures, adding the `action/risk-gated` event rewrites 86 files with 148 inserted lines and zero removed, and the 67 changed manifest lines carry byte-identical digests; every remaining difference is `seq`, `throughSeq`, or `sourceEventSeqs` renumbering.
