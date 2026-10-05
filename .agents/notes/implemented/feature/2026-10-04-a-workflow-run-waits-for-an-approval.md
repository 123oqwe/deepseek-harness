# Agent Note: A workflow run waits for an approval

Status: implemented

English | [中文](2026-10-04-a-workflow-run-waits-for-an-approval.zh.md)

## Problem

Epic P2-07 must[2] and must[3] require a run to wait durably for an approval and to be resumed once the approval is decided, in the same process or after a restart (acceptance[0]), and an approval to be consumed at most once when two resumes race (acceptance[1]). After U1 every approval goes through the durable queue, but only a turn's tool call asks, and it waits inside its turn; nothing that outlives a process could wait.

## Decision

- **A workflow run waits (the delegate's ruling, option A).** A script's `await approval({ title })` is the waiting call, and only a detached run may make it: only a detached run outlives the turn that started it, so only it can be woken. Elsewhere the call throws `APPROVAL_UNAVAILABLE`, as it does where no approval store is mounted.
- **The journal holds the wait.** The host records a run-scoped approval as the run's own session, journals the asking call's key, the approval id and the tenant and principal it was recorded as, together with what the run was started with, then settles the run `waiting_for_approval` and gives back its worker, lease and agent. The waiting state lives only in the journal and the store.
- **A wake is a resume.** `approval-store/changed` in this process, and a scan of the home's journals once the approval store and the agent registry mount, resume the run in its own session with its journaled model route, take its lease, reconcile its journal and re-run the script. The re-run reaches the same call, which consumes the approval by compare-and-swap, so of two resumes at most one continues past it.
- **The journaled viewer consumes (D2).** The approval is read and consumed as the tenant and principal journaled with the call, never as the resuming process.
- **A refusal is catchable.** A denied, revoked, lapsed or already consumed approval throws `ApprovalRefusedError` with its `refusal`. It is not a fatal `WorkflowError`, so a script may take another branch, and the asked action never runs on its behalf.
- **The woken session holds the token it held (D8).** Before the run's session is resumed, `adoptDelegatedToken` hands it the newest delegated token recorded for it, the same token, so its scope and revocation lineage cannot change. It is never issued a root, which would be wider than what its launcher delegated; an expired or revoked token leaves it holding none, and its tool calls are refused.
- **Not model-visible.** No session event is added. A model collecting a waiting run with `attach` reads an error naming the approval.

## Alternatives considered

- **An agent Run waits (option B).** It needs a model-visible result and follow-up, a rule binding an approval to one call, a wake API the Run plugin lacks, and a lease keyed by session.
- **Issue the woken session a token on demand.** With its launcher gone the provider would issue a root, wider than the filter its launcher delegated.
- **Also write the waiting state to the run store.** A second record of a fact the journal already holds.

## Consequences

- `WorkflowStopReason` gains `waiting_for_approval`, and every exhaustive consumer handles it; tool-workflow records the end of foreground runs only, which never wait.
- An approval that lapses, or one another process decides in a shared store, wakes its run only at the next scan.
- `approvalWaitMs` (default one day) should not exceed the session token's lifetime: a run woken after its token expired holds none.
