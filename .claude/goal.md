GOAL: drive all 110 First-100 items to terminal state — the 101 registry rows (100 epics plus P3-13) and the 9 P9 extensions. Terminal = 101/101 ACCEPTED, R10 passed, and each P9 item either VERIFIED or scheduled-BLOCKED on record. Source of truth for the item set is `tests/first100/registry.json` (+ `registry-extension.json` for P9).

NOW lives in `.claude/goal.local.md`, which is untracked and per-worktree. It is not in this file by design: two lanes editing one tracked 39 KB narrative produced a rebase conflict every time and left each worktree holding the other lane's stale snapshot — a wrong anchor is worse than no anchor. The accumulated NOW that used to live here was deleted rather than moved; none of it was a source of truth.

WHERE STATE ACTUALLY LIVES — read these, never a prose summary of them:

- Program state: `spec/first100/exec/EXEC-STATE.json` (digests, totals, current slice) and `spec/first100/exec/ledger.json` (per-epic, per-stage cells). The ledger outranks EXEC-STATE when they disagree, and the tree outranks both.
- Handover between delegate sessions: `spec/first100/exec/DELEGATE-CHECKPOINT*` per EPIC-LIFECYCLE §5.2.
- What happened and why: `spec/first100/exec/plan-rectification-2026-09-06.md` (the delegate's ruling journal, append-only).

RULES — the entry point is the lifecycle file; everything else is reached from it:

- `spec/first100/exec/EPIC-LIFECYCLE.md` — one epic from start to acceptance, every step with its authority. §5.1 is the two-lane protocol, §5.2 the delegate succession. When it conflicts with the authority it cites, the authority wins and the conflict is a bug in that file.
- `spec/first100/exec/BLOCKED-QUEUE.md` — `## Open` awaits a decision; `## Standing` is settled and still binding (several standing rules live only there); `## ACCEPTANCE LOCKS` must be read before accepting any row.
- `spec/first100/exec/make-vs-use-plan.md` — the 110 execution cards, derived; §0 is the one field spec for `preFlight.makeVsUse`. Never hand-edited.
- `AGENTS.md` / `packages/AGENTS.md` — repository conventions, which outrank anything in this file.

TWO RULES THAT COST THE MOST WHEN FORGOTTEN:

- Whoever adds a declaration regenerates its projection, in the same commit. A `SessionEventMap` merge without `gen-persistence-catalog`, or a `registry.json` regeneration without a ledger write, leaves a generated file stale and a gate red — both happened on 2026-09-10.
- "Built" means a production call site a grep can find. Four epics reached green cells over clauses whose subject nothing called (P2-02, P6-07, P1-10, P4-01).
