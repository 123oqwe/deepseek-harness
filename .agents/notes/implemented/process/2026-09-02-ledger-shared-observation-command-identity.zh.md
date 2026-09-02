# Agent Note: 一次共享的 First-100 CI observation 在冻结命令不同时可以点绿多个 ledger 格，而不是在文件不同时

Status: implemented

[English](2026-09-02-ledger-shared-observation-command-identity.md) | 中文

## 问题

`scripts/first100/generate-ledger.mjs` 的 `cmdGreen`/`cmdGreenSupplement` 原先禁止两个 ledger 格按内容摘要引用同一份 observation-report 文件（B7①），理论依据是：两个格指向字节相同的证据，正是"一份证明点绿多格"作弊的特征。但实际上，本程序 `.github/workflows/first100-exact-sha.yml` 这个 workflow 每次 run 在结构上只上传两份互异的 observation 文件产物（一份签名的 `first100-evidence-<sha>/vitest-report.json` bundle，一份明文的 `first100-vitest-report-<sha>/vitest-report.json` 上传）——二者内容都是同一份全量测试 JSON 报告，只是打包了两遍。字节互异规则因此把任何单次 CI run 硬顶在最多绿 2 格，不论那一次全量跑其实已经真正满足了多少条冻结命令的期望，逼着团队为多绿哪怕一格都要额外再跑一次 CI，即便证据早已在手。

## 决策

谓词 (iii)（observation 互异性）——在格点绿时机（`checkSharedObservationAllowed`，供 `cmdGreen`/`cmdGreenSupplement` 使用）和整行 accept 时机（`checkObservationDistinctness`，供 `cmdAccept` 使用）两处强制执行——现在允许两个格或 supplement 引用同一份 observation 摘要，当且仅当它们各自的冻结命令——`argv` 加上 `expectCases` 标题集合，用 `isIdenticalFrozenCommand` 比较——确实不同。两个冻结命令完全相同的消费方仍然不能都从同一份共享 observation 点绿；那仍是这条谓词本要抓的真实作弊场景。每个格自己的 case-titles 是否在共享报告里 present-and-passing，此前已由既有的 `missing` 校验独立强制执行，因此不需要新增标题核验逻辑——字节相同性这道门本就严格弱于那道检查，而不是与之互补。

`usedObservationDigests` 现在会解析并携带每个既有消费方自己的冻结 `command-freeze.json` 条目（按 `epic`/`stage`，或按 supplement 的 `supplements.epic`/`supplements.stage`/`supplementSeq` 查找），与其标签一并保存，让比较有真实数据可比，而不只是一个标签。若某个既有消费方的冻结条目解析不出，一律按冲突处理，走保守失败路径。

## 考虑过的替代方案

**保留字节互异规则，改为让 CI workflow 每次 run 上传更多份互异的 observation 文件副本。** 已拒绝：这些产物仍会是同一份全量报告改名重复打包，字节相同——原规则的作者本人后来把这类做法称为"内容等价的重复上传……本就是纸糊的"，满足了文件计数要求，却没加任何真实互异性。这也会把 ledger 每次 run 能绿多少格的上限，永久绑死在某个 workflow 作者愿意多加几份冗余上传这件事上，而与真实证据量无关。

**完全放开共享，去掉冻结命令相同性检查。** 已拒绝：这会重新打开该谓词本要防的真实作弊——一个冻结命令的单次通过观察，悄悄给一个不相关的第二个格点绿，而那个格自己的期望从未真正独立地对着那份证据跑过。

## 后果

收益：单次 CI run 的全量观察现在可以点绿它确实满足的每一个格的冻结命令，去掉了一个跟一次 run 到底产出多少真实证据毫无关系的人为单次上限。`--accept` 的整行复核套用同一条规则，因此一行永远不会在互异性这一项上，被接受成一个新鲜的 `cmdGreen` 调用自己反而会拒绝的状态。

成本：`checkObservationDistinctness` 导出签名新增了两个必填参数（`freeze`、`epicId`），用来解析每个 stage 的冻结命令以供比较；两处调用点与既有测试套件均已同步更新。比较方式是 argv 数组相等加已排序标题集合相等，不是更深的语义 diff——两个只在参数顺序上不同、其余完全一致的冻结命令，`argv` 比较会判定为不同；实践中尚未出现过这种情况，且不会削弱这道检查（它只会让规则更严，绝不会放过真实的重复）。
