# Agent Note: The harness capability benchmark runs the shipped product

Status: implemented

English | [中文](2026-09-28-the-harness-benchmark-runs-the-shipped-product.zh.md)

## Problem

P0-08's benchmark ran four pseudo-random worlds inside the runner process. No trial launched the product, only task success had counts, the other standard metrics had names and no values, and the runner exited 0 whatever the invariants said. Question 18 (a) requires the deterministic, security and fault lanes to run the shipped product with no model API, and every standard metric to be computed from those runs or declared not applicable with the reason (BLOCKED-325, BLOCKED-335).

## Decision

- Every trial of a keyless lane launches `dsh --profile headless` from source in a fresh working directory and `$DSH_HOME`, with no model API configured, and harvests the session logs the run persisted (`benchmarks/harness-capability/product.ts`). The report lists each log's sha256 of its normalized projection, from the recorded-session snapshots' normalizer, and of its raw text.
- The deterministic lane replays recorded headless sessions from `snapshots/session/` through the replay provider, over the same patch layers the snapshot replay uses. The run seed draws 8 trials from the 12 recordings that replay unchanged and hold at least one tool result, and a trial succeeds when its last turn ends for the same reason with the same final assistant text as the recording and every tool result matches the recording once both are normalized.
- A computed metric is `{ value, n, source, ci }`, with a Wilson interval for a rate or a count and a seeded bootstrap interval for a mean; a metric a lane cannot compute is `{ notApplicable }` with the reason `manifest.yml` gives. token_cost prices recorded usage from a table in `manifest.yml` that names its source and the date it was read.
- A lane lists scenarios that fail while an open BLOCKED item stands under `knownRed`, outside its metrics. The run exits 0 when every computed invariant metric is 0 and no known-red scenario passed, 1 otherwise, and 2 on a lane with no scenario or a bad seed.
- The four pseudo-random worlds are removed. The security and fault lanes, and moving the CI step after the native addon build, follow in their own commits.

## Alternatives considered

- **Keep the pseudo-random worlds beside the product lanes.** They measure nothing the product does, and a green from them reads as product evidence.
- **Run the replay through the built `lib/` launcher.** The full suite runs before `pnpm run build`, so a lane observed there would find no build; the source launch needs none.
- **Report token_cost in tokens only.** The metric is a cost; a price table with its source and date says what the tokens cost when the run was measured.

## Consequences

- A lane run takes minutes rather than milliseconds, because every trial starts a product process.
- The frozen P0-08 cases in `tests/benchmark/runner.spec.ts`, `tests/benchmark/lane-runner.spec.ts` and `tests/first100/fixtures/P0-08.composition.spec.ts` pinned the old report; they are superseded with this change.
- Prices change; a report's token_cost names the date its table was read.
- This note supersedes in part [The harness benchmark command runs its lanes and writes both reports](../bug-fix/2026-09-24-the-harness-benchmark-command-runs-and-writes-its-reports.md): a run whose invariants breach now exits 1.
