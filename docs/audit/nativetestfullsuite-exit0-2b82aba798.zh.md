# nativeTestFullSuite EXIT_0_CAPTURED — 首次真正转绿（R0.3A）

[English](nativetestfullsuite-exit0-2b82aba798.md) | 中文

Status: EXIT_0_CAPTURED。R0 exit gate item 1 的 `nativeTestFullSuite` 项
真正关闭：在冻结基线 `0a53fb55` 上，一次真实的 Linux CI 全量套件运行，
真实退出码 0。

## 1. Identity

- Candidate SHA：`2b82aba798ee950923e3284e0c8b2c35eefee350`（分支 `first100-exec`）
- CI：`.github/workflows/first100-exact-sha.yml`，run
  [33419862042](https://github.com/123oqwe/deepseek-harness/actions/runs/33419862042)，
  job `install / typecheck / test @ exact SHA`
- Runner：GitHub 托管 `ubuntu-latest`，Node 24

## 2. 结果

`pnpm exec vitest run --reporter=json --outputFile=.artifacts/first100/observations/vitest-report.json`
——真实退出码 **0**。

上传的 artifact（`first100-vitest-report-2b82aba798ee950923e3284e0c8b2c35eefee350`）
原始计数：`numTotalTests: 17436`、`numPassedTests: 17368`、
`numFailedTests: 0`、`numPendingTests: 68`、`success: true`。

下载 artifact 的 sha256：`c293d832efaf4e3a7fb986abf3513f22f4a29e6fe7d291e9865e531d7b63a751`。

## 3. 修复溯源

这是 `packages/terminal/terminal-bash/tests/local.spec.ts` 中 pwsh
real-shell 测试计时修复（commit `2b82aba798`；先前的红态与根因分析见该
commit message 与 `docs/audit/baseline-0a53fb55.md` §3）的直接结果。
从先前的红态运行（`e722878872`，receipt `docs/audit/baseline-0a53fb55.md`）
到本次绿态运行之间，唯一的变化就是这一条测试计时 commit，加上
证据记录 commit `e4a3b24d22`（仅 spec/docs，无产品影响）——由此可将
该修复隔离认定为原因。

## 4. Honesty — 本 receipt 确立与未确立的事实

- **确立：** `nativeTestFullSuite` 真正满足其要求的 `EXIT_0_CAPTURED`
  状态。这是真实的、由 CI 产出的、绑定 exact SHA 的证据（按 maintainer
  决策 A4）——不是本地声明，不是 retry，不是 allowlist。
- **未确立：** `packInstall`、`runnerDryReceipt`、
  `independentReviewReceipts`——本 receipt 均未涉及。
  `spec/first100/exec/EXEC-STATE.json` 的 `programGate` 在四项 R0 行
  全部关闭前保持 `NO-GO`。
- First-100 仍为 0/109 ACCEPTED。
