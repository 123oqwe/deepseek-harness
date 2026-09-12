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

## Re-sign material (4.4a–d)

Written 2026-09-12 on the corpus branch, after U2 shipped the host-user attachment that [BLOCKED-200](BLOCKED-QUEUE.md#blocked-200) revoked this epic for. Documentation only: nothing here changes product code, and the one open question below is reported rather than fixed.

### 4.4a — where the production reach actually is

The attachment U2 added has four call sites, and none is a test:

| site | what it attaches |
| --- | --- |
| `packages/boot/app-boot/src/index.ts:807` | provides `HOST_USER_IDENTITY_KEY` as a FACTORY for every profile launched through `dsh`, so agents a profile creates from its own `agents:` rows get a host user |
| `packages/bundle/headless/src/index.ts:282` and `:303` | the headless profile's two programmatic root creations pass an identity directly |
| `packages/api/session-controller/src/commands.ts:263` | the Web app's session controller, for sessions it creates |
| `packages/workspace/command-workspace-trust/src/launch-grant.ts:104` | `--trust-workspace`, which needs a host principal to authorize a grant |

The factory is consumed at `packages/core/agent-loop/src/index.ts:484`, where a configured row that names its own identity keeps it and the launcher's host user is the default rather than an override. `bundle/base` mounts no producer of its own; the identity reaches a shipped boot through the launcher, which is why the census in BLOCKED-200 found none before U2.

### 4.4b — cell observations

| cell | status | candidate SHA | run |
| --- | --- | --- | --- |
| C | **NOT_RUN** | — | revoked: `P2-01.C.1` supersedes the 2026-09-02 freeze and drops `registers the package ownership with an empty installer`, a case `verify-package-invariants` rejects by name. Awaiting re-observation on the candidate carrying the supersede; lane B owns it. |
| P | GREEN | `87585733cf` | 33596937698 |
| U | GREEN | `bf24fa0a33` | 33637453508 |
| F | GREEN | `b3186e6db9` | 34088363628 |

**These are not candidate 3′′′ observations, and this section does not claim they are.** 3′′′ (`6ff9674a94`) was dispatched on 2026-09-12 and its exact-SHA run had not reported when this was written; the three green cells carry the SHAs and runs that actually earned them. A re-sign that wants 3′′′ readings has to wait for that run — the ledger is the authority, and it currently records the rows above.

### 4.4c — the hardcoded tenant, measured

The open question above asked whether `hostUserIdentity`'s fixed `'local'` is a defect or a single-tenant design. Measured, it is **a defect, and a latent one**. The two halves of the question and what each returns:

**Is the tenant configurable anywhere a deployment can reach?** Yes, in exactly one production consumer. `memory-context`'s `tenantId` is a REQUIRED config field with no default (`packages/context/memory-context/src/index.ts:54`, `tenantId: z.string().required()`), and it throws when an attached principal names a different tenant (`:83`). A deployment enabling that row must name a tenant, and the only value that will not throw on a shipped profile is `local`.

**Can the producer name any other?** No. `HostUserIdOptions` carries `env` and `randomUUID` and nothing else (`packages/identity/host-user-id/src/index.ts:45-50`); the tenant is the module-level constant `LOCAL_TENANT = 'local'` (`:123`).

So the contract is asymmetric: the consumer's configuration surface admits any tenant, the producer can mint only one. That is not "single-tenant by design" — a design would not offer a required, unconstrained tenant field on the consumer.

**Why latent, and what makes it fire.** `memory-context` ships **disabled** (`packages/bundle/base/cordis.patch.yml:423-425`), and no shipped bundle configures a tenant at all — a `grep` for `tenant` across every `packages/bundle/*/cordis*.yml` returns nothing. So the throw cannot fire on any profile as shipped. It fires the moment a deployment enables that row and names a tenant other than `local`, which the required field invites it to do.

A census of production `tenantId` readers finds `memory-context` is the only one that gates on a mismatch against an attached principal. `agent-loop/src/runtime-context.ts:158` also throws `TenantMismatchError`, but on a different axis — a supplied principal disagreeing with what a resumed session recorded — which no deployment configures.

**Not fixed here.** Whether the producer gains a tenant option or the consumer's field is constrained to the one value a shipped boot can produce is a change to this epic's public surface, so it is the delegate's to number and rule, not a fix to make inside a re-sign.

### 4.4d — no clause has zero production reach

| clause | production reach |
| --- | --- |
| [0] any action traces to root user/tenant and the full delegation chain | attachment at the four 4.4a sites; the chain is extended and logged at `packages/core/agent-loop/src/agent.ts:129-132`, and read by both dispatch paths through `manifestAttribution(attachedIdentity(session), session.id)` |
| [1] cross-tenant id mixing is rejected at both the type layer and runtime policy | type layer: `TenantMismatchError` at `packages/identity/principal/src/types.ts:237-248`, thrown by `extendChain` (`packages/identity/principal/src/chain.ts`); runtime policy: the same error thrown from `packages/core/agent-loop/src/runtime-context.ts:158` on a resupply whose tenant disagrees with the recorded chain, and from `packages/context/memory-context/src/index.ts:83` on a consumer whose configured tenant disagrees with the attached principal |
| [2] the anonymous dev mode has its own restricted principal, not an administrator's | `createAnonymousDevPrincipal` (`packages/identity/principal/src/chain.ts:179-181`) mints a frozen `kind: 'anonymous-dev'` principal, and `packages/action/action-manifest/src/identity.ts:51-52` is where a session with nothing attached gets one, keyed to the session rather than to a host user |

Every clause reaches shipped code. Clause [0]'s reach is what U2 added and BLOCKED-200 found missing; clauses [1] and [2] were already reachable and are unaffected by the withdrawal.
