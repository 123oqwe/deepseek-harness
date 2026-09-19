# Evidence package — P4-07 Worker Lease、Heartbeat 与 Fencing Token

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured at `53864d10ad`.

## Summary

Every clause closes. The consumer is `RunPlugin`, which takes a lease on `agent/session-start` before any turn runs, so the whole epic sits on the path a profile takes to open a session rather than behind an option.

| clause | verdict |
| --- | --- |
| must[0] every work item is owned by an epoch lease | closes |
| must[1] state writes and action execution carry a fencing token | closes |
| must[2] heartbeat renews; an expired lease may be reclaimed | closes |
| acceptance[0] a recovered old worker cannot commit or perform new effects | closes |
| acceptance[1] tolerable clock skew does not produce two masters | closes |
| acceptance[2] a lease-store failure stops new work | closes |

## must[0] — the work item is owned by an epoch lease

| question | answer |
| --- | --- |
| exists | `acquireRunLease` (`lease-contract/src/run-lease.ts`) returns a lease carrying `epoch` and `expiresAtMs` |
| production callers | **2** outside the package — `run/run/src/index.ts`, `workflow-worker-thread/src/index.ts` |
| reached | yes — `RunPlugin` acquires on `agent/session-start`, before the first turn |

**The identity of the work item is the load-bearing part, and it was wrong once.** The item is the SESSION (`brandString<WorkItemId>(agent.id)`), not the Run. A `run-<uuid>` is minted fresh on every open, so two hosts driving one session asked for two different items and neither acquire could refuse the other — measured, two processes over one SQLite lease store both got a granted lease at epoch 0. Under that identity acceptance[1] held vacuously. What two hosts actually contend for is a durable session, and that is what the lease is now taken on.

## must[1] — state writes and action execution carry a fencing token

| question | answer |
| --- | --- |
| exists | `checkFencing(token, lease)` (`lease-contract/src/index.ts:53`); `advanceAgentLifecycleFenced` is the only entry point that may move a lifecycle |
| production callers of `advanceAgentLifecycleFenced` | **3** outside the package — `core/agent/src/dispatch.ts`, `core/agent/src/index.ts`, `run/run/src/index.ts` |
| reached | yes |

The distinction the naming carries is the clause: `advanceAgentLifecycle` exists but is not the fenced entry point, and the epoch a lifecycle advances under is one a lease store ISSUED, never one a caller chose.

## must[2] — heartbeat renews, expiry permits reclaim

| question | answer |
| --- | --- |
| exists | `isReclaimable(lease, nowMs)` is `nowMs > lease.expiresAtMs` (`index.ts:73`); renewal refusals include `already-expired`, because renewing an expired lease would resurrect a fenced worker |
| production callers | the Run's heartbeat and the workflow engine's `startHeartbeat` |
| reached | yes — a live run renews on an interval bounded by `leaseMs` |

The boundary is stated rather than left to chance: a lease is still held at the exact instant it expires, so reclaiming at the deadline and renewing at the deadline cannot both win.

## acceptance[0] — a recovered old worker cannot commit or perform new effects

| question | answer |
| --- | --- |
| exists | `Agent.leaseRefused` distinguishes "no Run Service mounted" from "a live store refused this agent's lease" |
| production callers | `run/run/src/index.ts` writes it; `core/agent/src/dispatch.ts` reads it, returning `'lease-refused'` BEFORE checking absence |
| reached | yes — on the dispatch path of every tool call |

**This field exists because absence had two meanings.** An agent with no `lifecycle` is either running where no Run Service is composed — capability absence, which must dispatch normally — or one whose lease a live store refused, which must not dispatch at all. Measured before the field existed: the two were indistinguishable, so a second host that lost the race for a work item kept executing tools against it. That is the two-master state the epic removes, and it was live.

