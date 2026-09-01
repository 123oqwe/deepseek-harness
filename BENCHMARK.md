# Running benchmarks

Follow [Get started with the Python SDK](docs/user/guide/python-sdk.md) to install the SDK and run the `jsonrpc-agent` minimal variant. Use separate workspaces and session IDs for independent benchmark tasks.

## Baseline report as evidence-package item 1

Per P0-01's validation clause, the `pnpm baseline:capture` / `pnpm baseline:verify` report (`.dsh/baseline.json`, `docs/audit/baseline-fingerprint-<sha>.md`) is item 1 of every subsequent Evidence Package: a benchmark run's evidence bundle includes the baseline report captured for that checkout state, alongside the run's own receipts, before/after world state, and independent verification.
