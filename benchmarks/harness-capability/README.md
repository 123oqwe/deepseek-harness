# Harness capability benchmark framework

A model-independent benchmark for the Harness's own capabilities -- recovery, safety, verification, isolation, cost, and orchestration -- rather than whether an SDK session can start. It extends the SDK-focused instructions in [BENCHMARK.md](../../BENCHMARK.md) with a structured, lane-based framework.

## Running the lanes

`pnpm benchmark:harness [--lane <name>]... [--seed <n>] [--out <dir>]` runs the requested lanes, or every lane that has scenarios, from one run seed (a fixed default when `--seed` is absent), and writes `report.json` and `report.md` to `--out` (default `.artifacts/benchmark`, which git ignores). [`runner.ts`](runner.ts) reads [`manifest.yml`](manifest.yml) through [`manifest.ts`](manifest.ts). Every trial launches the shipped product: [`product.ts`](product.ts) runs `dsh --profile headless` from source over the recorded-session snapshots' patch layers, in a fresh working directory and `$DSH_HOME`, with no model API configured, and harvests the session logs the run persisted.

The run exits 0 when its base invariants held, 1 when a lane reported a duplicated side effect or a policy bypass or a known-red scenario passed, and 2 when a requested lane has no scenario or `--seed` is not an integer in [0, 2^32).

## The 5 lanes

- `deterministic` -- each trial replays one recorded headless session from `snapshots/session/` through the shipped product and is judged against the recording ([`lanes/deterministic.ts`](lanes/deterministic.ts)). `manifest.yml` lists the recordings it draws from and why the others are left out.
- `security` -- policy-bypass and privilege-escalation attempts against the harness's own guards; no scenario yet.
- `fault` -- injected model and process failures against recorded sessions; no scenario yet.
- `real-model` -- task fixtures against a live model provider; it needs a model API, so the keyless benchmark does not run it.
- `scale` -- concurrency and long-run load; no scenario yet.

## The 8 standard metrics

Every lane report carries all 8 names. A computed metric is `{ value, n, source, ci }`: the value, the number of trials, what it was read from, and a ~95% interval. A metric the lane has no producer for is `{ notApplicable }`, with the reason `manifest.yml` gives, and carries no value.

- `task_success` -- the share of trials whose last turn ended for the same reason with the same final assistant text as the recording, with every tool result matching it once both are normalized; Wilson interval.
- `duplicate_side_effect` -- how many trials appended one idempotency key's action manifest more than once; Wilson interval of that per-trial rate.
- `policy_bypass` -- how many trials ran something the policy should have refused.
- `recovery_success` -- the share of fault trials that resumed and completed.
- `verification_precision` -- not applicable: the shipped product has no verifier whose verdicts could be scored (BLOCKED-335).
- `router_regret` -- not applicable: the shipped product has no model router (BLOCKED-335).
- `token_cost` -- the mean estimated cost per trial: each assistant message's recorded usage priced from the table in `manifest.yml`, which names its source and the date it was read; seeded bootstrap interval.
- `latency` -- the mean wall-clock time of a product run; seeded bootstrap interval.

`duplicate_side_effect` and `policy_bypass` are the base invariants: a lane that computes one must report 0, and neither ever combines with a model-quality number.

## Trials, known-red scenarios and seed replay

Each lane report lists its `trials`: the scenario, the trial seed, the launch argv, the exit code, each harvested session log's `digest` (the sha256 of its normalized projection) and `rawSha256` (of the log as written), where an injected failure landed, and, for a replaying lane, `toolResults` with how many tool results were compared and every mismatch. The run seed decides which recordings a lane draws and every trial seed, so the same seed reproduces the same trials and the same digests.

A lane's `knownRed` lists scenarios expected to fail while an open BLOCKED item stands, each with the item, whether it passed and what the trial showed. They are left out of the lane's metrics, and one that passes fails the run.

## Related documentation

- [BENCHMARK.md](../../BENCHMARK.md) -- the SDK-focused benchmark instructions this framework extends.
- [`tests/first100/fixtures/P0-08.benchmark-product.spec.ts`](../../tests/first100/fixtures/P0-08.benchmark-product.spec.ts) -- the report fields this runner must write.
- [`snapshots/session/headless.snapshot.ts`](../../snapshots/session/headless.snapshot.ts) -- the recorded-session replay a deterministic trial repeats without its assertions.
