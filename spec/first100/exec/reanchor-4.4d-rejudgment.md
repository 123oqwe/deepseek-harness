# 4.4d re-judgment for the S3 set — suite-level evidence plus grep reachability.

**Not per-epic end-to-end.** This document records what *is* established for the
17-epic 4.4d set and what is not. It is the companion to
`reanchor-4.4bd-wiring-recheck.md` (`9037b0f213`), which answered 4.4b–c and
explicitly declined to answer 4.4d:

> **This is reachability by grep, not by execution.** … 4.4d in the strict sense —
> the capability actually functioning end to end — is what the snapshot suite and
> the registry gate set answer, **and neither has run on the merged tree yet**.

That last clause is now false, and this document exists to record what replaced it.

## 1. Suite-level evidence on the merged tree

Run **34928038271**, `event=push`, head `3672337016…` (commit D, the re-anchored
tree as pushed), both jobs `completed/success`, **zero failed steps**:

```
step 11  First-100 registry gate set                              success
         "registry gate set: 25 gate(s) passed, 1 held back with a stated reason above."
step 13  Full test suite (the ledger's observation input)          success   (26,543 cases, 0 failed)
step 20  Recorded-session snapshots                                success
step 11  Sign the dry/verify evidence bundle (second job)          success
```

These are the two instruments the wiring re-check named as the answer to strict
4.4d, and both are green on the merged tree. Also green earlier at `df85de5e63`
(run#4b, full suite, 0 failures), which is the same tree minus the workflow
fallback commit.

**What this establishes:** no capability in the programme is broken on the
re-anchored tree in a way the snapshot suite or the gate set can see.
**What it does not:** that *each* epic's clause still reaches what it claims. The
evidence is suite-level; 4.4d asks per-epic.

## 2. Wiring re-check coverage of the 17

`9037b0f213` names **8**: P0-02, P0-05, P1-01, P1-03, P1-08, P2-01, P2-02, P2-05.
**Absent: P4-06, P5-11, P2-03, P2-04, P2-06, P3-01, P4-11, P4-01** — and P0-03,
which the set's own source lists as the conservative 18th.

Its measured call-point counts, re-measured here at the current tip with the same
method (non-test `.ts`/`.tsx`/`.mts`, `vendor/` excluded):

| symbol | recheck (2026-09-14) | now | declared by |
|---|---|---|---|
| `resolveProfile` | 11 | **7** | P1-01, P1-08 |
| `composeProfile` | 10 | **6** | P0-02, P0-05, P1-01, P1-03 |
| `assertRuntimeTenantPolicy` | 10 | **5** | P2-01, P2-02 |
| `pluginEnforcement` | 1 | **1** | P1-01 |
| `enforceManifestedAction` | 3 sites | **4** | P2-05 |

**The counts moved and I cannot say why.** Including tests the numbers are 19 / 8
/ 7 / 1 / 7, so the difference is not a test-inclusion difference. Either the
recheck counted references rather than files, or it counted a different file set,
or the tree changed. **Recorded as a discrepancy, not reconciled** — reproducing
its exact method is the only honest way to compare, and I did not have it.

What does hold either way: **every symbol is still reached from production code,
and none has fallen to zero.**

**Addendum, 2026-09-15 (lane A measured; lane B re-measured at `191aa1e502`). Half
of "I cannot say why" can now be said, and one row has no subject.**

1. **The "now" column's method is reproducible, and is written down here.**
   `grep -rl <symbol>` over `packages/` and `apps/`, extensions
   `.ts`/`.tsx`/`.mts`, excluding `/lib/` and `vendor/`, then excluding `/tests/`,
   gives **7 / 6 / 5 / 1 / 4**, digit for digit the "now" column. The
   parenthetical "Including tests the numbers are 19 / 8 / 7 / 1 / 7" is **the
   same match without the `/tests/` exclusion**, and it also reproduces digit for
   digit. **It is a substring match, not a word boundary**, which is where point 2
   comes from.
2. **The `resolveProfile` row has no subject in either column.** The substring
   `resolveProfile` matches 19 files (7 non-test), while `\bresolveProfile\b`
   matches **0 files**, and **no declaration named `resolveProfile` exists under
   `packages/` or `apps/`**. The hits are different symbols that share the prefix,
   such as `resolveProfileDir` (40 references, tests included) and
   `resolveProfileFeatureGates` (20). **`11 → 7` compares two counts of a name
   that does not exist**; the "drop" is a drop in how many files happen to contain
   one of those symbols. **Recommended: strike the row, or re-base it on a real
   symbol.**
3. **Three of the five rows are symbols this program added; upstream never had
   them.** At the fork baseline `4e84901e64` the same method gives
   `resolveProfile` 5 and `composeProfile` 5, and **`assertRuntimeTenantPolicy` 0,
   `pluginEnforcement` 0 and `enforceManifestedAction` 0**. A reading of this
   movement as upstream churn is wrong for those three rows.
4. **The two columns are not comparable: the 2026-09-14 column is closest to
   reference counts, not file counts.** Non-test **references** (`grep -o`
   occurrences) at `3672337016` (D) are `composeProfile` 9 (table 10) and
   `assertRuntimeTenantPolicy` 9 (table 10), each within one on a tree that has
   since moved. That fits the column's own word for its last row, "3 **sites**",
   not "3 files". **It is still not one method:** `pluginEnforcement`'s 1 matches
   the **file** count (its reference count is 3), and `enforceManifestedAction`'s
   3 matches neither its 4 files nor its 10 references. **Printed side by side
   without their methods, the two columns invite the reading that call sites were
   lost.**
5. **The one movement with a known cause is an addition, not a loss.**
   `enforceManifestedAction` went from 3 to 4 because P2-05 added an enforcement
   point: commit `46e3295fec`, *"P2-05 U — the enforcement point, on both dispatch
   paths"*.

**Section 2's conclusion does not change.** "Every symbol is still reached from
production code, and none has fallen to zero" holds under every counting method
above. The one exception is `resolveProfile` by word boundary, which is 0 because
it was never a symbol.

**Two further notes.** The five "now" numbers are identical at `3672337016` (D),
`69a66830e0` and `191aa1e502`, so the column did not move across the unpushed
chain. The 2026-09-14 recheck's own script was not available, so **"does not
reproduce" holds only on the refs measured** (`4e84901e64`, `3672337016`,
`69a66830e0`, `191aa1e502`); the tree that recheck read was the pre-re-anchor
candidate and was not rebuilt. Reference counts include declarations, imports and
comments; they are not call sites in the compiler's sense, and neither column
measured those.

