# Harness capability benchmark framework

A model-independent benchmark for the Harness's own capabilities -- recovery, safety, verification, isolation, cost, and orchestration -- rather than whether an SDK session can start. It extends the SDK-focused instructions in [BENCHMARK.md](../../BENCHMARK.md) with a structured, lane-based framework.

## Stage: Contract only

This directory currently holds the frozen structural schema for [`manifest.yml`](manifest.yml), enforced by [`tests/benchmark/runner.spec.ts`](../../tests/benchmark/runner.spec.ts), and nothing else. `runner.ts`, `report.ts`, and `scenarios/` -- the code that actually boots a profile and executes a lane -- do not exist yet; they are a later, U-stage slice of Epic P0-08 (`tests/first100/registry.json`). `manifest.yml` in this directory is deliberately incomplete relative to the schema it documents below; the test file's header comment explains why.

## The 5 lanes

Every lane entry in `manifest.yml` names one of exactly these 5 lanes:

- `deterministic` -- scripted, seed-driven task fixtures with no external API dependency.
- `fault` -- seeded fault injection (provider failure, crash, network partition) against the same fixtures.
- `security` -- policy-bypass and privilege-escalation attempts against the harness's own guards.
- `real-model` -- the same task fixtures run against a live model provider.
- `scale` -- concurrency and long-run load (many agents, extended duration).

## The 8 standard metrics

Every lane declares exactly these 8 metric names in its `metrics` list:

- `task_success` -- whether the scripted task fixture reached its declared goal state.
- `duplicate_side_effect` -- whether a retried or replayed action produced the effect more than once.
- `policy_bypass` -- whether a guarded action executed without its required policy check.
- `recovery_success` -- whether the harness resumed correctly after an injected fault.
- `verification_precision` -- false-positive/false-negative rate of the harness's own completion verification.
- `router_regret` -- cost/quality delta between the router's chosen model and the best available choice.
- `token_cost` -- tokens and dollar cost consumed by the run.
- `latency` -- wall-clock time from task start to verified completion.

## Confidence intervals and seed replay

Each lane's `reporting` block declares `confidenceInterval: true` and `seedReplay: true`: this lane's report must record a confidence interval per metric and, for every failure, the seed that reproduces it. `manifest.yml`'s comments mark which lanes are currently missing one or both flags.

## Related documentation

- [BENCHMARK.md](../../BENCHMARK.md) -- the SDK-focused benchmark instructions this framework extends.
- [`tests/benchmark/runner.spec.ts`](../../tests/benchmark/runner.spec.ts) -- the structural contract this manifest must satisfy.
- [`packages/test-support/README.md`](../../packages/test-support/README.md) -- keyless test harnesses (Loader smoke boot, LLM mock/replay) relevant to lanes that must run without external API configuration.
