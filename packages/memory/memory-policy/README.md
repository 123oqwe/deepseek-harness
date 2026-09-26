# @deepseek-ai/dsh-memory-policy

P6-03 proposal policy for the durable Memory capability. Mounts the
`memoryProposalPolicy` service that `@deepseek-ai/dsh-memory`'s `propose` path
consults to decide whether a candidate write is **auto-accepted**, sent to
**human review**, or **rejected** (`must[1]`), and always sends sensitive or
unassessed content to review rather than into active memory (`must[2]`).

The decision itself, `decideProposal`, is a pure function; this package's
service is the thin provider that applies it with a deployment's thresholds. A
deployment that omits this plugin keeps the pre-P6-03 behaviour — every
traceable write is auto-accepted — so mounting it is what turns the policy on.

## Model Experience

The model never calls this package directly; it proposes a memory through
`ctx.memory.propose`, and this policy decides what becomes of that proposal.

- **What the model can rely on:** a proposal it marks `sensitive`, or leaves
  unassessed, does not silently become recallable memory — it waits for a human.
  A normal, traceable, sufficiently-confident proposal is admitted and becomes
  retrievable.
- **Tokens / KV cache:** none. The policy runs at write time, decides a
  disposition, and adds nothing to any model request; a `pending` record is
  simply withheld from later recall until approved.

## Known Limitations and Deferred Work

- The review lifecycle beyond the disposition — listing pending proposals and
  approving or rejecting them — and merge/supersede/forget/export propagation
  (`must[3]`, `acceptance[1]`, `acceptance[2]`) are the next P6-03 slice; this
  package's first slice covers the proposal decision and its `pending`/`active`
  routing only.
