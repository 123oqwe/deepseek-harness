# P2-01 — Identity, tenancy and the delegation chain

This page records what the U2 stage measured. The epic's C/P/U cells are `ACCEPTED`; U2 is the remediation slice [BLOCKED-200](BLOCKED-QUEUE.md#blocked-200) opened — a shipped boot attaching a real host user, and a delegated child extending the chain rather than losing it.

## What "traceable" means here, read from the log

`action/manifest-appended` records `actor: manifest.actor.id` (`core/tools/src/manifest-log.ts`) — the id **string**, with no kind, tenant or chain beside it. The chain lives on `identity/attached`, which carries the whole `IdentityContext`.

So acceptance[0]'s *"any action traces to the root user/tenant and the full delegation chain"* is satisfied by a **join inside one session log**: an action names its actor id, and the same log's `identity/attached` names that principal's kind, tenant and chain. It is not satisfied by a manifest carrying its own chain, and it deliberately is not: copying a variable-length delegation chain into every action would pay per action for something one lookup already answers. Ruling §12.85 note 43-② confirmed this reading; no gap was opened for it.

Every frozen claim in this stage is therefore a **pair**: the identity a session attached, and the first manifest attributing an action to exactly that principal. The first half alone would prove an identity was attached and nothing about whether actions used it.

## Measured on a real shipped headless boot

The root agent of a `bootProductionProfile({ profile: 'headless' })` composition, read from the booted agent itself:

```
principal: { kind: 'user', id: '59ba916b-…', tenantId: 'local' }
runId:     'run-7de4e62d-…'
chain:     one entry, that same principal
```

and `identity/attached` is the **first event** in that session's log. Before this slice no shipped profile attached anything, and both dispatch paths synthesized an `anonymous-dev` principal named after the session.

## A fixture property, recorded so the next reader does not re-derive it

An early attempt built a dedicated composition fixture for these claims. It boots and attaches correctly, but its turn issues **no model request at all** — no `request/header`, no assistant events — so it appends no manifest and spawns no child, and the claims have nothing to read.

A probe against P1-07's fixture, which uses the same mechanics, showed that shape **does** dispatch (`request/header`, `request/context`, five `assistant/chunk`, `assistant/message`), so this is not a property of `bootProductionProfile` compositions in general and the cause was never isolated. The claims moved to the snapshot corpus instead, which is a real `dsh` process rather than a fixture and already carries manifests and subagent scenarios. Recorded rather than left as folklore: the difference is in that one fixture, not in the composition shape, and it did not warrant a BLOCKED entry because no shipped path depends on it — both shipped bundles configure `agents: []`.

## The OQ30 boundary, as a before/after reading

OQ30 ruled that a host user is attached where a LOCAL launcher creates the agent, and nowhere else: a request that arrived over a socket is not the machine's host user. The recorded corpus shows that as two numbers rather than a sentence — the same scenarios, before and after the identity was attached:

| corpus lane | what creates the agent | logs carrying `identity/attached` before | after |
| --- | --- | --- | --- |
| `snapshots/session/` | `dsh --profile headless` | 0 of 93 | (see below) |
| `snapshots/sdk/` | the out-of-process SDK server, per request | 0 of 25 | 0 of 25 |
| `snapshots/acp/` | ACP, per request | 0 of 8 | 0 of 8 |

The headless lane moves and the two remote lanes do not. That is the ruling, read off the product's own output.

`snapshots/web/` is excluded from the table on purpose. Its fixtures are refreshed by the Chromium lane (`pnpm run test:web`), not by `test:snapshot`, so their counts say nothing about this change.

## What the frozen cases read

`tests/first100/fixtures/P2-01.corpus.spec.ts` reads `snapshots/session/advanced-toolchain/` — one scenario, one real process, a root and two delegated children. It is the corpus rather than a purpose-built fixture because a fixture would prove that the fixture attaches an identity.

