# Dispatch intelligence: what is startable, and what unblocks what

Read-only. Produced by lane B on request at `441584b2af`, base `d69d6e5b3e`. Nothing here chooses an assignment.

## The READY table is empty, and that is the finding

`node scripts/first100/check-ready.mjs` over every non-ACCEPTED row:

```
0 epic(s) ready to start:
  in flight: 2 — P1-10 P4-11
  blocked by predecessors: 66
  blocked by file overlap: 0
  awaiting acceptance: 5 — P1-07 P4-01 P6-01 P6-02 P6-07
  built, awaiting observation: 2 — P2-05 P4-02
```

**No epic can be started.** P2-05 and P4-02 were the two READY rows until they were built; they are now awaiting observation, and nothing moved up behind them. So a lane-disjointness table over the READY set has no rows to compute — the question it answers does not arise today, and reporting a table of zero rows as though it were an answer would hide that.

**The consequence for §5.1.13.** "A lane always holds an assignment" cannot be met by dispatching a new epic. The only work that exists is: finishing what is in flight, clearing the five awaiting acceptance, observing the two that are built, and the remediation slices already scheduled. That is a scheduling fact, not a complaint — but a delegate looking for something to assign will not find it in the READY set.

## What each active row would unblock if it landed

Computed from the `predecessors` graph, counting only successors not already ACCEPTED, and separating "would become READY immediately" from "still waits on something else". A successor's other predecessors count as landed when ACCEPTED **or** when every applicable cell is green — the same admission `check-ready.mjs:220` makes, so that a withdrawn-but-green predecessor is not counted as a blocker.

| row | state | successors pending | would become READY at once | who |
|---|---|---|---|---|
| **P2-05** | awaiting observation | 11 | **4** | P2-06, P2-10, P2-12, P3-01 |
| **P4-01** | awaiting acceptance | 6 | **2** | P4-02, P4-11 |
| **P6-01** | awaiting acceptance | 2 | 1 | P6-02 |
| **P4-11** | in flight | 2 | 0 | — |
| **P4-02** | awaiting observation | 2 | 0 | — |
| **P6-02** | awaiting acceptance | 1 | 0 | — |
| P1-07, P1-10, P6-07 | — | 0 | 0 | — |

**The highest-leverage row by a wide margin is P2-05**: observing it unblocks four epics at once and makes another seven one predecessor closer — including P3-01, on which `P3-02…P3-12` and much of P4 ultimately sit. Second is P4-01's re-signature, which is what P4-02 and P4-11 are nominally waiting on (both are already in flight or built, so this unblocks their ACCEPTANCE rather than their start — §12.83's distinction).

**Three rows unblock nothing at all** — P1-07, P1-10 and P6-07 have no pending successors. Their value is the clause they close, not the doors they open; worth knowing when sequencing, because finishing them buys no parallelism.

## A measurement caveat about `checkParallelLaneDisjointness`

The delegate named `generate-specs.ts:975` for the overlap columns. Read before use: it considers only `files[]` entries whose `kind` is `N` or `P` — the epic's **owned** files — and ignores `[B]` shared base files and every path declared under `stages`. `check-ready.mjs`'s own overlap condition uses a wider set (`files[] ∪ all four stages' files`).

So the two are different questions: `checkParallelLaneDisjointness` asks "would two lanes both claim to author the same new file", and `check-ready` asks "do two epics' declared paths touch at all". For this report the distinction is moot — `check-ready` reports `blocked by file overlap: 0`, so neither notion finds a conflict among the active rows — but a later dispatch decision that relies on the narrower one should say which it used.
