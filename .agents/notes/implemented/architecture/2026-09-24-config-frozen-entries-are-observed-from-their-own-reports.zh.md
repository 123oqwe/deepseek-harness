# Agent Note：按自身 vitest 配置冻结的条目，从它自己的报告里观测

Status: implemented

[English](2026-09-24-config-frozen-entries-are-observed-from-their-own-reports.md) | 中文

## 问题

exact-SHA 工作流给账本的观测是全量报告，也就是默认 vitest 配置的一次运行。冻结成 `vitest run --config vitest.e2e.config.ts <file>` 的条目（P4-05.U.4），或按快照配置冻结的条目，从不出现在这份报告里。resolvable 门跑这类 argv 时不带 `--reporter=json`，读不到报告；in-tree 门的 `vitest list` 同样按默认配置收集，把这类条目的标题报成已删除；uniqueness 门要求全量报告覆盖 `vitest.e2e.config.ts`，把它当成了测试路径；`--supplement` 则没有报告可读。冻结里的 `-t` 值也没人核：不转义的 `[1]` 编成字符类，一条用例都选不中，运行以 0 退出，冻结的用例全部被跳过。

## 决定

- **resolvable 门在冻结 argv 没写 `--reporter=json` 时补上它。** 冻结本身不改。
- **每个按专门配置运行的步骤各写一份 JSON 报告。** keyless-smoke 与 acp 两个 e2e 步骤、录制会话快照步骤分别写 `vitest-e2e-*.json` 与 `vitest-snapshot.json`，和全量报告一起上传到 `first100-vitest-report-<sha>`。
- **in-tree 门与 uniqueness 门接受可重复的 `--e2e-report`。** in-tree 门把每份报告里的所有用例名并入 `vitest list` 收集到的名字。uniqueness 门对点名了配置的条目，只在它自己的报告里计数；argv 目标跳过 `--config` 或 `-c` 后面的值。两个步骤都排在写报告的步骤之后。
- **报告缺失或读不了时，两道门都停下。** 否则报告里的标题会被读成已删除，目标会被读成未覆盖。所以某个 e2e 步骤若在写出报告之前就失败，那一轮也拿不到 in-tree 与 uniqueness 的结论。
- **`--supplement` 拒绝没有跑遍按配置冻结的 argv 所列全部测试路径的报告**，并点出应当交哪份报告。主格（`cmdGreen`）没有这项检查。
- **resolvable 门按 vitest 的方式编译冻结的 `-t` 值**，即一个与每条用例全名匹配的 `RegExp`；只要有一条冻结的用例没被选中，就拒绝这个条目。
- **B5 签名覆盖 artifact 里的每一份报告**，不只是 `vitest-report.json`。账本工具都不读签名：`cmdGreen` 与 `--supplement` 只对交给它们的报告算哈希。报告的真实性依靠两点：CI 产物可以按 run id 追溯；delegate 在签字前按 4.4b 核对每一格的那一轮运行。

## 考虑过的其他做法

- **点名了配置的条目免于 uniqueness 门的全套件检查。** 不采用：这些条目的用例名就再也没有地方核唯一性了。
- **in-tree 门留在 e2e 步骤之前，与它们互不相干。** 不采用：它会把每个按配置冻结的标题读成已删除。
- **在这次改动里让 `--supplement` 核签名。** delegate 暂缓：全量报告也在同一个信任模型下，核验应当和「哪份签过名的文件是账本输入」这个决定放在一起。

## 后果

- 新增一个按配置冻结的条目，需要：一个工作流步骤，命令是它的 argv 加两个 reporter；一份名为 `vitest-e2e-*.json`、`vitest-snapshot*.json` 或 `vitest-web*.json` 的报告；并把这份报告加进上传、in-tree、uniqueness 与签名四处清单。工作流用例会检查这四处。
- P2-04 U.4 的 web 配置步骤与 lane A 的 P2-04 夹具一起落，候选上还没有这个夹具。
- 快照报告是 lib 模式下跑全部快照文件的一次运行，是快照条目 argv 的超集，正如全量报告之于默认配置的条目。
