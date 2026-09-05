# First-100 daily digest (24×7 mode, decision C6 item 5)

Append-only; one entry per day, posted before 08:00 local. Newest entry on
top. Each entry: `X/109` accepted, current wave, most recent CI run link(s),
BLOCKED queue summary, rough token-spend estimate.

## 2026-09-07

- **Progress:** 19/109 ACCEPTED, unchanged. No cell greened this session and none could: every GREEN requires an exact-SHA CI artifact, which requires a push, which is refused.
- **Wave:** W4 for the registry epics. Phase-9 opened under decision C3 (Stage-0 registry extension landed; nine rows generated from the SHA-pinned matrix into `tests/first100/registry-extension.json`, leaving `registry.json` byte-identical).
- **P9 contracts written, frozen, mutation-proved, all awaiting CI:** P9-01.C (conformance registration gate), P9-04.C/P/U (graded edit fallback, whole seam), P9-06.C (scriptable input and exit codes), P9-07.C (hard loop budget). P9-05 stopped at pre-flight: two of its four clauses need a tokenizer-source decision. P9-02/03 are gated on P9-01 greening; P9-08/09 are not cleared for early start.
- **CI:** none dispatched. `origin` returns 403 and the `fork` push is refused by this session's classifier.
- **Findings that outlived their epics:**
  - BLOCKED-104: three freeze predicates now gated and mutation-proved (at least one match, at most one, no repeats). 1869 frozen titles, 0 unresolved, 0 ambiguous, 0 duplicated.
  - BLOCKED-106: 24 GREEN cells were hand-written; evidence real, `expectCasesMatched` copied from the freeze rather than computed from the observation. The recomputation gate now proves all 97 cells, **0 false claims**. `EXEC-STATE.ledgerDigest` remains stale at `46b2796c` as the measurable residue.
  - BLOCKED-107: P9-05's exact-count clauses have no reachable subject without a tokenizer source.
  - BLOCKED-108: `test:snapshot` red at 76/115 from P2-03's `action/manifest-appended` event. Repair is `test:snapshot:refresh`, keyless — the earlier claim that it needed a key was wrong.
  - BLOCKED-109: cell greening runs typecheck plus the full unit suite, but not `lint` or `test:snapshot`. Fix written, not applied: it would hard-stop greening while 108 stands and raise the bar on 19 already-accepted epics.
  - Lint debt cleared: 525 errors across 28 First-100 files.
- **BLOCKED queue:** 104 resolved, 105–109 open. Seven items need the maintainer, of which two are permissions rather than judgements: the push path, and approval to run `test:snapshot:refresh`.
- **Token spend:** heavy; one full unit suite (~350s) and three full freeze-corpus sweeps (~10 min each) were run rather than trusted.

### Later the same day — the push opened, and the gate widened

- **The user authorized three commands** (`push fork`, `generate-ledger --green/--accept`, `DSH_SNAPSHOT=refresh`). Everything below follows from that.
- **BLOCKED-106 closed.** All 30 drifted cells regreened **through the tool** from the observations they already cited. Every signature of the hand-writing is gone, and `EXEC-STATE.ledgerDigest` matches `ledger.json` again without anyone touching the field. Recomputation gate: **97 GREEN cells, 97 recomputed, 0 mismatched, 0 unavailable, 0 false claims.**
- **The ledger went DOWN, 19 → 17.** The delegate withdrew its sign-offs on P4-07 and P8-01 after finding both rested on a clause with no subject, using a `--conclusion WITHDRAWN` path added for it. Append-only: the retracted PASS is still readable, and the verdict comes from order rather than deletion.
- **BLOCKED-108 closed**, 76 snapshot failures → 0 locally. Its first diagnosis (needs a key) was wrong; `DSH_SNAPSHOT=refresh` is keyless.
- **BLOCKED-109 adjudicated and applied.** Lint and snapshots joined the greening gate, then lint was re-scoped to files differing from `frozenBaseline` — because 39 of its 95 type-aware errors were this program's (two were real signature bugs discarding type information) and 56 predate the baseline. **Lint is now green on CI.**
- **BLOCKED-110/111/112 opened.** A partial refresh that reports as complete; ~56 repo-level lint errors; environment-dependent snapshot expectations.
- **P9 advanced to four epics with frozen stages:** P9-01 (C/P/U/F), P9-04 (C/P/U/F), P9-06 (C/P/F), P9-07 (C/P). 126 of 132 frozen P9 cases were confirmed present and passing in a real CI observation; the other 6 postdate that run.
- **Doc gates:** the four packages this program left without READMEs now have them, bilingual and paired, plus 15 audited model-experience entries. Three doc gates green; the rest is pre-existing debt.
- **CI now:** unit **green**, scoped lint **green**, snapshots red at three scenarios — two pwsh (absent on this host) and `bash-tool` (the runner has no sandbox backend, so the product correctly refuses to run unconfined). A bubblewrap install with a real confinement control is in flight.
- **Method note that outgrew any single entry:** every failure found today was the same move — *checking something adjacent to the target and reporting it as the target*. Hand-written cells verified against the freeze rather than the observation; `argumentsHash` diagnosed from a summary; a refresh that skipped what it could not run; `lint clean` from a grep pattern the local reporter never emits; a sandbox control stricter than the product it guards. The standing rule adopted from it: **a check returning "none" needs a positive control before it may be reported as "none".**

## 2026-08-31

- **Progress:** 0/109 ACCEPTED (fixed truth: First-100 = 0/100 ACCEPTED until proven otherwise).
- **Wave:** W0 (bootstrap slice) — BASE-ALIGN done (rebaselined `b150a551b8` → `0a53fb55`, `first100-exec` cut from upstream `master`), remaining W0 deliverables (exec state schema, ledger, exact-SHA CI workflow + key migration, goal.md/PreCompact hook) in progress this session.
- **CI:** none dispatched yet — `first100-exact-sha.yml` not yet built.
- **BLOCKED queue:** empty.
- **Token spend:** not yet tracked (first working session).
