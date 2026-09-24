# Agent Note: The harness benchmark command runs its lanes and writes both reports

Status: implemented

English | [中文](2026-09-24-the-harness-benchmark-command-runs-and-writes-its-reports.zh.md)

## Problem

The registry types P0-08's verify command as `pnpm benchmark:harness`, but the root `package.json` named the script `benchmark:harness-capability`, and the script's target, `benchmarks/harness-capability/runner.ts`, had no entry point: running it loaded the module and exited 0 without running a lane or writing a report (BLOCKED-270). No CI step ran it.

## Decision

- **The script carries the registry's name.** `benchmark:harness` runs `benchmarks/harness-capability/runner.ts`.
- **`runner.ts` has an entry point.** It runs the requested `--lane`s, or every lane the scenarios cover, with `--seed` (a fixed default when absent), and writes `report.json` and `report.md` to `--out`, by default `.artifacts/benchmark`, which git ignores. It exits 0 once the lanes ran and both reports are written, and 2 for a lane with no scenario or a seed outside [0, 2^32). The invariant verdict and any skipped lane are recorded in both reports, not in the exit code.
- **The exact-SHA workflow runs it.** A step with a two-minute timeout runs the deterministic lane with no model API key configured, checks that `report.json` holds that lane alone with trials and that `report.md` is not empty, and uploads both reports.

## Alternatives considered

- **Make the exit code carry the invariant verdict.** Not chosen: the clause asks that the command run completely, reproduce under one seed, score its halves apart and write two reports, and the deterministic lane reports a breach by construction, so an exit code tied to the verdict could never pass.
- **Keep the default output under `.dsh/` and delete it before each run.** Not chosen: `.dsh/` is not ignored, so a report committed by accident could stand in for a run's; changing the default to `.artifacts/` is one string.

## Consequences

- A run whose invariants breach still exits 0; the reports carry the verdict.
- The CI step checks what the command wrote rather than trusting its exit status alone.
