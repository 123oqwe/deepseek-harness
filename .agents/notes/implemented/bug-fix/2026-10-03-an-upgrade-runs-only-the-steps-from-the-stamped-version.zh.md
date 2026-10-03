# Agent Note：升级只跑从版本戳起的步骤

Status: implemented

[English](2026-10-03-an-upgrade-runs-only-the-steps-from-the-stamped-version.md) | 中文

## 问题

`dsh plugin` 按介质上的 schema 版本戳规划升级、计算批准 digest、决定是否导出，实际执行的迁移却从最低的 `fromVersion` 起把全部声明步骤串起来跑。已经处在中间版本的数据，会再经过它早已经过的步骤：换算金额的一步跑了两次，版本戳以下一个不可逆的步骤在没有批准、也没有导出的情况下跑了，而所有检查都报成功（P1-10 盲审 1-2）。

## 决定

- resolution 的 `migrate` 接收版本戳，只按声明版本顺序跑从它起的声明步骤。`migrateChangedPlugins` 传入它规划时用的版本，于是计划、digest 与实际执行的步骤是同一条路径。

## 考虑过的替代方案

- **保留跑全部步骤的 `migrate`，再加一个按版本跑的。** 全链在出厂路径上不会有调用方。

## 后果

- 从中间 schema 升级，每一步只跑一次；批准写明的就是实际执行的步骤。
