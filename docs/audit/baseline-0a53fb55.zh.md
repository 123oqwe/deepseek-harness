# Clean-branch full-suite receipt — R0.3A (re-baseline 0a53fb55)

[English](baseline-0a53fb55.md) | 中文

Status: EVIDENCE CAPTURED（Linux CI，真实退出码）——R0 exit gate item 1 的
`nativeTestFullSuite` 项从"尚未采集"变为一次真实、fail-closed 的采集；
仍未达到 `EXIT_0_CAPTURED`，因为真实退出码是 1，不是 0。本 receipt 不涉及
`packInstall`——本次运行不执行 pack/verify-packed-install，该项保持不变
（仍是 `spec/first100/exec/r0-gate-baseline-transition.json` 中所记录的
"尚未采集"）。

## 1. Identity

- Candidate SHA：`e722878872fce23bf425df23058c9f33ca0b118b`（分支
  `first100-exec`，正是本次运行 push 的 tip——workflow 自身的
  "Verify checkout landed on the requested SHA" 步骤已确认）
- Frozen baseline：`0a53fb55bea101816fa226bb964ae2bed71c343b`（该 SHA
  是其后代提交，见 `tests/first100/registry.json` 的 `frozenBaseline`）
- CI：GitHub Actions，`.github/workflows/first100-exact-sha.yml`，run
  [33416915582](https://github.com/123oqwe/deepseek-harness/actions/runs/33416915582)，
  job `install / typecheck / test @ exact SHA`，由 `first100-exec` 上的
  `push` 触发（maintainer 决策 A4——唯一被授权点绿 ledger 格的通道）
- Runner：GitHub 托管 `ubuntu-latest`，Node 24

## 2. Command / exit / evidence

| step | command | real exit | evidence |
|---|---|---|---|
| install | `pnpm install --frozen-lockfile` | **0** | job step "Install (immutable)" 绿 |
| typecheck | `pnpm run typecheck` | **0** | job step "Typecheck" 绿 |
| test（全量套件，真实退出码，从不吞掉）| `pnpm exec vitest run --reporter=json --outputFile=.artifacts/first100/observations/vitest-report.json` | **1** | artifact `first100-vitest-report-e722878872fce23bf425df23058c9f33ca0b118b`（即使失败也上传，`if: always()`）；本地副本 sha256 `211a316f81d84acb757d32894bf9e9eb2950158bba0222b24082a09d238baa5a` |

上传报告中的原始计数：`numTotalTests: 17436`、`numPassedTests: 17367`、
`numFailedTests: 1`、`numPendingTests: 68`、`numTotalTestSuites: 3472`、
`numFailedTestSuites: 2`。

## 3. 唯一的失败

```
packages/terminal/terminal-bash/tests/local.spec.ts
  terminal-bash pwsh real shell bootstraps a persistent pwsh, persists state, and scrubs secrets
  AssertionError: expected 'inferred_idle' to be 'stdin_read' // Object.is equality
```

这与早前 R0-5 targeted-classification probe 已分类的确定性缺陷相同
（`r0-5-item1-ci-classification-33256815163.txt`，run
[33256815163](https://github.com/123oqwe/deepseek-harness/actions/runs/33256815163)，
在已退役的 `b150a551b8` 基线上）：persistent-pwsh 路径中 `inferred_idle`
与 `stdin_read` 之间的 idle-inference race，在全量套件与隔离采样中
Linux CI 上 4/4 复现。该 probe 的结论——"真实基线缺陷，非环境性"——依然
成立；本 receipt 是该缺陷在新基线 `0a53fb55`（1313+ 个提交之后）依然
存在的首次确认。

**本次明显缺席的：** 早前 probe 的另外两个失败
（`local.spec.ts:333` 空 viewport raw-echo race，以及
`loader-composition.spec.ts:142` scrollback-eviction 超时）本次**未**
复现。本 receipt 未做进一步调查——推测可能已在 `b150a551b8` 到
`0a53fb55` 之间 1313+ 个提交中的某处被上游修复，但这只是推断，未经核实。

## 4. Honesty — 本 receipt 确立与未确立的事实

- **确立：** 在新的冻结基线上，一次真实、fail-closed（从不吞掉、从不
  retry-to-green）的全量套件 Linux CI 采集，作为 A4 唯一授权用于
  ledger 点绿的 workflow 产出的真实 artifact。早前已知的三个
  环境性/缺陷失败中有两个不再复现。
- **未确立：** `nativeTestFullSuite` 的 EXIT_0_CAPTURED——真实退出码是
  1。按 maintainer 决策 A2，这个残留失败必须作为真实的
  W0/wave 修复项被真正修掉，不得 allowlist、skip 或 retry-to-green。
  `spec/first100/exec/EXEC-STATE.json` 的 `programGate` 保持 `NO-GO`。
- **未确立**任何关于 `packInstall` 的事实——本 workflow 尚未运行 pack
  或 `verify-packed-install`；该项不受本 receipt 影响。
- First-100 仍为 0/109 ACCEPTED；W1 仍处于 BLOCKED，直到
  `inferred_idle`/`stdin_read` race 被真正修复（或 maintainer 就替代
  路径做出新决策），且 `packInstall`、`runnerDryReceipt`、
  `independentReviewReceipts` 三项仍开放的 R0 证据被采集。
