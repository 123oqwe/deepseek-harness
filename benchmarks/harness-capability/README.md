# Harness capability benchmark framework

A model-independent benchmark for the Harness's own capabilities -- recovery, safety, verification, isolation, cost, and orchestration -- rather than whether an SDK session can start. It extends the SDK-focused instructions in [BENCHMARK.md](../../BENCHMARK.md) with a structured, lane-based framework.

## Running the lanes

`pnpm benchmark:harness [--lane <name>]... [--seed <n>] [--out <dir>]` runs the requested lanes one after another, or every lane that has scenarios, from one run seed (a fixed default when `--seed` is absent), and writes `report.json` and `report.md` to `--out` (default `.artifacts/benchmark`, which git ignores). [`runner.ts`](runner.ts) reads [`manifest.yml`](manifest.yml) through [`manifest.ts`](manifest.ts). Every trial launches the shipped product, `dsh --profile headless` from source through [`product.ts`](product.ts), in a fresh working directory and `$DSH_HOME`, and harvests the session logs the run persisted; a fault trial's resume launches again in the same directory. A replaying trial adds the recorded-session snapshots' patch layers and configures no model API; an attacking trial keeps the shipped composition, adds only the patches its attack needs, and points the shipped DeepSeek client at the benchmark's stub model ([`stub-model.ts`](stub-model.ts)) on a loopback port with the key `sk-benchmark-not-a-key`.

The run exits 0 when its base invariants held, 1 when a lane reported a duplicated side effect or a policy bypass or a known-red scenario passed, and 2 when a requested lane has no scenario or `--seed` is not an integer in [0, 2^32).

## The 5 lanes

- `deterministic` -- each trial replays one recorded headless session from `snapshots/session/` through the shipped product and is judged against the recording ([`lanes/deterministic.ts`](lanes/deterministic.ts)). `manifest.yml` lists the recordings it draws from and why the others are left out.
- `security` -- each trial is one attack the shipped product must refuse, asked for by the stub model ([`lanes/security.ts`](lanes/security.ts)): a write outside the workspace under `workspace-write`; a shell write under `read-only`; a write that asks to escalate to `danger-full-access`, which headless has no one to approve; a `run_code` program's tool call after its session token expired; and a write in the same step after an earlier call failed the Run. A trial is judged from the file the attack would write and from the root session's log.
- `fault` -- each trial replays one recorded headless session that changes its workspace and injects one failure at a model call its trial seed picks ([`lanes/fault.ts`](lanes/fault.ts)); trials alternate, a process fault first. A process fault stalls the replay at a call that follows a world-changing call, kills the product with SIGKILL once it has persisted what it wrote, waits for its Run lease to lapse, and resumes the session through the shipped headless runner's `resumeSessionId` with the task given again. The resumed replay starts at the last world-changing call before the stall, so the product meets that call again under its original call id. A model fault makes the replay provider fail with a retryable `SERVER` error before one recorded answer. A trial is judged from its final workspace against the recording's `workspace.expected` and from the root session's log.
- `real-model` -- task fixtures against a live model provider; it needs a model API, so the keyless benchmark does not run it.
- `scale` -- concurrency and long-run load; no scenario yet.

## The 8 standard metrics

Every lane report carries all 8 names. A computed metric is `{ value, n, source, ci }`: the value, the number of trials, what it was read from, and a ~95% interval. A metric the lane has no producer for is `{ notApplicable }`, with the reason `manifest.yml` gives, and carries no value.

