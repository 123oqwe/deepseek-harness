# Agent Note: The core agent run holds the lease, and tool dispatch presents it

Status: implemented

## Problem

P4-07's fencing rule had no holder. `checkFencing`, `isReclaimable`, the lease store and `advanceAgentLifecycleFenced` all shipped through P4-05's and P4-07's Contract stages, and the count that withdrew P4-07's sign-off was blunt: **zero production callers of either the store's acquire or the fenced advance**. A rule nothing holds refuses nothing.

The workflow engine was made a holder first, and that was not enough. `dsh-subagent` does not depend on `workflow-worker-thread`; P4-06's settlement sender is a subagent, an agent run; P4-12's `LedgerEpoch` sits on the core tool path. None of those pass through a workflow host, so the epoch they wait on could never arrive from there.

## Decision

**The core agent run is the work item.** `RunPlugin` (`@deepseek-ai/dsh-run`) already opens exactly one Run per agent session and owns `Agent.runId`; that is where ownership is decided, so that is where the lease is taken.

- **The lease is acquired BEFORE the Run is registered.** A Run that exists without an owner is a Run a second host can also open work against, and the window between registering and acquiring is the window this epic closes. A refused lease opens **no Run at all** — stop-work, not a warning, because an agent proceeding without one makes state writes nothing can refuse.
- **`Agent.runLease` carries the authority, not the Run Service.** The agent loop is where tool calls are dispatched and `dsh-run` already depends on the agent loop, so a call back into that service would be a cycle. Putting the lease on the Agent lets the dispatcher present it with no dependency on `dsh-run` at all — a composition with no Run Service simply has no lease, answers `no-run`, and dispatches normally.
- **`advanceLeasedAgent` in `dsh-agent` is the one implementation.** Both callers reach it: `RunPlugin`, driving the run's own progress, and `tool-calls.ts`, presenting authority at dispatch. A second copy in either is the shape BLOCKED-136 records, and this is the copy that decides whether a stale host may write. The token and the current lease both come from `Agent.runLease`, never from the caller — a caller supplying its own would be asserting the authority the check verifies. The lease is read through on every call, because a lease this holder has *lost* is the case that matters and a cached copy reports the authority the holder wishes it still had.
- **The lifecycle needs a driver, so `agent/pre-step` is it.** Left undriven the lifecycle stays `queued` forever and every fenced transition is unreachable — a state machine nothing moves refuses nothing, the same defect one level up from the one being fixed. `pre-step` fires when the run is actually about to work, and again after every tool result, so the return from `waiting_tool` needs no second subscription.
- **A fenced dispatch writes every call's synthetic result.** The model must see that its calls did not run; a silent drop would leave the turn's log claiming calls that neither executed nor failed. The error is named `FencedError`, distinct from the abort path, because the model's next move differs: a cancelled turn may be retried, a fenced one must not be.
- **`acquireRunLease` moved to `dsh-lease-contract`.** A holder is not a storage choice, and the two holders — the core agent run and a workflow run — must not depend on each other to share the shape. `RunLease.advance` was dropped in favour of `currentLease()`: the advance needs `dsh-agent`, which a definitions package may not import.

## Evidence

`packages/run/run/tests/fenced-dispatch.spec.ts`, ten cases on a real mounted stack — no hand-built lifecycle, no hand-built epoch:

- The lease exists in the STORE for every opened Run, and `Agent.lifecycle.epoch` equals the epoch the store issued. Asked of the issuer, because a lifecycle carrying an epoch nobody issued is exactly what this refuses.
- Another holder takes the Run → the next state write answers `fenced`, and the lifecycle does not move. **Mutation: `advanceAgentLifecycleFenced` → `advanceAgentLifecycle` reddens exactly this one case.**
- The same write is ADMITTED while this holder is current — the positive control, without which the refusal case passes against an `advance` that refuses everything.
- An illegal transition answers `illegal-transition`, not `fenced`: reporting either as the other makes a routing bug look like a failover.
- A whitespace reason answers `missing-reason`.
- An agent with no lifecycle answers `no-run` rather than being treated as `queued`.
- A store marked unavailable opens no Run and no lifecycle.
- A fenced host executes **zero** tool calls and both results carry `FencedError` with the model-visible refusal text. **Mutation: removing the fenced branch reddens exactly this one case.** Its positive control executes both calls and leaves the agent `running`.

## Consequences

- Every suite that mounts `RunPlugin` must mount a lease-store provider; without one the plugin stays PENDING and opens no Run. That is the intended cost of a real dependency.
- `dsh-agent` no longer depends on `@deepseek-ai/dsh-lease` (the in-memory provider) — only on the contract. `check-layer-deps` findings stay at 120 and the runtime-closure list stays at 16 entries.
- Six of gate (u)'s findings remain (BLOCKED-147); P4-06's two name `core/agent/src/dispatch.ts`, which this change modifies, but a supplement citing it must wait until P4-06 actually consumes the epoch — citing it now would be name-matching, the defect the gate exists to catch.
- Nothing yet moves a Run to `paused`, `waiting_human`, `cancelling`, `completed`, `failed` or `orphaned`. Those states are legal and unreached, and no sweep reclaims an abandoned Run; recorded in the package's Known Limitations.

## Alternatives considered

- **Leave the workflow run as the only holder.** It was the first holder and it is a real one, but `dsh-subagent` does not depend on `workflow-worker-thread`, so a settlement sender and a tool dispatch could never receive an epoch from there. The rule would have held for one kind of work and been unreachable for the rest.
- **Take the lease after registering the Run.** Simpler to write and it leaves exactly the window this epic closes: a Run that exists without an owner is one a second host can open work against, and no later fencing check can undo a write made inside that window.
- **Put the lease behind the Run Service instead of on the Agent.** The natural home for it, and a cycle: the agent loop dispatches tool calls and `dsh-run` already depends on the agent loop, so a dispatcher asking the service for authority would close the loop. Putting it on the Agent also gives a composition with no Run Service a coherent answer (`no-run`) rather than a missing dependency.
- **Warn on a refused lease and continue.** Rejected because an agent proceeding without a lease makes state writes nothing can refuse, which is the failure the capability exists to prevent; a warning would record it after the damage.
- **Cache the current lease in the holder.** Cheaper per check and wrong in the only case that matters: a holder that has LOST its lease is exactly the caller being fenced, and a cache reports the authority it wishes it still had.
