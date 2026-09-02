# First-100 invariants → enforcing gates

Durable register of every invariant this program depends on, and the mechanical
gate (script/check/rule) that enforces it. Built 2026-09-03 per
`BLOCKED-QUEUE.md#BLOCKED-034`'s distilled rule: **an invariant this program
depends on must be enforced by an unskippable mechanical gate, never by an
agent's own diligence alone.** A repeated failure shape across this program's
history (BLOCKED-016/020/023/029/030/033) is exactly this: an invariant held
by "someone remembers to check" → gets missed → a gate gets bolted on after
the fact. This file exists so an unmechanized invariant is *visible as a GAP*
before it causes a REJECT round or a mid-flight stall, not discovered by one.

Append-only in spirit (this is a live status register, not a decision log —
`BLOCKED-QUEUE.md` remains the append-only decision record; this file may be
edited in place to update a GAP's status once it's closed, with the closing
`BLOCKED-0XX`/commit cited).

## Format

Each row: **Invariant** — **Enforcing gate** — **When it runs** — **Status**.

## Mechanized (no action needed — listed for visibility, not because they're at risk)

| Invariant | Enforcing gate | When it runs | Status |
|---|---|---|---|
| Generated spec artifacts (manifest YAML, digests) byte-match the registry | `pnpm run first100:verify-specs` (`generate-specs.ts --check`) | `first100:slice-gate-registry`, every slice touching `registry.json`/`adjudication.json` | Mechanized (BLOCKED-020) |
| A slice's typecheck genuinely matches CI's own build, including test files | `pnpm run first100:verify-typecheck-host` (`tsc -b tsconfig.host.json`) | Unconditionally in `first100:slice-gate` (base gate, inherited everywhere) | Mechanized (BLOCKED-029) |
| `deliverablePathPatches`/coverage meta-logic (`generate-specs.spec.ts`) itself is exercised, not just its byte-output | `pnpm run first100:test-specs` | `first100:slice-gate-registry` | Mechanized (BLOCKED-033-adjacent fix) |
| A flake-registry entry meets the real evidence standard (not same-SHA-all-fail) | `pnpm run first100:verify-flake-registry` | Before registering any flake entry | Mechanized (BLOCKED-023) |
| An `--accept`'s three predicates (coverage closure / candidate-chain consistency / observation distinctness) are real | `generate-ledger.mjs --accept` (`checkCoverageClosure`/chain-consistency/`checkObservationDistinctness`) | Every `--accept` invocation | Mechanized (pre-existing, hardened across the session) |
| A ledger cell only greens from a genuine CI observation at an exact candidate SHA, never a local run | `generate-ledger.mjs --epic ... --report <path> --candidate-sha <sha>` requires a real report file + signature verification (`attest.ts --verify`) before accepting it | Every greening | Mechanized (pre-existing; enforced by Supervisor discipline of independently downloading + verifying every artifact, per this session's standing practice) |
| A `--candidate-sha` is a real, reachable git object, not just 40-hex-shaped | Tracked fix, not yet implemented | — | **GAP, tracked (BLOCKED-015)** — deferred to the same structural-CI-fold breakpoint as BLOCKED-014; not yet built |
| Any future re-anchor's `kind=B` file references are re-verified to exist on the new baseline | New mechanical script (`git cat-file -e` per declared `kind=B` path against the new `frozenBaseline`), plus a `kind=N`-already-exists companion check as a PARTIAL-rescope signal | Any future baseline re-anchor (BASE-ALIGN-v2 and beyond) | **To be built inside BASE-ALIGN-v2** (BLOCKED-033) — specified, not yet implemented |
| **`tests/first100/registry.json` is a faithful, byte-identical extraction of its pinned source docs, never hand-edited** — the foundation every other check in this table (three-predicate accept, coverage closure, command-freeze, owner-map, wave scheduling) is validated *against* | `pnpm run first100:verify-registry-extraction` (`extract-registry.mjs --check` — in-memory re-extraction + byte-compare) | Unconditionally in `first100:slice-gate` (base gate, inherited everywhere, ~0.2s cost) | Mechanized (BLOCKED-035, 2026-09-03) — bidirectionally verified: a hand-edited registry field flips this RED; reverting flips it back GREEN. **Open design prerequisite for BASE-ALIGN-v2, NOT yet solved (see BLOCKED-035): the extractor currently reads exactly 3 fixed docs (`first100-requirements-matrix.md`/`implementation-wave-map.md`/`r0-decision-package.md`) and does NOT consume the `base-align-v2/` vendored docs at all — BASE-ALIGN-v2 must design how its own legitimate registry changes (new frozenBaseline, 23 PARTIAL rescopes, P3-13 addition, the 9 BLOCKED-033 reference retargets) keep this gate passing (by updating the pinned source docs themselves and re-extracting, or by formally extending the extractor's own source set) BEFORE it starts editing the registry — never by bypassing this gate, which would defeat its purpose.** |
| **A ledger row's `--accept` only fires after the delegate's own real three-predicate deep-verify actually happened** — same tier as registry-immutability above ("guards the evidence system itself"): once the Supervisor holds `--accept` execution rights directly (BLOCKED-036), nothing else stops it from running before that review | `generate-ledger.mjs --accept`'s new predicate (iv): `checkDelegateSignoff` requires a `spec/first100/exec/delegate-signoff.json` PASS entry for the exact epic, bound to a sha256 digest of that epic's CURRENT ledger row (a stale entry, from before the row last changed, fails closed); a `USER_CONFIRMATION_TIER_EPICS` epic (`P0-02`/`P2-01`/`P0-07`) additionally requires a `userConfirmationRef`. Writing an entry requires the Supervisor-run `--record-signoff` command. | Every `--accept` invocation | Mechanized (BLOCKED-036, 2026-09-02) — bidirectionally verified end-to-end via a real scratch CLI run (not just unit tests): no sign-off → BLOCKED; valid sign-off at the current row digest → ACCEPTED; row mutated after sign-off → re-BLOCKED as stale; a user-confirmation-tier epic's `--record-signoff` without `--user-confirmation-ref` → refused to write, with the ref → succeeds. 11 unit tests cover every branch of `checkDelegateSignoff`/`rowDigest` (`generate-ledger.spec.ts`). |

## GAP — currently enforced only by an agent's own diligence, not a gate

Ranked by the delegate's own priority: cheapest to mechanize + already caused a real REJECT round, first.

| # | Invariant | Currently enforced by | Real incident it already caused | Proposed gate | Priority |
|---|---|---|---|---|---|
| 1 | A non-trivial code change ships with an Agent Note | Reviewer discretion / this repo's own `AGENTS.md` rule, read and applied manually | P2-01.F's first review round REJECTed solely for a missing Agent Note (the fix itself was already correct) | A pre-merge check: if a commit's diff touches non-test source beyond some line threshold and adds no `.agents/notes/` entry, fail closed (allow an explicit, recorded exemption for genuinely mechanical/local edits, matching `.agents/notes/README.md`'s own existing exemption clause) | **Highest — lowest cost, do first** |
| 2 | A fix round's diff stays inside its stated intent surface (no scope creep) | Reviewer manually diffing base vs fix and eyeballing file list | The `gen-tsconfig-paths.ts` footgun (an unrelated alias silently dropped) hit 3 times this session; P1-01.U's Writer materially exceeded its declared scope (756K tokens/438 tool calls) before anyone caught it | A mechanical check: a fix-round commit touching any file outside the epic's declared `files[]` (or an already-recorded `deliverablePathPatches` entry) fails unless an explicit, freshly-recorded exemption exists | Second |
| 3 | A subagent dispatched onto an existing branch name never force-moves a shared ref | BLOCKED-028's dispatch-prompt-level instruction only (no mechanical interception) | The `git update-ref`-on-a-shared-branch incident (independently confirmed zero data loss, but a real near-miss) | Script the `git worktree list` contention check + nonced-sibling-branch assignment at the Supervisor's OWN dispatch layer (not a machine-level git hook, which was already explicitly declined as out-of-program-scope per BLOCKED-028) — i.e. the Supervisor's dispatch code path itself never hands a Writer an occupied branch name to begin with | Third |

## Maintenance note

When a GAP closes, move its row up to "Mechanized" with the closing `BLOCKED-0XX` entry and commit cited, exactly like the rows above. When a new invariant is identified (a new class of thing this program depends on that isn't yet on this list), add it here BEFORE it becomes a GAP-shaped incident, not after.
