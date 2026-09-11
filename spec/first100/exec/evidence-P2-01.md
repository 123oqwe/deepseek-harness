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