Each claim is a PAIR joined by the actor id, for the reason recorded above: a manifest carries the id alone, and the chain lives on `identity/attached`. The third case is the control — a child that merely inherited its parent's identity would satisfy "roots at the same user" trivially — and the fourth pins OQ30's boundary as counts.

## Open questions for re-signing

The delegate's overlay revoked this epic's sign-off. These are the questions the re-sign has to answer, both raised by what U2 actually shipped rather than by review of the plan.

### The host identity's tenant is hardcoded, and it is now load-bearing

`hostUserIdentity` mints its principal in `LOCAL_TENANT` — the literal `'local'` (`packages/identity/host-user-id/src/index.ts:123`), with no way for a composition to name another. Before U2 that was inert, because a shipped headless boot attached nothing and every consumer fell back to its own configured tenant.

It is no longer inert. `resolveMemoryAccessContext` THROWS when the attached principal's tenant differs from the consumer's configured one (`packages/context/memory-context/src/index.ts:83-86`), so **any composition configuring `memory-context` with a tenant other than `local` now fails on a shipped profile**. That check could not fire in production before U2; it can now, and the only tenant a shipped boot can produce is one no deployment chose.

Measured, not predicted: this is exactly how `memory-context`'s six cases went red on the cloud run. The fixture named `t-fixture`, the boot attached `local`, and the throw inside the pre-step waterfall ended the turn with the user's prompt consumed and no output at all ([BLOCKED-219](BLOCKED-QUEUE.md#blocked-219) owns that second, separable defect). Reverting only the tenant alignment reproduced it (`5 failed | 3 passed | 2 skipped`); restoring it passed 10/10.

Two shapes the re-sign could take, and the choice is a design decision rather than a defect fix:

1. **The tenant stays fixed and `local` becomes the contract.** A deployment naming another tenant is then a misconfiguration that should fail loud, which is the repo's stated rule, and the fixture was simply wrong. This is what the fix assumed in order to stay minimal.
2. **The host identity's tenant becomes configurable**, so a multi-tenant deployment can attach a principal its consumers can agree with. That is a change to this epic's own public surface and belongs to the re-sign, not to a test fixture.

Nothing here argues for one. What the re-sign cannot do is leave it unstated: a hardcoded tenant that nothing observed is a detail, and one that every mounted consumer must now agree with is a contract.

### The three deviation reasons were restated, and one was wrong

Recorded here because the correction is about this epic's own card. `accepted-unadopted` is reserved for an ACCEPTED row, so the revocation made all three illegal; they now state their measurements. Re-measuring found the OTel row had been **understated**: `service.name` IS set in the tree (`session-telemetry-otel/src/index.ts:199`) carrying `APP_IDENTITY.product`, so the earlier "no telemetry attribute mapping exists in this epic" was false — a mapping exists and deliberately carries no principal. `enduser.id` has zero occurrences repo-wide and the exporter never reads `identity/attached`, so no principal this epic mints reaches telemetry at all.

### A frozen C-stage title conflicts with a repository rule, and the record is being corrected

Recorded here because it changes what this epic's C stage is signed against, and because the correction is the delegate's rather than a re-judgement of the epic.

P2-01.C's frozen set carries `registers the package ownership with an empty installer`. An empty installer is not valid under this repository's package rules — `verify-package-invariants` rejects it — and after [BLOCKED-209](BLOCKED-QUEUE.md#blocked-209) retired the principal companion package, the frozen case and that gate became mutually exclusive: satisfying either one reddens the other.

The delegate ruled the C entry be superseded to drop that title, with the C cell's green withdrawn in the same commit, and re-observed on the next candidate's cloud run. Lane B carries it.

What a re-sign has to take from this: the C stage's evidence is being restated, not re-argued. No claim this epic makes about identity, delegation or the attached host user rests on that title — it is a packaging assertion that outlived the package it described. The re-sign should read the C stage against the superseding entry, not against the set recorded when the cell was first greened.
