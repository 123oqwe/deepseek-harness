# Agent Note：恢复撤回的是升级切换的那个 unit

Status: implemented

[English](2026-09-26-recovery-undoes-the-recorded-unit.md) | 中文

## 问题

BLOCKED-341，P1-10 acceptance[0]：在切换之后、健康检查之前崩溃，`recoverUpgrade` 回滚并丢弃的是以插件命名的 unit（`record.plugin`），而升级切换的是插件迁移模块的描述符所命名的那个 unit。这个名字由插件决定，没有任何东西要求它与包名相同。lane A 的 A-446 用插件 `notes-plugin`、unit `notes` 量到：恢复报告 `recovered`，`notes` 却仍然只能按版本 2 打开，里面是从未通过健康检查的迁移后数据。

## 决定

- **记录写明它的 unit。** `runUpgrade` 在冻结时把 `unit: request.unit.name` 写进第一份记录，之后每次写入都带着它。恢复回滚并丢弃的就是这个 unit。
- **这次改动之前写下的记录没有 unit，用它的插件名代替。** 这样的记录恢复起来和改动前的每一份记录完全一样：unit 以插件命名时撤回的是对的 unit，否则撤回错的。只有在这次改动之前、升级在快照之后崩溃，并且此后再没跑过任何 `dsh plugin` 命令时，才会有这样的记录，因为每条命令都先做恢复。

## 考虑过的替代方案

- **拒绝没有 unit 的记录。** 发布前的立场是拒绝旧的磁盘格式，但拒绝会让每条 `dsh plugin` 命令都在 pnpm 运行前停下，直到操作者手工修好记录；unit 与插件同名、旧恢复本来就对的常见情形也不例外。冻结的 P1-10 故障用例 08、09、13、14 恢复的正是这样的记录，含义会变。
- **恢复时再从插件的迁移模块解析 unit。** 已安装的代码可能已经是新版本，它的描述符未必命名被中断的升级所切换的那个 unit；只有记录看到过它。

## 后果

- `UpgradeRecord.unit` 在类型里是可选的，因为这次改动之前写下的记录没有它；`runUpgrade` 写的每份记录都带着它。
- 存储 facet 没有改动；恢复现在交给它们的是升级切换的那个 unit。
- 验证：A-446（`apps/cli/tests/plugin-migration-crash.spec.ts`），其中 switch 那条用例的 unit 与插件不同名；以及 `packages/plugin/plugin-migrations/tests/recovery.spec.ts`。
