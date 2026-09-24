# Agent Note: A report observes only the entries frozen under its own config

Status: implemented

English | [中文](2026-09-24-a-report-observes-only-entries-frozen-under-its-own-config.zh.md)

## Problem

The First-100 exact-SHA workflow writes five vitest JSON reports: the full suite under the default config, three e2e runs under `vitest.e2e.config.ts`, and the recorded-session snapshots under `vitest.snapshot.config.ts`. A vitest JSON report does not record the config it ran under, so `configFrozenReportRefusal` in `scripts/first100/generate-ledger.mjs`, the check that ties a report to a freeze entry, compared test paths only. The blind review of the e2e freeze tools (B-562) found five ways past it: a report of another config that ran the same file was accepted; an argv naming a config and no test path was accepted; the `-c=<path>` spelling vitest accepts was read as naming no config; `cmdGreen` never called the check; and an entry naming no config accepted any report. The in-tree title gate had the matching gap: it added every `--e2e-report`'s titles to the one set it checks default-config entries against, so a deleted default-config test went unreported whenever another config's run carried the same title.

## Decision

`REPORT_CONFIGS` in `generate-ledger.mjs` maps each observation report's file name to the config its workflow step runs: `vitest-report.json` to the default config; `vitest-e2e-sdk-keyless-smoke.json`, `vitest-e2e-acp.json` and `vitest-e2e-workflow.json` to `vitest.e2e.config.ts`; and `vitest-snapshot.json` to `vitest.snapshot.config.ts`. A spec reads `.github/workflows/first100-exact-sha.yml` and requires the map to equal the observation reports the workflow writes, each with the `--config` of the step that writes it.

`configFrozenReportRefusal(argv, reportFiles, reportPath)` refuses a report whose file name the map does not know, a report of a config other than the one the entry's argv names, and an argv that names a config and no test path. For an entry frozen under its own config it still requires that the report ran every test path the argv names. `frozenCommand` reads `-c=<path>` as well as `--config <path>`, `--config=<path>` and `-c <path>`.

Both greening paths of `generate-ledger.mjs`, `cmdGreen` and `--supplement`, call the check after parsing the report and before reading the ledger, and exit 1 with a `BLOCKED:` line when it refuses. `verify-freeze-case-uniqueness.mjs` uses the same check to pick an entry's own `--e2e-report`.

`verify-frozen-titles-in-tree.mjs` looks up an entry that names no config only in the names `vitest list` collects under the default config, and an entry frozen under its own config only in the `--e2e-report` reports the check accepts for it.

## Alternatives considered

- A sidecar file beside each report that names its config. Rejected: the workflow would have to write and upload it, and a report copied without it would need a refusal of its own, while the file name is already part of every report path the tools receive.
- Deriving the config from the report's test file paths. Rejected: `vitest.web.config.ts` and `vitest.snapshot.config.ts` both include `apps/web/tests/**/*.snapshot.ts`, so a path does not determine the config.
- Keeping one set of titles from every report. Rejected: that set is the relaxation the review found, because a title from another config's run says nothing about the tree the default config collects.

## Consequences

- `narrow-report.json` and any renamed report are refused; ledger inputs are full-gate artifacts only.
- An entry that names no config is greened only from `vitest-report.json`, and an entry frozen under a config only from a report of that config.
- A new observation report in `first100-exact-sha.yml` needs its `REPORT_CONFIGS` entry in the same change; the spec that compares the map with the workflow fails until it has one.
- The in-tree gate reports a default-config title as an orphan when only an e2e or snapshot run carries it.
- 2-1(b), the directory prefix, is unchanged: a directory path in a frozen argv still counts as run when one file under it ran.
