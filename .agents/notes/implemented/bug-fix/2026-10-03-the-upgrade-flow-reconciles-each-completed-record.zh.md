# Agent Note: 升级流程拿每份已完成的记录与介质对账

Status: implemented

[English](2026-10-03-the-upgrade-flow-reconciles-each-completed-record.md) | 中文

## 问题

BLOCKED-302 条件 [1]，P1-10 acceptance[1]：`reconcileUpgrade` 拿插件的升级记录与介质比，可它唯一的调用方 `reportUnreconciled` 没有调用方，而且比的是包版本，不是 schema 版本。`migrateChangedPlugins` 遇到介质已在新构建所要版本的插件就跳过，迁移完就报成功，两处都不拿记录与介质比。lane A 的 A-540v2 把两处都量出来了：一份 schema 版本与介质不符的已完成记录，在跳过路径上和迁移之后都照样通过。

## 决策

- **流程碰到的每份已完成记录都对账**（裁定 (乙)，2026-09-27）：跳过路径上，对的是之前那次升级的记录；迁移之后，对的是事务刚写下的记录。没有达成那一半的记录是中断的升级，由包管理器之前的恢复流程处理，这里不对账。
- **对账拿记录的 schema 版本比介质上标记的版本；刚迁移完时，还拿记录的数据 digest 比介质记录快照的 digest。** 快照用完就丢弃。跳过路径上不比 digest，因为插件在上次升级之后自己写的数据会改变它。包版本一律不比：它与这两样各自变动。
- **对不上就判这个插件失败，调用方随之把代码放回。** 跳过路径上数据没动。迁移之后，经记录的 `previousHandle` 把被换下的数据放回，记录只留意图那一半，下次运行的恢复流程无事可撤，直接清掉。
- `UpgradeEnvironment` 在 `writeRecord` 旁加 `readRecord`；`reconcileUpgrade` 改为接收记录、只做比较；`reportUnreconciled` 读记录与介质，写出两边各是什么。

## 已考虑的替代方案

- **只在 `runUpgrade` 之后对账。** 被恢复或被改过、这次又不迁移的介质会不经检查就通过。
- **跳过路径上也比 digest。** 已完成的记录从不清除，于是每个在上次升级之后写过数据的插件，下一次包更新都会被拒。
- **迁移之后对不上时，数据留在新版本。** 调用方遇到任何失败都会把代码放回，新数据就会碰上旧代码，正是 acceptance[0] 不许的混合状态。

## 后果

- 介质与已完成记录对不上的插件，在介质或记录被改对之前，装不上也更新不了；报告写明两边。
- 验证：A-540v2（`apps/cli/tests/plugin-migration-reconcile.spec.ts`）。它的两条不符用例与介质只差记录的 schema 版本；对照是一份包版本与 schema 版本不同、但与介质一致的记录。
