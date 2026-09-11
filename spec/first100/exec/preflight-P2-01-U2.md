# preFlight — P2-01 (U2): attaching a host-user principal at a shipped boot

**Status: measurement only. No code written.** Measured at `46408e3c10`. This is the slice [BLOCKED-200](BLOCKED-QUEUE.md#blocked-200) opened and §12.85 note 32 ruled: a shipped boot must attach a `kind: 'user'` host principal, so an action traces to a real actor rather than to one synthesized at the point of use.

## Correction to BLOCKED-200's own census, made before building on it

BLOCKED-200 and P1-07's characterization case both say: *"Every `agentLoop.create(` call site that passes an identity is a test."* True, and incomplete in a way that would have sent this slice to the wrong file.

**There are ZERO non-test `agentLoop.create(` call sites at all.** `grep -rn "agentLoop\.create(" packages apps`, excluding `/lib/`, `/tests/` and `.spec.`, returns nothing. `AgentLoop.create` is reached two ways only:

1. its own constructor, once per `Config.agents` row — and both shipped bundles configure `agents: []` (`bundle/base:743`, `bundle/sdk-minimal:128`);
2. `AgentRegistry.create` / `resume`, which the factory delegates to (`agent-loop/src/index.ts:521`).

So the identity has to be supplied as `CreateAgentOptions.agentOptions.identity` at an `ctx.agents.create()` call site. The ruling's *"`agentLoop.create` 传 identity"* is right about the mechanism and the file is not `agentLoop`'s.

## The shipping creation call sites, classified

Census of `ctx.agents.create(` / `ctx.agents.resume(`, excluding tests and README examples — **twelve calls across nine files**, and they are not one kind:

| # | file | root or child |
| --- | --- | --- |
| 1 | `bundle/headless/src/index.ts:279` (create), `:271` (resume) | **root** — the `dsh --profile headless` run |
| 2 | `api/session-controller/src/commands.ts:247`, `agent.ts:477` (create), `:428`, `:460` (resume) | **root** — the Web app |
| 3 | `acp/acp/src/session.ts:128` (create), `:149` (resume) | **root** — ACP, automation-only |
| 4 | `sdk/server/src/server.ts:401` | **root** — out-of-process SDK client |
| 5 | `webhook/webhook/src/session.ts:136` | **root** — webhook ingress |
| 6 | `subagent/subagent-in-process-driver/src/index.ts:136` | child |
| 7 | `subagent/subagent/src/continuation.ts:1301` (create), `:1295` (resume) | child |
| 8 | `workflow/workflow-worker-thread/src/index.ts:405` | child |

**None of the twelve passes `identity`.** `grep -rn "identity:"` across those packages finds only projection schemas and a Client scope lookup — no `AgentOptions.identity` anywhere in shipping code.

The five root sites are not interchangeable. A host user is behind #1 and #2. #3 is automation-only by its own README, #4 is an out-of-process client, and #5 is an inbound HTTP request — a `kind: 'user'` principal minted from `$DSH_HOME` at those three would assert that the machine's local host user made a request that arrived over a socket. **The ruling names `profile-boot`/app-boot, which is #1 (and #2 by the same launcher); the other three are a separate question this slice should not answer by accident.**

## The second half of acceptance[0] has no producer at all

Acceptance[0] is *"任何 action 都能追溯 root user/tenant 与**完整委托链**"*. Attaching at the root closes the first half. The second half is in a worse state than BLOCKED-200 recorded, and it is measurable today:

- **`resolveChildAgentOptions` does not copy `identity`.** `subagent/subagent/src/child-agent.ts:131-142` builds the child's `AgentOptions` from the parent's `provider`, `model`, `reasoningEffort`, `maxTokens`, plus `requested` and `subagentDepth`. `identity` is not among them, and `requested` never carries one.
- **`extendChain` has zero production callers.** `grep -rn extendChain packages`, excluding `/lib/`, tests and specs, returns **seven hits, every one of them prose** — six doc comments and its own declaration at `principal/src/chain.ts:206`. Nothing in this tree has ever added a delegation hop.

So on a tree where the root attaches correctly, a delegated child still resolves no identity, `manifestAttribution` synthesizes `anonymous-dev` for it exactly as today, and a subagent's actions remain untraceable to the root user. **The delegation chain is a declared value with no producer** — the same shape as `ExecutionWorld` ([BLOCKED-178](BLOCKED-QUEUE.md#blocked-178)) and `PolicyEffect`'s `ask` ([BLOCKED-187](BLOCKED-QUEUE.md#blocked-187)'s output half).

This is not an argument against the slice. It is the reason the slice's frozen claim must be worded for what it proves: *the first action manifest of a real headless boot carries a `kind: 'user'` actor*. A case worded "any action traces to a root user" would be false one delegation hop away, and would be this program's fake-coverage pattern again.

## The id the ruling names, and what renaming it costs

**The facility exists**: `@deepseek-ai/dsh-anonymous-user-id`, which persists a random UUID v4 as a bare line in `$DSH_HOME/.anonymous-user-id` (`ANONYMOUS_USER_ID_FILE_NAME`), memoized per resolved path, minted on first use, never derived from hostname, network address, or git remote. Its own module doc already states the property this slice needs: *"scoped to the harness home, not the machine: every process sharing one `$DSH_HOME` reports the same id."*

**Three live consumers**, all of which read it as an *anonymous telemetry subject* today:

| consumer | use |
| --- | --- |
| `llm/llm-deepseek/src/index.ts:454` | `user` field on model requests |
| `session/session-telemetry-otel/src/index.ts:204` | OTel `user.id` attribute |
| `feedback/command-feedback/src/index.ts:95` | printed to the user as *"Anonymous user: …"* |

The ruling's *"设施改名 local host-user id，文件不动"* keeps the file and the value, so no consumer's behaviour changes. **What does change is what the name claims**, and that is worth stating before it is done rather than after: the same uuid would be simultaneously the OTel `user.id` sent off-box and the `UserPrincipal.id` a trust upgrade is authorized under. Those are not obviously the same subject, and `command-feedback` says "Anonymous user" to the user's face while `isHostUserPrincipal` would be reading it as the host user. **I am not taking that call** — see OQ29 below.

## The principal is constructible today; nothing is missing in `dsh-principal`

`createUserPrincipal` and `createChain(root, delegatedAt)` exist (`principal/src/chain.ts`), `UserPrincipal` is `kind: 'user'` (`types.ts:123`), and `isHostUserPrincipal` admits exactly that kind. `resolveSessionIdentity` already handles a supplied identity, a re-supplied one, and the tenant policy, and `agent.ts:132` logs `identity/attached` when `shouldLog`. **Nothing in the identity layer needs building; what is missing is a caller.**

`tenant: 'local'` per the ruling. The OS username is display-only per the ruling, and there is no existing reader for it — a display field with no consumer would be a field nobody reads, so it should ride whatever surface actually shows a user, or wait.

## What flips, and what must be re-frozen

`tests/first100/fixtures/P1-07.composition.spec.ts:131`, *"CHARACTERIZATION: /trust-skills cannot grant on a shipped profile, because no host user is attached to the session"*, goes red and is rewritten to assert the grant succeeds. It is in P1-07.U's live frozen entry (31 cases, frozen this batch at `46408e3c10`), so **P1-07.U needs its FIFTH freeze in the same batch** — the title changes, so it is a rename plus a re-freeze, not only a count change.

That is the case working as designed: it was written as a characterization of another epic's gap precisely so that closing the gap would show up here.

## Open questions — none taken

1. **OQ29 — does the anonymous telemetry id become the host user's identity?** The ruling says rename the facility and keep the file. The measurement above is that its value is currently sent off-box as an OTel `user.id` and shown to the user as "Anonymous user". Reusing it as `UserPrincipal.id` makes one uuid both the telemetry subject and the authorization subject. Confirm, or mint a separate `$DSH_HOME` file for the host-user id and leave the telemetry one alone.
2. **OQ30 — which of the five root call sites attach?** The ruling names `profile-boot`/app-boot, which is headless (and the Web app by the same launcher). ACP, SDK-server and webhook are not the local host user, and attaching there would make a remote request claim the machine's user. Recommend: headless + Web app only in this slice, with the other three named in the note as deliberately unattached.
3. **OQ31 — does the delegation chain get a producer in this slice, or a BLOCKED entry?** `extendChain` has no callers and `resolveChildAgentOptions` drops `identity`, so acceptance[0]'s "完整委托链" half stays open whatever this slice does at the root. Recommend: frozen claim scoped to the root manifest, and a new BLOCKED entry for the child half, rather than a claim the tree does not support.

## Status

**No code written.** The census is the deliverable: the identity layer is complete and uncalled, the shipping call sites are twelve and none passes an identity, five of them are roots and only two are the local host user, and the delegation half of acceptance[0] has no producer anywhere in the tree.
