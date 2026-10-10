# Agent Note：批次先验证已提交的基线

Status: implemented

[English](2026-10-03-a-batch-verifies-the-committed-baseline-first.md) | 中文

## 问题

P0-01 must[2] 要求每个执行批次在运行之前拿锁定的基线验证，遇到上游漂移就停下并生成 rebase report。`baseline-fingerprint.mjs` 把不同的 HEAD 报成漂移，于是锁在任何更早提交上的基线都必然失败。启动时的 preflight 因此只能关着，CI 和发布 workflow 都先采一份新基线再验证，那样永远查不出漂移。出厂路径上没有一处拿锁定的基线做验证（P0-01 盲审 1-1）。

## 决定

- `verifyBaseline` 接收一个 HEAD 策略。`pnpm baseline:verify` 与 preflight 用 `'context'`，只计指纹所覆盖各面的改动，基线的提交与当前提交写在输出和 `.dsh/rebase-report.json` 里。`collect-evidence` 与 `verify-evidence` 用 `'bound'`，不同的 HEAD 仍算漂移，因为证据包绑定的是一个确切的提交。
- `first100-exact-sha.yml` 在会覆盖它的那一步之前验证已提交的 `.dsh/baseline.json`，有漂移就让 job 停下并上传 rebase report。发布 workflow 在重新捕获之前先验证已提交的基线。
- 改动了指纹所覆盖某一面的批次，把从 CI 捕获的新基线随记录一并提交。
- preflight 仍默认关闭；理由改为：开发 checkout 里尚未提交的清单改动会让每次启动中止。

## 考虑过的替代方案

- **默认打开 preflight。** 检查会在开发者机器上每次启动时跑，而那里有未提交的改动是常态；批次开始前的检查属于 CI。

## 后果

- 代码改了清单、bundle 行、协议 schema 或锁文件、却没有重采基线的批次，会停在 CI 的第一步，并点名漂移的那些面。
