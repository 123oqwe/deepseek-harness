# Agent Note: 已确认却没记下的结算，在父启动时再投一次

Status: implemented

[English](2026-09-28-a-settlement-acked-but-never-recorded-is-redelivered-when-its-parent-starts.md) | 中文

## 问题

子级的结算经持久总线送到父。drain 在同一次同步处理里把通知接进父，并把 outbox 行记为已确认；而这次接入要等活写批次刷盘才写进父日志，最多晚 200 毫秒。主机若在确认之后、刷盘之前被杀，这一行就停在已确认，任何 drain 都不会再投它，父日志里也没有这条通知：这次结算生效零次（BLOCKED-350，Epic P4-06 acceptance[0]；先红 A-566）。

## 决策

- 父的会话启动时，在排空它还欠着的行之前，把它确认过、而它的收件箱到达投影里既不在待处理、也不在已领取或已消费中的到达键所对应的结算，照 drain 的插入规则再投一次（`packages/subagent/subagent/src/continuation-activation.ts`）。这一行仍是已确认。
- 键就是收件箱自己的 `(source, id, epoch)`，投影由父的日志折叠而来，所以崩溃之前父已记下的通知不会投第二次，收件箱也接受一条从未记下的通知的再投。
- 只在会话启动时做，那时本进程还没有向这个父投过任何东西，投影就是到达它的全部记录。

## 已考虑的替代方案

- **等父日志刷盘之后才确认。** drain 在三个触发点上都得改成异步；刷盘期间仍是待投的行可能被另一个触发点再投一次；刷盘与确认之间的崩溃，仍要拿日志来比对。
- **扫父会话的历史找那次接入。** 同步读会话历史已弃用（[决策](../architecture/2026-09-09-deprecate-synchronous-session-event-reads.zh.md)）；投影里已经有这些键。

## 后果

- 在父的队列里、运行之前被取消的通知会离开投影，所以它的行若已确认，下次重启之后会再投一次。