`appendUnauthorizedToolCall(..., 'lease-refused')` renders the refusal as a `LeaseRefusedError` distinct from `FencedError`, so an operator can tell "never held the lease" from "held it and was fenced".

## acceptance[1] — tolerable clock skew does not produce two masters

Rests on must[0]'s corrected item identity plus the epoch comparison: two hosts contending for one session reach one `acquire`, and the loser is refused rather than granted a second lease at the same epoch. Skew moves *when* a lease expires, not *who* holds it, because the holder is decided by the store's write, not by either host's clock reading.

## acceptance[2] — a lease-store failure stops new work

| question | answer |
| --- | --- |
| exists | on `'denied' in taken`, `RunPlugin` opens **no** Run and sets no lifecycle (`run/src/index.ts:~632`) |
| reached | yes, unconditionally on the acquire path |

The code says it plainly: a refused lease is stop-work, not a warning — an agent that proceeded without one would make state writes nothing could refuse. The refusal is also *marked* rather than left as an empty lifecycle, which is what makes acceptance[0] decidable downstream.

## Signing position

All six clauses have live subjects reached on the ordinary session-open and tool-dispatch paths. Two of them — must[0]'s item identity and acceptance[0]'s absence ambiguity — were fixed during this program after being measured wrong, and both fixes are what makes the clauses non-vacuous rather than merely present. No deferral is proposed.

## Forward addendum (2026-09-19): the fencing check does not reach a PTC sub-dispatch

Recorded here so a later reader of this page meets the limit where the clause is argued rather than only in the register ([BLOCKED-265](BLOCKED-QUEUE.md#blocked-265)).

Everything above is about the native dispatch path. A PTC program issues its own sub-dispatches without returning to the model, and `advanceLeasedAgent` — the call this page treats as the fencing check on a tool call — has **no call** in `packages/core/tools/src/ptc.ts` (the single textual occurrence there today is the comment the 2026-09-19 gate landed with, so a grep for the name now answers 1). What partially covers that path instead is the idempotency ledger: `reserveExternalEffect` passes `generationOf(agent)` as the reservation's epoch, so a REPLAY of the same idempotency key from a fenced host is refused `stale-epoch`. A genuinely new key — which is the ordinary case inside a program, since the key derives from the arguments hash — is not.

**What changed on 2026-09-19 and what did not.** The stop half now reaches PTC: `refuseNewAction` is asked per sub-dispatch before any reservation, on both paths, from one decision. The fencing half is in the same function and the same call, so a fenced host's next sub-call is refused too — but **no case observes that yet**: the cases added with it drive the STOP, and P4-07's own frozen cases are all on the native path or in the lease store. Until one does, the fencing arm on the PTC path is code with no observation, which is the shape this program keeps recording.

**Reach, corrected on 2026-09-19 after re-measuring.** PTC is not the DEFAULT presentation mode: `ToolRuntime`'s `mode` defaults to `'native'` (`packages/core/tools/src/index.ts:1047`). It is not a file edit away either. **Two shipped bundles already wire that field to an environment variable** -- `packages/bundle/headless/cordis.patch.yml:16` and `packages/bundle/web-app/cordis.patch.yml:48` both carry `mode: !!js process.env.DSH_TOOLS_MODE`, and both `insert` a `code-runtime` row, so `DSH_TOOLS_MODE=ptc` puts a shipped profile into PTC mode with no file changed at all; unset, the row evaluates to `undefined` and the schema default `'native'` applies, which is why the absence looks like nothing is wired. `apps/web/tests/smoke-real.e2e.ts:593` drives exactly that variable and asserts the wire tools collapse to `run_code`, so the path is exercised rather than hypothetical. An earlier version of this paragraph read *"no bundle in `packages/bundle/**` sets `ptc`"* and called the gap "one config row away": literally true and materially understated, because a grep for the literal `ptc` finds no bundle while two bundles hand the choice to the environment. That is why the gap was closed rather than deferred, and why "not the default" is never recorded here as "safe".
