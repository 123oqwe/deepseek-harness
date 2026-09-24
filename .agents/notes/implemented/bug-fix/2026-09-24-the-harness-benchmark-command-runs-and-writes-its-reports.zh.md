# Agent Note: harness 基准命令跑完各条 lane 并写出两份报告

Status: implemented

[English](2026-09-24-the-harness-benchmark-command-runs-and-writes-its-reports.md) | 中文

## 问题

registry 把 P0-08 的校验命令写作 `pnpm benchmark:harness`，但根 `package.json` 里的脚本名是 `benchmark:harness-capability`，而它指向的 `benchmarks/harness-capability/runner.ts` 没有入口：运行时只加载模块就以 0 退出，既没跑 lane，也没写报告（BLOCKED-270）。也没有任何 CI 步骤运行它。

## 决策

- **脚本用 registry 里的名字。** `benchmark:harness` 运行 `benchmarks/harness-capability/runner.ts`。
- **`runner.ts` 有了入口。** 它按 `--seed`（缺省时用固定默认值）运行请求的各个 `--lane`，不给 `--lane` 时运行场景覆盖的全部 lane，并把 `report.json` 与 `report.md` 写到 `--out`，默认是被 git 忽略的 `.artifacts/benchmark`。各 lane 跑完且两份报告都已写出时以 0 退出；请求的 lane 没有场景，或 seed 不在 [0, 2^32) 内时以 2 退出。不变量的判定与被跳过的 lane 都写进两份报告，不决定退出码。
- **exact-SHA 工作流运行它。** 一个限时两分钟的步骤在未配置任何模型 API key 的情况下运行 deterministic lane，核对 `report.json` 只含这一条 lane 且有 trials、`report.md` 不为空，然后上传两份报告。

## 考虑过的替代方案

- **让退出码带上不变量判定。** 未采用：条款要求的是命令完整运行、同一 seed 可复现、两半分开计分、写出两份报告，而 deterministic lane 按构造必报违反，退出码若与判定挂钩就永远无法通过。
- **默认输出仍放在 `.dsh/` 下，每次运行前删除。** 未采用：`.dsh/` 没有被忽略，误提交的旧报告可能冒充本次运行的报告；把默认值改到 `.artifacts/` 只是一个字符串。

## 后果

- 不变量被违反的运行仍以 0 退出；判定写在报告里。
- CI 步骤核对命令写出的内容，而不是只信它的退出状态。
