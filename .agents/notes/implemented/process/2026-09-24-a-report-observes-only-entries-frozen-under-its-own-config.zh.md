# Agent Note：一份报告只观测在它自己的 config 下冻结的条目

Status: implemented

[English](2026-09-24-a-report-observes-only-entries-frozen-under-its-own-config.md) | 中文

## 问题

First-100 的 exact-SHA 工作流写出五份 vitest JSON 报告：默认 config 下的全量套件，`vitest.e2e.config.ts` 下的三次 e2e 运行，以及 `vitest.snapshot.config.ts` 下的录制会话快照。vitest JSON 报告不记录它运行时的 config，所以 `configFrozenReportRefusal`（位于 `scripts/first100/generate-ledger.mjs`，是把报告与冻结条目对应起来的检查）只比较测试路径。e2e 冻结工具的盲审（B-562）找到了绕过它的五种方式：另一个 config 的报告只要跑过同一个文件就被接受；带 config、不带测试路径的 argv 被接受；vitest 接受的 `-c=<path>` 写法被读成没有 config；`cmdGreen` 从不调用这道检查；不带 config 的条目接受任何报告。in-tree 标题门有对应的缺口：它把每份 `--e2e-report` 的标题都加进同一个集合，再用这个集合核对默认 config 的条目，所以只要别的 config 的运行里有同名标题，删掉一个默认 config 的测试就不会被报出。

## 决定

`REPORT_CONFIGS`（位于 `generate-ledger.mjs`）把每份观测报告的文件名映射到写出它的工作流步骤所用的 config：`vitest-report.json` 对应默认 config；`vitest-e2e-sdk-keyless-smoke.json`、`vitest-e2e-acp.json` 和 `vitest-e2e-workflow.json` 对应 `vitest.e2e.config.ts`；`vitest-snapshot.json` 对应 `vitest.snapshot.config.ts`。一个 spec 读取 `.github/workflows/first100-exact-sha.yml`，要求这张表与工作流写出的观测报告完全一致，且每份报告的 config 等于写出它的步骤的 `--config`。

`configFrozenReportRefusal(argv, reportFiles, reportPath)` 拒绝三种情况：文件名不在表中的报告；config 与条目 argv 所写 config 不同的报告；写了 config 却没有测试路径的 argv。对于在自己的 config 下冻结的条目，它仍要求报告跑过 argv 写出的每一个测试路径。`frozenCommand` 读取 `-c=<path>`，与 `--config <path>`、`--config=<path>` 和 `-c <path>` 一样。

`generate-ledger.mjs` 的两条变绿路径 `cmdGreen` 和 `--supplement`，都在解析报告之后、读取账本之前调用这道检查，拒绝时输出一行 `BLOCKED:` 并以 1 退出。`verify-freeze-case-uniqueness.mjs` 用同一道检查为条目挑选它自己的 `--e2e-report`。

`verify-frozen-titles-in-tree.mjs` 对不带 config 的条目，只在 `vitest list` 于默认 config 下收集到的名字中查找；对在自己的 config 下冻结的条目，只在这道检查为它接受的 `--e2e-report` 报告中查找。

## 考虑过的替代方案

- 在每份报告旁放一个写明其 config 的 sidecar 文件。未采用：工作流必须写出并上传它，缺了它的报告副本还要另设一道拒绝，而文件名本来就在工具收到的每个报告路径里。
- 从报告里的测试文件路径推断 config。未采用：`vitest.web.config.ts` 与 `vitest.snapshot.config.ts` 都收录 `apps/web/tests/**/*.snapshot.ts`，所以路径决定不了 config。
- 保留一个汇集所有报告标题的集合。未采用：这个集合正是盲审发现的放宽，因为另一个 config 的运行里出现的标题，说明不了默认 config 收集的源码树。

## 后果

- `narrow-report.json` 以及任何改过名的报告都会被拒绝；账本的输入只能是完整门禁运行的产物。
- 不带 config 的条目只能由 `vitest-report.json` 变绿，在某个 config 下冻结的条目只能由该 config 的报告变绿。
- `first100-exact-sha.yml` 新增观测报告时，必须在同一变更中给 `REPORT_CONFIGS` 加上对应条目；比较这张表与工作流的 spec 会一直失败，直到加上为止。
- 当某个默认 config 的标题只出现在 e2e 或快照运行中时，in-tree 门会把它报为孤儿。
- 2-1(b)，即目录前缀，保持不变：冻结 argv 中的目录路径，只要其下有一个文件跑过，仍算作跑过。
