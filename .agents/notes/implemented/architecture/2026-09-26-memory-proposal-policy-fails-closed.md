# Agent Note: The memory proposal policy fails closed and ships enabled by default

Status: implemented

English | [中文](2026-09-26-memory-proposal-policy-fails-closed.zh.md)

## Problem

P6-03 `must[1]` requires that every candidate memory write be decided — auto-accepted, sent to human review, or rejected — and `must[2]` requires that sensitive content, and content whose sensitivity nobody assessed, never be auto-admitted into active (recallable) memory. `@deepseek-ai/dsh-memory` ships opt-in and disabled; the decision itself did not yet exist, and where it should live, and what a `memory` mounted *without* it should do, were open.

The trap is the default direction. If the absence of a policy means "auto-accept", then a profile that enables `memory` but forgets the policy silently admits every write — the fail-open direction `must[2]` exists to forbid. The first slice of this package took exactly that wrong default and had to be corrected.

## Decision

A new package, `@deepseek-ai/dsh-memory-policy`, in three parts:

- **A pure decision, `decideProposal`,** separate from the service that applies it. It reads only the proposal's own stated facts (`sensitivity`, `origin`) and the deployment thresholds, so it is testable without a Context and cannot depend on anything else. Order is deliberate: sensitivity is decided before confidence, because a sensitive claim goes to review however sure its writer is; an unstated sensitivity is treated the way active memory's index treats it — not admissible.
- **A thin service** that mounts `ctx.memoryProposalPolicy` and applies the function with its validated `Config` (`reviewBelowConfidence`, a per-deployment bar, not a constant — a shared store wants a stricter bar than a personal one).
- **`dsh-memory`'s `propose` fails closed:** it reaches the policy through `ctx.get('memoryProposalPolicy')`, and with none mounted it holds every write as `pending` rather than admitting it. Only an explicit `auto-accept` stores `active`; a `reject` refuses. So a `memory` enabled without its policy cannot silently auto-accept.

`memory-policy` ships **enabled** in the base bundle (`disabled: false`), unlike `memory` itself. It has no provider dependency and no injections, so with `memory` disabled it only registers the service and is inert. Once a profile enables `memory`, the write path inherits the mounted policy. The single fail-closed path is left for the operator who *explicitly* disables `memory-policy` while `memory` is on.

## Alternatives considered

- **Fail open when no policy is mounted** — auto-accept a write in that case. Rejected: a profile that enables `memory` but not the policy would then silently admit every write, the exact fail-open direction `must[2]` forbids. This was the slice-1 bug, corrected here.
- **Require a memory-enabling profile to also enable `memory-policy`, failing load otherwise.** Considered, but shipping the policy enabled by default is simpler and lets the red-first instrument mount only `memory` — the policy comes for free through the base layer — rather than forcing every such profile and every test fixture to name a second row.
- **Fold the decision into `dsh-memory`'s `propose`, with no separate package.** Rejected: a pure decision kept apart from the seam is testable without a Context and stays a swappable, per-deployment-configurable layer, rather than logic hardcoded in the seam.

## Consequences

- The red-first instrument (lane B's B-651) mounts only `memory` over the shipped profile — which is what a user actually does — and gets the policy for free through the base layer, so a normal write auto-accepts and the control case is green. The instrument does not have to accommodate the implementation.
- The decision is unit-tested without a Context (`tests/proposal.spec.ts`); the service is tested by mounting it on a bare Context (`tests/policy.spec.ts`).
- The review lifecycle (list/approve/reject) and merge/supersede/forget/export propagation (`must[3]`, `acceptance[1]`, `acceptance[2]`) are the next slice; this slice covers the proposal decision and its `pending`/`active` routing only.