## 3. Grep reachability for the 9 absent epics

Same method, at the current tip.

| epic | its conflict file | status at the tip | production reachability |
|---|---|---|---|
| **P4-06** | `core/agent/src/inbox.ts` (upstream deleted) | successor `core/agent-loop/src/inbox.ts` **exists** | `ReactLoopInbox` reached from **2** non-test files (`agent-loop/src/agent.ts`, `agent-loop/src/inbox.ts`) |
| **P4-06** | `session-persistence/src/write-behind.ts` | **absent at the tip** — deleted upstream by `bec6805d6a`; **no same-named successor, but the write path was replaced** in that same commit by `handle.ts` + `storage-contract.ts` | `writeBehind` reached from **0** non-test files |
| **P4-06** | `subagent/src/continuation.ts`, `subagent/src/index.ts` | both **exist** | (not separately measured) |
| **P5-11** | `core/agent/src/inbox.ts` (deleted) | same successor as P4-06 | same: `ReactLoopInbox` at 2 |
| **P2-03** | `core/tools/src/ptc.ts` | **exists** | — |
| **P2-04** | `ptc.ts` | **exists** | — |
| **P2-06** | `ptc.ts` | **exists** | — |
| **P3-01** | `runtime-context.ts`, `ptc.ts` | both **exist** | `assertRuntimeTenantPolicy` at 5 |
| **P4-11** | `agent-loop/src/agent.ts` | **exists** | — |
| **P4-01** | `bundle/base/package.json` | **exists** | mount surface, not a symbol |
| **P0-03** | (checker inputs, the judgement call) | — | — |

### S3-T1 — P4-06 and P5-11, adjudicated

**Ruling: re-verify, not re-do.** The material:

`write-behind.ts` was deleted by upstream `bec6805d6a` (2026-08-28,
*"refactor(session-persistence)!: handle-based seam with a lifecycle-owned write
path"*). That commit also deleted `coordinator.ts` (−1564) and `preparations.ts`
(−401) and added `handle.ts` (+106) and `storage-contract.ts` (+148). So there is
**no same-named successor, and there is a replacement**: the write path moved to a
handle seam owned by the lifecycle. An earlier version of this section said "no
successor found", which read as *the capability is gone*; it is not.

**No live clause depends on the deleted mechanism.** Measured over every P4-06
freeze entry: the only two that mention `write-behind` or `coordinator` — in
`argv` and `files`, never in `expectCases` — are **both SUPERSEDED** P4-06.P
entries. The ten live entries mention them nowhere. The supersession already moved
the evidence: the live P runs
`session-persistence-jsonl/tests/jsonl.spec.ts`, and P4-06's three acceptance
clauses (idempotent consumption, replay of undelivered messages, tenant
isolation) are pinned by live entries under `packages/run/message-bus/tests/*`.

**P5-11 is the same shape with a successor that was already adjudicated.** Its
conflict file is `core/agent/src/inbox.ts`, whose successor is
`core/agent-loop/src/inbox.ts` per the BASE-ALIGN-v3 S2 adjudication;
`ReactLoopInbox` is reached from two non-test files today.

**What the ruling does not close.** P4-06's registry `files` still names four
paths that do not exist (`core/agent/src/inbox.ts`,
`session-persistence/src/{write-behind,coordinator}.ts`, and
`run/message-bus/tests/crash.e2e.ts` — the last a suffix slip for
`.e2e.spec.ts`), and three **live** entries name absent files. Those are
declaration debt, tracked separately; they do not bear on whether the clauses
hold.

## 4. What this document is, in one sentence

Suite-level green on the merged tree (§1) plus symbol-level reachability (§2, §3)
— **not** per-epic end-to-end verification, which remains undischarged for all 17.
The argv-level re-run planned separately (`argv-rerun-table.md`, 28 commands over
the 33 checklist cells) is the nearest thing to per-epic evidence that exists, and
it covers the S5/S6/S7 set rather than this one.

## 5. Explicitly not claimed

- that any of the 17 has had 4.4a–d re-run in the sense §5(2) of
  `base-align-v3-user-confirmation.md` requires;
- that grep reachability implies the call is on a live path — the wiring
  re-check's own caveat, carried forward unchanged;
- that the call-point counts in §2 are comparable to the 2026-09-14 ones; they
  are printed side by side so the discrepancy is visible, not resolved;
- anything about P0-03, whose inclusion is itself unsettled (16 in the table, 17
  in the heading, 18 with P0-03 — recorded as documentation debt).
