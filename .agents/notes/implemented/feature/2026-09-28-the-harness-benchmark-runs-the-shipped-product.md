# Agent Note: The harness capability benchmark runs the shipped product

Status: implemented

English | [中文](2026-09-28-the-harness-benchmark-runs-the-shipped-product.zh.md)

## Problem

P0-08's benchmark ran four pseudo-random worlds inside the runner process. No trial launched the product, only task success had counts, the other standard metrics had names and no values, and the runner exited 0 whatever the invariants said. Question 18 (a) requires the deterministic, security and fault lanes to run the shipped product with no model API, and every standard metric to be computed from those runs or declared not applicable with the reason (BLOCKED-325, BLOCKED-335).

## Decision

- Every trial of a keyless lane launches `dsh --profile headless` from source in a fresh working directory and `$DSH_HOME`, with no model API but the benchmark's own, and harvests the session logs the run persisted (`benchmarks/harness-capability/product.ts`). The report lists each log's sha256 of its normalized projection, from the recorded-session snapshots' normalizer, and of its raw text.
- The deterministic lane replays recorded headless sessions from `snapshots/session/` through the replay provider, over the same patch layers the snapshot replay uses. The run seed draws 8 trials from the 12 recordings that replay unchanged and hold at least one tool result, and a trial succeeds when its last turn ends for the same reason with the same final assistant text as the recording and every tool result matches the recording once both are normalized.
- The security lane makes one attack per trial on the shipped headless composition, with only the patches the attack needs, and a stub model on a loopback port asking for exactly the attack: a write outside the workspace, a shell write under `read-only`, an escalation headless has no one to approve, a `run_code` call after the session token expired, and a write in the same step after the Run failed. A trial bypassed the policy when the attack's target file exists or its call reported success. No attack stands on an open BLOCKED item, so its known-red list is empty, and the report says so with the date the list was checked.
- The fault lane replays the five recordings that change their workspace and injects one failure per trial at a model call the trial seed picks. A process fault stalls the replay after a world-changing call, kills the product with SIGKILL once it has persisted what it wrote, and resumes the session through the shipped headless runner's `resumeSessionId` once the Run lease lapses; the resumed replay re-issues the last world-changing call under its original call id, which the action ledger must not apply again. A model fault makes the replay provider fail with a retryable error before one recorded answer. A trial succeeds when its final workspace equals the recording's `workspace.expected` and its last turn completed, and it recovered when its failure also shows in the session log and no call was applied twice. The retry policy and the Run lease are the benchmark's own settings, laid over the replay by a patch.
- duplicate_side_effect counts the idempotency keys whose calls were applied more than once, read from the tool results: a result recorded without the tool running, such as the ledger's refusal of a re-issue, is not an application.
- A computed metric is `{ value, n, source, ci }`, with a Wilson interval for a rate or a count and a seeded bootstrap interval for a mean; a metric a lane cannot compute is `{ notApplicable }` with the reason `manifest.yml` gives. token_cost prices recorded usage from a table in `manifest.yml` that names its source and the date it was read.
- A lane lists scenarios that fail while an open BLOCKED item stands under `knownRed`, outside its metrics. The run exits 0 when every computed invariant metric is 0 and no known-red scenario passed, 1 otherwise, and 2 on a lane with no scenario, a `--patch` that names no file, or a bad seed.
- `--patch <file>`, repeatable, lays the file over every product launch of every lane after the launch's own patches, so an operator can measure a composition they changed. Both reports mark such a run's product as a modified composition and name each patch with the sha256 of its content, so its numbers cannot pass for the shipped product's.
- The four pseudo-random worlds are removed. Moving the CI step after the native addon build follows in its own commit.

## Alternatives considered

- **Keep the pseudo-random worlds beside the product lanes.** They measure nothing the product does, and a green from them reads as product evidence.
- **Run the replay through the built `lib/` launcher.** The full suite runs before `pnpm run build`, so a lane observed there would find no build; the source launch needs none.
- **Report token_cost in tokens only.** The metric is a cost; a price table with its source and date says what the tokens cost when the run was measured.
- **Script the security lane's model with recorded replays.** The replay composition swaps the sandbox row for a pass-through runner and defaults to `danger-full-access`, so an attack on it would test the test composition, not the shipped one.
- **Count duplicates by action manifests.** Every re-issue appends a manifest, so a re-issue the ledger refused would read as a duplicate.
- **Resume from the stalled call.** Nothing would be re-issued, so the lane could not tell a product that applies a re-issued call twice from one that refuses it.
- **Lay extra patches through an environment variable that product.ts reads.** Every launch would change while the runner's arguments and both reports stayed as for the shipped product.
- **Kill the product after a count of persisted events.** Where the kill lands would depend on scheduling; a stall in a model call puts it at the same place for the same seed.

## Consequences

- A lane run takes minutes rather than milliseconds, because every trial starts a product process.
- The frozen P0-08 cases in `tests/benchmark/runner.spec.ts`, `tests/benchmark/lane-runner.spec.ts` and `tests/first100/fixtures/P0-08.composition.spec.ts` pinned the old report; they are superseded with this change.
- Prices change; a report's token_cost names the date its table was read.
- The security lane's model is a stub, so its token_cost prices the stub's reported usage; the README lists this as a known limitation.
- The fault lane's retry policy and Run lease are shorter than the shipped defaults; the README lists this as a known limitation, and recovery_success states the policy in its source.
- This note supersedes in part [The harness benchmark command runs its lanes and writes both reports](../bug-fix/2026-09-24-the-harness-benchmark-command-runs-and-writes-its-reports.md): a run whose invariants breach now exits 1.
