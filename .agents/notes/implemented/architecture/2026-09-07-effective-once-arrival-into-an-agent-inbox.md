# Agent Note: At-least-once delivery into an agent inbox, made effective-once by the consumer

Status: implemented

## Problem

Epic P4-06's must[2] — "the consumer deduplicates by `(source, message id, epoch)`" — had a rule, a key derivation, and no consumer. `@deepseek-ai/dsh-intake-dedup` owned the derivation and `dsh-message-bus` joined it to a mailbox, but the epic's own declared Usage consumer, `packages/core/agent/src/inbox.ts`, had zero references to any of it. Gate (u) reported it and BLOCKED-147 classified it as one of six real integration gaps.

The `Inbox` did refuse a duplicate *pending* identity, and that is not the same rule. A message that has been claimed and run is no longer pending, so a second arrival of it inserts cleanly and its effect happens twice — acceptance[0]'s exact failure.

The third of the key that was missing until now is the epoch. It is the SENDER's generation, and no sender had one: agent runs acquired no lease until §12.19-3 and no shipped profile mounted the Run Service until §12.20.

## Decision

- **The consumer is the agent inbox, and the sender is a settling subagent.** `Inbox` keeps a `consumed` set keyed by `dedupKey({ source, id, epoch })` and refuses an insertion whose key it has already run, throwing `DuplicateArrivalError`.
- **`id` is the SENDER's stable identity, not the message's.** `createUserMessage` mints a fresh message id per delivery, so keying on it would give a redelivery a different key from the delivery it repeats and refuse nothing. The id is the child session, which outlives each of its activations; the epoch says which activation spoke.
- **The set is rebuilt from the session's own log**, which is the only reason it means anything: a seen-set assembled in memory is empty after exactly the event it exists to survive. No new session event was needed — a claim is already distinguishable in the log as a splice that removes messages, inserts none, and is not marked `canceled`. A second marker could disagree with the first.
- **A cancellation consumes nothing.** It removes messages too, and those never ran; keying them would refuse a legitimate resend of work that never happened — the opposite failure.
- **A source with no epoch is not deduplicated**, and that is the contract rather than a gap. Keying a source without a generation would make every later message from it collide with an earlier one and be dropped.
- **The sender states its generation.** `SubagentSettledMessageSource` gained `senderEpoch`, read from the child's `Agent.lifecycle` before the handle is disposed.

## Evidence

Unit, in `dsh-agent` (six cases): refusal after a claim; admission in a later epoch; admission from a different child; a cancellation consuming nothing; **survival across a restart**, driven as a second `Inbox` projecting the same durable log; and the documented no-epoch fall-through.

Composition, in `dsh-subagent` (one case, on the real manager with the Run Service and a lease provider mounted): the manager's own settlement notice carries `senderEpoch` equal to the epoch the store issued the child's Run, and redelivering that notice to the parent inbox is refused.

Mutations, each measured:
- Constant epoch in the key → reddens exactly the later-epoch case.
- Sender omits `senderEpoch` → reddens exactly the composition case.

**One measurement worth recording because it corrects a comment I wrote.** Replacing the `source` component with a constant reddens NOTHING in the unit set: every sender that reaches this inbox with an epoch is a `subagent-settled` notice today, so the case I had labelled "one sender cannot suppress another" actually varies the `id`. The case and the module doc now say that, and point at `dsh-intake-dedup` for the component's own coverage. A case whose name claims more than its assertion is the defect shape this program keeps finding.

## Consequences

- Any composition mounting `RunPlugin` needs a lease provider; `tests/first100/fixtures/loader/p4-01-run/cordis.yml` gained one, so P4-01's seven frozen cases pass in the same observation rather than being superseded (BLOCKED-059).
- `senderEpoch` is model-visible through the session log, so every snapshot corpus was refreshed.
- `dsh-agent` now depends on `@deepseek-ai/dsh-intake-dedup` (capability-definitions → capability-definitions). `check-layer-deps` findings unchanged at 120.
- Five of gate (u)'s six integration gaps remain.

## Alternatives considered

- **Key on the message id.** The obvious identity and the one that refuses nothing: `createUserMessage` mints a fresh id per delivery, so a redelivery carries a different key from the delivery it repeats. The sender's own identity is what survives a redelivery.
- **Keep the seen-set in memory.** Free, and empty after exactly the event it exists to survive. Rebuilding from the session log is the only version of this rule that holds across a restart.
- **Record a new session event marking a claim.** Considered and rejected because the log already distinguishes one — a splice that removes messages, inserts none, and is not marked `canceled` — and a second marker could disagree with the first about what was consumed.
- **Treat a cancellation as consuming.** It removes messages the same way and they never ran, so keying them would refuse a legitimate resend of work that never happened: the opposite failure, arrived at by pattern-matching on the mutation rather than on the meaning.
- **Deduplicate a source that carries no epoch.** Would make every later message from that source collide with an earlier one and be silently dropped. Leaving it undeduplicated is stated in the contract rather than left as a gap.
