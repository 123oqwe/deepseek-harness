# Agent Note：嵌套的 workflow 不会比已取消的父运行活得更久

Status: implemented

[English](2026-10-04-a-nested-workflow-does-not-outlive-its-cancelled-parent.md) | 中文

## 问题

工作流运行被取消时，会遍历它持有的嵌套运行集合，逐个取消嵌套的 `workflow()` 运行。嵌套运行要启动之后才进入这个集合，而宿主启动它之前不查父运行是否已被取消。worker 在运行已被取消、但还没读到 Cancel 消息时发来嵌套启动，就会得到一个没有任何东西取消、持续花父运行预算的嵌套运行。登记处旁的注释说它在等待启动之前登记，实际是在之后（B-709；P4-09 acceptance[1]，盲审 1-1）。

## 决定

- 运行已取消、已失去 worker 或已结算时，宿主拒绝嵌套启动，用的是 `agent()` 子 agent 已在用的同一个准入检查。拒绝写明原因，什么都不启动。
- 嵌套运行启动之后、登记之前，宿主再查一次。父运行在它启动期间被取消，宿主就 dispose 这个嵌套运行并拒绝这次调用，它既不登记，也不被等待。
- 注释改为写明代码实际的先后。只改 `packages/workflow/workflow-worker-thread/src/host.ts`。

## 考虑过的替代方案

- **在启动之前登记嵌套运行。** 运行要等引擎启动它之后才存在，之前没有东西可登记。
- **由引擎在启动嵌套运行时查父运行。** 这样引擎的嵌套端口就要读宿主运行的取消状态，而这个状态归宿主；宿主自己检查能盖住同一个时间窗，不必扩大那个端口。

## 后果

- 运行被取消之后，脚本再调 `workflow()` 会以 `nested workflow "<name>" was not started: workflow run cancelled: <reason>` reject。
- 未覆盖：在另一个进程里的嵌套运行；今天嵌套运行都在进程内启动。
