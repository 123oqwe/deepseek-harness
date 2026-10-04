# Agent Note：操作者用路径 digest 确认升级的前置条件

Status: implemented

[English](2026-10-04-an-operator-confirms-an-upgrades-preconditions-with-its-path-digest.md) | 中文

## 问题

插件迁移步骤的前置条件只存在于内部的计划类型里。Plugin Manifest v2 没有对应字段，出厂插件无法声明前置条件。而带前置条件的计划一律以 `preconditions-undecided` 拒绝，操作者没有任何办法放行（B-711b 1-5；P1-10 must[0]）。

## 决定

- Manifest v2 的迁移步骤可以声明 `preconditions`，每条带非空的 `id` 与 `requirement`。校验器与 `spec/capability-manifest.schema.json` 都接受它，CLI 把它带进计划。
- 步骤的前置条件编进路径 digest，排在版本之后。没声明前置条件的步骤只编码版本，所以没有前置条件的路径，digest 不变。
- `planConfirmedUpgrade` 在操作者确认路径 digest 后放行带前置条件的路径；没有相符的确认就以 `preconditions-undecided` 拒绝，逐条列出前置条件，并给出能放行这条路径的 digest。
- 升级事务与 CLI 都用它出计划。CLI 只要拿到 `--confirm` 就传下去，所以一次确认同时覆盖路径的前置条件与不可逆路径的审批。`planUpgrade` 本身不变。

## 考虑过的替代方案

- **由 harness 检查前置条件。** 它判断不了磁盘是否可写、外部系统是否可达；靠猜的检查会让升级建立在假设之上。
- **给前置条件另加一个标志。** 同一条路径的两次确认可能不一致，而 digest 已经准确指明操作者看到的是什么。

## 后果

- 改动某条前置条件的 requirement 会改变 digest，之前的确认不再相符。
- CLI 的拒绝逐条以 `id (requirement)` 列出前置条件，并给出 `--confirm` 用的 digest。
- 未覆盖：被确认的前置条件是否真的成立，只是操作者的陈述，没有任何检查。
