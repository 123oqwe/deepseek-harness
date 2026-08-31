# nativeTestFullSuite EXIT_0_CAPTURED — first real green (R0.3A)

English | [中文](nativetestfullsuite-exit0-2b82aba798.zh.md)

Status: EXIT_0_CAPTURED. R0 exit gate item 1's `nativeTestFullSuite` row
closes for real: a genuine Linux CI run of the full suite, at the frozen
baseline `0a53fb55`, real exit 0.

## 1. Identity

- Candidate SHA: `2b82aba798ee950923e3284e0c8b2c35eefee350` (branch `first100-exec`)
- CI: `.github/workflows/first100-exact-sha.yml`, run [33419862042](https://github.com/123oqwe/deepseek-harness/actions/runs/33419862042), job `install / typecheck / test @ exact SHA`
- Runner: GitHub-hosted `ubuntu-latest`, Node 24

## 2. Result

`pnpm exec vitest run --reporter=json --outputFile=.artifacts/first100/observations/vitest-report.json` — real exit **0**.

Raw counts from the uploaded artifact (`first100-vitest-report-2b82aba798ee950923e3284e0c8b2c35eefee350`):
`numTotalTests: 17436`, `numPassedTests: 17368`, `numFailedTests: 0`, `numPendingTests: 68`, `success: true`.

sha256 of the downloaded artifact: `c293d832efaf4e3a7fb986abf3513f22f4a29e6fe7d291e9865e531d7b63a751`.

## 3. Provenance of the fix

This is the direct result of `packages/terminal/terminal-bash/tests/local.spec.ts`'s pwsh real-shell test timing fix (commit `2b82aba798`, see that commit message and `docs/audit/baseline-0a53fb55.md` §3 for the prior red state and root-cause analysis). The only change between the prior red run (`e722878872`, receipt `docs/audit/baseline-0a53fb55.md`) and this green run is that one test-timing commit plus the evidence-recording commit `e4a3b24d22` (spec/docs only, no product-affecting change) — isolating the fix as the cause.

## 4. Honesty — what this receipt does and does not establish

- **Does establish:** `nativeTestFullSuite` genuinely meets its required `EXIT_0_CAPTURED` status. This is real, CI-produced, exact-SHA-bound evidence per maintainer decision A4 — not a local claim, not a retry, not an allowlist.
- **Does NOT establish:** `packInstall`, `runnerDryReceipt`, or `independentReviewReceipts` — none of those are addressed by this receipt. `spec/first100/exec/EXEC-STATE.json`'s `programGate` stays `NO-GO` until all four R0 rows close.
- First-100 remains 0/109 ACCEPTED.
