# Agent Note: A reservation is exclusive only when a lease generation backs both sides

Status: implemented

English | [中文](2026-09-12-ledger-reservation-fencing.zh.md)

## Problem

`decideReservation` (`packages/action/action-ledger/src/index.ts`) granted a `prepared` entry to every caller whose epoch was `>= existing.epoch`. At a strictly higher epoch that is required: the fence proves the previous holder is out, which is must[3]'s recovery path. At the SAME epoch the holder is a live peer, and granting it puts two workers on one reservation — the state P4-12 must[2] exists to forbid, produced by the ledger itself.

The defect was invisible for two independent reasons, and both are worth keeping.

**The concurrency case reported the schedule, not the invariant.** `store.spec.ts`'s two-process case asserted one `reserved` and one `duplicate`. A loser can only see `duplicate` once the winner has SENT, and the send is not inside the reservation's transaction: `reserve` spans the read and the write under `BEGIN IMMEDIATE`, then `reserveExternalEffect` calls `markSent` as a second statement. When the loser's transaction ran in the gap between the winner's `COMMIT` and its send, it read `prepared` at its own epoch and was granted the same reservation. The case was green in run 34666554965 and red in run 34667961832 at one SHA.

**A frozen control pinned the defect as the requirement.** `idempotency.e2e.spec.ts`'s `admits the SAME epoch, so fencing refuses only what is genuinely behind` was written as a control against a fence that refuses everything. Its entry helper defaults `state: 'prepared'`, so what it actually froze was that a peer at the holder's own generation may take the reservation. A control needs a generation the fence has genuinely passed, which is a higher one.

**Underneath both, the call site erased the question.** `epochOf` returned `brandNumber<LedgerEpoch>(agent.lifecycle?.epoch ?? 0)`. Only `RunPlugin` assigns `agent.lifecycle`, so every run in a composition that mounts no Run Service reserved at epoch `0` — and presented the same generation as every other such run. For those profiles must[2] was not racy; it was unreachable, and nothing said so.

## Decision

**`'unfenced'` is a state, not the number zero.** `LedgerGeneration = LedgerEpoch | 'unfenced'`, carried by the request, the entry and the store. `generationOf` returns `'unfenced'` when the agent holds no lifecycle instead of defaulting to zero. Every generation comparison requires a generation on both sides: an unfenced caller is outside the ordering, not early in it, so it is neither refused as stale nor treated as a peer.

**A peer at the holder's own generation is refused `held-at-same-epoch`, naming the generation that holds it.** The reason is new because the existing ones assert things that are not true here: `duplicate` asserts the effect already happened, which would let a caller abandon an effect nobody performed, and `stale-epoch` asserts a successor that does not exist. One says wait; the other says stop.

**An unfenced reservation is granted and labelled.** With either side unfenced the ledger re-takes a `prepared` entry, because nothing can prove the holder gone and refusing would strand a key that was never sent — at-least-once is the guarantee that survives without generations. The `reserved` decision carries `fenced`, so an audit reads which rule admitted it. A well-fenced caller taking over an entry whose own holder was unfenced is `fenced: false`: the old holder can still send, and fencing is a property of the pair rather than of the caller.

**The store persists the absence rather than encoding it.** The `epoch` column is nullable, NULL meaning unfenced, at `SCHEMA_VERSION` 2, and an older file is refused at open with the path and both versions named. Every transition matches with `epoch IS ?` rather than `=`, because `NULL = NULL` is false and `=` would refuse every write by the caller just told it holds the reservation — measured as `is held by epoch unfenced, not unfenced`.

## Testing

Three frozen entries are superseded in `spec/first100/exec/command-freeze.json`, each carrying its cell's complete current case list and its own mutation proof. None is registered in `frozen-title-renames.json`: a replacement that asserts the opposite admission is a property change, and a rename would tell the resolver the title had merely moved.

The two-process case now stops AT the reservation and never sends, which is what makes its answer deterministic: must[2] is about two workers HOLDING one reservation, and including the send made the loser's reason a function of the schedule. Its honest twin asserts that two UNFENCED processes are BOTH granted the reservation — the exclusivity a profile without a lease does not get, recorded rather than left for a reader to discover from a duplicate external effect.

Each mutation reddens cases in its own suite and leaves the rest green: deleting the peer refusal reddens two of the contract stage's twenty-two; spelling the transition's match as `=` reddens exactly the unfenced holder's transition; and mapping `'unfenced'` to epoch 0 — the pre-fix call site — reddens exactly the unfenced at-least-once case, because that retry is then refused as its own peer and an unsent effect can never be sent.

The crash campaign's own weakness was measured while verifying this and is NOT fixed here. Its LCG is evaluated in double arithmetic, so from the second iteration the product exceeds 2^53, the low bits are lost, and the crash point is `none` in 9956 of 10,000 iterations, `after-reserve` in 43, `after-send` in 1 and `after-receipt` in none. The campaign passes this change because it barely crashes. Repairing it is entangled with generations — a campaign that really crashed after a reservation needs each attempt to present a new one, which `attempt` now accepts — so it is recorded in the program's BLOCKED queue for the owner to rule on rather than folded in silently.

## Alternatives considered

**Refusing every repeat reservation of a `prepared` entry.** The first attempt at this fix, and it breaks must[3]'s recovery: a generation that crashes before sending would hold its reservation forever, and the effect would never happen. Three frozen cases reddened, the patch was withdrawn, and the entry records it.

**Keeping `?? 0` and treating generation 0 as "no lease".** The cheapest change, and the defect's root. A sentinel makes every lease-less caller the same generation as every other, so the ledger cannot tell a peer from a restart and must silently pick one answer for both: refuse, and at-least-once is lost; admit, and must[2] is vacuous. Naming the absence is what lets the two rules be different rules.

**Preserving the entry's generation when an unfenced caller re-takes it, so a fence is never lowered.** Attractive — it keeps a real generation on the row — and it makes the reservation unusable: the transitions match on the entry's generation, so the caller just granted the reservation could not record its send. The entry carries the new holder's generation, unfenced included, and the degradation is reported on the decision instead.

**Extending the transaction over the send, so the two-process case's original assertion would hold.** Rejected: the send is an external request, and holding a SQLite write lock across it would serialise every external effect in the process and block other keys behind a network call. The fix belongs in the decision the transaction already covers.

**Carrying `fenced` into a new session event.** The audit reads unfencedness today from `action/manifest-appended` omitting `leaseEpoch`, which covers the caller's own state. What it does not distinguish is a fenced caller taking over an unfenced holder's entry. A new event is a `SessionEventMap` change with both SDKs' expected output attached, so the gap is recorded in the package README and the queue entry rather than closed from here.

## Consequences

A retry at the same generation no longer performs the effect. Progress after a crash comes from the next generation, which is what the Run Service issues a replacement process; a caller that retries under its own generation is told `held-at-same-epoch` and the effect stays unsent rather than being sent twice.

`sdk-minimal` mounts no Run Service, so every reservation there is unfenced: at-least-once holds, must[2] does not, and both the decision and the package README now say so. The four profiles that layer `dsh-base` are fenced, since `dsh-run` is enabled there and `run/src/index.ts` assigns the lifecycle epoch from the lease it took.

An existing `action-ledger.sqlite` written by an older build is refused at open rather than migrated, per the pre-release stance. The refusal names the file and both versions; deleting it starts a new ledger.

`ReserveDecision`'s `reserved` member gained a required field, so every consumer that constructs one — the store and the tests — states which rule admitted it. That is the point: a decision that said `fenced` for everything, or left it to be inferred, would carry no information.
