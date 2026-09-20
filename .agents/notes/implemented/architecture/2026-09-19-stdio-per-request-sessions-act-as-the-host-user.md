# Agent Note: A per-request session on stdio acts as the host user

Status: implemented

English | [中文](2026-09-19-stdio-per-request-sessions-act-as-the-host-user.zh.md)

## Problem

P2-01 gave sessions a host-user principal, and the four call sites it covered were the ones that create an agent from a configured `agents:` row or from a programmatic root: `boot/app-boot` through `HOST_USER_IDENTITY_KEY`, `bundle/headless`, the Web session controller, and workspace launch grants. The two surfaces that create an agent **per request** — `packages/acp/acp` and `packages/sdk/server` — had zero callers, so every action either of them took was attributed to `anonymous:<sessionId>`, the unauthenticated-local-work fallback in `action-manifest/src/identity.ts`.

The reason on record for leaving them out was that "a request that arrived over a socket is not the machine's host user". That sentence was in five places and was false of both: each is pure stdio, spawned by the local user, in a process that user owns. Webhook ingress is the surface the sentence was actually true of, and it keeps the exception.

The epic's sign-off was withdrawn twice over this — once for the original gap, once after a re-sign against the four call points then known. The second withdrawal is [BLOCKED-291](../../../../spec/first100/exec/BLOCKED-QUEUE.md).

## What changed

Both surfaces now read the launcher's factory at the point they compose an agent, the same mechanism `agent-loop` already applies to a configured row:

- `acp/src/index.ts` gained `agentOptionsFor(ctx, config)`, used by both `session/new` and `session/resume`. Resume matters as much as create: without it the resumed agent is composed with no identity, and a case asserting "a resume adds no second `identity/attached`" would hold for the wrong reason.
- `sdk/server/src/server.ts` reads it in `createSession`, the only place that surface composes one. There is no resume half to cover here: the SDK's request map is `initialize`, `session/prompt` and `shutdown`, none of which names a session that already exists, and `session/prompt` always creates — the durable backend then refuses an id whose log is on disk (`session-persistence-jsonl/src/index.ts:317-318`). [BLOCKED-298](../../../../spec/first100/exec/BLOCKED-QUEUE.md) holds that gap, and the two-launch evidence for acceptance[0] is the ACP case's.

Through the context key rather than by calling `hostUserIdentity()` directly, which is what `bundle/headless` and the Web controller do. Resolving an identity touches `$DSH_HOME`, and a composition that provides no factory — every unit suite mounting either plugin directly — must attach nothing rather than write an identity file into a developer's home. A hand-mounted harness staying anonymous is the honest outcome, not a gap.

Both packages gained `@deepseek-ai/dsh-agent-loop` and `@deepseek-ai/dsh-principal` as peer plus dev dependencies, with matching project references, across two commits rather than one: ACP's in `a816deb892`, the SDK server's here. The config catalog moved with the ACP half alone — regenerating it after this half leaves it byte-identical — while the module graph moves with each. The first is a runtime edge, for the key and its factory type; the second carries only the `RunId` brand, type-only, in the shape both files already use for `SessionId`.

## Consequences

**The recorded corpora change.** `anonymous:` appears in 26 committed snapshot files across the acp and sdk trees, and `identity/attached` appears in none of them while appearing in 104 files of the session tree. After this change those sessions carry the host-user principal and one attachment each, so `pnpm run test:snapshot` is red until the corpora are refreshed — which is a separate commit, by policy, and reviewed as a diff rather than regenerated in place. The ACP half of that red is already live: it started at `a816deb892`, not here. Refreshing the six ACP corpora on `301b00497d` showed two further changes, recorded here as observations with their cause **being measured (A-247)**: the task profile stops asking who is acting -- the `high-risk-missing` question `Whose authorization should this task act under?` on `actingIdentity` is gone from all six, leaving the `sideEffect` question alone -- and each corpus gains a `workspace-trust` approval pair (`approval/asked` with its `approval/decided`, carrying the project-instructions prompt), which in the three escalation corpora pushes the original question out to `approval:2`. The two questions settle differently and the counts are worth keeping apart: the trust question is `rejected` in the three corpora whose `approval/policy` is `never` and `unavailable` in the three whose policy is `ask`, while the escalation question keeps the outcomes it had before the re-record (2 `allowed-once`, 1 `rejected`). That correspondence with the policy is an observation too, not an explanation.

**Evidence lives at the launcher layer.** A case on `makeBridgeHarness` or the SDK server's `mountPlugin` proves wiring between plugins a test chose to mount: neither loads an app's `cordis.patch.yml`, neither mounts app-boot, so `HOST_USER_IDENTITY_KEY` is absent from their Context by construction. The unlock cases therefore spawn the shipped launcher and read the durable session log. They are keyless because a loopback stand-in model answers the turn with a real tool call — acceptance[0] is about a manifest, and a manifest needs an action, so `session/new` alone could not have shown it.

**The negative control is a commit, not a flag — and it landed differently on the two surfaces.** ACP's control was observed green twice while asserting `anonymous:` and zero attachments (step 23 of runs 35467913630 and 35475180584), and `a816deb892` flipped it. The SDK's control asserted the same values from the start and was NEVER green: it timed out four runs running, waiting for a `turn/end` on a turn the server had already refused, until `afac505e1b` stopped the driver doing that and run 35479346884 observed it passing for the first time. That run is what this commit's flip is measured against; before it there was nothing to compare with. An expected-failure marker was considered and rejected: it passes for any reason at all, a broken environment included, so it cannot distinguish "the defect is there" from "the run did not work".
