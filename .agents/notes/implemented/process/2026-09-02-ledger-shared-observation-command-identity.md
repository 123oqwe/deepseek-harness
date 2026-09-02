# Agent Note: A shared First-100 CI observation greens multiple ledger cells when their frozen commands differ, not when their files differ

Status: implemented

English | [中文](2026-09-02-ledger-shared-observation-command-identity.zh.md)

## Problem

`scripts/first100/generate-ledger.mjs`'s `cmdGreen`/`cmdGreenSupplement` originally refused to let two ledger cells reference the same observation-report file by content digest (B7①), on the theory that two cells pointing at byte-identical evidence is the signature of "one proof greens many cells" abuse. In practice the program's `.github/workflows/first100-exact-sha.yml` workflow structurally uploads only two distinct observation-file artifacts per run (a signed `first100-evidence-<sha>/vitest-report.json` bundle and a plain `first100-vitest-report-<sha>/vitest-report.json` upload) — both containing the identical full-suite JSON report, just packaged twice. The byte-distinctness rule therefore capped any single CI run at greening two cells regardless of how many frozen commands' expectations that one full-suite run had actually, genuinely satisfied, forcing a wasteful CI run per additional cell even when the evidence for all of them already existed in hand.

## Decision

Predicate (iii) (observation mutual-distinctness), enforced both at cell-green time (`checkSharedObservationAllowed`, used by `cmdGreen`/`cmdGreenSupplement`) and at row-accept time (`checkObservationDistinctness`, used by `cmdAccept`), now permits two cells or supplements to reference the identical observation digest if and only if their frozen commands — `argv` plus the `expectCases` title set, compared via `isIdenticalFrozenCommand` — genuinely differ. Two consumers whose frozen commands are identical still cannot both be greened from one shared observation; that remains the real abuse case this predicate exists to catch. Each cell's own case-titles being present-and-passing in the shared report was already independently enforced by the pre-existing `missing` check, so no new title-verification logic was needed — the byte-identity gate was strictly weaker than that check, not complementary to it.

`usedObservationDigests` now resolves and carries each existing consumer's own frozen `command-freeze.json` entry (looked up by `epic`/`stage`, or by `supplements.epic`/`supplements.stage`/`supplementSeq` for a supplement) alongside its label, so the comparison has real data to compare rather than only a label. An existing consumer whose frozen entry cannot be resolved is treated as a conflict, fail-safe.

## Alternatives considered

**Keep the byte-distinctness rule and instead change the CI workflow to upload more distinct observation-file copies per run.** Rejected: the artifacts would still be byte-identical full-suite reports repackaged under different names, which the original rule's own author later called out as "content-equivalent duplicate uploads... already hollow" — satisfying a file-count requirement without adding any real distinctness. It would also permanently couple the ledger's cell-count-per-run ceiling to however many redundant uploads a workflow author chooses to add, rather than to anything meaningful.

**Allow any sharing, dropping the identical-command check entirely.** Rejected: this would reopen the real abuse the original predicate existed to prevent — one frozen command's single passing observation silently greening a second, unrelated cell whose own expectations were never independently run against that evidence.

## Consequences

Bought: a single CI run's full-suite observation can now green every cell whose frozen command it genuinely satisfies, removing an artificial per-run ceiling that had nothing to do with how much real evidence one run actually produced. `--accept`'s row-level recheck applies the identical rule, so a row is never accepted on distinctness grounds a fresh `cmdGreen` invocation would itself reject.

Cost: `checkObservationDistinctness`'s exported signature gained two required parameters (`freeze`, `epicId`) to resolve each stage's frozen command for comparison; both call sites and the existing spec suite were updated. The comparison is by argv-array-equality plus sorted-title-set-equality, not a deeper semantic diff — two frozen commands that differ only in argument order but are otherwise identical would compare as different for `argv`; this has not occurred in practice and does not weaken the check (it can only make the rule stricter, never permit a real duplicate through).
