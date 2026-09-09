# preFlight — P2-02.U supplement: give the capability token a production subject

Written after the sign-off was WITHDRAWN (§12.69, `189b14360d`). Zero code until this is confirmed.

Measured at `b871e7d481`.

## What the withdrawal rests on — re-measured independently, not taken on report

Per 4.4d, I re-ran each claim rather than accepting it, since the withdrawal came from expanding a measurement I had supplied:

| subject | production callers in `packages/*/*/src` (excluding `lib/`, `tests/`) |
| --- | --- |
| `CapabilityTokenService.issue(` | **0** — nothing on any profile signs a token into existence |
| `tools.requireCapabilityToken()` | **0** — the only hits are its own definition and its effect label at `core/tools/src/index.ts:932,1583,1587` |
| `.attenuate(` / `attenuateDelegatedToken` | **0** |
| capability-token plugin in `packages/bundle/*/cordis.patch.yml` | **absent from every bundle** |
| a token given to a spawned child (`subagent/src/index.ts`, `tool-subagent/src/index.ts`) | **none** |

So must[1] (TrustKernel issues/verifies), must[3] (tools, plugin RPC, external agents and ExecutionWorld all require a token), acceptance[0] and acceptance[1] have **no subject on any launched profile**. The mechanism is complete, tested and unreachable. `assertTokenPresented` being imported by `core/tools` is real but is not the same fact: the check exists and is never armed.

My own contribution to the error is recorded in BLOCKED-168 — I read `attenuateDelegatedToken`'s JSDoc as evidence of a caller, and §12.66 was ruled on that false premise.

## What the supplement builds

1. **Issue.** The TrustKernel signs a session-root token at session start (must[1]). The capability-token plugin mounts in `bundle/base` with a real store path, so all five shipped bundles inheriting base reach it — the §12.20 third question answered by mounting rather than by assertion.
2. **Arm.** That plugin calls `tools.requireCapabilityToken()` in production, and the agent-loop's tool execution presents the session token automatically. A user sees nothing new; the one visible change is that a tool call made OUTSIDE a session, holding no token, is refused. If model-visible text moves at all, the four-corpus snapshot counts are reported with the change.
3. **One derivation, two consumers.** `attenuateDelegatedToken` is LIFTED from `subagent/src/child-agent.ts` into `policy/capability-token` (capability-definitions layer), with the child subject generalised from "agent" to "agent or workflow run". Subagent spawn becomes its **first** production consumer, so acceptance[0] (a child is never wider than its parent) and acceptance[1] (revoking a parent invalidates descendants) freeze against a **real spawn** rather than a constructed token. P4-09's slice then becomes the second consumer of that one path — not a second path.

## must[3]'s four nouns, split under §12.46-B

must[3] requires a token of tools, plugin RPC, external agents and ExecutionWorld. Two land here; two do not, and each gets a readiness entry rather than a silent omission:

| noun | owner | disposition |
| --- | --- | --- |
| tools | **this epic** | armed in (2) |
| sub-agent delegation | **this epic** | the first consumer in (3) |
| plugin RPC | **P1-06** (不可信插件 Out-of-Process Host, W8, depends on P2-02) | readiness BLOCKED entry: the out-of-process host must present a token per RPC |
| ExecutionWorld | **P3-05** (Process、Syscall、IPC 与 Device 隔离, W9) | readiness BLOCKED entry |
| external agents | **P5-07 / P5-08 / P5-09** (Codex, Claude Code and ACP adapters) — measured from the registry rather than assumed; there is no single "external agent" epic, so the requirement attaches to each adapter | readiness BLOCKED entry per adapter |

## 4.4a's third question, per noun

Presence is not reach, which is the whole lesson of the withdrawal, so each is answered by where it is MOUNTED:

- **tools**: armed by the plugin mounted in `bundle/base` → reached by `acp-app`, `headless`, `sdk-app`, `sdk-minimal`, `web-app`.
- **sub-agent delegation**: `tool-subagent` is mounted in `bundle/base:427`, so a spawn on any of those five profiles derives a child token.
- The three deferred nouns are explicitly NOT reached, which is why they are readiness entries and not claims.

## Key material and storage (§12.70)

The root token's signing private key lives **only** in the TrustKernel's private state — the signature roots pinned by `pinTrustKernel` — and reaches no repository file, no config, no log line and no session event. Tests generate their own keypair inside the case rather than reading a fixture, so no committed artifact ever holds one. The token store path is DERIVED from `dshHome`, the way the lease store and the message bus already derive theirs; a hardcoded `.dsh` literal would be the tunable this repo's own rule forbids.

## Not breaking the paths that legitimately hold no token yet (§12.70)

Arming `requireCapabilityToken` makes a tokenless call a refusal, and the risk is not the intended refusal but the unintended one: a legitimate IN-session tool call on `sdk-minimal`, `acp` or a hooks path that never gets a token attached would break while looking like the feature working. The four-corpus snapshots are the instrument — a path that fails to attach shows up there — and they are read as FACTS. If a corpus moves, its count is reported as measured; the normalizer is not touched to make a difference disappear.

## Cases to freeze (freeze precedes observation)

1. A session start issues a root token signed by the TrustKernel.
2. A tool call inside a session presents it and is admitted.
3. **A tool call with no token is refused** — the negative control, and the one that proves the check is armed rather than merely registered.
4. A real spawn derives a child token that is NOT wider than its parent (acceptance[0]).
5. **Revoking the parent makes the child's NEXT TOOL CALL refused** (acceptance[1]) — frozen on a real spawn, through the lineage walk. Verifying a constructed token against a revoked set would prove the function and not the harness, which is the distinction this whole withdrawal turned on.
6. A widening request is refused with its `TokenAttenuationDenialReason`.
7. **The session log and tool results carry only the token's DIGEST, never the token itself** (acceptance[2]). The moment tokens begin flowing through the agent loop is the moment to pin this, because afterwards a leak would be indistinguishable from normal traffic. Mutation: writing the token body into an event must go red.

Mutation expectations are to be RUN and pasted, never predicted (§12.68).

## Status

**No code written.** Submitted for confirmation. P4-09's token slice waits on (3) and must not build a second derivation in the meantime.
