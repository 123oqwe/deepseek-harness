# Agent Note: Entries frozen under their own vitest config are observed from their own reports

Status: implemented

English | [中文](2026-09-24-config-frozen-entries-are-observed-from-their-own-reports.zh.md)

## Problem

The exact-SHA workflow's ledger observation was the full-suite report, a run of the default vitest config. An entry frozen as `vitest run --config vitest.e2e.config.ts <file>` (P4-05.U.4), or under the snapshot config, never appears in that report. The resolvable gate ran such an argv without `--reporter=json` and read no report; the in-tree gate's `vitest list`, also under the default config, reported the entry's titles as deleted; the uniqueness gate required the full-suite report to cover `vitest.e2e.config.ts` as if it were a test path; and `--supplement` had no report to read. A frozen `-t` value was not checked either: an unescaped `[1]` compiles to a character class, selects no case, and the run exits 0 with every frozen case skipped.

## Decision

- **The resolvable gate appends `--reporter=json`** when a frozen argv names none. The freeze itself is unchanged.
- **Each config-specific step writes its own JSON report.** The keyless-smoke and acp e2e steps and the recorded-session snapshot step write `vitest-e2e-*.json` and `vitest-snapshot.json`, uploaded beside the full-suite report in `first100-vitest-report-<sha>`.
- **The in-tree and uniqueness gates take a repeatable `--e2e-report`.** The in-tree gate adds every case name in each report to what `vitest list` collects. The uniqueness gate counts an entry that names a config in that entry's own report, and its argv targets skip the value after `--config` or `-c`. Both steps run after the steps that write the reports.
- **A missing or unreadable report stops both gates.** Otherwise the titles it carries would read as deleted and its targets as uncovered. An e2e step that fails before writing its report therefore also costs that round the in-tree and uniqueness verdicts.
- **`--supplement` refuses a report that did not run every test path a config-frozen argv names**, and names the report to pass instead. Primary cells (`cmdGreen`) have no such check.
- **The resolvable gate compiles a frozen `-t` value as vitest does**, a `RegExp` matched against each case's full name, and refuses an entry when the pattern leaves one of its frozen cases unselected.
- **B5 signs every report the artifact carries**, not only `vitest-report.json`. No ledger tool reads a signature: `cmdGreen` and `--supplement` hash the report they are given. A report's authenticity rests on the CI artifact, traceable by run id, and on the delegate checking each cell's run under 4.4b before a sign-off.

## Alternatives considered

- **Exempt an entry that names a config from the uniqueness gate's whole-suite check.** Rejected: that entry's case names would then be checked for uniqueness nowhere.
- **Keep the in-tree gate before the e2e steps and independent of them.** Rejected: it would read every config-frozen title as deleted.
- **Verify signatures in `--supplement` in this change.** Deferred by the delegate: the full-suite report is under the same trust model, and verification belongs with a decision on which signed file is the ledger's input.

## Consequences

- A new config-frozen entry needs a workflow step whose command is its argv plus the two reporters, a report named `vitest-e2e-*.json`, `vitest-snapshot*.json` or `vitest-web*.json`, and that report in the upload, in-tree, uniqueness and signing lists. The workflow cases check all four places.
- The web-config step for P2-04 U.4 lands with lane A's P2-04 fixture, which is not on the candidate yet.
- The snapshot report is a lib-mode run of every snapshot file, a superset of a snapshot entry's argv, as the full-suite report is for a default-config entry.