- `task_success` -- in a replaying lane, the share of trials whose last turn ended for the same reason with the same final assistant text as the recording, with every tool result matching it once both are normalized; in an attacking lane, the share whose attack was refused for its expected reason, with its target file absent and the turn ended as the attack expects; in the fault lane, the share whose final workspace equals the recording's `workspace.expected` with the last turn completed; Wilson interval.
- `duplicate_side_effect` -- how many trials applied one idempotency key's call more than once. Every tool result of the key's calls counts, except a result recorded without the tool running: a refusal before dispatch, such as the action ledger's refusal of a re-issued call, or a resume's closer for a call that never started. Wilson interval of that per-trial rate.
- `policy_bypass` -- how many attacks wrote their target file or had their call report success; Wilson interval of that per-trial rate.
- `recovery_success` -- the share of fault trials whose failure shows in the session log and whose task then succeeded with no call applied twice, after in-process retries for a model fault and one resume for a process fault; Wilson interval.
- `verification_precision` -- not applicable: the shipped product has no verifier whose verdicts could be scored (BLOCKED-335).
- `router_regret` -- not applicable: the shipped product has no model router (BLOCKED-335).
- `token_cost` -- the mean estimated cost per trial: each assistant message's recorded usage priced from the table in `manifest.yml`, which names its source and the date it was read; seeded bootstrap interval.
- `latency` -- the mean wall-clock time of a trial's product run, summed over a fault trial's launches; seeded bootstrap interval.

`duplicate_side_effect` and `policy_bypass` are the base invariants: a lane that computes one must report 0, and neither ever combines with a model-quality number.

## Trials, known-red scenarios and seed replay

Each lane report lists its `trials`: the scenario, the trial seed, the launch argv, the exit code, each harvested session log's `digest` (the sha256 of its normalized projection; the deterministic lane restores the log as a recorded fixture first, the security and fault lanes normalize the live log as the product wrote it, and replace every idempotency key its manifests declare, wherever it appears, with one token, because a key is a digest over the run id) and `rawSha256` (of the log's text), and where an injected failure landed (`failure`: the turn, the step and the index among the log's events of the retry a model fault left or of the last event a killed product persisted). The deterministic lane adds `toolResults`, with how many tool results were compared and every mismatch; the security lane adds whether the attack `bypassed` the policy and an `observation` of what its call's result said; the fault lane adds the injected `fault`, with its kind, the call it hit and, after a kill, the call the resume started from with the resumed launch's argv and exit code, and an `observation` of the failure and the recovery. The run seed decides which recordings or attacks a lane draws and every trial seed, so the same seed reproduces the same trials and the same digests.

A lane's `knownRed` lists scenarios expected to fail while an open BLOCKED item stands, each with the item, whether it passed and what the trial showed. They are left out of the lane's metrics, and one that passes fails the run. `knownRedCheckedOn` is the date the list was last checked against `spec/first100/exec/BLOCKED-QUEUE.md`; `report.md` states an empty list as `known red: none` with that date.

## Known limitations

- `token_cost` uses the pricing page's standard (peak) prices, not its off-peak discount, so a trial that runs in discounted hours costs less than the report states.
- The pricing page names `deepseek-flash` and `deepseek-v4-pro`, and the recordings request `deepseek-v4-flash`; the price table in `manifest.yml` prices `deepseek-v4-flash` at the page's `deepseek-flash` row. Both reports state this assumption in the `token_cost` source, with the price source and the date the prices were read.
- In the security lane the model is the benchmark's stub; the client, the composition and everything that decides the attack's outcome are the shipped product's. The stub reports 3 input and 1 output tokens per answer, so the lane's `token_cost` prices those, not a real model's usage.
- The fault lane's retry policy (2 retries 1 ms apart, no jitter) and Run lease (5000 ms) are the benchmark's own settings, laid over the replay by a patch; the shipped defaults are 5 retries from 500 ms and a 30 s lease. `recovery_success` states the retry policy in its source.
- A resumed fault trial re-issues the recorded call under its original call id, the re-issue the action ledger's idempotency key (session, call id, arguments) identifies; a model that repeats an action under a new call id is not measured.
- A process fault kills the product while a model call stalls, after the step's tool results are persisted; a kill while a tool runs is not injected.

## Related documentation

- [BENCHMARK.md](../../BENCHMARK.md) -- the SDK-focused benchmark instructions this framework extends.
- [`tests/first100/fixtures/P0-08.benchmark-product.spec.ts`](../../tests/first100/fixtures/P0-08.benchmark-product.spec.ts) -- the report fields this runner must write.
- [`snapshots/session/headless.snapshot.ts`](../../snapshots/session/headless.snapshot.ts) -- the recorded-session replay a deterministic trial repeats without its assertions.
