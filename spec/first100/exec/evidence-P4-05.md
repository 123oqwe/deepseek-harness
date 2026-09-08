# Evidence package — P4-05 扩展 Agent Lifecycle 状态机

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured at `0153699d65`. **Measurement only; nothing was changed.**

## Summary

| clause | verdict |
| --- | --- |
| must[0] the ten named states | exists in full; **four of ten are never produced** |
| must[1] every transition carries reason, runId, lease epoch | closes |
| acceptance[0] illegal transitions and stale worker updates are refused | closes |
| acceptance[1] waiting states consume no LLM/worker resources | **does not close** — `consumesNoResources` has 0 production callers |
| acceptance[2] an orphaned agent can be reclaimed or safely failed after restart | **does not close** — nothing produces `orphaned`, and no reclaim exists |

## The observation age question the delegate raised

P4-05's cells were greened at runs **33946026079** (C), **33946484946** (U) and **33946729009** (F). Those precede this program's rebuild of the P4 line — P4-07's own pre-rebuild cells sat at 33959624760, which is *later* than all three.

Predicate (v) does pass for this row: `verify-freeze-in-candidate-tree` reports 127 GREEN with 0 MISSING, so each of these cells' candidate trees does contain its live freeze entries. **The concern is not (v), it is that the observed code has since changed.** §12.16-3 withdrew `advanceAgentLifecycle` from `@deepseek-ai/dsh-agent`'s exports — a change to this epic's own subject, made after all three observations. The cells are pre-commitments honoured against a tree that no longer matches the tree they describe.

## must[0] — the ten states

| question | answer |
| --- | --- |
| exists | `AgentLifecycleState` (`core/agent/src/state-machine.ts:34`) declares exactly `queued`, `starting`, `running`, `waiting_tool`, `waiting_human`, `paused`, `cancelling`, `failed`, `completed`, `orphaned` |
| production consumers of the type | `dispatch.ts`, `run/run/src/index.ts`, plus the generated catalog |
| reached | **partially** |

Which states a production path actually writes, measured by every `advanceLeasedAgent` / `advance` call site outside the owning package:

| state | producer |
| --- | --- |
| `queued` | initial state |
| `starting` | `run/run/src/index.ts:730` |
| `running` | `run/run/src/index.ts:731`, `:734` |
| `waiting_tool` | `agent-loop/src/tool-calls.ts:95` |
| `cancelling` | `run/run/src/index.ts:706` |
| `completed` | `run/run/src/index.ts:708` |
| `waiting_human` | **none** |
| `paused` | **none** |
| `failed` | **none** |
| `orphaned` | **none** |

Six of ten are produced. The declaration is complete and the vocabulary is right; four members name states no shipped path enters. `failed` is the one worth flagging beyond the count — `TERMINAL_STATES` is `['failed', 'completed']`, so half the terminal set is unreachable, and an agent whose work ends badly reaches `completed` or nothing.

## must[1] — every transition carries reason, runId and lease epoch

| question | answer |
| --- | --- |
| exists | `AgentTransition` requires all three; `decideTransition` refuses an empty reason |
| production callers | `advanceLeasedAgent` from `agent-loop/src/tool-calls.ts` and `run/run/src/index.ts` (4 call sites) |
| reached | yes — on the ordinary dispatch and session-lifecycle paths |

The epoch is one a lease store ISSUED, not one a caller chose; `advanceAgentLifecycleFenced` is the only entry point that may move a lifecycle, and since §12.16-3 the unfenced decision is no longer exported at all.

## acceptance[0] — illegal transitions and stale worker updates are refused

| question | answer |
| --- | --- |
| exists | `LEGAL_TRANSITIONS` gates the move; `checkFencing` refuses a stale epoch |
| production callers | the same four `advanceLeasedAgent` sites |
| reached | yes |

(The `LEGAL_TRANSITIONS` occurrence in `run/message-bus/src/outbox.ts` is an unrelated constant of the same name for the outbox's own states — not a consumer of this one.)

## acceptance[1] — waiting states consume no LLM or worker resources

| question | answer |
| --- | --- |
| exists | `consumesNoResources(state)` and `NON_CONSUMING_STATES` (`state-machine.ts:73`, `:173`) |
| production callers | **0** outside the owning package |
| reached | **no** |

**This does not close.** The predicate that decides whether a state consumes resources is called by nothing, so the clause is a property of a function rather than of the harness's behaviour. Whether a waiting agent actually holds an LLM slot or a worker is not decided by this module today — nothing asks it.

Note this is weaker than it first appears in one direction and stronger in another: the clause may well hold *in fact* (a waiting agent may genuinely hold nothing), but P4-05 offers no mechanism that establishes it, so signing acceptance[1] on this subject would sign a claim the epic does not implement.

## acceptance[2] — an orphaned agent can be reclaimed or safely failed after restart

| question | answer |
| --- | --- |
| exists | `orphaned` is a declared state |
| production producers of `orphaned` | **0** |
| reclaim path | **none found** — no `reclaimOrphaned` or equivalent exists anywhere |
| reached | **no** |

**This does not close, and it is the larger of the two gaps.** Nothing marks an agent orphaned, so nothing can reclaim one; the clause's two arms — reclaim, or fail safely — both operate on a state no path produces. `TERMINAL_STATES` not containing `orphaned` means an orphaned agent would also not be terminal, but the question is moot while the state is unreachable.

## Signing position

must[1] and acceptance[0] close on live consumers reached by every session. must[0] closes as a declaration and is four-tenths unreached. acceptance[1] and acceptance[2] do not close: their subjects have no production caller and no producer respectively.

Two further facts belong in the sign-off decision rather than in this measurement:

1. All three cells were observed **before** §12.16-3 changed this epic's own subject. Whatever is decided about the clauses, the observations describe a tree that no longer exists.
2. The same shape has now been found in P4-08 must[2], P4-09's registry, P5-11 must[1], P4-12 must[2] and P2-03 acceptance[2]: a complete, tested decision module with no consumer. That it recurs suggests the plan generated Contract stages faster than Usage stages, which is a program-level observation and not P4-05's fault.
