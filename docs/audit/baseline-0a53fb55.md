# Clean-branch full-suite receipt — R0.3A (re-baseline 0a53fb55)

English | [中文](baseline-0a53fb55.zh.md)

Status: EVIDENCE CAPTURED (Linux CI, real exit) — R0 exit gate item 1's
`nativeTestFullSuite` row moves from "no capture attempted" to a real,
fail-closed capture; still short of `EXIT_0_CAPTURED` because the real exit
is 1, not 0. `packInstall` is NOT addressed by this receipt — this run does
not exercise pack/verify-packed-install and stays untouched (still "no
capture attempted yet" per `spec/first100/exec/r0-gate-baseline-transition.json`).

## 1. Identity

- Candidate SHA: `e722878872fce23bf425df23058c9f33ca0b118b` (branch `first100-exec`, exactly the tip pushed for this run — the workflow's own "Verify checkout landed on the requested SHA" step confirms it)
- Frozen baseline: `0a53fb55bea101816fa226bb964ae2bed71c343b` (this SHA is a descendant of it, per `tests/first100/registry.json`'s `frozenBaseline`)
- CI: GitHub Actions, `.github/workflows/first100-exact-sha.yml`, run [33416915582](https://github.com/123oqwe/deepseek-harness/actions/runs/33416915582), job `install / typecheck / test @ exact SHA`, triggered by the `push` trigger on `first100-exec` (maintainer decision A4 — the only channel a ledger cell may ever green from)
- Runner: GitHub-hosted `ubuntu-latest`, Node 24

## 2. Command / exit / evidence

| step | command | real exit | evidence |
|---|---|---|---|
| install | `pnpm install --frozen-lockfile` | **0** | job step "Install (immutable)" green |
| typecheck | `pnpm run typecheck` | **0** | job step "Typecheck" green |
| test (full suite, real exit, never swallowed) | `pnpm exec vitest run --reporter=json --outputFile=.artifacts/first100/observations/vitest-report.json` | **1** | artifact `first100-vitest-report-e722878872fce23bf425df23058c9f33ca0b118b` (uploaded even on failure, `if: always()`); local copy sha256 `211a316f81d84acb757d32894bf9e9eb2950158bba0222b24082a09d238baa5a` |

Raw counts from the uploaded report: `numTotalTests: 17436`, `numPassedTests: 17367`, `numFailedTests: 1`, `numPendingTests: 68`, `numTotalTestSuites: 3472`, `numFailedTestSuites: 2`.

## 3. The one failure

```
packages/terminal/terminal-bash/tests/local.spec.ts
  terminal-bash pwsh real shell bootstraps a persistent pwsh, persists state, and scrubs secrets
  AssertionError: expected 'inferred_idle' to be 'stdin_read' // Object.is equality
```

This is the same deterministic defect already classified in the earlier
R0-5 targeted-classification probe (`r0-5-item1-ci-classification-33256815163.txt`,
run [33256815163](https://github.com/123oqwe/deepseek-harness/actions/runs/33256815163),
at the retired `b150a551b8` baseline): an idle-inference race between
`inferred_idle` and `stdin_read` in the persistent-pwsh path, reproduced
4/4 times across full-suite and isolation samples on Linux CI. That probe's
conclusion — "a real baseline defect, not environmental" — stands; this
receipt is the first confirmation that the same defect survives at the new
baseline `0a53fb55`, 1313+ commits later.

**Notably absent this run:** the earlier probe's other two failures
(`local.spec.ts:333` empty-viewport raw-echo race, and the
`loader-composition.spec.ts:142` scrollback-eviction timeout) do NOT
reproduce here. Not investigated further in this receipt — plausibly fixed
upstream somewhere in the 1313+ commits between `b150a551b8` and
`0a53fb55`, but that is an inference, not verified fact.

## 4. Honesty — what this receipt does and does not establish

- **Does establish:** a real, fail-closed (never swallowed, never
  retried-to-green) Linux CI capture of the full suite at the new frozen
  baseline, uploaded as a genuine artifact from the only workflow A4
  authorizes for ledger-greening. Two of the three previously-known
  environmental/defect failures no longer reproduce.
- **Does NOT establish:** `nativeTestFullSuite` EXIT_0_CAPTURED — the real
  exit is 1. Per maintainer decision A2, this remaining failure must be
  genuinely fixed as a real W0/wave repair item, not allowlisted, skipped,
  or retried to green. `spec/first100/exec/EXEC-STATE.json`'s
  `programGate` stays `NO-GO`.
- **Does NOT establish** anything about `packInstall` — this workflow does
  not run pack or `verify-packed-install` yet; that row is untouched by
  this receipt.
- First-100 remains 0/109 ACCEPTED; W1 remains BLOCKED pending a genuine
  fix of the `inferred_idle`/`stdin_read` race (or a fresh maintainer
  decision on an alternative path) plus capture of the three still-open
  R0 evidence rows (`packInstall`, `runnerDryReceipt`,
  `independentReviewReceipts`).
